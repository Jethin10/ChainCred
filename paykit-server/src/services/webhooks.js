// Outbox-style webhooks: events are stored first, then delivered with retries.
// Each request is signed: header  PayKit-Signature: t=<unix>,v1=<hex hmac-sha256(secret, `${t}.${body}`)>
const crypto = require("crypto");
const config = require("../config");
const { uid, nowSec, toJson } = require("../util");

function sign(secret, timestamp, body) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

function createWebhooks(store) {
  async function enqueue(merchant, type, data) {
    const evt = {
      id: uid("evt"),
      merchantId: merchant.id,
      type,
      data: toJson(data),
      status: merchant.webhookUrl ? "pending" : "no_endpoint",
      attempts: 0,
      nextAttemptAt: new Date().toISOString(),
    };
    await store.insert("webhook_events", evt);
    return evt;
  }

  async function deliver(evt) {
    const merchant = await store.get("merchants", evt.merchantId);
    if (!merchant?.webhookUrl) {
      await store.update("webhook_events", evt.id, { status: "no_endpoint" });
      return;
    }
    const body = JSON.stringify({ id: evt.id, type: evt.type, createdAt: evt.createdAt, data: evt.data });
    const t = nowSec();
    let ok = false;
    let statusCode = null;
    let error = null;
    try {
      const res = await fetch(merchant.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "PayKit-Webhooks/0.1",
          "paykit-event": evt.type,
          "paykit-signature": `t=${t},v1=${sign(merchant.webhookSecret, t, body)}`,
        },
        body,
        signal: AbortSignal.timeout(8000),
      });
      statusCode = res.status;
      ok = res.ok;
    } catch (e) {
      error = e.message;
    }
    const attempts = evt.attempts + 1;
    if (ok) {
      await store.update("webhook_events", evt.id, { status: "delivered", attempts, statusCode, deliveredAt: new Date().toISOString() });
      console.log(`[webhooks] ${evt.type} -> ${merchant.webhookUrl} delivered`);
      return;
    }
    const failed = attempts >= config.webhookMaxAttempts;
    const delaySec = Math.min(3600, 5 * 2 ** (attempts - 1)); // 5s, 10s, 20s, ... max 1h
    await store.update("webhook_events", evt.id, {
      status: failed ? "failed" : "pending",
      attempts,
      statusCode,
      error,
      nextAttemptAt: new Date(Date.now() + delaySec * 1000).toISOString(),
    });
    console.warn(`[webhooks] ${evt.type} -> ${merchant.webhookUrl} failed (${statusCode || error}), attempt ${attempts}${failed ? ", giving up" : ""}`);
  }

  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const pending = await store.find("webhook_events", { status: "pending" }, { limit: 50, order: "asc" });
      const due = pending.filter((e) => new Date(e.nextAttemptAt).getTime() <= Date.now());
      for (const evt of due) await deliver(evt);
    } catch (e) {
      console.error("[webhooks] tick error:", e.message);
    } finally {
      running = false;
    }
  }

  function start() {
    setInterval(tick, 2000).unref();
  }

  async function redeliver(merchant, eventId) {
    const evt = await store.get("webhook_events", eventId);
    if (!evt || evt.merchantId !== merchant.id) return null;
    return store.update("webhook_events", eventId, {
      status: merchant.webhookUrl ? "pending" : "no_endpoint",
      nextAttemptAt: new Date().toISOString(),
    });
  }

  return { enqueue, start, tick, redeliver };
}

module.exports = { createWebhooks, sign };
