// Subscription demo against a running server (npm start in another terminal):
//   merchant creates a plan -> customer subscribes with two gasless signatures (first charge now)
//   -> the scheduler collects the next charge automatically -> customer cancels gaslessly
//   npm run demo:subscription
// Uses the merchant saved in .demo.json by "npm run demo".
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ask, askPrivateKey, askAmount } = require(path.resolve(
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

async function waitFor(label, fn, done, timeoutMs) {
  const t0 = Date.now();
  process.stdout.write(`  waiting for ${label} `);
  for (;;) {
    const v = await fn();
    if (done(v)) {
      process.stdout.write(" ✓\n");
      return v;
    }
    if (Date.now() - t0 > timeoutMs) {
      process.stdout.write(" (timed out)\n");
      return v;
    }
    process.stdout.write(".");
    await sleep(3000);
  }
}

const yes = async (q) => !/^n/i.test(await ask(`${q} [Y/n]: `));

async function main() {
  await call("GET", "/health").catch(() => {
    throw new Error(`Server not reachable at ${API}. Start it with "npm start" in another terminal.`);
  });
  if (!fs.existsSync(STATE)) throw new Error('No .demo.json yet. Run "npm run demo" once to onboard a merchant.');
  const state = JSON.parse(fs.readFileSync(STATE, "utf8"));
  const key = state.apiKey;
  await call("GET", "/v1/merchants/me", { token: key }).catch(() => {
    throw new Error('The merchant in .demo.json is unknown to this server (in-memory store restarted?). Run "npm run demo" again.');
  });
  console.log(`\nMerchant "${state.name}" ${state.merchantId}`);

  // ── 1. merchant creates a plan ──
  console.log("\n── 1. Merchant creates a subscription plan ──");
  const amount = await askAmount("Price per charge in USDT", "2");
  const interval = (await ask("Charge every how many seconds? (or day/week/month) [Enter = 60]: ")) || "60";
  const cycles = Number((await ask("Total number of charges [Enter = 3]: ")) || "3");
  const plan = await call("POST", "/v1/plans", {
    token: key,
    body: { kind: "subscription", name: "Demo Pro plan", amount, interval, cycles, graceSeconds: 60 },
  });
  console.log(`  ✓ ${plan.id}: ${plan.amount} USDT every ${plan.interval}, ${plan.cycles} charges (total ${plan.total} USDT)`);
  console.log(`    subscribe link: ${plan.subscribeUrl}`);

  // ── 2. customer subscribes ──
  console.log("\n── 2. Customer subscribes (gasless) ──");
  const payer = await askPrivateKey("CUSTOMER wallet. Needs USDT for the first charge, no WBT.", null);
  const s = await call("POST", `/v1/public/plans/${plan.id}/subscribe`, { body: { payer: payer.address } });
  console.log(`  ${s.subscriptionId}: ${s.summary.chargedNow} USDT now, then ${s.summary.then} (total ${s.summary.total})`);
  const { permit, consent } = s.typedData;
  const permitSignature = await payer.signTypedData(permit.domain, permit.types, permit.message);
  console.log(`  customer signed USDT permit: router may pull up to ${Number(permit.message.value) / 1e6} USDT in total`);
  const consentSignature = await payer.signTypedData(consent.domain, consent.types, consent.message);
  console.log("  customer signed PlanConsent for exactly these terms");
  const sub = await call("POST", `/v1/public/subscriptions/${s.subscriptionId}/authorize`, { body: { permitSignature, consentSignature } });
  console.log(`  submitted: ${sub.createTxUrl}`);
  const active = await waitFor(
    "activation",
    () => call("GET", `/v1/subscriptions/${s.subscriptionId}`, { token: key }),
    (x) => x.status === "active" && x.chargesPaid >= 1,
    120_000
  );
  console.log(`  ✓ ${active.status}: paid ${active.amountPaid} USDT so far, next charge at ${active.nextChargeAt}`);

  // ── 3. scheduler charges automatically ──
  if (active.scheduledChargesTotal > 0 && (await yes("\nWait for the scheduler to collect the next charge automatically?"))) {
    const waitMs = Math.max(0, new Date(active.nextChargeAt).getTime() - Date.now()) + 120_000;
    const after = await waitFor(
      "automatic charge",
      () => call("GET", `/v1/subscriptions/${s.subscriptionId}`, { token: key }),
      (x) => x.scheduledChargesCollected >= 1 || x.status !== "active",
      waitMs
    );
    console.log(`  ${after.status}: ${after.chargesPaid} charges paid, ${after.amountPaid} USDT total${after.lastError ? ` (last error: ${after.lastError})` : ""}`);
    for (const p of after.payments) console.log(`    ${p.kind.padEnd(12)} ${p.amount} USDT  ${p.txUrl}`);
  }

  // ── 4. cancel any time ──
  const cur = await call("GET", `/v1/subscriptions/${s.subscriptionId}`, { token: key });
  if (["active", "past_due"].includes(cur.status) && (await yes("\nCancel the subscription now as the customer (gasless)?"))) {
    const req = await call("POST", `/v1/public/subscriptions/${s.subscriptionId}/cancel-request`);
    const signature = await payer.signTypedData(req.typedData.domain, req.typedData.types, req.typedData.message);
    const c = await call("POST", `/v1/public/subscriptions/${s.subscriptionId}/cancel`, { body: { signature } });
    console.log(`  submitted: ${c.cancelTxUrl}`);
    const done = await waitFor(
      "cancellation",
      () => call("GET", `/v1/subscriptions/${s.subscriptionId}`, { token: key }),
      (x) => x.status === "cancelled",
      120_000
    );
    console.log(`  ✓ ${done.status} by ${done.cancelledBy}. No further charges can be pulled.`);
  }

  const final = await call("GET", `/v1/subscriptions/${s.subscriptionId}`, { token: key });
  console.log(`\nFinal: ${final.status}, ${final.chargesPaid} charge(s), ${final.amountPaid} USDT.`);
  console.log(`Customer view: ${API}/v1/public/subscriptions/${s.subscriptionId}`);
}

main().catch((e) => {
  console.error("\n✗", e.message || e);
  process.exitCode = 1;
});
