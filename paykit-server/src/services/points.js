// Universal loyalty points: no-code campaigns (issuer side) and rewards (redeemer side).
//
//   Campaign  "earn N points per 1 USDT" at one shop, with optional min spend, dates, first purchase only,
//             max points per order, total budget, and whether it applies to payments, subscriptions or both.
//             At checkout the single best eligible campaign is used (no stacking).
//   Reward    "spend P points for X% / X USDT off" at one shop, with optional max discount, min spend, dates,
//             uses per wallet and total stock. The redeeming shop funds the discount (it receives less USDT).
//
// Two backends (POINTS_BACKEND):
//   chain  Balances live onchain in PayKitPoints; the observer mirrors every PointsEarned / PointsRedeemed /
//          PointsReversed event into points_ledger and points_wallets so dashboards never query the chain.
//   arkiv  Points live on Arkiv as "lots" (points one payment earned, owned by the issuing shop, expiring
//          when the points do) and "spends" (points used from a lot, owned by the redeeming shop).
//          Campaigns and rewards are published on Arkiv too. Whitechain still settles the payment and the
//          discount (PaymentRouterV2 with 0 onchain points), and every lot and spend names that payment.
//          Postgres keeps a mirror, the reservations that stop double spends, and the Arkiv write outbox.
const { ethers, routers, points: pointsContract, txUrl } = require("../chain");
const config = require("../config");
const { HttpError, uid, parseUsdt, fmtUsdt, parseAddress } = require("../util");

const ZERO32 = ethers.ZeroHash;
const idHash = (id) => ethers.keccak256(ethers.toUtf8Bytes(id));
const nowMs = () => Date.now();

function parseDate(v, field) {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(v);
  if (isNaN(d)) throw new HttpError(400, `invalid_${field}`, `${field} must be an ISO date`);
  return d.toISOString();
}
function parsePositiveNumber(v, field, { integer = false, max } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n)) || (max !== undefined && n > max)) {
    throw new HttpError(400, `invalid_${field}`, `${field} must be a positive ${integer ? "whole " : ""}number${max ? ` up to ${max}` : ""}`);
  }
  return n;
}
const optInt = (v, field) => (v === undefined || v === null || v === "" ? null : parsePositiveNumber(v, field, { integer: true }));
const optUsdt = (v, field) => (v === undefined || v === null || v === "" ? null : parseUsdt(v, field).toString());
const inWindow = (x, t = nowMs()) => (!x.startsAt || new Date(x.startsAt).getTime() <= t) && (!x.endsAt || new Date(x.endsAt).getTime() > t);

const STATUSES = ["active", "paused", "archived"];

