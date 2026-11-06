// paykit: accept USDT on Whitechain from your server. No dependencies; runs on Node 18+, Bun, Deno,
// Vercel/Cloudflare edge. The browser half is `paykit/checkout`.
//
//   import { PayKit } from "paykit";
//   const paykit = new PayKit({ apiKey: process.env.PAYKIT_API_KEY });
//   const invoice = await paykit.invoices.create({ amount: "12.50", reference: order.id });
//   // send invoice.id to the browser, then openCheckout({ invoiceId }) there

export const DEFAULT_SERVER_URL = "https://paykit-server.vercel.app";
export const ONBOARDING_URL = "https://paykit-app.vercel.app/#merchant";

export class PayKitError extends Error {
  /** @param {string} message @param {{ status?: number, code?: string, details?: unknown }} [info] */
  constructor(message, info = {}) {
    super(message);
    this.name = "PayKitError";
    this.status = info.status ?? 0;
    this.code = info.code ?? "paykit_error";
    this.details = info.details;
  }
}

const env = (k) => (typeof process !== "undefined" && process.env ? process.env[k] : undefined);
const enc = encodeURIComponent;

export class PayKit {
  /** @param {{ apiKey?: string, serverUrl?: string, fetch?: typeof fetch, timeoutMs?: number }} [options] */
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? env("PAYKIT_API_KEY");
    this.serverUrl = (options.serverUrl ?? env("PAYKIT_SERVER_URL") ?? DEFAULT_SERVER_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this._fetch = options.fetch ?? globalThis.fetch;
    if (!this._fetch) throw new PayKitError("No fetch available. Use Node 18+ or pass options.fetch.");

    const req = this.request.bind(this);
    this.merchant = {
      /** Your merchant account (name, payout wallet, profile). */
      get: () => req("GET", "/v1/merchants/me"),
      /** Update webhookUrl or profile ({ website, category, tagline, accent }). */
      update: (patch) => req("PATCH", "/v1/merchants/me", patch),
    };
    this.invoices = {
      /** amount is a USDT decimal string such as "12.50". Returns the invoice with id and payUrl. */
      create: (input) => req("POST", "/v1/invoices", { ...input, amount: String(input?.amount ?? "") }),
      get: (id) => req("GET", `/v1/invoices/${enc(id)}`),
      list: async () => (await req("GET", "/v1/invoices")).data,
      /** Public view, no key needed: status, amountDue, merchant branding. */
      getPublic: (id) => req("GET", `/v1/public/invoices/${enc(id)}`, undefined, { auth: false }),
      /** Resolves when the invoice is paid (or throws after timeoutMs). */
      waitForPaid: async (id, { timeoutMs = 5 * 60_000, intervalMs = 2_000 } = {}) => {
        const end = Date.now() + timeoutMs;
        for (;;) {
          const inv = await req("GET", `/v1/public/invoices/${enc(id)}`, undefined, { auth: false });
          if (inv.status === "paid") return inv;
          if (Date.now() > end) throw new PayKitError(`Invoice ${id} is still ${inv.status}`, { code: "timeout" });
          await new Promise((r) => setTimeout(r, intervalMs));
        }
      },
    };
    this.payments = {
      list: async () => (await req("GET", "/v1/payments")).data,
      get: (id) => req("GET", `/v1/payments/${enc(id)}`),
      /** Public receipt, cross-checked against the chain (receipt.onchain.verified). */
      receipt: (paymentId) => req("GET", `/v1/public/receipts/${enc(paymentId)}`, undefined, { auth: false }),
    };
    this.refunds = {
      /** Starts a refund. The payout wallet signs the returned typedData, then call authorize. */
      create: (paymentId, input = {}) => req("POST", `/v1/payments/${enc(paymentId)}/refunds`, input),
      authorize: (refundId, signature) => req("POST", `/v1/refunds/${enc(refundId)}/authorize`, { signature }),
    };
    this.plans = {
      /** Subscriptions and installment plans. Customers subscribe at payUrl or #pay/subscribe/<planId>. */
      create: (input) => req("POST", "/v1/plans", input),
      list: async () => (await req("GET", "/v1/plans")).data,
      get: (id) => req("GET", `/v1/plans/${enc(id)}`),
      setActive: (id, active) => req("PATCH", `/v1/plans/${enc(id)}`, { active }),
    };
    this.subscriptions = {
      list: async (status) => (await req("GET", `/v1/subscriptions${status ? `?status=${enc(status)}` : ""}`)).data,
      get: (id) => req("GET", `/v1/subscriptions/${enc(id)}`),
      cancel: (id) => req("POST", `/v1/subscriptions/${enc(id)}/cancel`),
    };
    this.points = {
      summary: () => req("GET", "/v1/points/summary"),
      createCampaign: (input) => req("POST", "/v1/points/campaigns", input),
      listCampaigns: async () => (await req("GET", "/v1/points/campaigns")).data,
      createReward: (input) => req("POST", "/v1/points/rewards", input),
      listRewards: async () => (await req("GET", "/v1/points/rewards")).data,
      customer: (wallet) => req("GET", `/v1/points/customers/${enc(wallet)}`),
    };
    this.webhooks = {
      /** Sends a signed test event to your webhookUrl. */
      test: () => req("POST", "/v1/webhooks/test"),
      events: async () => (await req("GET", "/v1/webhooks/events")).data,
      redeliver: (eventId) => req("POST", `/v1/webhooks/events/${enc(eventId)}/redeliver`),
      /** Verifies a delivery and returns the parsed event. See verifyWebhook. */
      verify: (rawBody, signatureHeader, secret = env("PAYKIT_WEBHOOK_SECRET"), opts) => verifyWebhook(rawBody, signatureHeader, secret, opts),
    };
  }

