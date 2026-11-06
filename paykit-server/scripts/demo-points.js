// Universal points demo against a running server with PaymentRouterV2 + PayKitPoints configured:
//   shop A (t-shirts) runs a campaign -> customer buys and earns points
//   shop B (jeans) offers rewards -> checkout lists them (unavailable ones greyed out with the reason)
//   -> customer picks one -> pays less, points are burned, all in one gasless payment
//   npm run demo:points
// Shops are saved in .demo-points.json so re-runs reuse them.
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
process.on("unhandledRejection", (e) => { console.error("\n✗", e?.name === "TimeoutError" ? "a server call took longer than 60 s, look at the server window for the error" : e?.message || e); process.exit(1); });
const STATE = path.join(__dirname, "..", ".demo-points.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, url, { token, body } = {}) {
  const res = await fetch(API + url, {
    signal: AbortSignal.timeout(60_000), // never hang silently: say which call is slow
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
  process.stdout.write(`  waiting for ${label} `);
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
  console.log(`  submitted: ${sub.txUrl}`);
  await until("confirmation", () => call("GET", `/v1/public/quotes/${q.quoteId}`), (x) => ["confirmed", "failed"].includes(x.status));
  return q;
}

async function main() {
  const health = await call("GET", "/health").catch(() => {
    throw new Error(`Server not reachable at ${API}. Start it with "npm start".`);
  });
  if (!health.pointsEnabled) throw new Error("Points are off: set ROUTER_V2_ADDRESS, POINTS_ADDRESS and DEPLOY_BLOCK_V2 in .env and restart.");

  // ── shops (once) ──
  let st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : null;
  if (st) {
    const ok = await call("GET", "/v1/merchants/me", { token: st.A.apiKey }).then(() => true, () => false);
    if (!ok) st = null;
  }
  if (!st) {
    console.log("\n── Setting up two shops (4 onchain transactions) ──");
    const payA = await askAddress("Shop A (T-shirt shop) PAYOUT wallet");
    const payB = await askAddress("Shop B (Jeans store) PAYOUT wallet", payA);
    const A = await call("POST", "/v1/merchants", { token: process.env.ADMIN_TOKEN, body: { name: "Tee Shop", payoutAddress: payA } });
    const B = await call("POST", "/v1/merchants", { token: process.env.ADMIN_TOKEN, body: { name: "Jeans Co", payoutAddress: payB } });
    // the no-code part: what a shopkeeper would fill in on the dashboard
    const campaign = await call("POST", "/v1/points/campaigns", {
      token: A.apiKey,
      body: { name: "10 points per USDT", pointsPerUsdt: 10 },
    });
    const rewards = [];
    rewards.push(await call("POST", "/v1/points/rewards", { token: B.apiKey, body: { name: "10% off jeans", pointsCost: 20, type: "percent_off", value: 10, maxDiscount: "5" } }));
    rewards.push(await call("POST", "/v1/points/rewards", { token: B.apiKey, body: { name: "1 USDT off", pointsCost: 500, type: "fixed_off", value: "1" } }));
    rewards.push(await call("POST", "/v1/points/rewards", { token: B.apiKey, body: { name: "Big order: 3 USDT off", pointsCost: 10, type: "fixed_off", value: "3", minSpend: "50" } }));
    st = { A: { id: A.merchant.id, apiKey: A.apiKey }, B: { id: B.merchant.id, apiKey: B.apiKey }, campaign: campaign.id, rewards: rewards.map((r) => r.id) };
    fs.writeFileSync(STATE, JSON.stringify(st, null, 2));
    console.log(`  ✓ Tee Shop campaign: "${campaign.name}"`);
    for (const r of rewards) console.log(`  ✓ Jeans Co reward: ${r.label}`);
  }

  const customer = await askPrivateKey("\nCUSTOMER wallet (needs USDT, no WBT).", null);
  const pts = async () => (await call("GET", `/v1/public/points/${customer.address}`)).balance;
  const start = await pts();
  console.log(`  points balance: ${start} PKP`);

  // ── 1. buy a t-shirt at shop A, earn points ──
  console.log("\n── 1. T-shirt at Tee Shop ──");
  const amtA = await askAmount("T-shirt price in USDT", "2");
  const invA = await call("POST", "/v1/invoices", { token: st.A.apiKey, body: { amount: amtA, reference: `TEE-${Date.now() % 100000}` } });
  const preA = await call("GET", `/v1/public/invoices/${invA.id}/offers?payer=${customer.address}`);
  console.log(`  you'll earn ${preA.willEarn} points (${preA.campaign ? preA.campaign.name : "no campaign"})`);
  await pay(invA.id, customer);
  const after1 = await until("points", () => call("GET", `/v1/public/points/${customer.address}`), (w) => w.balance >= start + preA.willEarn);
  if (after1.backend === "arkiv") {
    const lot = after1.lots[after1.lots.length - 1];
    console.log(`  ✓ points balance: ${after1.balance} (lot from ${lot ? lot.shop : "?"}, expires ${lot ? lot.expiresAt.slice(0, 10) : "?"})`);
    await until("the copy on Arkiv", () => call("GET", `/v1/public/points/${customer.address}`), (w) => w.arkiv.pendingWrites === 0, 90_000);
    const v = await call("GET", `/v1/public/points/${customer.address}?verify=1`);
    console.log(`    Arkiv itself says: ${v.arkiv.balance ?? "no answer (" + v.arkiv.error + ")"}  (Postgres says ${v.balance})`);
    console.log(`    Arkiv query: ${after1.arkiv.query}`);
  } else {
    console.log(`  ✓ points balance: ${after1.balance} PKP (onchain, token ${after1.token.address})`);
  }

  // ── 2. jeans at shop B, pick an offer ──
  console.log("\n── 2. Jeans at Jeans Co ──");
  const amtB = await askAmount("Jeans price in USDT", "2");
  const invB = await call("POST", "/v1/invoices", { token: st.B.apiKey, body: { amount: amtB, reference: `JEANS-${Date.now() % 100000}` } });
  const offers = await call("GET", `/v1/public/invoices/${invB.id}/offers?payer=${customer.address}`);
  console.log(`  You have ${offers.balance} points. Offers:`);
  offers.offers.forEach((o, i) =>
    console.log(
      `   ${o.available ? `[${i + 1}]` : "   "} ${o.name.padEnd(24)} ${o.available ? `-${o.discount} USDT -> pay ${o.payAfter}` : `(greyed: ${o.message})`}`
    )
  );
  const pick = await ask("  Apply which offer? [number, Enter = none]: ");
  const chosen = pick ? offers.offers[Number(pick) - 1] : null;
  if (chosen && !chosen.available) throw new Error(`That offer is not available: ${chosen.message}`);
  const q = await pay(invB.id, customer, chosen ? { rewardId: chosen.id } : {});
  console.log(`  paid ${q.gross} USDT${Number(q.discount) > 0 ? ` (discount ${q.discount}, ${q.points.redeemed} points used)` : ""}`);
  const after2 = await until("points", () => call("GET", `/v1/public/points/${customer.address}`), (w) => w.balance <= start + preA.willEarn - (q.points?.redeemed || 0));
  console.log(`  ✓ points balance: ${after2.balance}${after2.backend === "arkiv" ? ` (Arkiv copy ${after2.arkiv.pendingWrites === 0 ? "up to date" : after2.arkiv.pendingWrites + " write(s) still queued"})` : " PKP"}`);
  const inv = await call("GET", `/v1/invoices/${invB.id}`, { token: st.B.apiKey });
  console.log(`  invoice ${inv.id}: ${inv.status} (${inv.amountPaid} of ${inv.amount} incl. discount)`);

  // ── 3. dashboards ──
  console.log("\n── 3. What the shops see ──");
  const sA = await call("GET", "/v1/points/summary", { token: st.A.apiKey });
  const sB = await call("GET", "/v1/points/summary", { token: st.B.apiKey });
  console.log(`  Tee Shop: issued ${sA.issued.points} points to ${sA.issued.customers} customer(s); spent elsewhere: ${JSON.stringify(sA.yourCustomersSpentElsewhere)}`);
  console.log(`  Jeans Co: ${sB.redeemedAtYou.redemptions} redemption(s), ${sB.redeemedAtYou.points} points, discount given ${sB.redeemedAtYou.discountGiven} USDT, new customers via points: ${sB.redeemedAtYou.newCustomersViaPoints}`);
  console.log(`\nCustomer history: ${API}/v1/public/points/${customer.address}`);
  console.log(`Rewards read from Arkiv: ${API}/v1/public/rewards`);
}

main().catch((e) => {
  console.error("\n✗", e.message || e);
  process.exitCode = 1;
});
