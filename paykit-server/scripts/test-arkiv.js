// Checks PayKit's Arkiv layer against the real Rabdi testnet (or the in-memory backend with --memory).
//
//   npm run test:arkiv             # real Arkiv: needs ARKIV_FUNDER_KEY (a wallet with tGLM) in .env
//   npm run test:arkiv -- --memory # same checks, no network
//   npm run test:arkiv -- --keep   # don't delete the test entities at the end (to look at them in the explorer)
//
// What it does, step by step (each step prints PASS/FAIL):
//   1. reach Arkiv, show the funder balance
//   2. make a throwaway "test shop" account and top it up with tGLM from the funder (what the server does)
//   3. as the shop: write one campaign, one reward, one lot and one spend (the 4 PayKit schemas)
//   4. read them back and check every field type round-trips (str, dec, u256, u64, i32, bool, addr, key)
//   5. filter like the app does (rewards by points cost, lots by holder, spends by lot)
//   6. patch a lot (a refund lowering points) and unset an optional field
//   7. another wallet tries to edit the shop's lot -> must fail (only the owner can edit)
//   8. another wallet writes a fake lot with our schema name -> it shows up in raw queries, and the owner
//      check the server applies filters it out (why every read checks $owner)
//   9. extend a reward's lifetime
//  10. delete a spend (what a full refund does)
//  11. auto-expiry: a lot written with a 1-minute lifetime is there, then gone after ~1 minute
//  12. clean up the test entities (unless --keep)
// Test entities use ref "test_<time>_..." and a fake shop id, so the server never shows them to anyone.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
process.env.POINTS_BACKEND = "arkiv";
const memory = process.argv.includes("--memory");
const keep = process.argv.includes("--keep");
if (memory) process.env.ARKIV_BACKEND = "memory";

const { ethers } = require("ethers");
const config = require("../src/config");
const { createArkiv } = require("../src/arkiv");

const arkiv = createArkiv();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);
let fails = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};
const step = (t) => console.log(`\n── ${t}`);
const tx = (h) => (arkiv.txUrl(h) ? `  ${arkiv.txUrl(h)}` : "");
const fmt = (wei) => `${ethers.formatEther(wei)} tGLM`;
const expectFail = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e.shortMessage || e.message || String(e)).split("\n")[0];
  }
};

