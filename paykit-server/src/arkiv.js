// Arkiv (the Web3 database) for universal loyalty points: campaigns, rewards, point lots and spends.
//
// Who owns what (only the owner of an entity can edit it):
//   paykit.campaign  the earning shop      "earn N points per USDT"          expires when the campaign ends
//   paykit.reward    the redeeming shop    "P points for X off"              expires when the reward ends
//   paykit.lot       the issuing shop      points one payment earned         expires when the points expire
//   paykit.spend     the redeeming shop    points used from one lot          expires with that lot
// A shop's Arkiv account is its hosted quote-signer key, the same address MerchantRegistry lists as the
// shop's signer on Whitechain, so anyone can check that an entity really comes from that shop.
//
// Two backends with the same interface:
//   rabdi   the real Arkiv testnet, through @arkiv-network/sdk (npm install @arkiv-network/sdk viem)
//   memory  an in-process imitation (owner checks, expiry, filters) for local runs and tests
const config = require("./config");

const ENTITY_MAX_SEC = 7_884_000 * 2; // 7,884,000 blocks of 2 s (~182.5 days)

// field types: str addr u64 u256 i32 bool dec key. `idx` = can be filtered on.
const SCHEMAS = {
  campaign: {
    name: "paykit.campaign",
    fields: {
      ref: { type: "str", idx: true }, // our campaign id (camp_...)
      merchantId: { type: "str", idx: true },
      shop: { type: "str" },
      title: { type: "str" },
      pointsPerUsdt: { type: "dec", idx: true },
      minSpend: { type: "u256", opt: true },
      maxPointsPerOrder: { type: "i32", opt: true },
      budget: { type: "i32", opt: true },
      firstPurchaseOnly: { type: "bool" },
      appliesTo: { type: "str", idx: true }, // all | payments | subscriptions
      startsAt: { type: "u64", opt: true },
      endsAt: { type: "u64", opt: true },
      active: { type: "bool", idx: true },
      updatedAt: { type: "u64", idx: true },
    },
  },
  reward: {
    name: "paykit.reward",
    fields: {
      ref: { type: "str", idx: true }, // our reward id (rw_...)
      merchantId: { type: "str", idx: true },
      shop: { type: "str" },
      title: { type: "str" },
      pointsCost: { type: "i32", idx: true },
      kind: { type: "str", idx: true }, // percent_off | fixed_off
      value: { type: "str" }, // percent, or USDT base units
      maxDiscount: { type: "u256", opt: true },
      minSpend: { type: "u256", idx: true, opt: true },
      perWalletLimit: { type: "i32", opt: true },
      totalLimit: { type: "i32", opt: true },
      startsAt: { type: "u64", opt: true },
      endsAt: { type: "u64", opt: true },
      active: { type: "bool", idx: true },
      updatedAt: { type: "u64", idx: true },
    },
  },
  lot: {
    name: "paykit.lot",
    fields: {
      ref: { type: "str", idx: true }, // lot_<payment key>
      holder: { type: "addr", idx: true },
      issuer: { type: "str", idx: true }, // merchantId of the shop that issued the points
      points: { type: "i32", idx: true }, // current, after refund reversals
      originalPoints: { type: "i32" },
      paymentId: { type: "str", idx: true }, // Whitechain payment key that earned them
      txHash: { type: "str" },
      campaign: { type: "str", opt: true },
      earnedAt: { type: "u64", idx: true },
      expiresAt: { type: "u64", idx: true },
    },
  },
  spend: {
    name: "paykit.spend",
    fields: {
      ref: { type: "str", idx: true }, // sp_<payment key>_<n>
      holder: { type: "addr", idx: true },
      redeemer: { type: "str", idx: true }, // merchantId of the shop that accepted the points
      lot: { type: "key", idx: true }, // the paykit.lot entity the points came from
      lotIssuer: { type: "str", idx: true },
      points: { type: "i32" },
      paymentId: { type: "str", idx: true }, // Whitechain payment where DiscountApplied fired
      reward: { type: "str", idx: true, opt: true },
      spentAt: { type: "u64", idx: true },
    },
  },
};

