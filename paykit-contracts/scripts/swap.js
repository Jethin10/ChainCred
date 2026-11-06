// Swap on YetiTrade (Uniswap V3 fork) using the pool wallet in .env (PLATFORM_ADMIN_KEY):
//   1) WBT  -> USDT   (wrap WBT -> WWBT, swap WWBT -> USDT, USDT sent to the recipient)
//   2) USDT -> WBT    (swap USDT -> WWBT, unwrap WWBT -> WBT, WBT sent to the recipient)
//
//   npm run swap
require("dotenv").config();
const { ethers } = require("hardhat");
const { ask, askAddress, askAmount } = require("./lib/prompt");

const env = (k, d) => process.env[k] || d;
const USDT = env("USDT_ADDRESS", "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7");
const WWBT = env("WWBT_ADDRESS", "0x4200000000000000000000000000000000000006");
const ROUTER = env("SWAP_ROUTER02", "0xe208cC685cD95D56E8ec6DEC9816476567fc6962");
const QUOTER = env("QUOTER_V2", "0x90f28c3a6233713d6Df00E5fa92a3f13EFe36191");
const FEE = Number(env("POOL_FEE", "3000"));
const EXPLORER = "https://explorer.testnet.whitechain.io";
const GAS_BUFFER = ethers.parseEther("0.002");
const SLIPPAGE_BPS = 200n; // 2%

async function main() {
  const [pool] = await ethers.getSigners();
  if (!pool) throw new Error("Set PLATFORM_ADMIN_KEY (the pool wallet's PRIVATE key) in .env");
  const provider = ethers.provider;

  const usdt = new ethers.Contract(
    USDT,
    [
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address,address) view returns (uint256)",
      "function approve(address,uint256) returns (bool)",
      "function transfer(address,uint256) returns (bool)",
    ],
    pool
  );
  const wwbt = new ethers.Contract(
    WWBT,
    [
      "function deposit() payable",
      "function withdraw(uint256)",
      "function approve(address,uint256) returns (bool)",
      "function balanceOf(address) view returns (uint256)",
    ],
    pool
  );
  const quoter = new ethers.Contract(
    QUOTER,
    ["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256,uint160,uint32,uint256)"],
    pool
  );
  const router = new ethers.Contract(
    ROUTER,
    ["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)"],
    pool
  );

  const wbtBal = await provider.getBalance(pool.address);
  const usdtBal = await usdt.balanceOf(pool.address);
  console.log(`\nPool wallet (from .env): ${pool.address}`);
  console.log(`  ${ethers.formatEther(wbtBal)} WBT   |   ${ethers.formatUnits(usdtBal, 6)} USDT\n`);

  let dir;
  for (;;) {
    dir = await ask("Direction?  1 = WBT -> USDT   2 = USDT -> WBT : ");
    if (dir === "1" || dir === "2") break;
    console.log("  ✗ Type 1 or 2");
  }
  const toUsdt = dir === "1";

  const recipient = await askAddress(
    `Who should RECEIVE the ${toUsdt ? "USDT" : "WBT"}?`,
    pool.address
  );
  const amountStr = await askAmount(
    `How much ${toUsdt ? "WBT" : "USDT"} should the pool wallet sell?`,
    toUsdt ? "0.05" : "1"
  );
  const amountIn = toUsdt ? ethers.parseEther(amountStr) : ethers.parseUnits(amountStr, 6);

  if (toUsdt && wbtBal < amountIn + GAS_BUFFER) throw new Error("Not enough WBT (keep ~0.002 for gas).");
  if (!toUsdt && usdtBal < amountIn) throw new Error("Pool wallet does not have that much USDT.");
  if (!toUsdt && wbtBal < GAS_BUFFER) throw new Error("Pool wallet needs ~0.002 WBT for gas.");

  const tokenIn = toUsdt ? WWBT : USDT;
  const tokenOut = toUsdt ? USDT : WWBT;
  const [quoted] = await quoter.quoteExactInputSingle.staticCall({
    tokenIn, tokenOut, amountIn, fee: FEE, sqrtPriceLimitX96: 0,
  });
  const minOut = (quoted * (10000n - SLIPPAGE_BPS)) / 10000n;
  const fmtOut = (v) => (toUsdt ? ethers.formatUnits(v, 6) + " USDT" : ethers.formatEther(v) + " WBT");
  console.log(`\nQuote: ${amountStr} ${toUsdt ? "WBT" : "USDT"} -> ${fmtOut(quoted)} (min ${fmtOut(minOut)}) to ${recipient}\n`);

  const hashes = [];
  const step = async (label, txPromise) => {
    console.log(label);
    const rc = await (await txPromise).wait();
    hashes.push(rc.hash);
    return rc;
  };

  if (toUsdt) {
    const before = await usdt.balanceOf(recipient);
    await step("1/3 wrapping WBT -> WWBT", wwbt.deposit({ value: amountIn }));
    await step("2/3 approving SwapRouter02 for exactly this WWBT", wwbt.approve(ROUTER, amountIn));
    await step(
      "3/3 swapping WWBT -> USDT (sent straight to the recipient)",
      router.exactInputSingle({ tokenIn, tokenOut, fee: FEE, recipient, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0 })
    );
    const got = (await usdt.balanceOf(recipient)) - before;
    console.log(`\n✓ Recipient got ${ethers.formatUnits(got, 6)} USDT`);
  } else {
    const allowance = await usdt.allowance(pool.address, ROUTER);
    if (allowance > 0n && allowance < amountIn) {
      await step("0/4 resetting old USDT allowance to 0", usdt.approve(ROUTER, 0));
    }
    if (allowance < amountIn) await step("1/4 approving SwapRouter02 for exactly this USDT", usdt.approve(ROUTER, amountIn));
    else console.log("1/4 allowance already sufficient");
    const wBefore = await wwbt.balanceOf(pool.address);
    await step(
      "2/4 swapping USDT -> WWBT",
      router.exactInputSingle({ tokenIn, tokenOut, fee: FEE, recipient: pool.address, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0 })
    );
    const out = (await wwbt.balanceOf(pool.address)) - wBefore;
    await step("3/4 unwrapping WWBT -> WBT", wwbt.withdraw(out));
    if (recipient !== pool.address) {
      await step(`4/4 sending ${ethers.formatEther(out)} WBT to the recipient`, pool.sendTransaction({ to: recipient, value: out }));
    } else {
      console.log("4/4 recipient is the pool wallet, nothing to send");
    }
    console.log(`\n✓ Recipient got ${ethers.formatEther(out)} WBT`);
  }

  console.log("Transactions:");
  for (const h of hashes) console.log(`  ${EXPLORER}/tx/${h}`);
  console.log(
    `Pool wallet now: ${ethers.formatEther(await provider.getBalance(pool.address))} WBT | ${ethers.formatUnits(await usdt.balanceOf(pool.address), 6)} USDT`
  );
}

main().catch((e) => {
  console.error("\n✗", e.shortMessage || e.reason || e.message || e);
  process.exitCode = 1;
});
