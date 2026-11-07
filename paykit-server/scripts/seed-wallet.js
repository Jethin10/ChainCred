// Fills one customer wallet with realistic activity, against a running server (npm start in another terminal):
//
//   npm run seed:wallet
//
// Everything is paid by YOUR wallet (the one you give a private key for), gaslessly through PayKit:
//   1. a paid invoice at Tee Shop          -> earns points
//   2. a paid invoice at Jeans Co          -> pays with a points reward (discount, points spent)
//   3. a paid invoice at Tee Shop          -> then partly refunded (shop takes back part of the points)
//   4. three UNPAID invoices addressed to your wallet: open, open (other shop), and one overdue
//   5. a monthly subscription at Tee Shop  -> first charge now, three more scheduled
//
// It reuses the two shops from `npm run demo:points` (.demo-points.json), or sets them up the same way if they
// are missing. Keys are typed with the input hidden and never written to disk.
// The shop's PAYOUT wallet key is asked once, for the refund (it funds the refund from the money it received).
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ask, askAddress, askPrivateKey } = require(path.resolve(
  __dirname,
  "..",
  process.env.CONTRACTS_DIR || "../paykit-contracts",
  "scripts",
  "lib",
  "prompt.js"
));

const API = process.env.PAYKIT_API || `http://localhost:${process.env.PORT || 8787}`;
const STATE = path.join(__dirname, "..", ".demo-points.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on("unhandledRejection", (e) => {
  console.error("\n✗", e?.name === "TimeoutError" ? "a server call took longer than 60 s, look at the server window for the error" : e?.message || e);
  process.exit(1);
});

// ── amounts (USDT) ──
const PAID_TEE = "2";
const PAID_JEANS = "2";
const REFUNDED_TEE = "2";
const REFUND_PART = "1";
const OPEN_TEE = "3";
const OPEN_JEANS = "2"; // the server refuses anything under 1.666667 USDT (its fee floor)
const OVERDUE_TEE = "2";
const SUB_AMOUNT = "2";
const SUB_CHARGES = 4;
// resume after a failure without redoing the payments:  npm run seed:wallet -- --from=4   (or: node scripts/seed-wallet.js --from=4)
const FROM = Number((process.argv.find((a) => a.startsWith("--from=")) || "--from=1").split("=")[1]);

