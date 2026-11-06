// Convert the USDT fees held in FeeTreasury into native WBT, paid to the calling relayer
// (the pool wallet in .env, PLATFORM_ADMIN_KEY). Calls FeeTreasury.refill().
//   npm run refill
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const { askAmount } = require("./lib/prompt");

const env = (k, d) => process.env[k] || d;
const EXPLORER = "https://explorer.testnet.whitechain.io";
const SLIPPAGE_BPS = 200n; // 2%

async function main() {
  const provider = ethers.provider;
  const chainId = Number((await provider.getNetwork()).chainId);
  const depFile = path.join(__dirname, "..", "deployments", `${chainId}.json`);
  if (!fs.existsSync(depFile)) throw new Error(`No ${depFile}. Run npm run deploy:testnet first.`);
  const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));

  const [relayer] = await ethers.getSigners();
  if (!relayer) throw new Error("Set PLATFORM_ADMIN_KEY in .env");

  const treasury = await ethers.getContractAt("FeeTreasury", dep.contracts.FeeTreasury, relayer);
  const usdtAddr = dep.tokens.USDT;
  const wwbtAddr = dep.tokens.WWBT;
  const poolFee = Number(env("POOL_FEE", "3000"));
  const quoter = new ethers.Contract(
    env("QUOTER_V2", "0x90f28c3a6233713d6Df00E5fa92a3f13EFe36191"),
    ["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256,uint160,uint32,uint256)"],
    relayer
  );

  if (!(await treasury.isRelayer(relayer.address))) {
    throw new Error(`${relayer.address} is not a whitelisted relayer on the treasury`);
  }

  const usdtInTreasury = await new ethers.Contract(usdtAddr, ["function balanceOf(address) view returns (uint256)"], provider).balanceOf(
    dep.contracts.FeeTreasury
  );
  const limits = await treasury.limits();
  const spentToday = await treasury.spentToday();
  const dayStart = await treasury.dayStart();
  const now = BigInt((await provider.getBlock("latest")).timestamp);
  const spent = now >= dayStart + 86400n ? 0n : spentToday; // the contract resets the counter after 24h
  const dayLeft = limits.maxUsdtPerDay > spent ? limits.maxUsdtPerDay - spent : 0n;
  const most = [usdtInTreasury, limits.maxUsdtPerRun, dayLeft].reduce((a, b) => (b < a ? b : a));

  console.log(`\nTreasury ${dep.contracts.FeeTreasury}`);
  console.log(`  holds ${ethers.formatUnits(usdtInTreasury, 6)} USDT`);
  console.log(`  per-run cap ${ethers.formatUnits(limits.maxUsdtPerRun, 6)} | left today ${ethers.formatUnits(dayLeft, 6)}`);
  console.log(`  you can refill up to ${ethers.formatUnits(most, 6)} USDT now`);
  console.log(`Relayer ${relayer.address}: ${ethers.formatEther(await provider.getBalance(relayer.address))} WBT\n`);
  if (most === 0n) throw new Error("Nothing to refill (treasury empty or a cap reached).");

  const amountStr = await askAmount("How much USDT to convert to WBT?", ethers.formatUnits(most, 6));
  const usdtIn = ethers.parseUnits(amountStr, 6);
  if (usdtIn > most) throw new Error(`Max allowed right now is ${ethers.formatUnits(most, 6)} USDT`);

  const [quoted] = await quoter.quoteExactInputSingle.staticCall({
    tokenIn: usdtAddr, tokenOut: wwbtAddr, amountIn: usdtIn, fee: poolFee, sqrtPriceLimitX96: 0,
  });
  const slipMin = (quoted * (10000n - SLIPPAGE_BPS)) / 10000n;
  const floorMin = (usdtIn * limits.minWbtPerUsdt) / 1_000_000n; // admin price floor enforced by the contract
  const minOut = slipMin > floorMin ? slipMin : floorMin;
  console.log(`\nQuote: ${amountStr} USDT -> ${ethers.formatEther(quoted)} WBT (min accepted ${ethers.formatEther(minOut)})`);
  if (minOut > quoted) {
    throw new Error(
      `The treasury's price floor (${ethers.formatEther(limits.minWbtPerUsdt)} WBT/USDT) is above the live price, so the swap would revert. ` +
        `Lower REFILL_MIN_WBT_PER_USDT and call treasury.setLimits, or wait for the price.`
    );
  }

  const deadline = now + 90n; // contract allows at most maxDeadlineWindow (120s) ahead
  await treasury.refill.staticCall(usdtIn, minOut, deadline);
  const before = await provider.getBalance(relayer.address);
  const rc = await (await treasury.refill(usdtIn, minOut, deadline)).wait();
  const gasCost = rc.gasUsed * rc.gasPrice;
  const gained = (await provider.getBalance(relayer.address)) - before + gasCost;

  console.log(`\n✓ Refill done: ${EXPLORER}/tx/${rc.hash}`);
  console.log(`  swapped ${amountStr} USDT -> ${ethers.formatEther(gained)} WBT (sent to ${relayer.address})`);
  console.log(`  this transaction cost ${ethers.formatEther(gasCost)} WBT in gas, so net ${ethers.formatEther(gained - gasCost)} WBT`);
  console.log(`  treasury now holds ${ethers.formatUnits(usdtInTreasury - usdtIn, 6)} USDT`);
}

main().catch((e) => {
  console.error("\n✗", e.shortMessage || e.reason || e.message || e);
  process.exitCode = 1;
});