const nowSec = () => Math.floor(Date.now() / 1000);
/** Seconds until `atSec`, as whole Arkiv blocks, clamped to [2 s, max lifetime]. */
function lifetimeSec(atSec) {
  let s = Math.ceil(Number(atSec) - nowSec());
  s = Math.min(Math.max(s, 2), ENTITY_MAX_SEC);
  return s + (s % 2);
}

const OPS = { eq: "=", gt: ">", gte: ">=", lt: "<", lte: "<=" };

function literal(type, v) {
  if (type === "str") return `str('${String(v).replace(/'/g, "''")}')`;
  if (type === "bool") return v ? "true" : "false";
  if (type === "i32") return `i32(${v})`;
  return `${type}(${v})`;
}
/** The same filter as the Arkiv query language, for docs and "one query we can run". */
function queryString(kind, conds = []) {
  const s = SCHEMAS[kind];
  const parts = [`arkiv.schema = str('${s.name}')`];
  for (const [field, op, value] of conds) {
    const type = field === "$owner" ? "addr" : s.fields[field].type;
    parts.push(`${field} ${OPS[op]} ${literal(type, value)}`);
  }
  return parts.join(" AND ");
}

// ─────────────────────────────── in-memory backend ───────────────────────────────

function createMemoryBackend() {
  const { ethers } = require("ethers");
  const entities = new Map();
  let n = 0;
  const live = (e) => e && e.expiresAt > nowSec();
  const ownerOf = (pk) => new ethers.Wallet(pk).address;
  const fakeTx = () => ethers.hexlify(ethers.randomBytes(32));

  function check(pk, key) {
    const e = entities.get(key);
    if (!live(e)) throw new Error(`EntityNotFound ${key}`);
    if (e.$owner !== ownerOf(pk)) throw new Error("NotOwner");
    return e;
  }
  const cmp = (a, b) => (typeof a === "number" || typeof b === "number" ? Number(a) - Number(b) : a < b ? -1 : a > b ? 1 : 0);
  const test = (val, op, want) => {
    if (val === undefined || val === null) return false;
    const c = cmp(typeof val === "string" ? val.toLowerCase() : val, typeof want === "string" ? want.toLowerCase() : want);
    return op === "eq" ? c === 0 : op === "gt" ? c > 0 : op === "gte" ? c >= 0 : op === "lt" ? c < 0 : c <= 0;
  };

  return {
    kind: "memory",
    async create(pk, kind, values, expiresAtSec) {
      const key = ethers.zeroPadValue(ethers.toBeHex(++n), 32);
      const expiresAt = nowSec() + lifetimeSec(expiresAtSec);
      entities.set(key, { kind, $key: key, $owner: ownerOf(pk), expiresAt, values: { ...values } });
      return { entityKey: key, txHash: fakeTx(), expiresAt };
    },
    async patch(pk, kind, key, set, unset = []) {
      const e = check(pk, key);
      Object.assign(e.values, set);
      for (const f of unset) delete e.values[f];
      return { entityKey: key, txHash: fakeTx() };
    },
    async extend(pk, key, expiresAtSec) {
      const e = check(pk, key);
      e.expiresAt = Math.max(e.expiresAt, nowSec() + lifetimeSec(expiresAtSec));
      return { entityKey: key, txHash: fakeTx(), expiresAt: e.expiresAt };
    },
    async remove(pk, key) {
      check(pk, key);
      entities.delete(key);
      return { entityKey: key, txHash: fakeTx() };
    },
    async query(kind, conds = [], { limit = 100, offset = 0, orderBy } = {}) {
      let rows = [...entities.values()].filter((e) => e.kind === kind && live(e));
      rows = rows.filter((e) => conds.every(([f, op, v]) => test(f === "$owner" ? e.$owner : e.values[f], op, v)));
      if (orderBy) {
        const [f, dir] = orderBy;
        rows.sort((a, b) => (dir === "desc" ? -1 : 1) * cmp(a.values[f] ?? 0, b.values[f] ?? 0));
      }
      return rows.slice(offset, offset + limit).map((e) => ({ $key: e.$key, $owner: e.$owner, $expiresAt: e.expiresAt, ...e.values }));
    },
    async balanceOf() {
      return 10n ** 18n;
    },
    async send() {
      return { txHash: fakeTx() };
    },
    address: ownerOf,
    _entities: entities, // tests only
  };
}

