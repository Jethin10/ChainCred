// A stand-in for the merchant's backend: receives PayKit webhooks and checks their signature.
//   npm run webhook-receiver      (listens on http://localhost:4000/webhooks)
// The secret comes from WEBHOOK_SECRET or from .demo.json (written by npm run demo).
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");

const PORT = Number(process.env.WEBHOOK_PORT || 4000);
function secret() {
  if (process.env.WEBHOOK_SECRET) return process.env.WEBHOOK_SECRET;
  const f = path.join(__dirname, "..", ".demo.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")).webhookSecret : null;
}

function verify(raw, header, sec, toleranceSec = 300) {
  const parts = Object.fromEntries(String(header || "").split(",").map((p) => p.split("=")));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", sec).update(`${parts.t}.${raw}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const app = express();
app.post("/webhooks", express.text({ type: "*/*" }), (req, res) => {
  const sec = secret();
  const ok = sec && verify(req.body, req.get("paykit-signature"), sec);
  if (!ok) {
    console.log(`✗ rejected ${req.get("paykit-event")} (bad signature)`);
    return res.status(400).send("bad signature");
  }
  const evt = JSON.parse(req.body);
  const d = evt.data;
  let line = "";
  if (evt.type === "payment.settled") line = `${d.payment.gross} USDT from ${d.payment.payer} -> invoice ${d.invoice?.id || "-"} (${d.invoice?.status || ""})  ${d.payment.txUrl}`;
  else if (evt.type === "invoice.paid") line = `invoice ${d.invoice.id} ref ${d.invoice.reference} is PAID — ship the order`;
  else if (evt.type === "refund.settled") line = `refund ${d.refund.amount} USDT, total refunded ${d.cumulativeRefunded}  ${d.refund.txUrl || ""}`;
  else if (evt.type.startsWith("subscription.")) {
    const s = d.subscription;
    line = `${s.id} ${s.status}  paid ${s.chargesPaid} charge(s) / ${s.amountPaid} USDT`;
    if (evt.type === "subscription.charged") line += `  cycle ${d.cycle + 1}: ${d.amount} USDT  ${d.txUrl}`;
    if (evt.type === "subscription.charge_failed") line += `  (${d.reason}, retry in ${d.retryInSeconds}s)`;
    if (evt.type === "subscription.cancelled") line += `  by ${d.by}`;
  } else line = JSON.stringify(d);
  console.log(`✓ ${new Date().toLocaleTimeString()}  ${evt.type}  ${line}`);
  res.sendStatus(200);
});

app.listen(PORT, () => console.log(`Webhook receiver on http://localhost:${PORT}/webhooks (signature checked)`));
