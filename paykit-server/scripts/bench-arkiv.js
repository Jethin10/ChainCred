// Measures where the time goes when PayKit talks to Arkiv. Run it from the same machine as the server:
//
//   npm run bench:arkiv             # reads only, about 20 seconds
//   npm run bench:arkiv -- --write  # also times one write (uses ARKIV_FUNDER_KEY, entity lives 2 minutes, then deleted)
//
// It prints how long each kind of call takes, so we can tell "the network to Arkiv is slow" from "our code does too many calls".
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
process.env.POINTS_BACKEND = "arkiv";
const { ethers } = require("ethers");
const config = require("../src/config");
const { createArkiv } = require("../src/arkiv");

const arkiv = createArkiv();
const write = process.argv.includes("--write");
const nowSec = () => Math.floor(Date.now() / 1000);

async function time(label, fn) {
  const t0 = Date.now();
  try {
    await fn();
    return Date.now() - t0;
  } catch (e) {
    console.log(`  ${label}: FAILED ${String(e.shortMessage || e.message).split("\n")[0]}`);
    return null;
  }
}
const stats = (xs) => {
  const v = xs.filter((x) => x !== null).sort((a, b) => a - b);
  if (!v.length) return "no results";
  return `min ${v[0]} ms, median ${v[Math.floor(v.length / 2)]} ms, max ${v[v.length - 1]} ms  (${v.length} calls)`;
};

(async () => {
  console.log(`Arkiv ${arkiv.kind}, RPC ${config.arkiv.rpcUrl || "(SDK default)"}\n`);
  const nobody = ethers.Wallet.createRandom().address;

  console.log("1. one bare RPC call (eth_blockNumber). This is the network round trip to Arkiv:");
  console.log("   ", stats(await seq(5, () => time("ping", () => arkiv.ping()))));

  console.log("2. query that finds nothing (lots of a random wallet), one after another:");
  console.log("   ", stats(await seq(5, () => time("query", () => arkiv.query("lot", [["holder", "eq", nobody]])))));

  console.log("3. same query, 5 at once:");
  const t0 = Date.now();
  const par = await Promise.all([1, 2, 3, 4, 5].map(() => time("query", () => arkiv.query("lot", [["holder", "eq", nobody]]))));
  console.log("   ", stats(par), `, all done after ${Date.now() - t0} ms`);

  console.log("4. query that returns rows (live rewards), one after another:");
  console.log("   ", stats(await seq(3, () => time("query", () => arkiv.query("reward", [["active", "eq", true]], { limit: 20 })))));

  console.log("5. balance of an account:");
  console.log("   ", stats(await seq(3, () => time("balance", () => arkiv.balanceOf(nobody)))));

  if (write) {
    if (!config.arkiv.funderKey) throw new Error("--write needs ARKIV_FUNDER_KEY in .env");
    console.log("6. one write (create a 2-minute lot, wait for the receipt), then how long until a query sees it:");
    const ref = `bench_${Date.now()}`;
    let key;
    const wms = await time("create", async () => {
      const r = await arkiv.create(config.arkiv.funderKey, "lot", {
        ref, holder: nobody, issuer: "bench", points: 1, originalPoints: 1,
        paymentId: ethers.hexlify(ethers.randomBytes(32)), txHash: ethers.hexlify(ethers.randomBytes(32)),
        earnedAt: nowSec(), expiresAt: nowSec() + 120,
      }, nowSec() + 120);
      key = r.entityKey;
    });
    console.log(`    write returned after ${wms} ms`);
    const t1 = Date.now();
    let seen = false;
    while (!seen && Date.now() - t1 < 60_000) {
      seen = (await arkiv.query("lot", [["ref", "eq", ref]])).length > 0;
      if (!seen) await new Promise((r) => setTimeout(r, 500));
    }
    console.log(`    ${seen ? `visible to queries ${Date.now() - t1} ms after the write returned` : "not visible after 60 s"}`);
    if (key) {
      const dms = await time("delete", () => arkiv.remove(config.arkiv.funderKey, key));
      console.log(`    delete returned after ${dms} ms`);
    }
  }
  console.log("\nSend me this output. Roughly: step 1 is the network, step 2 minus step 1 is the SDK's own overhead, and the write time is Arkiv's block time plus the receipt wait.");
})().catch((e) => {
  console.error("bench failed:", e.message);
  process.exit(1);
});

async function seq(n, fn) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await fn());
  return out;
}