// ─────────────────────────────── Rabdi backend (@arkiv-network/sdk) ───────────────────────────────

function createRabdiBackend() {
  let sdk, S, Q, chains, viem, accounts;
  try {
    sdk = require("@arkiv-network/sdk");
    S = require("@arkiv-network/sdk/schema");
    Q = require("@arkiv-network/sdk/query");
    chains = require("@arkiv-network/sdk/chains");
    viem = require("viem");
    accounts = require("viem/accounts");
  } catch (e) {
    throw new Error(`Arkiv SDK missing: run "npm install @arkiv-network/sdk@1.0.1 viem" in paykit-server (${e.message})`);
  }
  const chain = chains.rabdi({ accessKey: config.arkiv.accessKey || "" });
  const transport = () => viem.http(config.arkiv.rpcUrl || undefined);
  const pub = sdk.createPublicClient({ chain, transport: transport() });

  // typed schemas from the field specs
  const col = (spec) => {
    let c = S[spec.type]();
    if (spec.idx) c = c.indexed();
    if (spec.opt) c = c.optional();
    return c;
  };
  const schemas = Object.fromEntries(
    Object.entries(SCHEMAS).map(([k, s]) => [k, S.defineSchema(s.name, Object.fromEntries(Object.entries(s.fields).map(([f, spec]) => [f, col(spec)])))])
  );
  const typed = (type, v) => {
    switch (type) {
      case "addr":
        return S.addr(v);
      case "u64":
        return S.u64(BigInt(v));
      case "u256":
        return BigInt(v);
      case "i32":
        return Number(v);
      case "dec":
        return S.dec(String(v));
      case "key":
        return S.key(v);
      case "bool":
        return !!v;
      default:
        return String(v);
    }
  };
  const typeValues = (kind, values) => {
    const out = {};
    for (const [f, v] of Object.entries(values)) {
      if (v === undefined || v === null) continue;
      out[f] = typed(SCHEMAS[kind].fields[f].type, v);
    }
    return out;
  };
  const plain = (x) => {
    const v = x && typeof x === "object" && "value" in x ? x.value : x;
    return typeof v === "bigint" ? (v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()) : v;
  };

  // one wallet client per account, with writes queued so concurrent writes never race for a nonce
  const wallets = new Map();
  function walletFor(pk) {
    if (wallets.has(pk)) return wallets.get(pk);
    const account = accounts.privateKeyToAccount(pk);
    const client = sdk.createWalletClient({ chain, transport: transport(), account });
    let tail = Promise.resolve();
    const run = (fn) => {
      const job = tail.then(() => fn(client));
      tail = job.catch(() => {});
      return job;
    };
    const w = { address: account.address, run };
    wallets.set(pk, w);
    return w;
  }
  const gas = () => BigInt(config.arkiv.gas);
  // Arkiv reports expiry as a block number; the rest of PayKit works in unix seconds
  const BLOCK_SEC = 2;
  // One reference point (block number + its time) is enough: blocks come every BLOCK_SEC, so any block number
  // converts by arithmetic. Fetch it at most every 5 minutes instead of on every query and write.
  let timing = null;
  async function blockToSec() {
    if (!timing || Date.now() - timing.at > 5 * 60_000) {
      const t = await pub.getBlockTiming();
      timing = { block: BigInt(t.currentBlock), time: Number(t.currentBlockTime), at: Date.now() };
    }
    const { block, time } = timing;
    return (b) => time + Number(BigInt(b) - block) * BLOCK_SEC;
  }
  const exp = (atSec) => sdk.ExpirationTime.fromSeconds(lifetimeSec(atSec));

  function where(kind, conds) {
    const parts = conds.map(([f, op, v]) => {
      const type = f === "$owner" ? "addr" : SCHEMAS[kind].fields[f].type;
      return Q[op](f, typed(type, v));
    });
    return parts.length > 1 ? Q.and(...parts) : parts[0];
  }

  return {
    kind: "rabdi",
    async create(pk, kind, values, expiresAtSec) {
      const r = await walletFor(pk).run((c) => c.createEntity(schemas[kind], typeValues(kind, values), { expiration: exp(expiresAtSec) }, { gas: gas() }));
      const sec = await blockToSec();
      return { entityKey: r.entityKey, txHash: r.txHash, expiresAt: sec(r.expiresAt), expiresAtBlock: Number(r.expiresAt) };
    },
    async patch(pk, kind, key, set, unset = []) {
      const patch = {};
      if (set && Object.keys(set).length) patch.set = typeValues(kind, set);
      if (unset.length) patch.unset = unset;
      const r = await walletFor(pk).run((c) => c.patchEntity(schemas[kind], key, patch, { gas: gas() }));
      return { entityKey: key, txHash: r.txHash };
    },
    async extend(pk, key, expiresAtSec) {
      const r = await walletFor(pk).run((c) => c.extendEntity({ entityKey: key, expiration: exp(expiresAtSec) }, { gas: gas() }));
      const sec = await blockToSec();
      return { entityKey: key, txHash: r.txHash, expiresAt: sec(r.expiresAt), expiresAtBlock: Number(r.expiresAt) };
    },
    async remove(pk, key) {
      const r = await walletFor(pk).run((c) => c.deleteEntity({ entityKey: key }, { gas: gas() }));
      return { entityKey: key, txHash: r.txHash };
    },
    async query(kind, conds = [], { limit = 100, offset = 0, orderBy } = {}) {
      const sel = { $key: true, $owner: true, $expiresAt: true };
      for (const f of Object.keys(SCHEMAS[kind].fields)) sel[f] = true;
      let b = pub.select(sel).from(schemas[kind]);
      if (conds.length) b = b.where(where(kind, conds));
      if (orderBy) b = b.orderBy((orderBy[1] === "desc" ? Q.desc : Q.asc)(orderBy[0]));
      const page = await Promise.race([
        b.limit(Math.min(limit, 100)).offset(offset).fetch(),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`Arkiv query for ${kind} timed out after ${config.arkiv.queryTimeoutMs / 1000} s`)), config.arkiv.queryTimeoutMs)),
      ]);
      const sec = page.entities.length ? await blockToSec() : null;
      return page.entities.map((e) => {
        const row = Object.fromEntries(Object.entries(e).map(([k, v]) => [k, plain(v)]));
        row.$expiresAtBlock = row.$expiresAt;
        row.$expiresAt = sec(e.$expiresAt); // unix seconds, same as the memory backend
        return row;
      });
    },
    async balanceOf(address) {
      return pub.getBalance({ address });
    },
    async ping() {
      return Number(await pub.getBlockNumber()); // one bare RPC round trip, for scripts/bench-arkiv.js
    },
    async send(pk, to, value) {
      const hash = await walletFor(pk).run((c) => c.sendTransaction({ to, value }));
      await pub.waitForTransactionReceipt({ hash });
      return { txHash: hash };
    },
    address: (pk) => accounts.privateKeyToAccount(pk).address,
  };
}

function createArkiv() {
  if (config.pointsBackend !== "arkiv") return { enabled: false, kind: null };
  const backend = config.arkiv.backend === "memory" ? createMemoryBackend() : createRabdiBackend();
  const explorer = config.arkiv.explorerUrl;
  return {
    enabled: true,
    ...backend,
    schemas: SCHEMAS,
    queryString,
    txUrl: (h) => (backend.kind === "memory" || !h ? null : `${explorer}/tx/${h}`),
    // entity page on the Rabdi explorer (path not confirmed in the docs; the tx link always works)
    // the explorer's per-entity page path isn't known, so an entity link exists only when ARKIV_ENTITY_URL is set
    entityUrl: (k) => (backend.kind === "memory" || !k || !config.arkiv.entityUrl ? null : config.arkiv.entityUrl.replace("{key}", k)),
    // account page of the wallet that owns the entities (a shop's signer): lists everything it wrote
    addressUrl: (a) => (backend.kind === "memory" || !a ? null : `${explorer}/address/${a}`),
    maxLifetimeSec: ENTITY_MAX_SEC,
  };
}

module.exports = { createArkiv, SCHEMAS, queryString, ENTITY_MAX_SEC };
