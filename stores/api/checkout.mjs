// POST /api/checkout — the store's own backend (a Vercel function).
// Prices the cart from the catalog, then creates a PayKit invoice with this store's merchant key
// (STORE_API_KEY, set in the Vercel project, never sent to the browser). The browser pays the
// returned invoice through @paykit/embed without leaving the store's order page.
import { STORES, priceCart } from "./catalog.mjs";

const PAYKIT = (process.env.PAYKIT_SERVER_URL || "https://paykit-server.vercel.app").replace(/\/$/, "");

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  const store = STORES[process.env.STORE];
  const key = process.env.STORE_API_KEY;
  if (!store || !key) return send(res, 500, { error: "This store is not configured for PayKit yet" });
  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { error: "Bad request" }); }
  let priced;
  try { priced = priceCart(store, body.items); } catch (e) { return send(res, 400, { error: e.message }); }

  const reference = `${store.refPrefix}-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
  const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
  const description = priced.lines.map((l) => `${l.qty}× ${l.name}`).join(", ").slice(0, 280);
  const r = await fetch(`${PAYKIT}/v1/invoices`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      amount: priced.total,
      reference,
      description,
      successUrl: `${origin}/#order/${reference}`,
      metadata: { store: store.slug, lines: priced.lines, customer: { name: String(body.name || "").slice(0, 80) } },
    }),
  });
  const inv = await r.json().catch(() => ({}));
  if (!r.ok) return send(res, 502, { error: inv?.error?.message || "PayKit could not create the invoice" });
  return send(res, 201, { reference, invoiceId: inv.id, payUrl: inv.payUrl, total: priced.total, lines: priced.lines });
}