function createPointsService(store, relayer, arkiv = { enabled: false }, sync = { enqueue: async () => {}, pendingFor: async () => 0 }) {
  const offchain = config.pointsBackend === "arkiv" && !!arkiv.enabled;
  const onchain = !offchain;
  const backend = offchain ? "arkiv" : "chain";
  const enabled = !!routers.v2 && (offchain || !!pointsContract);
  let maxPointsPerUsdt = null; // read from chain (or kv) lazily

  function requireEnabled() {
    if (!enabled) {
      throw new HttpError(
        503,
        "points_disabled",
        offchain ? "Points need PaymentRouterV2 (set ROUTER_V2_ADDRESS)" : "Points need PaymentRouterV2 + PayKitPoints (set ROUTER_V2_ADDRESS and POINTS_ADDRESS)"
      );
    }
  }
  async function platformMax() {
    if (maxPointsPerUsdt === null) {
      if (pointsContract) maxPointsPerUsdt = Number(await pointsContract.maxPointsPerUsdt());
      else maxPointsPerUsdt = (await store.get("kv", "points.maxPointsPerUsdt"))?.value ?? config.maxPointsPerUsdt;
    }
    return maxPointsPerUsdt;
  }

  // one checkout at a time per wallet, so two quotes can't reserve the same points
  const locks = new Map();
  async function withWallet(wallet, fn) {
    const key = String(wallet || "").toLowerCase();
    const prev = locks.get(key) || Promise.resolve();
    let release;
    const mine = new Promise((r) => (release = r));
    const chained = prev.then(() => mine);
    locks.set(key, chained);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(key) === chained) locks.delete(key);
    }
  }
  // links to the Arkiv explorer, read from the record itself (saved when the entity was written), no Arkiv query needed
  const arkivRef = (d) => {
    if (!offchain) return undefined;
    if (!d.arkivKey) return d.arkivDeletedTx ? { key: null, deleted: true, deletedTxUrl: d.arkivDeletedTxUrl || txUrl_(d.arkivDeletedTx) } : { key: null, pending: true };
    return {
      key: d.arkivKey,
      url: d.arkivUrl || arkiv.entityUrl(d.arkivKey), // null unless ARKIV_ENTITY_URL is set
      ownerUrl: d.arkivOwnerUrl || (d.arkivOwner ? arkiv.addressUrl(d.arkivOwner) : null),
      createTxUrl: d.arkivCreateTxUrl || null,
      lastTxUrl: d.arkivTxUrl || arkiv.txUrl(d.arkivTx),
      expiresAt: d.arkivExpiresAt ? new Date(Number(d.arkivExpiresAt) * 1000).toISOString() : null,
      syncedAt: d.arkivSyncedAt || null,
    };
  };
  const txUrl_ = (h) => arkiv.txUrl(h);

  // ───────────────────────── campaigns (issuer side) ─────────────────────────

  function publicCampaign(c) {
    return {
      id: c.id,
      name: c.name,
      description: c.description || null,
      pointsPerUsdt: c.pointsPerUsdt,
      minSpend: c.minSpend ? fmtUsdt(c.minSpend) : null,
      maxPointsPerOrder: c.maxPointsPerOrder,
      budget: c.budget,
      issued: c.issued || 0,
      remainingBudget: c.budget ? Math.max(0, c.budget - (c.issued || 0)) : null,
      firstPurchaseOnly: !!c.firstPurchaseOnly,
      appliesTo: c.appliesTo,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      status: c.status,
      live: c.status === "active" && inWindow(c) && (!c.budget || (c.issued || 0) < c.budget),
      wallets: c.wallets || 0,
      arkiv: arkivRef(c),
      createdAt: c.createdAt,
    };
  }

  async function validateCampaign(body, partial = false) {
    const out = {};
    if (!partial || body.name !== undefined) {
      if (!body.name || typeof body.name !== "string") throw new HttpError(400, "invalid_name", "name is required");
      out.name = body.name;
    }
    if (body.description !== undefined) out.description = body.description || null;
    if (!partial || body.pointsPerUsdt !== undefined) {
      const max = await platformMax();
      out.pointsPerUsdt = parsePositiveNumber(body.pointsPerUsdt, "pointsPerUsdt", { max });
    }
    if (body.minSpend !== undefined) out.minSpend = optUsdt(body.minSpend, "minSpend");
    if (body.maxPointsPerOrder !== undefined) out.maxPointsPerOrder = optInt(body.maxPointsPerOrder, "maxPointsPerOrder");
    if (body.budget !== undefined) out.budget = optInt(body.budget, "budget");
    if (body.firstPurchaseOnly !== undefined) out.firstPurchaseOnly = !!body.firstPurchaseOnly;
    if (!partial || body.appliesTo !== undefined) {
      const a = body.appliesTo || "all";
      if (!["all", "payments", "subscriptions"].includes(a)) throw new HttpError(400, "invalid_appliesTo", 'appliesTo must be "all", "payments" or "subscriptions"');
      out.appliesTo = a;
    }
    if (body.startsAt !== undefined) out.startsAt = parseDate(body.startsAt, "startsAt");
    if (body.endsAt !== undefined) out.endsAt = parseDate(body.endsAt, "endsAt");
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) throw new HttpError(400, "invalid_status", `status must be ${STATUSES.join(", ")}`);
      out.status = body.status;
    }
    return out;
  }

  async function createCampaign(merchant, body) {
    requireEnabled();
    const v = await validateCampaign(body);
    const id = uid("camp");
    const c = await store.insert("point_campaigns", {
      id,
      merchantId: merchant.id,
      idHash: idHash(id),
      minSpend: null,
      maxPointsPerOrder: null,
      budget: null,
      firstPurchaseOnly: false,
      startsAt: null,
      endsAt: null,
      status: "active",
      issued: 0,
      wallets: 0,
      editedAt: new Date().toISOString(),
      ...v,
    });
    await sync.enqueue("campaign", c);
    return publicCampaign(c);
  }

  async function ownCampaign(merchant, id) {
    const c = await store.get("point_campaigns", id);
    if (!c || c.merchantId !== merchant.id) throw new HttpError(404, "not_found", "Campaign not found");
    return c;
  }
  const listCampaigns = async (merchant) =>
    (await store.find("point_campaigns", { merchantId: merchant.id }, { limit: 200 })).map(publicCampaign);
  const getCampaign = async (merchant, id) => publicCampaign(await ownCampaign(merchant, id));
  async function updateCampaign(merchant, id, body) {
    await ownCampaign(merchant, id);
    const c = await store.update("point_campaigns", id, { ...(await validateCampaign(body, true)), editedAt: new Date().toISOString() });
    await sync.enqueue("campaign", c);
    return publicCampaign(c);
  }

  /** Has this wallet paid this merchant before (any router)? */
  async function isReturning(merchantId, wallet) {
    return !!(await store.findOne("payments", { merchantId, payer: wallet }));
  }

  /**
   * Best eligible campaign for an amount. context: "payments" | "subscriptions".
   * Returns { points, campaign } (points = 0, campaign = null if none).
   */
  async function bestCampaign(merchantId, gross, wallet, context) {
    if (!enabled || gross <= 0n) return { points: 0, campaign: null };
    const max = await platformMax();
    const all = await store.find("point_campaigns", { merchantId, status: "active" }, { limit: 200 });
    let returning = null;
    let best = { points: 0, campaign: null };
    for (const c of all) {
      if (!inWindow(c)) continue;
      if (c.appliesTo !== "all" && c.appliesTo !== context) continue;
      if (c.minSpend && gross < BigInt(c.minSpend)) continue;
      if (c.firstPurchaseOnly) {
        if (returning === null) returning = wallet ? await isReturning(merchantId, wallet) : false;
        if (returning) continue;
      }
      const pts = pointsFrom(c, gross, max);
      if (pts > best.points) best = { points: pts, campaign: c };
    }
    return best;
  }

  /** Points one campaign gives for `gross` (rate, per-order cap, remaining budget, platform cap). */
  function pointsFrom(c, gross, max) {
    const rate = Math.min(c.pointsPerUsdt, max);
    let pts = Math.floor((Number(gross) * rate) / 1e6);
    if (c.maxPointsPerOrder) pts = Math.min(pts, c.maxPointsPerOrder);
    if (c.budget) pts = Math.min(pts, Math.max(0, c.budget - (c.issued || 0)));
    return pts;
  }
  async function campaignPoints(c, gross) {
    return c && gross > 0n ? pointsFrom(c, gross, await platformMax()) : 0;
  }

  // ───────────────────────── rewards (redeemer side) ─────────────────────────

  function publicReward(r, merchant) {
    return {
      id: r.id,
      merchant: merchant ? { id: merchant.id, name: merchant.name } : undefined,
      name: r.name,
      description: r.description || null,
      pointsCost: r.pointsCost,
      type: r.type,
      value: r.type === "percent_off" ? r.value : fmtUsdt(r.value),
      label: rewardLabel(r),
      maxDiscount: r.maxDiscount ? fmtUsdt(r.maxDiscount) : null,
      minSpend: r.minSpend ? fmtUsdt(r.minSpend) : null,
      perWalletLimit: r.perWalletLimit,
      totalLimit: r.totalLimit,
      redeemed: r.redeemed || 0,
      remaining: r.totalLimit ? Math.max(0, r.totalLimit - (r.redeemed || 0)) : null,
      pointsRedeemed: r.pointsRedeemedTotal || 0,
      discountGiven: fmtUsdt(r.discountGiven || "0"),
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      status: r.status,
      arkiv: arkivRef(r),
      createdAt: r.createdAt,
    };
  }
  function rewardLabel(r) {
    const off = r.type === "percent_off" ? `${r.value}% off` : `${fmtUsdt(r.value)} USDT off`;
    return `${r.pointsCost} points → ${off}${r.maxDiscount ? ` (max ${fmtUsdt(r.maxDiscount)} USDT)` : ""}`;
  }

  function validateReward(body, partial = false) {
    const out = {};
    if (!partial || body.name !== undefined) {
      if (!body.name || typeof body.name !== "string") throw new HttpError(400, "invalid_name", "name is required");
      out.name = body.name;
    }
    if (body.description !== undefined) out.description = body.description || null;
    if (!partial || body.pointsCost !== undefined) out.pointsCost = parsePositiveNumber(body.pointsCost, "pointsCost", { integer: true });
    if (!partial || body.type !== undefined || body.value !== undefined) {
      const type = body.type;
      if (!["percent_off", "fixed_off"].includes(type)) throw new HttpError(400, "invalid_type", 'type must be "percent_off" or "fixed_off"');
      out.type = type;
      out.value =
        type === "percent_off"
          ? parsePositiveNumber(body.value, "value", { max: 100 })
          : parseUsdt(body.value, "value").toString();
    }
    if (body.maxDiscount !== undefined) out.maxDiscount = optUsdt(body.maxDiscount, "maxDiscount");
    if (body.minSpend !== undefined) out.minSpend = optUsdt(body.minSpend, "minSpend");
    if (body.perWalletLimit !== undefined) out.perWalletLimit = optInt(body.perWalletLimit, "perWalletLimit");
    if (body.totalLimit !== undefined) out.totalLimit = optInt(body.totalLimit, "totalLimit");
    if (body.startsAt !== undefined) out.startsAt = parseDate(body.startsAt, "startsAt");
    if (body.endsAt !== undefined) out.endsAt = parseDate(body.endsAt, "endsAt");
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) throw new HttpError(400, "invalid_status", `status must be ${STATUSES.join(", ")}`);
      out.status = body.status;
    }
    return out;
  }

  async function createReward(merchant, body) {
    requireEnabled();
    const id = uid("rw");
    const r = await store.insert("rewards", {
      id,
      merchantId: merchant.id,
      idHash: idHash(id),
      maxDiscount: null,
      minSpend: null,
      perWalletLimit: null,
      totalLimit: null,
      startsAt: null,
      endsAt: null,
      status: "active",
      redeemed: 0,
      pointsRedeemedTotal: 0,
      discountGiven: "0",
      editedAt: new Date().toISOString(),
      ...validateReward(body),
    });
    await sync.enqueue("reward", r);
    return publicReward(r, merchant);
  }
  async function ownReward(merchant, id) {
    const r = await store.get("rewards", id);
    if (!r || r.merchantId !== merchant.id) throw new HttpError(404, "not_found", "Reward not found");
    return r;
  }
  const listRewards = async (merchant) =>
    (await store.find("rewards", { merchantId: merchant.id }, { limit: 200 })).map((r) => publicReward(r, merchant));
  const getReward = async (merchant, id) => publicReward(await ownReward(merchant, id), merchant);
  async function updateReward(merchant, id, body) {
    const cur = await ownReward(merchant, id);
    const patch = validateReward({ type: cur.type, ...body }, true);
    if (body.value === undefined && body.type === undefined) {
      delete patch.type;
      delete patch.value;
    }
    const r = await store.update("rewards", id, { ...patch, editedAt: new Date().toISOString() });
    await sync.enqueue("reward", r);
    return publicReward(r, merchant);
  }

  /** All live rewards across shops ("where can I spend my points?"). */
  async function marketplace({ maxPoints, source } = {}) {
    // Postgres is the working copy; ?source=arkiv reads the public copy straight from Arkiv
    if (offchain && source === "arkiv") {
      try {
        return await marketplaceFromArkiv(maxPoints);
      } catch (e) {
        console.warn("[points] Arkiv read failed, using the Postgres mirror:", e.message);
      }
    }
    const rows = (await store.find("rewards", { status: "active" }, { limit: 500 })).filter((r) => !maxPoints || r.pointsCost <= Number(maxPoints));
    const merchants = {};
    const out = [];
    for (const r of rows.filter((x) => inWindow(x))) {
      merchants[r.merchantId] ??= await store.get("merchants", r.merchantId);
      out.push(publicReward(r, merchants[r.merchantId]));
    }
    return out;
  }

  // ───────────────────────── reads straight from Arkiv ─────────────────────────

  /** Arkiv accepts writes from anyone, so an entity only counts if its owner is that shop's registered signer. */
  async function signerIndex() {
    const all = await store.find("merchants", {}, { limit: 1000 });
    return Object.fromEntries(all.map((m) => [m.id, { signer: (m.signerAddress || "").toLowerCase(), name: m.name }]));
  }
  async function queryAll(kind, conds, max = 1000) {
    const out = [];
    for (let offset = 0; offset < max; offset += 100) {
      const page = await arkiv.query(kind, conds, { limit: 100, offset });
      out.push(...page);
      if (page.length < 100) break;
    }
    return out;
  }

  /** "Where can I spend my points?" read from Arkiv: every live reward any shop published. */
  async function marketplaceFromArkiv(maxPoints) {
    const conds = [["active", "eq", true]];
    if (maxPoints) conds.push(["pointsCost", "lte", Number(maxPoints)]);
    const shops = await signerIndex();
    const t = Math.floor(nowMs() / 1000);
    const rows = (await queryAll("reward", conds, 500)).filter(
      (e) => shops[e.merchantId] && shops[e.merchantId].signer === String(e.$owner).toLowerCase() && (!e.endsAt || Number(e.endsAt) > t) && (!e.startsAt || Number(e.startsAt) <= t)
    );
    return rows.map((e) => {
      const r = {
        id: e.ref,
        name: e.title,
        pointsCost: Number(e.pointsCost),
        type: e.kind,
        value: e.kind === "percent_off" ? Number(e.value) : e.value,
        maxDiscount: e.maxDiscount != null ? String(e.maxDiscount) : null,
      };
      return {
        id: e.ref,
        merchant: { id: e.merchantId, name: shops[e.merchantId].name },
        name: e.title,
        pointsCost: r.pointsCost,
        type: e.kind,
        value: e.kind === "percent_off" ? r.value : fmtUsdt(e.value),
        label: rewardLabel(r),
        maxDiscount: r.maxDiscount ? fmtUsdt(r.maxDiscount) : null,
        minSpend: e.minSpend != null ? fmtUsdt(e.minSpend) : null,
        startsAt: e.startsAt ? new Date(Number(e.startsAt) * 1000).toISOString() : null,
        endsAt: e.endsAt ? new Date(Number(e.endsAt) * 1000).toISOString() : null,
        source: "arkiv",
        arkiv: { key: e.$key, owner: e.$owner, expiresAt: new Date(Number(e.$expiresAt) * 1000).toISOString(), url: arkiv.entityUrl(e.$key), ownerUrl: arkiv.addressUrl(e.$owner) },
      };
    });
  }

  /** A wallet's balance computed only from Arkiv: genuine lots minus genuine spends. Expired lots are gone. */
  const balanceCache = new Map(); // wallet -> {at, value}: Arkiv answers in seconds, so repeat checks reuse the last answer for 15 s
  async function arkivBalance(wallet) {
    const hit = balanceCache.get(wallet);
    if (hit && Date.now() - hit.at < 15_000) return hit.value;
    const value = await arkivBalanceFresh(wallet);
    balanceCache.set(wallet, { at: Date.now(), value });
    return value;
  }
  async function arkivBalanceFresh(wallet) {
    const shops = await signerIndex();
    const genuine = (e, field) => shops[e[field]] && shops[e[field]].signer === String(e.$owner).toLowerCase();
    const t0 = Date.now();
    const [lotRows, spendRows] = await Promise.all([queryAll("lot", [["holder", "eq", wallet]]), queryAll("spend", [["holder", "eq", wallet]])]);
    if (Date.now() - t0 > 3000) console.warn(`[points] slow Arkiv balance lookup: ${Date.now() - t0} ms`);
    const lots = lotRows.filter((e) => genuine(e, "issuer"));
    const spends = spendRows.filter((e) => genuine(e, "redeemer"));
    const spent = {};
    for (const s of spends) spent[String(s.lot).toLowerCase()] = (spent[String(s.lot).toLowerCase()] || 0) + Number(s.points);
    const balance = lots.reduce((a, l) => a + Math.max(0, Number(l.points) - (spent[String(l.$key).toLowerCase()] || 0)), 0);
    return { balance, lots: lots.length, spends: spends.length };
  }

  // ───────────────────────── wallets & ledger ─────────────────────────

  async function walletDoc(wallet) {
    return (await store.get("points_wallets", wallet)) || { id: wallet, balance: 0, lifetimeEarned: 0, lifetimeRedeemed: 0 };
  }

  /** Arkiv mode: every lot of a wallet with what is spent and left. */
  async function lotState(wallet) {
    const [lots, spends] = await Promise.all([
      store.find("point_lots", { wallet }, { limit: 2000, order: "asc" }),
      store.find("point_spends", { wallet }, { limit: 5000, order: "asc" }),
    ]);
    const spent = {};
    for (const sp of spends) spent[sp.lotId] = (spent[sp.lotId] || 0) + sp.points;
    const t = nowMs();
    return lots.map((l) => ({ ...l, spent: spent[l.id] || 0, remaining: Math.max(0, l.points - (spent[l.id] || 0)), live: new Date(l.expiresAt).getTime() > t }));
  }
  const liveBalance = (state) => state.filter((l) => l.live).reduce((a, l) => a + l.remaining, 0);

  /** Points held by checkouts in progress (quoted with a reward, not settled yet). */
  async function reservedOf(wallet) {
    const quotes = await store.find("quotes", { payer: wallet }, { limit: 200 });
    const t = nowMs();
    return quotes
      .filter((q) => (q.pointsRedeemed || 0) > 0)
      .filter((q) => q.status === "mined" || (["awaiting_signature", "submitting", "submitted"].includes(q.status) && new Date(q.expiresAt).getTime() > t))
      .reduce((a, q) => a + q.pointsRedeemed, 0);
  }

  /** What a wallet can spend right now. */
  async function spendable(wallet) {
    if (!wallet) return 0;
    if (onchain) return Number(await pointsContract.balanceOf(wallet));
    return Math.max(0, liveBalance(await lotState(wallet)) - (await reservedOf(wallet)));
  }

  async function usesOf(rewardId, wallet) {
    return (await store.find("points_ledger", { type: "redeem", rewardDocId: rewardId, wallet }, { limit: 1000 })).length;
  }

  /** Discount a reward gives on `amount`, before fee checks. */
  function discountFor(r, amount) {
    let d = r.type === "percent_off" ? (amount * BigInt(Math.round(r.value * 100))) / 10000n : BigInt(r.value);
    if (r.maxDiscount) d = d < BigInt(r.maxDiscount) ? d : BigInt(r.maxDiscount);
    return d;
  }

  /**
   * Evaluate one reward for a wallet and an amount. Returns {available, reason, discount, payAfter}.
   * `chargeable(gross)` returns null if gross is payable, else a reason (fee floor / merchant cap).
   */
  async function evaluate(r, wallet, amount, balance, chargeable) {
    const base = { discount: "0", payAfter: fmtUsdt(amount) };
    const t = nowMs();
    if (r.startsAt && new Date(r.startsAt).getTime() > t) return { ...base, available: false, reason: "not_started", message: `Starts ${r.startsAt.slice(0, 10)}` };
    if (r.totalLimit && (r.redeemed || 0) >= r.totalLimit) return { ...base, available: false, reason: "sold_out", message: "Fully redeemed" };
    if (r.minSpend && amount < BigInt(r.minSpend)) return { ...base, available: false, reason: "min_spend", message: `Spend at least ${fmtUsdt(r.minSpend)} USDT` };
    if (balance < r.pointsCost) {
      return { ...base, available: false, reason: "not_enough_points", message: `You need ${r.pointsCost - balance} more points`, pointsShort: r.pointsCost - balance };
    }
    if (r.perWalletLimit && wallet && (await usesOf(r.id, wallet)) >= r.perWalletLimit) {
      return { ...base, available: false, reason: "limit_reached", message: `Limit ${r.perWalletLimit} per customer` };
    }
    const d = discountFor(r, amount);
    if (d <= 0n || d >= amount) return { ...base, available: false, reason: "order_too_small", message: "Order too small for this reward" };
    const blocked = await chargeable(amount - d);
    if (blocked) return { ...base, available: false, reason: "order_too_small", message: blocked };
    return { available: true, reason: null, message: null, discount: fmtUsdt(d), discountBase: d, payAfter: fmtUsdt(amount - d) };
  }

  /** The offer list a checkout shows: every live reward of this shop, unavailable ones with a reason. */
  async function offersFor(merchant, wallet, amount, chargeable) {
    if (!enabled) return { enabled: false, balance: 0, offers: [] };
    const balance = wallet ? (onchain ? (await walletDoc(wallet)).balance : await spendable(wallet)) : 0;
    const rewards = (await store.find("rewards", { merchantId: merchant.id, status: "active" }, { limit: 200 })).filter(
      (r) => !r.endsAt || new Date(r.endsAt).getTime() > nowMs()
    );
    const offers = [];
    for (const r of rewards) {
      const ev = await evaluate(r, wallet, amount, balance, chargeable);
      delete ev.discountBase;
      offers.push({ ...publicReward(r), ...ev });
    }
    offers.sort((a, b) => Number(b.available) - Number(a.available) || Number(b.discount) - Number(a.discount));
    return { enabled: true, balance, offers };
  }

  /** Validate a chosen reward at quote time. Returns { reward, discount, pointsRedeemed }. */
  async function applyReward(merchant, rewardId, wallet, amount, chargeable) {
    requireEnabled();
    const r = await store.get("rewards", rewardId);
    if (!r || r.merchantId !== merchant.id || r.status !== "active" || (r.endsAt && new Date(r.endsAt).getTime() <= nowMs())) {
      throw new HttpError(400, "reward_unavailable", "This reward is not available at this shop");
    }
    const ev = await evaluate(r, wallet, amount, await spendable(wallet), chargeable);
    if (!ev.available) throw new HttpError(400, `reward_${ev.reason}`, ev.message);
    return { reward: r, discount: ev.discountBase, pointsRedeemed: r.pointsCost };
  }

  async function publicWallet(wallet, { verify = false } = {}) {
    wallet = parseAddress(wallet, "wallet");
    if (offchain) return publicWalletArkiv(wallet, verify);
    const w = await walletDoc(wallet);
    const onchain = enabled ? Number(await pointsContract.balanceOf(wallet)) : 0;
    const history = await store.find("points_ledger", { wallet }, { limit: 100 });
    return {
      wallet,
      balance: onchain,
      cachedBalance: w.balance,
      inSync: onchain === w.balance,
      lifetimeEarned: w.lifetimeEarned,
      lifetimeRedeemed: w.lifetimeRedeemed,
      token: enabled ? { address: config.points, symbol: "PKP", decimals: 0 } : null,
      history: history.map(publicLedger),
    };
  }

  async function publicWalletArkiv(wallet, verify) {
    const w = await walletDoc(wallet);
    const state = await lotState(wallet);
    const balance = liveBalance(state);
    const reserved = await reservedOf(wallet);
    const pending = await sync.pendingFor(wallet);
    const shops = await signerIndex();
    const soon = nowMs() + 7 * 86400_000;
    const lots = state
      .filter((l) => l.live)
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
      .map((l) => ({
        shop: shops[l.merchantId]?.name || l.merchantId,
        earned: l.originalPoints,
        points: l.points,
        spent: l.spent,
        remaining: l.remaining,
        earnedAt: l.earnedAt,
        expiresAt: l.expiresAt,
        paymentTxUrl: txUrl(l.txHash),
        arkiv: arkivRef(l),
      }));
    const spendDocs = await store.find("point_spends", { wallet }, { limit: 200 });
    const spends = spendDocs.map((sp) => ({
      shop: shops[sp.merchantId]?.name || sp.merchantId,
      points: sp.points,
      lotId: sp.lotId,
      spentAt: sp.spentAt,
      arkiv: arkivRef(sp),
    }));
    let onArkiv = null;
    if (verify) {
      // the Arkiv check is a bonus: never let a slow network hold the answer back
      onArkiv = await Promise.race([
        arkivBalance(wallet),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Arkiv did not answer within 8 s")), 8000)),
      ]).catch((e) => {
        console.warn("[points] Arkiv balance check failed:", e.message);
        return { error: e.message };
      });
    }
    const history = await store.find("points_ledger", { wallet }, { limit: 100 });
    return {
      wallet,
      backend: "arkiv",
      balance,
      spendable: Math.max(0, balance - reserved),
      reserved,
      lifetimeEarned: w.lifetimeEarned || 0,
      lifetimeRedeemed: w.lifetimeRedeemed || 0,
      spends,
      expiringSoon: lots.filter((l) => l.remaining > 0 && new Date(l.expiresAt).getTime() < soon).map((l) => ({ points: l.remaining, shop: l.shop, expiresAt: l.expiresAt })),
      lots,
      // copy status: every write queued for Arkiv has gone through (and, when verified, Arkiv's own total matches)
      inSync: verify ? (onArkiv && onArkiv.balance !== undefined ? onArkiv.balance === balance && pending === 0 : null) : pending === 0,
      arkiv: {
        chainId: config.arkiv.chainId,
        backend: arkiv.kind,
        balance: onArkiv && onArkiv.balance !== undefined ? onArkiv.balance : null,
        error: onArkiv && onArkiv.error ? onArkiv.error : null,
        pendingWrites: pending,
        query: arkiv.queryString("lot", [["holder", "eq", wallet]]),
      },
      token: null,
      history: history.map(publicLedger),
    };
  }

  function publicLedger(e) {
    return {
      type: e.type,
      amount: e.amount,
      merchantId: e.merchantId || null,
      merchantName: e.merchantName || null,
      campaignId: e.campaignDocId || null,
      rewardId: e.rewardDocId || null,
      paymentId: e.paymentId,
      at: e.at,
      txUrl: txUrl(e.txHash),
    };
  }

  async function ledgerFor(merchant, { wallet, type } = {}) {
    const filter = { merchantId: merchant.id, ...(wallet ? { wallet: parseAddress(wallet, "wallet") } : {}), ...(type ? { type } : {}) };
    return (await store.find("points_ledger", filter, { limit: 500 })).map((e) => ({ ...publicLedger(e), wallet: e.wallet }));
  }

  async function customer(merchant, wallet) {
    wallet = parseAddress(wallet, "wallet");
    const w = await publicWallet(wallet);
    const payments = await store.find("payments", { merchantId: merchant.id, payer: wallet }, { limit: 100 });
    const atYou = w.history.filter((h) => h.merchantId === merchant.id);
    return {
      ...w,
      ordersWithYou: payments.length,
      spentWithYou: fmtUsdt(payments.reduce((a, p) => a + BigInt(p.gross), 0n)),
      earnedWithYou: atYou.filter((h) => h.type === "earn").reduce((a, h) => a + h.amount, 0),
      redeemedWithYou: atYou.filter((h) => h.type === "redeem").reduce((a, h) => a + h.amount, 0),
    };
  }

  /** Dashboard numbers, including the cross-shop view. */
  async function summary(merchant) {
    const mine = await store.find("points_ledger", { merchantId: merchant.id }, { limit: 10000, order: "asc" });
    const earned = mine.filter((e) => e.type === "earn");
    const redeemed = mine.filter((e) => e.type === "redeem");
    const sum = (rows) => rows.reduce((a, e) => a + e.amount, 0);
    const earnWallets = new Set(earned.map((e) => e.wallet));
    const redeemWallets = new Set(redeemed.map((e) => e.wallet));

    // redeemers who had never paid you before their first redemption = customers brought in by points
    let newCustomersViaPoints = 0;
    for (const w of redeemWallets) {
      const first = redeemed.find((e) => e.wallet === w);
      const paidBefore = earned.some((e) => e.wallet === w && e.at < first.at);
      const priorPayments = await store.find("payments", { merchantId: merchant.id, payer: w }, { limit: 50, order: "asc" });
      if (!paidBefore && !priorPayments.some((p) => p.settledAt < first.at)) newCustomersViaPoints++;
    }
    // where did your customers spend points you issued?
    const elsewhere = {};
    for (const w of earnWallets) {
      const spends = await store.find("points_ledger", { wallet: w, type: "redeem" }, { limit: 500 });
      for (const s of spends) if (s.merchantId !== merchant.id) elsewhere[s.merchantName || s.merchantId] = (elsewhere[s.merchantName || s.merchantId] || 0) + s.amount;
    }
    const rewards = await store.find("rewards", { merchantId: merchant.id }, { limit: 200 });
    return {
      issued: { points: sum(earned), customers: earnWallets.size },
      reversedByRefunds: sum(mine.filter((e) => e.type === "reversal")),
      redeemedAtYou: {
        points: sum(redeemed),
        redemptions: redeemed.length,
        customers: redeemWallets.size,
        discountGiven: fmtUsdt(rewards.reduce((a, r) => a + BigInt(r.discountGiven || "0"), 0n)),
        newCustomersViaPoints,
      },
      yourCustomersSpentElsewhere: Object.entries(elsewhere).map(([shop, points]) => ({ shop, points })),
      activeCampaigns: (await store.find("point_campaigns", { merchantId: merchant.id, status: "active" }, { limit: 200 })).length,
      activeRewards: rewards.filter((r) => r.status === "active").length,
    };
  }

  // ───────────────────────── chain events (from the observer) ─────────────────────────

  async function addLedger(ev, entry) {
    const id = `${ev.txHash}:${ev.logIndex}`;
    if (await store.get("points_ledger", id)) return false; // already processed
    const m = entry.merchantId ? await store.get("merchants", entry.merchantId) : null;
    await store.insert("points_ledger", {
      id,
      ...entry,
      merchantName: m ? m.name : null,
      txHash: ev.txHash,
      blockNumber: ev.blockNumber,
      at: ev.settledAt,
    });
    return true;
  }
  async function bumpWallet(wallet, delta, field) {
    const w = await walletDoc(wallet);
    const patch = { id: wallet, balance: w.balance + delta };
    if (field) patch[field] = (w[field] || 0) + Math.abs(delta);
    await store.upsert("points_wallets", patch);
  }

  async function onPointsEarned(ev) {
    const amount = Number(ev.amount);
    const c = ev.campaignId !== ZERO32 ? await store.findOne("point_campaigns", { idHash: ev.campaignId }) : null;
    const isNewWallet = c && !(await store.findOne("points_ledger", { type: "earn", campaignDocId: c.id, wallet: ev.wallet }));
    const added = await addLedger(ev, {
      type: "earn",
      wallet: ev.wallet,
      amount,
      merchantId: ev.merchantId,
      paymentId: ev.paymentId,
      campaignDocId: c ? c.id : null,
    });
    if (!added) return;
    await bumpWallet(ev.wallet, amount, "lifetimeEarned");
    if (c) await store.update("point_campaigns", c.id, { issued: (c.issued || 0) + amount, wallets: (c.wallets || 0) + (isNewWallet ? 1 : 0) });
    const p = await store.get("payments", ev.paymentId);
    if (p) await store.update("payments", p.id, { pointsEarned: (p.pointsEarned || 0) + amount });
    console.log(`[points] +${amount} PKP to ${ev.wallet.slice(0, 8)}…${c ? ` (${c.name})` : ""}`);
  }

  async function onPointsRedeemed(ev) {
    const amount = Number(ev.amount);
    const quote = await store.findOne("quotes", { paymentKey: ev.paymentId });
    const discountBase = quote && quote.discount ? quote.discount : "0";
    const r = ev.rewardId !== ZERO32 ? await store.findOne("rewards", { idHash: ev.rewardId }) : null;
    const added = await addLedger(ev, {
      type: "redeem",
      wallet: ev.wallet,
      amount,
      merchantId: ev.merchantId,
      paymentId: ev.paymentId,
      rewardDocId: r ? r.id : null,
    });
    if (!added) return;
    await bumpWallet(ev.wallet, -amount, "lifetimeRedeemed");
    if (r) {
      await store.update("rewards", r.id, {
        redeemed: (r.redeemed || 0) + 1,
        pointsRedeemedTotal: (r.pointsRedeemedTotal || 0) + amount,
        discountGiven: (BigInt(r.discountGiven || "0") + BigInt(discountBase || 0)).toString(),
      });
    }
    const p = await store.get("payments", ev.paymentId);
    if (p) await store.update("payments", p.id, { pointsRedeemed: (p.pointsRedeemed || 0) + amount, rewardId: r ? r.id : null });
    console.log(`[points] -${amount} PKP from ${ev.wallet.slice(0, 8)}…${r ? ` (${r.name})` : ""}`);
  }

  async function onPointsReversed(ev) {
    const removed = Number(ev.earnedRemoved);
    const restored = Number(ev.redeemedRestored);
    const p = await store.get("payments", ev.paymentId);
    const added = await addLedger(ev, {
      type: "reversal",
      wallet: ev.wallet,
      amount: removed,
      restored,
      shortfall: Number(ev.shortfall),
      merchantId: p ? p.merchantId : null,
      paymentId: ev.paymentId,
    });
    if (!added) return;
    await bumpWallet(ev.wallet, restored - removed);
    console.log(`[points] refund on ${ev.paymentId.slice(0, 10)}…: -${removed} / +${restored} PKP`);
  }

  // ───────────────────────── Arkiv mode: settle points off the payment events ─────────────────────────

  async function refreshWallet(wallet) {
    if (offchain) await store.upsert("points_wallets", { id: wallet, balance: liveBalance(await lotState(wallet)) });
  }

  /** Called by the payment service once a payment settled on Whitechain (Arkiv mode only). */
  async function settleOffchain(p, quote, sub) {
    if (!offchain || !enabled) return;
    // spend before earn: points earned on this payment can't pay for this payment's discount
    if (quote && (quote.pointsRedeemed || 0) > 0) await redeemOffchain(p, quote);
    let earn = 0;
    let campaignDocId = null;
    if (quote) {
      earn = quote.pointsEarned || 0;
      campaignDocId = quote.campaignDocId || null;
    } else if (sub) {
      earn = p.kind === "down_payment" ? sub.downPaymentPoints || 0 : sub.pointsPerCharge || 0;
      campaignDocId = sub.campaignDocId || null;
    }
    if (earn > 0) await earnOffchain(p, earn, campaignDocId);
    await refreshWallet(p.payer);
    if (!p.offchainSettled) await store.update("payments", p.id, { offchainSettled: true });
  }

  async function earnOffchain(p, amount, campaignDocId) {
    const id = `lot_${p.id}`;
    if (await store.get("point_lots", id)) return; // already processed
    const earnedAt = p.settledAt || new Date().toISOString();
    const lot = await store.insert("point_lots", {
      id,
      merchantId: p.merchantId,
      wallet: p.payer,
      points: amount,
      originalPoints: amount,
      paymentId: p.id,
      txHash: p.txHash,
      campaignDocId,
      earnedAt,
      expiresAt: new Date(new Date(earnedAt).getTime() + config.pointValidityDays * 86400_000).toISOString(),
    });
    const c = campaignDocId ? await store.get("point_campaigns", campaignDocId) : null;
    const isNewWallet = c && !(await store.findOne("points_ledger", { type: "earn", campaignDocId: c.id, wallet: p.payer }));
    await addLedger(
      { txHash: p.txHash, logIndex: "earn", blockNumber: p.blockNumber, settledAt: earnedAt },
      { type: "earn", wallet: p.payer, amount, merchantId: p.merchantId, paymentId: p.id, campaignDocId, lotId: id }
    );
    const w = await walletDoc(p.payer);
    await store.upsert("points_wallets", { id: p.payer, lifetimeEarned: (w.lifetimeEarned || 0) + amount });
    if (c) await store.update("point_campaigns", c.id, { issued: (c.issued || 0) + amount, wallets: (c.wallets || 0) + (isNewWallet ? 1 : 0) });
    await store.update("payments", p.id, { pointsEarned: amount });
    await sync.enqueue("lot", lot);
    console.log(`[points] +${amount} points to ${p.payer.slice(0, 8)}… on Arkiv${c ? ` (${c.name})` : ""}`);
  }

  async function redeemOffchain(p, quote) {
    if (await store.findOne("point_spends", { paymentId: p.id })) return; // already processed
    const want = quote.pointsRedeemed;
    // use the points that expire first
    const lots = (await lotState(p.payer)).filter((l) => l.live && l.remaining > 0).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
    let left = want;
    let n = 0;
    const spends = [];
    for (const l of lots) {
      if (left <= 0) break;
      const take = Math.min(l.remaining, left);
      spends.push(
        await store.insert("point_spends", {
          id: `sp_${p.id}_${n++}`,
          merchantId: p.merchantId,
          wallet: p.payer,
          lotId: l.id,
          lotMerchantId: l.merchantId,
          points: take,
          originalPoints: take,
          paymentId: p.id,
          rewardDocId: quote.rewardDocId || null,
          spentAt: p.settledAt || new Date().toISOString(),
        })
      );
      left -= take;
    }
    const used = want - left;
    // the discount already settled onchain; if points ran out meanwhile (expired between quote and payment), say so
    if (left > 0) console.warn(`[points] ${p.id.slice(0, 10)}…: ${left} of ${want} points were no longer available (shortfall)`);
    const r = quote.rewardDocId ? await store.get("rewards", quote.rewardDocId) : null;
    await addLedger(
      { txHash: p.txHash, logIndex: "redeem", blockNumber: p.blockNumber, settledAt: p.settledAt },
      { type: "redeem", wallet: p.payer, amount: used, shortfall: left, merchantId: p.merchantId, paymentId: p.id, rewardDocId: r ? r.id : null }
    );
    const w = await walletDoc(p.payer);
    await store.upsert("points_wallets", { id: p.payer, lifetimeRedeemed: (w.lifetimeRedeemed || 0) + used });
    if (r) {
      await store.update("rewards", r.id, {
        redeemed: (r.redeemed || 0) + 1,
        pointsRedeemedTotal: (r.pointsRedeemedTotal || 0) + used,
        discountGiven: (BigInt(r.discountGiven || "0") + BigInt(quote.discount || "0")).toString(),
      });
    }
    await store.update("payments", p.id, { pointsRedeemed: used, rewardId: r ? r.id : null });
    for (const sp of spends) await sync.enqueue("spend", sp);
    console.log(`[points] -${used} points from ${p.payer.slice(0, 8)}… on Arkiv${r ? ` (${r.name})` : ""}`);
  }

  /**
   * Called once a refund settled (Arkiv mode). Same policy as PayKitPoints.onRefund: the share of the payment
   * refunded takes back that share of the points it earned, and gives back that share of the points it spent.
   *  - points given back: the refunding shop lowers its own spends on this payment
   *  - points taken back: the refunding shop lowers its own lots for this wallet (this payment's lot first);
   *    what the customer already spent elsewhere is recorded as a shortfall, never taken from other shops' lots
   */
  async function refundOffchain(paymentId, cumulativeRefunded) {
    if (!offchain || !enabled) return;
    const p = await store.get("payments", paymentId);
    if (!p) return;
    const gross = BigInt(p.gross);
    if (gross === 0n) return;
    let cum = BigInt(cumulativeRefunded);
    if (cum > gross) cum = gross;
    const earnedTarget = Number((BigInt(p.pointsEarned || 0) * cum) / gross);
    const restoreTarget = Number((BigInt(p.pointsRedeemed || 0) * cum) / gross);
    const toRemove = earnedTarget - (p.pointsEarnedReversed || 0);
    const toRestore = restoreTarget - (p.pointsRedeemedRestored || 0);
    if (toRemove <= 0 && toRestore <= 0) return;

    // give back: lower this payment's spends, the longest-lived lots first
    let r = Math.max(0, toRestore);
    if (r > 0) {
      const spends = await store.find("point_spends", { paymentId: p.id }, { limit: 100, order: "asc" });
      const lotExp = {};
      for (const sp of spends) lotExp[sp.lotId] ??= (await store.get("point_lots", sp.lotId))?.expiresAt || "";
      spends.sort((a, b) => lotExp[b.lotId].localeCompare(lotExp[a.lotId]));
      for (const sp of spends) {
        if (r <= 0) break;
        const take = Math.min(sp.points, r);
        if (take <= 0) continue;
        const updated = await store.update("point_spends", sp.id, { points: sp.points - take });
        await sync.enqueue("spend", updated);
        r -= take;
      }
    }
    const restored = Math.max(0, toRestore) - r;

    // take back: from the refunding shop's own lots for this wallet
    let x = Math.max(0, toRemove);
    if (x > 0) {
      const state = (await lotState(p.payer)).filter((l) => l.live && l.merchantId === p.merchantId && l.remaining > 0);
      state.sort((a, b) => (a.paymentId === p.id ? -1 : b.paymentId === p.id ? 1 : a.expiresAt.localeCompare(b.expiresAt)));
      for (const l of state) {
        if (x <= 0) break;
        const take = Math.min(l.remaining, x);
        const updated = await store.update("point_lots", l.id, { points: l.points - take });
        await sync.enqueue("lot", updated);
        x -= take;
      }
    }
    const removed = Math.max(0, toRemove) - x;

    await store.update("payments", p.id, { pointsEarnedReversed: earnedTarget, pointsRedeemedRestored: restoreTarget });
    await addLedger(
      { txHash: p.txHash, logIndex: `refund:${cum}`, blockNumber: p.blockNumber, settledAt: new Date().toISOString() },
      { type: "reversal", wallet: p.payer, amount: removed, restored, shortfall: x, merchantId: p.merchantId, paymentId: p.id }
    );
    await refreshWallet(p.payer);
    console.log(`[points] refund on ${p.id.slice(0, 10)}…: -${removed} / +${restored} points on Arkiv${x ? ` (shortfall ${x})` : ""}`);
  }

  async function setPlatformMax(value) {
    requireEnabled();
    const v = parsePositiveNumber(value, "maxPointsPerUsdt", { integer: true });
    if (!pointsContract) {
      await store.upsert("kv", { id: "points.maxPointsPerUsdt", value: v });
      maxPointsPerUsdt = v;
      return { maxPointsPerUsdt: v, txUrl: null };
    }
    const sent = await relayer.submit(
      "points.setMaxPointsPerUsdt",
      () => pointsContract.setMaxPointsPerUsdt.staticCall(v),
      () => pointsContract.setMaxPointsPerUsdt(v),
      {}
    );
    await sent.wait();
    maxPointsPerUsdt = v;
    return { maxPointsPerUsdt: v, txUrl: txUrl(sent.hash) };
  }

  return {
    enabled,
    onchain,
    backend,
    withWallet,
    settleOffchain,
    refundOffchain,
    arkivBalance,
    platformMax,
    createCampaign,
    listCampaigns,
    getCampaign,
    updateCampaign,
    bestCampaign,
    campaignPoints,
    createReward,
    listRewards,
    getReward,
    updateReward,
    marketplace,
    offersFor,
    applyReward,
    publicWallet,
    ledgerFor,
    customer,
    summary,
    onPointsEarned,
    onPointsRedeemed,
    onPointsReversed,
    setPlatformMax,
    idHash,
  };
}

module.exports = { createPointsService };
