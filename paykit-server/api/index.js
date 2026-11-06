// Vercel entry: the same API as `npm start`, as one serverless function.
// There is no always-on process, so the background work (chain observer, subscription charges,
// webhook delivery) catches up after requests, at most every CATCH_UP_MS per instance, and on the
// daily cron (/api/cron). POST /v1/admin/scheduler/tick still forces a scheduler run.
const { waitUntil } = require("@vercel/functions");
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

module.exports = async (req, res) => {
  let svc;
  try {
    svc = await services();
  } catch (e) {
    console.error("[boot]", e.message);
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ error: { code: "unavailable", message: "Server is starting or misconfigured" } }));
  }

  if (req.url.startsWith("/api/cron")) {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.authorization !== `Bearer ${secret}`) { res.statusCode = 401; return res.end(); }
    await catchUp(svc, true);
    const refill = process.env.REFILL_ENABLED === "false" ? null : await svc.refill.run().catch((e) => ({ decision: "ERROR", reason: e.message }));
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ ok: true, refill: refill && refill.decision }));
  }

  const pending = catchUp(svc);
  if (pending) waitUntil(pending);
  return svc.app(req, res);
};