  /** Server health: chain, contracts, relayer. No key needed. */
  health() {
    return this.request("GET", "/health", undefined, { auth: false });
  }

  async request(method, path, body, { auth = true } = {}) {
    if (auth && !this.apiKey) {
      throw new PayKitError(`Missing API key. Set PAYKIT_API_KEY or pass { apiKey }. Get one at ${ONBOARDING_URL}`, { code: "missing_api_key" });
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res;
    try {
      res = await this._fetch(this.serverUrl + path, {
        method,
        signal: ctrl.signal,
        headers: {
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(auth ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new PayKitError(e?.name === "AbortError" ? `PayKit did not answer within ${this.timeoutMs} ms` : `Could not reach PayKit at ${this.serverUrl}`, { code: "network", details: e });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
      throw new PayKitError(json?.error?.message || `PayKit ${method} ${path} failed (${res.status})`, { status: res.status, code: json?.error?.code, details: json ?? text });
    }
    return json;
  }
}

// ── webhooks ──
// Header:  PayKit-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmacHex(secret, message) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new PayKitError("Web Crypto is not available (Node 18+ required)");
  const te = new TextEncoder();
  const key = await subtle.importKey("raw", te.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await subtle.sign("HMAC", key, te.encode(message)));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Checks a webhook delivery and returns the event { id, type, createdAt, data }.
 * Pass the RAW request body (string or bytes), not re-serialized JSON.
 * @param {string | Uint8Array | ArrayBuffer} rawBody
 * @param {string | null | undefined} signatureHeader  value of the `paykit-signature` header
 * @param {string} secret  your webhook secret (whsec_...)
 * @param {{ toleranceSeconds?: number, now?: number }} [opts]
 */
export async function verifyWebhook(rawBody, signatureHeader, secret, { toleranceSeconds = 300, now = Date.now() } = {}) {
  if (!secret) throw new PayKitError("Missing webhook secret. Set PAYKIT_WEBHOOK_SECRET.", { code: "missing_secret" });
  const body = typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody);
  const parts = Object.fromEntries(String(signatureHeader || "").split(",").map((p) => p.trim().split("=")));
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(t)) throw new PayKitError("Missing or malformed PayKit-Signature header", { status: 400, code: "bad_signature" });
  if (Math.abs(now / 1000 - t) > toleranceSeconds) throw new PayKitError("Webhook timestamp is too old", { status: 400, code: "stale_signature" });
  if (!safeEqual(await hmacHex(secret, `${t}.${body}`), parts.v1)) throw new PayKitError("Webhook signature does not match", { status: 400, code: "bad_signature" });
  return JSON.parse(body);
}

/** For tests: builds the header PayKit would send for this body. */
export async function signWebhook(rawBody, secret, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${await hmacHex(secret, `${t}.${rawBody}`)}`;
}

export default PayKit;
