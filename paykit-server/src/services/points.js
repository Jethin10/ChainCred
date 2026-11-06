// Universal loyalty points: no-code campaigns (issuer side) and rewards (redeemer side).
//
//   Campaign  "earn N points per 1 USDT" at one shop, with optional min spend, dates, first purchase only,
//             max points per order, total budget, and whether it applies to payments, subscriptions or both.
//             At checkout the single best eligible campaign is used (no stacking).
//   Reward    "spend P points for X% / X USDT off" at one shop, with optional max discount, min spend, dates,
//             uses per wallet and total stock. The redeeming shop funds the discount (it receives less USDT).
//
// Balances live onchain in PayKitPoints; the observer mirrors every PointsEarned / PointsRedeemed /
// PointsReversed event into points_ledger and points_wallets so dashboards never have to query the chain.
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

function createPointsService(store, relayer) {
  const enabled = !!(routers.v2 && pointsContract);
  let maxPointsPerUsdt = null; // read from chain lazily

  function requireEnabled() {
    if (!enabled) throw new HttpError(503, "points_disabled", "Points need PaymentRouterV2 + PayKitPoints (set ROUTER_V2_ADDRESS and POINTS_ADDRESS)");
  }
  async function platformMax() {
    if (maxPointsPerUsdt === null) maxPointsPerUsdt = Number(await pointsContract.maxPointsPerUsdt());
    return maxPointsPerUsdt;
  }

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
      ...v,
    });
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
    return publicCampaign(await store.update("point_campaigns", id, await validateCampaign(body, true)));
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
    // the epsilon keeps float error from rounding a whole result down (e.g. 50 bonus on 700 USDT -> 49.999…)
    let pts = Math.floor((Number(gross) * rate) / 1e6 + 1e-9);
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
      ...validateReward(body),
    });
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
    return publicReward(await store.update("rewards", id, patch), merchant);
  }

  /** All live rewards across shops ("where can I spend my points?"). */
  async function marketplace() {
    const rows = await store.find("rewards", { status: "active" }, { limit: 500 });
    const merchants = {};
    const out = [];
    for (const r of rows.filter((x) => inWindow(x))) {
      merchants[r.merchantId] ??= await store.get("merchants", r.merchantId);
      out.push(publicReward(r, merchants[r.merchantId]));
    }
    return out;
  }

  // ───────────────────────── wallets & ledger ─────────────────────────

  async function walletDoc(wallet) {
    return (await store.get("points_wallets", wallet)) || { id: wallet, balance: 0, lifetimeEarned: 0, lifetimeRedeemed: 0 };
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
    const balance = wallet ? (await walletDoc(wallet)).balance : 0;
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
    const onchain = Number(await pointsContract.balanceOf(wallet));
    const ev = await evaluate(r, wallet, amount, onchain, chargeable);
    if (!ev.available) throw new HttpError(400, `reward_${ev.reason}`, ev.message);
    return { reward: r, discount: ev.discountBase, pointsRedeemed: r.pointsCost };
  }

  async function publicWallet(wallet) {
    wallet = parseAddress(wallet, "wallet");
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

  async function setPlatformMax(value) {
    requireEnabled();
    const v = parsePositiveNumber(value, "maxPointsPerUsdt", { integer: true });
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
