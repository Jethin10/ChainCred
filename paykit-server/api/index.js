// Vercel entry: one function, one URL, two route sets.
//
// - paykit-server's own API (src/api.js): hosted pay pages (/v1/public/*), admin, points campaigns
//   and rewards, merchant API keys (pk_test_…), webhooks events, exports. Same as `npm start`.
// - The PayKit SDK API (packages/server, bundled in sdk/dist): every route @paykit/js and
//   @paykit/react call (status, config, directory, checkout sessions, SIWE, portal, …).
//
// There is no always-on process, so background work catches up after requests (and on the daily
// cron, /api/cron): the chain observer, subscription charges and webhooks for paykit-server, and
// payment relays and plan jobs for the SDK API.
const { waitUntil } = require("@vercel/functions");
const { Pool } = require("pg");
const { boot } = require("../src/boot");

const CATCH_UP_MS = 10_000;
let ready = null;
let running = null;
let last = 0;

function services() {
  if (!ready) ready = boot().catch((e) => { ready = null; throw e; });
  return ready;
}

function catchUp(svc, force = false) {
  if (running) return running;
  if (!force && Date.now() - last < CATCH_UP_MS) return null;
  last = Date.now();
  running = (async () => {
    await svc.observer.catchUp(8000).catch((e) => console.error("[catch-up] observer:", e.message));
    await svc.subscriptions.tick().catch((e) => console.error("[catch-up] scheduler:", e.message));
    await svc.webhooks.tick().catch((e) => console.error("[catch-up] webhooks:", e.message));
    await svc.arkivSync.tick().catch((e) => console.error("[catch-up] arkiv:", e.message));
    await svc.payments.resettlePoints().catch((e) => console.error("[catch-up] points:", e.message));
  })().finally(() => { running = null; });
  return running;
}

// ── SDK API ──
let sdkReady = null;
function sdk() {
  if (!sdkReady) {
    sdkReady = (async () => {
      const { createSdkHost } = await import("../sdk/dist/paykit-sdk.mjs");
      const url = (process.env.DATABASE_URL || "").replace(/sslmode=(require|prefer|verify-ca)\b/, "sslmode=verify-full");
      const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true }, max: 3 });
      pool.on("error", (e) => console.error("[sdk] pg pool error:", e.message));
      const siweDomains = (process.env.SDK_SIWE_DOMAINS || "paykit-app.vercel.app,localhost:5174,127.0.0.1:5174")
        .split(",").map((d) => d.trim()).filter(Boolean);
      // PAYKIT_SDK_MODE: "test" (default, and the only mode): SDK orders never move real funds.
      return createSdkHost({ query: (text, params) => pool.query(text, params), siweDomains, mode: process.env.PAYKIT_SDK_MODE || "test" });
    })().catch((e) => { sdkReady = null; throw e; });
  }
  return sdkReady;
}

// Routes only paykit-server has. Paths both APIs share (/v1/invoices, /v1/payments, /v1/plans,
// /v1/refunds) go to paykit-server when the caller uses its keys (pk_test_/pk_live_ merchant keys,
// ms_ wallet sign-in sessions, adm_ admin token); everything else is the SDK API.
const NATIVE = [
  /^\/health$/,
  /^\/v1\/public\//,
  /^\/v1\/admin\//,
  /^\/v1\/merchants\/me(\/|$)/,
  /^\/v1\/webhooks\//,
  /^\/v1\/subscriptions(\/|$)/,
  /^\/v1\/exports\/payments\.csv$/,
  /^\/v1\/points\/(campaigns|rewards|summary|ledger|customers|limits)(\/|$)/,
  /^\/v1\/refunds\/[^/]+\/authorize$/,
];
const SHARED = /^\/v1\/(invoices|payments|plans|refunds)(\/|$)/;

function isNative(req) {
  const path = req.url.split("?")[0];
  if (NATIVE.some((r) => r.test(path))) return true;
  if (req.method === "POST" && path === "/v1/merchants") return true;
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return SHARED.test(path) && /^(pk_test_|pk_live_|adm_|ms_)/.test(bearer);
}

async function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  if (req.readableEnded) {
    const b = req.body;
    if (b === undefined || b === null) return undefined;
    return Buffer.isBuffer(b) || typeof b === "string" ? b : JSON.stringify(b);
  }
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function serveSdk(req, res) {
  let host;
  try {
    host = await sdk();
  } catch (e) {
    console.error("[sdk boot]", e.message);
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.setHeader("access-control-allow-origin", "*");
    return res.end(JSON.stringify({ error: { code: "unavailable", message: "PayKit SDK API is starting or misconfigured" } }));
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
  }
  const url = `https://${req.headers.host || "localhost"}${req.url}`;
  const body = await readBody(req);
  const response = await host.handle(new Request(url, { method: req.method, headers, body }));
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
  waitUntil(host.settle());
}

module.exports = async (req, res) => {
  if (req.url.startsWith("/api/cron")) {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.authorization !== `Bearer ${secret}`) { res.statusCode = 401; return res.end(); }
    const svc = await services();
    await catchUp(svc, true);
    await sdk().then((h) => h.settle(20_000)).catch((e) => console.error("[cron] sdk:", e.message));
    const refill = process.env.REFILL_ENABLED === "false" ? null : await svc.refill.run().catch((e) => ({ decision: "ERROR", reason: e.message }));
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ ok: true, refill: refill && refill.decision }));
  }

  if (!isNative(req)) return serveSdk(req, res);

  let svc;
  try {
    svc = await services();
  } catch (e) {
    console.error("[boot]", e.message);
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ error: { code: "unavailable", message: "Server is starting or misconfigured" } }));
  }

  // Catch up only after the response is out, so it never slows the request itself.
  res.on("finish", () => {
    const pending = catchUp(svc);
    if (pending) waitUntil(pending);
  });
  return svc.app(req, res);
};
