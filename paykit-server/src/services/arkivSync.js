// Keeps Arkiv in step with the points records in Postgres, through an outbox.
//
// A change to a campaign, reward, lot or spend only enqueues "sync <kind> <id>". The worker then makes the
// Arkiv entity match the current record: create it, patch the fields that changed, extend its lifetime, or
// delete it. That makes every step idempotent and retryable, and an Arkiv outage never blocks a payment:
// the points land on Arkiv a little later.
//
// Each entity is written by the shop that owns it (its hosted signer key). A funder wallet tops shop
// accounts up with tGLM when they run low.
const config = require("../config");
const { decrypt } = require("../util");

const TABLE = { campaign: "point_campaigns", reward: "rewards", lot: "point_lots", spend: "point_spends" };
const DAY = 86400;
const nowSec = () => Math.floor(Date.now() / 1000);
const toSec = (iso) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : null);

class Wait extends Error {}

function createArkivSync(store, arkiv) {
  const enabled = !!arkiv.enabled;
  const fundedAt = new Map();
  let running = null;
  let lastError = null;
  let lastRun = null;

  // ───────── what each record looks like on Arkiv ─────────

  async function merchantOf(id) {
    const m = await store.get("merchants", id);
    if (!m) throw new Error(`merchant ${id} not found`);
    return m;
  }

  async function desired(kind, doc) {
    if (kind === "campaign") {
      const m = await merchantOf(doc.merchantId);
      return {
        owner: m,
        exists: doc.status !== "archived",
        expiresAt: toSec(doc.endsAt) || nowSec() + arkiv.maxLifetimeSec,
        values: {
          ref: doc.id,
          merchantId: doc.merchantId,
          shop: m.name.slice(0, 120),
          title: doc.name.slice(0, 120),
          pointsPerUsdt: String(doc.pointsPerUsdt),
          minSpend: doc.minSpend,
          maxPointsPerOrder: doc.maxPointsPerOrder,
          budget: doc.budget,
          firstPurchaseOnly: !!doc.firstPurchaseOnly,
          appliesTo: doc.appliesTo,
          startsAt: toSec(doc.startsAt),
          endsAt: toSec(doc.endsAt),
          active: doc.status === "active",
          updatedAt: toSec(doc.editedAt || doc.createdAt) || nowSec(),
        },
      };
    }
    if (kind === "reward") {
      const m = await merchantOf(doc.merchantId);
      return {
        owner: m,
        exists: doc.status !== "archived",
        expiresAt: toSec(doc.endsAt) || nowSec() + arkiv.maxLifetimeSec,
        values: {
          ref: doc.id,
          merchantId: doc.merchantId,
          shop: m.name.slice(0, 120),
          title: doc.name.slice(0, 120),
          pointsCost: doc.pointsCost,
          kind: doc.type,
          value: String(doc.value),
          maxDiscount: doc.maxDiscount,
          minSpend: doc.minSpend,
          perWalletLimit: doc.perWalletLimit,
          totalLimit: doc.totalLimit,
          startsAt: toSec(doc.startsAt),
          endsAt: toSec(doc.endsAt),
          active: doc.status === "active",
          updatedAt: toSec(doc.editedAt || doc.createdAt) || nowSec(),
        },
      };
    }
    if (kind === "lot") {
      return {
        owner: await merchantOf(doc.merchantId),
        exists: true, // a lot at 0 points stays as the record of what was earned and reversed
        expiresAt: toSec(doc.expiresAt),
        values: {
          ref: doc.id,
          holder: doc.wallet,
          issuer: doc.merchantId,
          points: doc.points,
          originalPoints: doc.originalPoints,
          paymentId: doc.paymentId,
          txHash: doc.txHash,
          campaign: doc.campaignDocId,
          earnedAt: toSec(doc.earnedAt),
          expiresAt: toSec(doc.expiresAt),
        },
      };
    }
    if (kind === "spend") {
      const lot = await store.get("point_lots", doc.lotId);
      if (!lot || !lot.arkivKey) throw new Wait(`waiting for lot ${doc.lotId} to reach Arkiv`);
      return {
        owner: await merchantOf(doc.merchantId),
        exists: doc.points > 0, // fully refunded: the points went back, the spend is removed
        expiresAt: toSec(lot.expiresAt),
        values: {
          ref: doc.id,
          holder: doc.wallet,
          redeemer: doc.merchantId,
          lot: lot.arkivKey,
          lotIssuer: lot.merchantId,
          points: doc.points,
          paymentId: doc.paymentId,
          reward: doc.rewardDocId,
          spentAt: toSec(doc.spentAt),
        },
      };
    }
    throw new Error(`unknown kind ${kind}`);
  }

  // ───────── gas for shop accounts ─────────

  async function ensureFunded(address) {
    const last = fundedAt.get(address);
    if (last && Date.now() - last < 10 * 60_000) return;
    const bal = await arkiv.balanceOf(address);
    const min = BigInt(config.arkiv.topupMinWei);
    if (bal < min) {
      if (!config.arkiv.funderKey) throw new Error(`Arkiv account ${address} has no tGLM: set ARKIV_FUNDER_KEY or fund it at https://hub.arkiv.network/faucet`);
      const r = await arkiv.send(config.arkiv.funderKey, address, BigInt(config.arkiv.topupWei));
      console.log(`[arkiv] topped up ${address} (tx ${r.txHash})`);
    }
    fundedAt.set(address, Date.now());
  }

  // ───────── one sync ─────────

  const clean = (v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && x !== null));
  const same = (a, b) => String(a) === String(b);

  async function syncOne(kind, id, { retry = false } = {}) {
    const table = TABLE[kind];
    const doc = await store.get(table, id);
    if (!doc) return "gone";
    const want = await desired(kind, doc);
    const pk = decrypt(want.owner.signerKeyEnc);
    const values = clean(want.values);
    let key = doc.arkivKey || null;

    if (!key) {
      if (!want.exists) return "skipped";
      await ensureFunded(arkiv.address(pk));
      // adopt an entity an earlier attempt created but did not record (crash after the write)
      const owner = arkiv.address(pk);
      // only after a failed attempt: a first attempt can't have left an entity behind, so skip the extra query
      const found = retry ? (await arkiv.query(kind, [["ref", "eq", doc.id]], { limit: 10 })).find((e) => e.$owner.toLowerCase() === owner.toLowerCase()) : null;
      if (found) {
        await store.update(table, id, { arkivKey: found.$key, arkivUrl: arkiv.entityUrl(found.$key), arkivExpiresAt: found.$expiresAt, arkivValues: null });
        return syncOne(kind, id); // now patch it to the current values
      }
      const r = await arkiv.create(pk, kind, values, want.expiresAt);
      await store.update(table, id, {
        arkivKey: r.entityKey,
        arkivOwner: arkiv.address(pk),
        arkivOwnerUrl: arkiv.addressUrl(arkiv.address(pk)),
        arkivUrl: arkiv.entityUrl(r.entityKey), // links are stored with the record, so the frontend never has to query Arkiv
        arkivTx: r.txHash,
        arkivTxUrl: arkiv.txUrl(r.txHash),
        arkivCreateTxUrl: arkiv.txUrl(r.txHash),
        arkivExpiresAt: r.expiresAt,
        arkivValues: values,
        arkivSyncedAt: new Date().toISOString(),
      });
      return "created";
    }

    if (!want.exists) {
      await ensureFunded(arkiv.address(pk));
      const r = await arkiv.remove(pk, key).catch((e) => {
        if (/EntityNotFound|EntityExpired|NoEntityFound/i.test(e.message)) return { txHash: null };
        throw e;
      });
      await store.update(table, id, { arkivKey: null, arkivUrl: null, arkivDeletedTx: r.txHash, arkivDeletedTxUrl: arkiv.txUrl(r.txHash), arkivValues: null, arkivSyncedAt: new Date().toISOString() });
      return "deleted";
    }

    const prev = doc.arkivValues || {};
    const set = {};
    for (const [f, v] of Object.entries(values)) if (!same(prev[f], v)) set[f] = v;
    const unset = Object.keys(prev).filter((f) => values[f] === undefined && arkiv.schemas[kind].fields[f]?.opt);
    // campaigns and rewards without an end date live as long as they are active: extend before the max runs out
    const extendTo = want.expiresAt > (doc.arkivExpiresAt || 0) + 60 ? want.expiresAt : null;
    if (!Object.keys(set).length && !unset.length && !extendTo) return "unchanged";

    await ensureFunded(arkiv.address(pk));
    const patch = {};
    if (Object.keys(set).length || unset.length) {
      try {
        const r = await arkiv.patch(pk, kind, key, set, unset);
        patch.arkivTx = r.txHash;
        patch.arkivTxUrl = arkiv.txUrl(r.txHash);
      } catch (e) {
        // the entity expired (or was removed) under us: write a fresh one
        if (/EntityNotFound|EntityExpired|NoEntityFound/i.test(e.message)) {
          await store.update(table, id, { arkivKey: null, arkivValues: null });
          return syncOne(kind, id);
        }
        throw e;
      }
    }
    if (extendTo) {
      const r = await arkiv.extend(pk, key, extendTo);
      patch.arkivExpiresAt = r.expiresAt;
      patch.arkivTx = r.txHash;
      patch.arkivTxUrl = arkiv.txUrl(r.txHash);
    }
    await store.update(table, id, { ...patch, arkivValues: values, arkivSyncedAt: new Date().toISOString() });
    return "patched";
  }

  // ───────── outbox ─────────

  async function enqueue(kind, doc, extra = {}) {
    if (!enabled) return;
    await store.upsert("arkiv_outbox", {
      id: `${kind}:${doc.id}`,
      merchantId: doc.merchantId,
      kind,
      docId: doc.id,
      wallet: doc.wallet || null,
      status: "pending",
      attempts: 0,
      nextAt: 0,
      lastError: null,
      ...extra,
    });
  }

  async function tick() {
    if (!enabled) return { processed: 0 };
    if (running) return running;
    running = (async () => {
      const rows = await store.find("arkiv_outbox", { status: "pending" }, { limit: 100, order: "asc" });
      let processed = 0;
      const handle = async (row) => {
        try {
          const result = await syncOne(row.kind, row.docId, { retry: (row.attempts || 0) > 0 });
          await store.update("arkiv_outbox", row.id, { status: "done", result, doneAt: new Date().toISOString(), lastError: null });
          processed++;
        } catch (e) {
          const attempts = (row.attempts || 0) + 1;
          const wait = e instanceof Wait;
          const msg = (e.shortMessage || e.message || String(e)).split("\n")[0];
          lastError = `${row.id}: ${msg}`;
          if (!wait) console.error(`[arkiv] ${row.id}: ${msg}`);
          await store.update("arkiv_outbox", row.id, {
            attempts: wait ? row.attempts || 0 : attempts,
            status: attempts >= config.arkiv.maxAttempts ? "failed" : "pending",
            nextAt: Date.now() + (wait ? 3000 : Math.min(600_000, 5000 * 2 ** Math.min(attempts, 7))),
            lastError: msg,
          });
        }
      };
      // each shop writes from its own Arkiv account, so different shops can write at the same time;
      // one shop's writes stay in order (they share a nonce)
      const byShop = new Map();
      for (const row of rows) {
        if (row.nextAt > Date.now()) continue;
        const k = row.merchantId || "_";
        if (!byShop.has(k)) byShop.set(k, []);
        byShop.get(k).push(row);
      }
      await Promise.all([...byShop.values()].map(async (list) => { for (const row of list) await handle(row); }));
      lastRun = new Date().toISOString();
      await maintain();
      return { processed };
    })().finally(() => {
      running = null;
    });
    return running;
  }

  // campaigns and rewards with no end date: extend them before Arkiv's max lifetime runs out
  let lastMaintain = 0;
  async function maintain() {
    if (Date.now() - lastMaintain < 6 * 3600_000) return;
    lastMaintain = Date.now();
    const soon = nowSec() + 30 * DAY;
    for (const [kind, table] of [["campaign", "point_campaigns"], ["reward", "rewards"]]) {
      for (const d of await store.find(table, {}, { limit: 1000 })) {
        if (d.arkivKey && d.status !== "archived" && !d.endsAt && (d.arkivExpiresAt || 0) < soon) await enqueue(kind, d);
      }
    }
  }

  async function pendingFor(wallet) {
    if (!enabled) return 0;
    return (await store.find("arkiv_outbox", { status: "pending", wallet }, { limit: 100 })).length;
  }

  const funderCache = {};
  async function status() {
    if (!enabled) return { enabled: false };
    const pending = (await store.find("arkiv_outbox", { status: "pending" }, { limit: 1000 })).length;
    const failed = await store.find("arkiv_outbox", { status: "failed" }, { limit: 20 });
    let funder = null;
    if (config.arkiv.funderKey) {
      const address = arkiv.address(config.arkiv.funderKey);
      // the balance is only for display: look it up at most once a minute (Arkiv can be slow)
      if (!funderCache.at || Date.now() - funderCache.at > 60_000) {
        funderCache.balance = (await arkiv.balanceOf(address).catch(() => null))?.toString() ?? null;
        funderCache.at = Date.now();
      }
      funder = { address, balance: funderCache.balance };
    }
    return {
      enabled: true,
      backend: arkiv.kind,
      chainId: config.arkiv.chainId,
      pending,
      failed: failed.map((f) => ({ id: f.id, attempts: f.attempts, error: f.lastError })),
      lastRun,
      lastError,
      funder,
    };
  }

  let timer = null;
  function start() {
    if (!enabled || timer) return;
    const loop = async () => {
      await tick().catch((e) => console.error("[arkiv] tick:", e.message));
      timer = setTimeout(loop, config.arkiv.pollMs);
    };
    loop();
  }

  return { enabled, enqueue, tick, start, status, pendingFor, syncOne };
}

module.exports = { createArkivSync };