async function call(method, url, { token, body } = {}) {
  const res = await fetch(API + url, {
    signal: AbortSignal.timeout(60_000),
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text;
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${data?.error ? data.error.code + ": " + data.error.message : text}`);
  return data;
}

async function until(label, fn, ok, ms = 120_000) {
  process.stdout.write(`    waiting for ${label} `);
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (ok(v)) return process.stdout.write(" ✓\n"), v;
    if (Date.now() - t0 > ms) return process.stdout.write(" (timed out)\n"), v;
    process.stdout.write(".");
    await sleep(2000);
  }
}

async function pay(invoiceId, customer, extra = {}) {
  const q = await call("POST", `/v1/public/invoices/${invoiceId}/quote`, { body: { payer: customer.address, ...extra } });
  const sig = await customer.signTypedData(q.typedData.domain, q.typedData.types, q.typedData.message);
  const sub = await call("POST", `/v1/public/quotes/${q.quoteId}/authorize`, { body: { signature: sig } });
  console.log(`    submitted: ${sub.txUrl}`);
  const done = await until("confirmation", () => call("GET", `/v1/public/quotes/${q.quoteId}`), (x) => ["confirmed", "failed"].includes(x.status));
  if (done.status !== "confirmed") throw new Error(`Payment ${q.quoteId} ${done.status}`);
  return q;
}

// create an unpaid invoice, or reuse the one an earlier run already made for this wallet (same description)
async function ensureInvoice(token, body) {
  const list = (await call("GET", "/v1/invoices", { token })).data || [];
  const hit = list.find((i) => i.description === body.description && (i.payerAddress || "").toLowerCase() === body.payerAddress.toLowerCase() && i.status !== "paid");
  return hit || call("POST", "/v1/invoices", { token, body });
}

const ref = (p) => `${p}-${Date.now().toString().slice(-6)}`;
const inDays = (d) => new Date(Date.now() + d * 86400_000).toISOString();

async function shops() {
  let st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : null;
  if (st) {
    const ok = await call("GET", "/v1/merchants/me", { token: st.A.apiKey }).then(
      () => call("GET", "/v1/merchants/me", { token: st.B.apiKey }).then(() => true, () => false),
      () => false
    );
    if (ok) return st;
  }
  console.log("\nNo demo shops yet. Setting up Tee Shop (earns points) and Jeans Co (rewards), 4 onchain transactions.");
  const payA = await askAddress("Tee Shop PAYOUT wallet (gets paid, funds refunds)");
  const payB = await askAddress("Jeans Co PAYOUT wallet", payA);
  const A = await call("POST", "/v1/merchants", { token: process.env.ADMIN_TOKEN, body: { name: "Tee Shop", payoutAddress: payA } });
  const B = await call("POST", "/v1/merchants", { token: process.env.ADMIN_TOKEN, body: { name: "Jeans Co", payoutAddress: payB } });
  const campaign = await call("POST", "/v1/points/campaigns", { token: A.apiKey, body: { name: "10 points per USDT", pointsPerUsdt: 10 } });
  const rewards = [];
  rewards.push(await call("POST", "/v1/points/rewards", { token: B.apiKey, body: { name: "10% off jeans", pointsCost: 20, type: "percent_off", value: 10, maxDiscount: "5" } }));
  rewards.push(await call("POST", "/v1/points/rewards", { token: B.apiKey, body: { name: "1 USDT off", pointsCost: 500, type: "fixed_off", value: "1" } }));
  rewards.push(await call("POST", "/v1/points/rewards", { token: B.apiKey, body: { name: "Big order: 3 USDT off", pointsCost: 10, type: "fixed_off", value: "3", minSpend: "50" } }));
  st = { A: { id: A.merchant.id, apiKey: A.apiKey }, B: { id: B.merchant.id, apiKey: B.apiKey }, campaign: campaign.id, rewards: rewards.map((r) => r.id) };
  fs.writeFileSync(STATE, JSON.stringify(st, null, 2));
  return st;
}

async function main() {
  const health = await call("GET", "/health").catch(() => {
    throw new Error(`Server not reachable at ${API}. Start it with "npm start" in another terminal.`);
  });
  if (!health.pointsEnabled) throw new Error("Points are off on this server (ROUTER_V2_ADDRESS / POINTS_ADDRESS not set), so there would be no points to show.");

  const st = await shops();
  console.log(`\nUsing shops from .demo-points.json: Tee Shop ${st.A.id.slice(0, 10)}…, Jeans Co ${st.B.id.slice(0, 10)}…`);

  const customer = await askPrivateKey("YOUR wallet: pays everything, so the invoices, points and subscription appear under it.\nNeeds USDT (about 7), no WBT.", null);
  console.log(`  ✓ wallet ${customer.address}`);
  const pts = async () => (await call("GET", `/v1/public/points/${customer.address}`)).balance;
  const start = await pts();
  console.log(`  points before: ${start}`);
  const need = (FROM <= 1 ? Number(PAID_TEE) : 0) + (FROM <= 2 ? Number(PAID_JEANS) : 0) + (FROM <= 3 ? Number(REFUNDED_TEE) - Number(REFUND_PART) : 0) + Number(SUB_AMOUNT);
  console.log(
    `\nStarting at step ${FROM}. This will spend about ${need} USDT from your wallet` +
      `\nand the subscription's other ${SUB_CHARGES - 1} charges (${SUB_AMOUNT} USDT each) will be pulled monthly from now on.`
  );
  if (/^n/i.test(await ask("Go ahead? [Y/n]: "))) return;

  // ── 1. paid at Tee Shop, earns points ──
  if (FROM <= 1) {
  console.log("\n── 1. Paid invoice at Tee Shop (earns points) ──");
  const inv1 = await call("POST", "/v1/invoices", { token: st.A.apiKey, body: { amount: PAID_TEE, reference: ref("SEED-TEE"), description: "T-shirt", payerAddress: customer.address, dueDate: inDays(7) } });
  const pre1 = await call("GET", `/v1/public/invoices/${inv1.id}/offers?payer=${customer.address}`);
  await pay(inv1.id, customer);
  await until("points", pts, (b) => b >= start + pre1.willEarn);
  console.log(`    ✓ paid ${PAID_TEE} USDT, earned ${pre1.willEarn} points`);

  }

  // ── 2. paid at Jeans Co with a points reward ──
  if (FROM <= 2) {
  console.log("\n── 2. Paid invoice at Jeans Co (spends points on a discount) ──");
  const inv2 = await call("POST", "/v1/invoices", { token: st.B.apiKey, body: { amount: PAID_JEANS, reference: ref("SEED-JEANS"), description: "Jeans", payerAddress: customer.address, dueDate: inDays(7) } });
  const offers = await call("GET", `/v1/public/invoices/${inv2.id}/offers?payer=${customer.address}`);
  const offer = offers.offers.filter((o) => o.available).sort((a, b) => Number(b.discount) - Number(a.discount))[0];
  if (offer) {
    const q2 = await pay(inv2.id, customer, { rewardId: offer.id });
    console.log(`    ✓ "${offer.name}": paid ${q2.gross} USDT instead of ${PAID_JEANS}, ${q2.points?.redeemed ?? 0} points used`);
  } else {
    await pay(inv2.id, customer);
    console.log(`    no reward was available (${offers.balance} points), paid in full`);
  }

  }

  // ── 3. paid at Tee Shop, then partly refunded ──
  if (FROM <= 3) {
  console.log("\n── 3. Paid invoice at Tee Shop, then partly refunded ──");
  const inv3 = await call("POST", "/v1/invoices", { token: st.A.apiKey, body: { amount: REFUNDED_TEE, reference: ref("SEED-REFUND"), description: "T-shirt (returned)", payerAddress: customer.address, dueDate: inDays(7) } });
  const q3 = await pay(inv3.id, customer);
  const rf = await call("POST", `/v1/payments/${q3.paymentId}/refunds`, { token: st.A.apiKey, body: { amount: REFUND_PART, reason: "Seed data: customer returned the item" } });
  const funder = await askPrivateKey(`Tee Shop's PAYOUT wallet ${rf.refund.funder}: it funds the refund. Needs USDT, no WBT.`, null);
  if (funder.address !== rf.refund.funder) throw new Error(`That key is for ${funder.address}, but the refund must be funded by ${rf.refund.funder}`);
  const rsig = await funder.signTypedData(rf.typedData.domain, rf.typedData.types, rf.typedData.message);
  const done = await call("POST", `/v1/refunds/${rf.refund.id}/authorize`, { token: st.A.apiKey, body: { signature: rsig } });
  console.log(`    submitted: ${done.txUrl}`);
  await until("refund confirmation", () => call("GET", `/v1/payments/${q3.paymentId}`, { token: st.A.apiKey }), (p) => p.refunds.some((r) => r.id === rf.refund.id && r.status === "confirmed"));
  console.log(`    ✓ ${REFUND_PART} of ${REFUNDED_TEE} USDT refunded to your wallet`);

  }

  // ── 4. unpaid invoices addressed to the wallet ──
  console.log("\n── 4. Unpaid invoices ──");
  const open1 = await ensureInvoice(st.A.apiKey, { amount: OPEN_TEE, reference: ref("SEED-OPEN"), description: "Hoodie (due in 5 days)", payerAddress: customer.address, dueDate: inDays(5) });
  const open2 = await ensureInvoice(st.B.apiKey, { amount: OPEN_JEANS, reference: ref("SEED-OPEN"), description: "Belt (due in 10 days)", payerAddress: customer.address, dueDate: inDays(10) });
  const late = await ensureInvoice(st.A.apiKey, { amount: OVERDUE_TEE, reference: ref("SEED-LATE"), description: "Sticker pack (overdue)", payerAddress: customer.address, dueDate: inDays(-3) });
  for (const i of [open1, open2, late]) console.log(`    ✓ ${i.id}  ${i.amount} USDT  ${i.status}  due ${i.dueDate.slice(0, 10)}`);

  // ── 5. monthly subscription ──
  console.log("\n── 5. Monthly subscription at Tee Shop ──");
  const plan = await call("POST", "/v1/plans", { token: st.A.apiKey, body: { kind: "subscription", name: "Tee Club monthly", amount: SUB_AMOUNT, interval: "month", cycles: SUB_CHARGES } });
  const s = await call("POST", `/v1/public/plans/${plan.id}/subscribe`, { body: { payer: customer.address } });
  const { permit, consent } = s.typedData;
  const permitSignature = await customer.signTypedData(permit.domain, permit.types, permit.message);
  const consentSignature = await customer.signTypedData(consent.domain, consent.types, consent.message);
  const sub = await call("POST", `/v1/public/subscriptions/${s.subscriptionId}/authorize`, { body: { permitSignature, consentSignature } });
  console.log(`    submitted: ${sub.createTxUrl}`);
  const active = await until("activation", () => call("GET", `/v1/subscriptions/${s.subscriptionId}`, { token: st.A.apiKey }), (x) => x.status === "active" && x.chargesPaid >= 1);
  console.log(`    ✓ ${active.status}: ${active.chargesPaid} charge paid, next ${active.nextChargeAt ? active.nextChargeAt.slice(0, 10) : "-"}, ${active.scheduledChargesTotal - active.scheduledChargesCollected} scheduled`);

  // ── summary ──
  console.log("\n── What your wallet now shows ──");
  const act = await call("GET", `/v1/public/wallets/${customer.address}/activity`);
  const w = await call("GET", `/v1/public/points/${customer.address}`);
  console.log(`  payments: ${act.data.length}   unpaid invoices: ${(act.invoices || []).length}   subscriptions: ${(act.subscriptions || []).length}`);
  console.log(`  points: ${w.balance} (earned ${w.lifetimeEarned}, spent ${w.lifetimeRedeemed})`);
  console.log(`  ${API}/v1/public/wallets/${customer.address}/activity`);
  console.log(`  ${API}/v1/public/points/${customer.address}`);
  console.log("\nDone. Open the wallet page and connect (or look up) " + customer.address);
}

main().catch((e) => {
  console.error("\n✗", e.message || e);
  process.exitCode = 1;
});
