// Full or partial refund of a settled payment, through PaymentRouter.refund().
//   npm run refund
//
// Who does what:
//   merchant -> the pool wallet in .env signs the refund terms (it is the merchant owner from npm run pay)
//   funder   -> the merchant wallet that received the money. You type its PRIVATE key; it only SIGNS
//               a one-time USDT transfer for the refund amount (needs USDT, needs 0 WBT).
//   customer -> gets the USDT back automatically at the refund address locked in at payment time.
//   relayer  -> the pool wallet submits the transaction and pays the WBT gas.
// The contract refuses refunds above what was paid, in total across all partial refunds.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const T = require("./lib/typedData");
const { ask, askPrivateKey, askAmount } = require("./lib/prompt");

const EXPLORER = "https://explorer.testnet.whitechain.io";
const usd = (v) => ethers.formatUnits(v, 6);
const loadJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : d);

async function main() {
  const provider = ethers.provider;
  const chainId = Number((await provider.getNetwork()).chainId);
  const dir = path.join(__dirname, "..", "deployments");
  const dep = loadJson(path.join(dir, `${chainId}.json`), null);
  if (!dep) throw new Error(`No deployments/${chainId}.json — run npm run deploy:testnet first`);

  const [relayer] = await ethers.getSigners();
  if (!relayer) throw new Error("Set PLATFORM_ADMIN_KEY in .env");
  const router = await ethers.getContractAt("PaymentRouter", dep.contracts.PaymentRouter, relayer);
  const registry = await ethers.getContractAt("MerchantRegistry", dep.contracts.MerchantRegistry, relayer);
  const usdt = new ethers.Contract(
    dep.tokens.USDT,
    ["function balanceOf(address) view returns (uint256)", "function authorizationState(address,bytes32) view returns (bool)"],
    provider
  );

  // ── pick the payment ──
  const payLog = loadJson(path.join(dir, `payments-${chainId}.json`), []);
  if (payLog.length) {
    console.log("\nRecent payments (from deployments/payments-%d.json):", chainId);
    payLog.slice(-5).forEach((p) =>
      console.log(`  ${p.paymentId}  ${usd(p.gross)} USDT  ${p.payer.slice(0, 8)}… -> ${p.receiver.slice(0, 8)}…  ${p.at}`)
    );
  }
  const last = payLog.length ? payLog[payLog.length - 1].paymentId : undefined;
  let paymentId;
  for (;;) {
    const a = await ask(`\nPayment id to refund (0x…, 66 chars)${last ? ` [Enter = ${last}]` : ""}: `);
    paymentId = a || last;
    if (paymentId && /^0x[0-9a-fA-F]{64}$/.test(paymentId)) break;
    console.log("  ✗ That is not a payment id (it is printed by npm run pay)");
  }

  const p = await router.payments(paymentId);
  if (p.settledAt === 0n) throw new Error("No settled payment with that id on this router");
  const remaining = p.gross - p.refunded;
  const logged = payLog.find((x) => x.paymentId.toLowerCase() === paymentId.toLowerCase());
  console.log(`\nPayment ${paymentId}`);
  console.log(`  paid ${usd(p.gross)} USDT on ${new Date(Number(p.settledAt) * 1000).toISOString()}`);
  console.log(`  already refunded ${usd(p.refunded)} USDT, refundable ${usd(remaining)} USDT`);
  console.log(`  refund goes to ${p.refundTo} (locked in when the customer paid)`);
  if (remaining === 0n) throw new Error("This payment is already fully refunded");

  if (!(await registry.isAuthorized(p.merchantId, relayer.address))) {
    throw new Error(`Pool wallet ${relayer.address} is not the owner or a signer of merchant ${p.merchantId}`);
  }

  // ── inputs ──
  const funder = await askPrivateKey(
    `FUNDER: the merchant wallet that pays the refund${logged ? ` (it was paid at ${logged.receiver})` : ""}. It only signs, needs USDT but no WBT.`,
    provider
  );
  const amountStr = await askAmount("Refund amount in USDT", usd(remaining));
  const amount = ethers.parseUnits(amountStr, 6);
  if (amount > remaining) throw new Error(`Max refundable is ${usd(remaining)} USDT`);
  const fee = 0n; // no platform fee on refunds
  const funderBal = await usdt.balanceOf(funder.address);
  if (funderBal < amount + fee) throw new Error(`Funder has only ${usd(funderBal)} USDT`);

  // ── 1. merchant signs the refund terms ──
  const now = BigInt((await provider.getBlock("latest")).timestamp);
  const t = {
    paymentId,
    refundId: ethers.hexlify(ethers.randomBytes(32)),
    amount,
    fee,
    funder: funder.address,
    validUntil: now + 600n,
  };
  const rDomain = T.routerDomain(chainId, dep.contracts.PaymentRouter);
  const merchantSig = await relayer.signTypedData(rDomain, T.types.RefundTerms, t);
  const termsHash = T.digest(rDomain, T.types.RefundTerms, t);

  // ── 2. funder signs the one-time USDT transfer to the router ──
  const nonce = T.refundNonce(termsHash);
  const auth = {
    from: funder.address,
    to: dep.contracts.PaymentRouter,
    value: amount + fee,
    validAfter: 0n,
    validBefore: now + 600n,
    nonce,
  };
  console.log(`\nFunder signs: "Tether USD — ReceiveWithAuthorization — ${amountStr} USDT to PayKit Router"`);
  const sig = await funder.signTypedData(T.usdtDomain(chainId, dep.tokens.USDT), T.types.ReceiveWithAuthorization, auth);
  if (await usdt.authorizationState(funder.address, nonce)) throw new Error("Authorization nonce already used");
  const f = { validAfter: auth.validAfter, validBefore: auth.validBefore, signature: sig };

  // ── 3. relayer simulates and submits ──
  const before = { customer: await usdt.balanceOf(p.refundTo), funder: funderBal };
  await router.refund.staticCall(t, merchantSig, f);
  console.log("Simulation ok, relaying …");
  const rc = await (await router.refund(t, merchantSig, f)).wait();
  const after = { customer: await usdt.balanceOf(p.refundTo), funder: await usdt.balanceOf(funder.address) };
  const pNow = await router.payments(paymentId);

  console.log(`\n✓ Refund settled: ${EXPLORER}/tx/${rc.hash}`);
  console.log(`  refund id  ${t.refundId}`);
  console.log(`  customer   +${usd(after.customer - before.customer)} USDT (${p.refundTo})`);
  console.log(`  funder     ${usd(after.funder - before.funder)} USDT (${funder.address})`);
  console.log(`  refunded so far ${usd(pNow.refunded)} of ${usd(pNow.gross)} USDT`);
  console.log(`  gas        ${ethers.formatEther(rc.gasUsed * rc.gasPrice)} WBT paid by the relayer (${rc.gasUsed} gas)`);

  const logFile = path.join(dir, `refunds-${chainId}.json`);
  const log = loadJson(logFile, []);
  log.push({
    at: new Date().toISOString(),
    tx: `${EXPLORER}/tx/${rc.hash}`,
    refundId: t.refundId,
    paymentId,
    to: p.refundTo,
    funder: funder.address,
    amount: amount.toString(),
    cumulativeRefunded: pNow.refunded.toString(),
    gasUsed: rc.gasUsed.toString(),
  });
  fs.writeFileSync(logFile, JSON.stringify(log, null, 2));
  console.log(`  saved to deployments/refunds-${chainId}.json`);
}

main().catch((e) => {
  console.error("\n✗", e.shortMessage || e.reason || e.message || e);
  process.exitCode = 1;
});
