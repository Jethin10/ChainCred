// Gasless USDT payment through PaymentRouter on Whitechain Sepolia.
//   npm run pay
//
// Who does what:
//   payer    -> types their PRIVATE key. It only SIGNS (no transaction, needs 0 WBT).
//   receiver -> you type a PUBLIC address. It receives the USDT (net of the fee).
//   relayer  -> the pool wallet in .env (PLATFORM_ADMIN_KEY). It submits the tx and pays the WBT gas.
//
// For this script the pool wallet also acts as the merchant owner: the first time you pay a new
// receiver it registers a merchant with payout = receiver, and it signs the payment quote.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ethers } = require("hardhat");
const T = require("./lib/typedData");
const { askAddress, askPrivateKey, askAmount } = require("./lib/prompt");

const EXPLORER = "https://explorer.testnet.whitechain.io";
const MAX_FEE_BPS = 300; // merchant fee cap 3%
const usd = (v) => ethers.formatUnits(v, 6);

function loadJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
}

async function main() {
  const provider = ethers.provider;
  const chainId = Number((await provider.getNetwork()).chainId);
  const dir = path.join(__dirname, "..", "deployments");
  const dep = loadJson(path.join(dir, `${chainId}.json`), null);
  if (!dep) throw new Error(`No deployments/${chainId}.json — run npm run deploy:testnet first`);

  const [relayer] = await ethers.getSigners();
  if (!relayer) throw new Error("Set PLATFORM_ADMIN_KEY (pool wallet PRIVATE key) in .env");

  const usdtAddr = dep.tokens.USDT;
  const usdt = new ethers.Contract(
    usdtAddr,
    [
      "function balanceOf(address) view returns (uint256)",
      "function authorizationState(address,bytes32) view returns (bool)",
    ],
    provider
  );
  const router = await ethers.getContractAt("PaymentRouter", dep.contracts.PaymentRouter, relayer);
  const registry = await ethers.getContractAt("MerchantRegistry", dep.contracts.MerchantRegistry, relayer);

  console.log(`\nRelayer / pool wallet (from .env): ${relayer.address}`);
  console.log(`  ${ethers.formatEther(await provider.getBalance(relayer.address))} WBT for gas\n`);

  // ── inputs ──
  const payer = await askPrivateKey("PAYER (the customer sending USDT). It only signs, so it needs no WBT.", provider);
  const receiver = await askAddress("RECEIVER (the merchant wallet that gets paid).");
  const amountStr = await askAmount("Amount in USDT", "2");
  const gross = ethers.parseUnits(amountStr, 6);

  const bal = await usdt.balanceOf(payer.address);
  console.log(`\nPayer ${payer.address} has ${usd(bal)} USDT`);
  if (bal < gross) throw new Error("Payer does not have enough USDT. Run npm run swap (option 1) and send USDT to the payer's address.");

  // ── merchant for this receiver (pool wallet is the owner) ──
  const merchantsFile = path.join(dir, `merchants-${chainId}.json`);
  const merchants = loadJson(merchantsFile, {});
  let merchantId = merchants[receiver];
  if (!merchantId) {
    console.log(`Registering a merchant with payout ${receiver} …`);
    merchantId = await registry.predictMerchantId(relayer.address);
    const metadataHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({ payout: receiver })));
    const rc = await (await registry.register(receiver, MAX_FEE_BPS, metadataHash, "")).wait();
    console.log(`  ✓ merchant ${merchantId}\n    ${EXPLORER}/tx/${rc.hash}`);
    merchants[receiver] = merchantId;
    fs.writeFileSync(merchantsFile, JSON.stringify(merchants, null, 2));
  } else {
    console.log(`Using merchant ${merchantId}`);
  }

  // ── fee ──
  const fee = await router.protocolFee(usdtAddr, gross);
  if (fee * 10000n > gross * BigInt(MAX_FEE_BPS)) {
    throw new Error(`Amount too small: fee ${usd(fee)} would be over the ${MAX_FEE_BPS / 100}% cap. Try at least ~1.67 USDT.`);
  }

  // ── 1. merchant quote (signed by the pool wallet as merchant owner) ──
  const now = BigInt((await provider.getBlock("latest")).timestamp);
  const q = {
    merchantId,
    invoiceId: T.idFromUuid(crypto.randomUUID()),
    invoiceDigest: ethers.keccak256(ethers.toUtf8Bytes(`script payment ${amountStr} USDT`)),
    paymentId: ethers.hexlify(ethers.randomBytes(32)),
    token: usdtAddr,
    invoiceTotal: gross,
    gross,
    fee,
    payer: payer.address,
    splitProfileId: 0,
    validUntil: now + 600n,
  };
  const rDomain = T.routerDomain(chainId, dep.contracts.PaymentRouter);
  const merchantSig = await relayer.signTypedData(rDomain, T.types.PaymentQuote, q);
  const quoteHash = T.digest(rDomain, T.types.PaymentQuote, q);

  // ── 2. payer signs the USDT ReceiveWithAuthorization (no gas, no approve) ──
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const nonce = T.payNonce(quoteHash, payer.address, salt);
  const auth = {
    from: payer.address,
    to: dep.contracts.PaymentRouter,
    value: gross,
    validAfter: 0n,
    validBefore: now + 600n,
    nonce,
  };
  console.log(`\nPayer signs: "Tether USD — ReceiveWithAuthorization — ${amountStr} USDT to PayKit Router"`);
  const authSig = await payer.signTypedData(T.usdtDomain(chainId, usdtAddr), T.types.ReceiveWithAuthorization, auth);
  if (await usdt.authorizationState(payer.address, nonce)) throw new Error("Authorization nonce already used");

  const a = {
    from: payer.address,
    refundTo: ethers.ZeroAddress, // refunds go back to the payer
    salt,
    validAfter: auth.validAfter,
    validBefore: auth.validBefore,
    signature: authSig,
  };

  // ── 3. relayer simulates, then submits and pays the gas ──
  const before = {
    payer: bal,
    receiver: await usdt.balanceOf(receiver),
    treasury: await usdt.balanceOf(dep.contracts.FeeTreasury),
  };
  await router.pay.staticCall(q, merchantSig, a); // throws with the contract's error if it would revert
  console.log("Simulation ok, relaying …");
  const rc = await (await router.pay(q, merchantSig, a)).wait();
  const paymentKey = T.paymentKeyOf(merchantId, q.paymentId);

  const after = {
    payer: await usdt.balanceOf(payer.address),
    receiver: await usdt.balanceOf(receiver),
    treasury: await usdt.balanceOf(dep.contracts.FeeTreasury),
  };
  console.log(`\n✓ Payment settled: ${EXPLORER}/tx/${rc.hash}`);
  console.log(`  payment id (use for refunds): ${paymentKey}`);
  console.log(`  payer     ${usd(after.payer - before.payer)} USDT`);
  console.log(`  receiver  +${usd(after.receiver - before.receiver)} USDT`);
  console.log(`  fee       +${usd(after.treasury - before.treasury)} USDT to FeeTreasury`);
  console.log(`  gas       ${ethers.formatEther(rc.gasUsed * rc.gasPrice)} WBT paid by the relayer (${rc.gasUsed} gas)`);

  const logFile = path.join(dir, `payments-${chainId}.json`);
  const log = loadJson(logFile, []);
  log.push({
    at: new Date().toISOString(),
    tx: `${EXPLORER}/tx/${rc.hash}`,
    paymentId: paymentKey,
    merchantId,
    payer: payer.address,
    receiver,
    gross: gross.toString(),
    fee: fee.toString(),
    gasUsed: rc.gasUsed.toString(),
  });
  fs.writeFileSync(logFile, JSON.stringify(log, null, 2));
  console.log(`  saved to deployments/payments-${chainId}.json`);
}

main().catch((e) => {
  console.error("\n✗", e.shortMessage || e.reason || e.message || e);
  process.exitCode = 1;
});
