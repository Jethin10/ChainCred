// End-to-end demo against a running server (npm start in another terminal):
//   merchant onboarding -> invoice / payment link -> customer pays gaslessly -> webhook -> receipt
//   -> partial refund -> accountant CSV export
//   npm run demo
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ask, askAddress, askPrivateKey, askAmount } = require(path.resolve(
  __dirname,
  "..",
  process.env.CONTRACTS_DIR || "../paykit-contracts",
  "scripts",
  "lib",
  "prompt.js"
));

const API = process.env.PAYKIT_API || `http://localhost:${process.env.PORT || 8787}`;
const STATE = path.join(__dirname, "..", ".demo.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, url, { token, body } = {}) {
  const res = await fetch(API + url, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text;
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${data?.error ? data.error.code + ": " + data.error.message : text}`);
  return data;
}

async function waitFor(label, fn, done, timeoutMs = 120_000) {
  const t0 = Date.now();
  process.stdout.write(`  waiting for ${label} `);
  for (;;) {
    const v = await fn();
    if (done(v)) {
      process.stdout.write(" ✓\n");
      return v;
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    process.stdout.write(".");
    await sleep(2000);
  }
}

async function main() {
  const health = await call("GET", "/health").catch(() => {
    throw new Error(`Server not reachable at ${API}. Start it with "npm start" in another terminal.`);
  });
  console.log(`\nServer ok: chain ${health.chainId}, store ${health.store}, relayer ${health.relayer.address}`);

  // ── 1. merchant (once) ──
  let state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : null;
  if (state && health.store === "memory") {
    // in-memory server forgets merchants on restart; check it still knows ours
    const ok = await call("GET", "/v1/merchants/me", { token: state.apiKey }).then(() => true, () => false);
    if (!ok) state = null;
  }
  if (!state) {
    console.log("\n── 1. Onboard a merchant ──");
    const name = (await ask("Merchant name [Enter = Demo Coffee Co]: ")) || "Demo Coffee Co";
    const payoutAddress = await askAddress("Merchant PAYOUT wallet (gets paid, funds refunds).");
    const webhookUrl = (await ask("Webhook URL [Enter = http://localhost:4000/webhooks]: ")) || "http://localhost:4000/webhooks";
    console.log("  registering onchain (2 transactions, ~10s) …");
    const r = await call("POST", "/v1/merchants", {
      token: process.env.ADMIN_TOKEN,
      body: { name, payoutAddress, webhookUrl },
    });
    state = { merchantId: r.merchant.id, apiKey: r.apiKey, webhookSecret: r.webhookSecret, payoutAddress, name };
    fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
    console.log(`  ✓ merchant ${r.merchant.id}\n    ${r.merchant.registerTx}`);
    console.log(`  API key and webhook secret saved to .demo.json (run "npm run webhook-receiver" to see events)`);
  } else {
    console.log(`\nUsing merchant "${state.name}" ${state.merchantId} from .demo.json`);
  }
  const key = state.apiKey;

  // ── 2. invoice / payment link (what the merchant's backend does) ──
  console.log("\n── 2. Merchant creates an invoice ──");
  const amount = await askAmount("Invoice amount in USDT", "2");
  const inv = await call("POST", "/v1/invoices", {
    token: key,
    body: {
      amount,
      reference: `ORDER-${Date.now().toString().slice(-6)}`,
      description: "Demo order",
      dueDate: new Date(Date.now() + 7 * 86400_000).toISOString(),
    },
  });
  console.log(`  ✓ ${inv.id}  ${inv.amount} USDT  ref ${inv.reference}  due ${inv.dueDate.slice(0, 10)}`);
  console.log(`    pay link: ${inv.payUrl}`);

  // ── 3. customer pays (what the checkout page does) ──
  console.log("\n── 3. Customer pays (gasless) ──");
  const payer = await askPrivateKey("CUSTOMER wallet paying the invoice. Needs USDT, no WBT.", null);
  const quote = await call("POST", `/v1/public/invoices/${inv.id}/quote`, { body: { payer: payer.address } });
  console.log(`  quote ${quote.quoteId}: pay ${quote.gross} USDT (merchant gets ${quote.net}, fee ${quote.fee}), expires ${quote.expiresAt}`);
  const { domain, types, message } = quote.typedData;
  const signature = await payer.signTypedData(domain, types, message);
  console.log(`  customer signed "ReceiveWithAuthorization ${quote.gross} USDT" (no gas)`);
  const sub = await call("POST", `/v1/public/quotes/${quote.quoteId}/authorize`, { body: { signature } });
  console.log(`  submitted by the relayer: ${sub.txUrl}`);
  await waitFor("confirmation", () => call("GET", `/v1/public/quotes/${quote.quoteId}`), (q) => q.status === "confirmed" || q.status === "failed");
  const invAfter = await call("GET", `/v1/invoices/${inv.id}`, { token: key });
  console.log(`  ✓ invoice status: ${invAfter.status} (paid ${invAfter.amountPaid} of ${invAfter.amount})`);

  const receipt = await call("GET", `/v1/public/receipts/${quote.paymentId}`);
  console.log(`  public receipt: ${API}/v1/public/receipts/${quote.paymentId}`);
  console.log(`    verified onchain: ${receipt.onchain.verified}, refunds go to ${receipt.onchain.refundTo}`);

  // ── 4. refund (merchant dashboard) ──
  console.log("\n── 4. Merchant refunds part of it ──");
  const refundAmt = await ask(`Refund amount in USDT [Enter = skip, max ${receipt.onchain.gross}]: `);
  if (refundAmt) {
    const rf = await call("POST", `/v1/payments/${quote.paymentId}/refunds`, { token: key, body: { amount: refundAmt, reason: "Demo partial refund" } });
    const funder = await askPrivateKey(`PAYOUT wallet ${rf.refund.funder} (funds the refund; needs USDT, no WBT).`, null);
    if (funder.address !== rf.refund.funder) throw new Error(`That key is for ${funder.address}, expected ${rf.refund.funder}`);
    const rsig = await funder.signTypedData(rf.typedData.domain, rf.typedData.types, rf.typedData.message);
    const done = await call("POST", `/v1/refunds/${rf.refund.id}/authorize`, { token: key, body: { signature: rsig } });
    console.log(`  submitted: ${done.txUrl}`);
    await waitFor(
      "refund confirmation",
      () => call("GET", `/v1/payments/${quote.paymentId}`, { token: key }),
      (p) => p.refunds.some((r) => r.id === rf.refund.id && r.status === "confirmed")
    );
    const p = await call("GET", `/v1/payments/${quote.paymentId}`, { token: key });
    console.log(`  ✓ refunded ${p.refunded} of ${p.gross} USDT to ${p.refundTo}`);
  }

  // ── 5. accountant export ──
  console.log("\n── 5. Accountant export ──");
  const csv = await call("GET", "/v1/exports/payments.csv", { token: key });
  const outDir = path.join(__dirname, "..", "exports");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `payments-${new Date().toISOString().slice(0, 10)}.csv`);
  fs.writeFileSync(file, csv);
  console.log(`  ✓ ${csv.trim().split("\n").length - 1} rows saved to ${path.relative(process.cwd(), file)}`);
  console.log("\nDone.");
}

main().catch((e) => {
  console.error("\n✗", e.message || e);
  process.exitCode = 1;
});