async function main() {
  console.log(`Arkiv backend: ${arkiv.kind} (chain ${config.arkiv.chainId})${arkiv.kind === "rabdi" ? `, access key ${config.arkiv.accessKey ? "set" : "NOT set (public RPC, rate-limited)"}` : ""}`);
  const funderKey = memory ? ethers.Wallet.createRandom().privateKey : config.arkiv.funderKey;
  if (!funderKey) throw new Error("Set ARKIV_FUNDER_KEY in .env: the PRIVATE key of a wallet with tGLM (https://hub.arkiv.network/faucet)");
  const funder = arkiv.address(funderKey);
  const run = `test_${Date.now()}`;
  const fakeShopId = ethers.keccak256(ethers.toUtf8Bytes(run)); // not a real merchant: never shown by the server
  const holder = ethers.Wallet.createRandom().address;
  const made = []; // [pk, key] to clean up

  // 1 ───────────────────────────────────────────────
  step("1. reach Arkiv");
  const fbal = await arkiv.balanceOf(funder);
  check("RPC answers, funder balance read", fbal !== undefined, `${funder}: ${fmt(fbal)}`);
  if (!memory && fbal === 0n) throw new Error(`Funder ${funder} has 0 tGLM. Get some at https://hub.arkiv.network/faucet`);
  const anyRewards = await arkiv.query("reward", [["active", "eq", true]], { limit: 5 });
  check("query runs", Array.isArray(anyRewards), `${anyRewards.length} live paykit.reward entities on the network`);

  // 2 ───────────────────────────────────────────────
  step("2. shop account + top-up from the funder");
  const shopKey = ethers.Wallet.createRandom().privateKey;
  const shop = arkiv.address(shopKey);
  const topup = BigInt(config.arkiv.topupWei) / 5n; // a fifth of the server's top-up is plenty for this test
  const sent = await arkiv.send(funderKey, shop, topup);
  const sbal = await arkiv.balanceOf(shop);
  check("shop account funded", sbal >= topup || memory, `${shop}: ${fmt(sbal)}${tx(sent.txHash)}`);

  // 3 ───────────────────────────────────────────────
  step("3. write one entity of each PayKit schema (as the shop)");
  const in10min = nowSec() + 600;
  const campaign = await arkiv.create(shopKey, "campaign", {
    ref: `${run}_camp`, merchantId: fakeShopId, shop: "Test Tee Shop", title: "10 points per USDT", pointsPerUsdt: "10.5",
    minSpend: 2_000_000n, firstPurchaseOnly: false, appliesTo: "all", active: true, updatedAt: nowSec(),
  }, in10min);
  made.push([shopKey, campaign.entityKey]);
  check("campaign created", !!campaign.entityKey, `${campaign.entityKey}${tx(campaign.txHash)}`);
  const reward = await arkiv.create(shopKey, "reward", {
    ref: `${run}_rw`, merchantId: fakeShopId, shop: "Test Tee Shop", title: "10% off", pointsCost: 40, kind: "percent_off", value: "10",
    maxDiscount: 5_000_000n, minSpend: 1_000_000n, perWalletLimit: 2, active: true, updatedAt: nowSec(),
  }, in10min);
  made.push([shopKey, reward.entityKey]);
  check("reward created", !!reward.entityKey, `${reward.entityKey}${tx(reward.txHash)}`);
  const lot = await arkiv.create(shopKey, "lot", {
    ref: `${run}_lot`, holder, issuer: fakeShopId, points: 100, originalPoints: 100, paymentId: ethers.hexlify(ethers.randomBytes(32)),
    txHash: ethers.hexlify(ethers.randomBytes(32)), earnedAt: nowSec(), expiresAt: in10min,
  }, in10min);
  made.push([shopKey, lot.entityKey]);
  check("lot created", !!lot.entityKey, `${lot.entityKey}${tx(lot.txHash)}`);
  const spend = await arkiv.create(shopKey, "spend", {
    ref: `${run}_sp`, holder, redeemer: fakeShopId, lot: lot.entityKey, lotIssuer: fakeShopId, points: 30,
    paymentId: ethers.hexlify(ethers.randomBytes(32)), spentAt: nowSec(),
  }, in10min);
  made.push([shopKey, spend.entityKey]);
  check("spend created (points the customer used from that lot)", !!spend.entityKey, `${spend.entityKey}${tx(spend.txHash)}`);
  check("expiry comes back as unix seconds, ~10 min out", Math.abs(lot.expiresAt - in10min) < 30, `${new Date(lot.expiresAt * 1000).toISOString()}${lot.expiresAtBlock ? ` (block ${lot.expiresAtBlock})` : ""}`);

  // 4 ───────────────────────────────────────────────
  step("4. read back, field types round-trip");
  const [c] = await arkiv.query("campaign", [["ref", "eq", `${run}_camp`]]);
  check("campaign: dec, u256, bool, str", c && String(c.pointsPerUsdt) === "10.5" && BigInt(c.minSpend) === 2_000_000n && c.firstPurchaseOnly === false && c.appliesTo === "all", JSON.stringify({ pointsPerUsdt: c?.pointsPerUsdt, minSpend: c?.minSpend, firstPurchaseOnly: c?.firstPurchaseOnly }));
  check("owner is the shop account", c && c.$owner.toLowerCase() === shop.toLowerCase(), c?.$owner);
  const [l] = await arkiv.query("lot", [["ref", "eq", `${run}_lot`]]);
  check("lot: addr, i32, u64", l && l.holder.toLowerCase() === holder.toLowerCase() && Number(l.points) === 100 && Number(l.expiresAt) === in10min);
  const [s] = await arkiv.query("spend", [["ref", "eq", `${run}_sp`]]);
  check("spend: key field points at the lot", s && String(s.lot).toLowerCase() === lot.entityKey.toLowerCase());

  // 5 ───────────────────────────────────────────────
  step("5. filters the app uses");
  const cheap = await arkiv.query("reward", [["merchantId", "eq", fakeShopId], ["pointsCost", "lte", 50]]);
  const dear = await arkiv.query("reward", [["merchantId", "eq", fakeShopId], ["pointsCost", "lte", 39]]);
  check("rewards I can afford: pointsCost <= 50 finds it, <= 39 doesn't", cheap.length === 1 && dear.length === 0);
  const lots = await arkiv.query("lot", [["holder", "eq", holder]]);
  check("lots by holder", lots.length === 1);
  const spends = await arkiv.query("spend", [["lot", "eq", lot.entityKey]]);
  check("spends by lot key", spends.length === 1 && Number(spends[0].points) === 30);
  console.log(`      the same lot query in Arkiv's language: ${arkiv.queryString("lot", [["holder", "eq", holder]])}`);

  // 6 ───────────────────────────────────────────────
  step("6. patch (refund lowers the lot) and unset an optional field");
  const p1 = await arkiv.patch(shopKey, "lot", lot.entityKey, { points: 60 });
  const [l2] = await arkiv.query("lot", [["ref", "eq", `${run}_lot`]]);
  check("lot points 100 -> 60", l2 && Number(l2.points) === 60 && Number(l2.originalPoints) === 100, tx(p1.txHash));
  const p2 = await arkiv.patch(shopKey, "reward", reward.entityKey, {}, ["maxDiscount"]);
  const [r2] = await arkiv.query("reward", [["ref", "eq", `${run}_rw`]]);
  check("reward maxDiscount removed, other fields kept", r2 && (r2.maxDiscount === undefined || r2.maxDiscount === null) && Number(r2.pointsCost) === 40, tx(p2.txHash));

  // 7 ───────────────────────────────────────────────
  step("7. only the owner can edit");
  const denied = await expectFail(() => arkiv.patch(funderKey, "lot", lot.entityKey, { points: 999999 }));
  check("funder (not the owner) can't patch the shop's lot", !!denied, denied || "it went through!");
  const [l3] = await arkiv.query("lot", [["ref", "eq", `${run}_lot`]]);
  check("lot unchanged", l3 && Number(l3.points) === 60);

  // 8 ───────────────────────────────────────────────
  step("8. anyone can write our schema name, so reads check the owner");
  const fake = await arkiv.create(funderKey, "lot", {
    ref: `${run}_fake`, holder, issuer: fakeShopId, points: 5000, originalPoints: 5000, paymentId: "0x00", txHash: "0x00", earnedAt: nowSec(), expiresAt: in10min,
  }, in10min);
  made.push([funderKey, fake.entityKey]);
  const all = await arkiv.query("lot", [["holder", "eq", holder]]);
  const genuine = all.filter((e) => e.$owner.toLowerCase() === shop.toLowerCase());
  check("raw query sees 2 lots, owner check keeps the real one", all.length === 2 && genuine.length === 1 && Number(genuine[0].points) === 60);

  // 9 ───────────────────────────────────────────────
  step("9. extend a reward (rewards without an end date are kept alive this way)");
  const before = r2.$expiresAt;
  const ex = await arkiv.extend(shopKey, reward.entityKey, nowSec() + 1800);
  const [r3] = await arkiv.query("reward", [["ref", "eq", `${run}_rw`]]);
  check("reward lifetime extended to ~30 min", r3 && r3.$expiresAt > before + 600, `${new Date(before * 1000).toISOString()} -> ${new Date(r3?.$expiresAt * 1000).toISOString()}${tx(ex.txHash)}`);

  // 10 ───────────────────────────────────────────────
  step("10. delete a spend (a full refund gives the points back)");
  const del = await arkiv.remove(shopKey, spend.entityKey);
  made.splice(made.findIndex(([, k]) => k === spend.entityKey), 1);
  const gone = await arkiv.query("spend", [["ref", "eq", `${run}_sp`]]);
  check("spend gone", gone.length === 0, tx(del.txHash));

  // 11 ───────────────────────────────────────────────
  step("11. auto-expiry: a lot that lives 1 minute");
  const short = await arkiv.create(shopKey, "lot", {
    ref: `${run}_short`, holder, issuer: fakeShopId, points: 7, originalPoints: 7, paymentId: "0x01", txHash: "0x01", earnedAt: nowSec(), expiresAt: nowSec() + 60,
  }, nowSec() + 60);
  const t0 = Date.now();
  check("1-minute lot written", !!short.entityKey, `expires ${new Date(short.expiresAt * 1000).toISOString()}${tx(short.txHash)}`);
  let seen = false;
  let goneAt = null;
  while (Date.now() - t0 < 150_000) {
    const rows = await arkiv.query("lot", [["ref", "eq", `${run}_short`]]);
    const age = Math.round((Date.now() - t0) / 1000);
    if (rows.length) seen = true;
    console.log(`      t+${String(age).padStart(3)} s: ${rows.length ? "present" : "gone"}`);
    if (seen && !rows.length) {
      goneAt = age;
      break;
    }
    await sleep(10_000);
  }
  check("present at first, gone after about a minute, with no delete call", seen && goneAt !== null && goneAt >= 50, goneAt !== null ? `gone at ~${goneAt} s` : "still there after 150 s");
  const late = await expectFail(() => arkiv.patch(shopKey, "lot", short.entityKey, { points: 1 }));
  check("an expired entity can't be edited any more", !!late, late || "");

  // 12 ───────────────────────────────────────────────
  step(keep ? "12. keeping the test entities (--keep)" : "12. clean up");
  if (!keep) {
    for (const [pk, key] of made) await arkiv.remove(pk, key).catch((e) => console.log(`      could not delete ${key}: ${e.message.split("\n")[0]}`));
    const left = await arkiv.query("lot", [["holder", "eq", holder]]);
    check("test entities deleted", left.length === 0);
  } else {
    for (const [, key] of made) console.log(`      ${key}  ${arkiv.entityUrl(key) || ""}`);
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exitCode = fails ? 1 : 0;
}

main().catch((e) => {
  console.error("\n✗", e.shortMessage || e.message || e);
  process.exitCode = 1;
});
