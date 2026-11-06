// Read-only checks before deploying to Whitechain Sepolia. Sends no transactions.
//   npx hardhat run scripts/preflight.js --network whitechainTestnet
require("dotenv").config();
const { ethers } = require("hardhat");

const env = (k, d) => process.env[k] || d;
let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => {
  failures++;
  console.log(`  ✗ ${m}`);
};
const warn = (m) => console.log(`  ! ${m}`);

async function hasCode(label, addr) {
  const code = await ethers.provider.getCode(addr);
  code && code !== "0x" ? ok(`${label} has code (${addr})`) : bad(`${label} has NO code at ${addr}`);
}

async function main() {
  const provider = ethers.provider;
  const chainId = Number((await provider.getNetwork()).chainId);
  chainId === 1874 ? ok("chain id 1874 (Whitechain Sepolia)") : bad(`chain id is ${chainId}, expected 1874`);

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    bad("PLATFORM_ADMIN_KEY is not set");
  } else {
    const bal = await provider.getBalance(deployer.address);
    const msg = `deployer ${deployer.address} has ${ethers.formatEther(bal)} WBT`;
    bal >= ethers.parseEther("0.01") ? ok(msg) : bad(`${msg} (need ~0.01+ WBT for deploy + config)`);
  }

  const usdtAddr = env("USDT_ADDRESS", "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7");
  const usdt = new ethers.Contract(
    usdtAddr,
    [
      "function name() view returns (string)",
      "function decimals() view returns (uint8)",
      "function DOMAIN_SEPARATOR() view returns (bytes32)",
      "function authorizationState(address,bytes32) view returns (bool)",
      "function isBlocked(address) view returns (bool)",
    ],
    provider
  );
  await hasCode("USDT", usdtAddr);
  const [name, decimals, sep] = await Promise.all([usdt.name(), usdt.decimals(), usdt.DOMAIN_SEPARATOR()]);
  name === "Tether USD" ? ok(`USDT name "${name}"`) : bad(`USDT name is "${name}"`);
  Number(decimals) === 6 ? ok("USDT decimals 6") : bad(`USDT decimals ${decimals}`);
  const expected = ethers.TypedDataEncoder.hashDomain({
    name: "Tether USD",
    version: "1",
    chainId,
    verifyingContract: usdtAddr,
  });
  sep === expected
    ? ok(`USDT DOMAIN_SEPARATOR matches {Tether USD, 1, ${chainId}} (${sep.slice(0, 10)}…)`)
    : bad(`USDT DOMAIN_SEPARATOR ${sep} != expected ${expected}: signatures would fail`);
  try {
    await usdt.authorizationState(ethers.ZeroAddress, ethers.ZeroHash);
    ok("USDT exposes authorizationState (EIP-3009)");
  } catch {
    bad("USDT authorizationState call failed: EIP-3009 missing?");
  }

  const wwbtAddr = env("WWBT_ADDRESS", "0x4200000000000000000000000000000000000006");
  await hasCode("WWBT", wwbtAddr);
  await hasCode("SwapRouter02", env("SWAP_ROUTER02", "0xe208cC685cD95D56E8ec6DEC9816476567fc6962"));
  await hasCode("QuoterV2", env("QUOTER_V2", "0x90f28c3a6233713d6Df00E5fa92a3f13EFe36191"));
  await hasCode("USDT/WWBT pool", env("USDT_WWBT_POOL", "0x5645101Ca8d2F7BaBC27b10359555767a1BdF999"));

  // Live quote: 1 USDT -> WWBT via QuoterV2 (eth_call), to sanity-check REFILL_MIN_WBT_PER_USDT.
  try {
    const quoter = new ethers.Contract(
      env("QUOTER_V2", "0x90f28c3a6233713d6Df00E5fa92a3f13EFe36191"),
      [
        "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160,uint32,uint256)",
      ],
      provider
    );
    const [out] = await quoter.quoteExactInputSingle.staticCall({
      tokenIn: usdtAddr,
      tokenOut: wwbtAddr,
      amountIn: 1_000_000n,
      fee: Number(env("POOL_FEE", "3000")),
      sqrtPriceLimitX96: 0,
    });
    ok(`live quote: 1 USDT -> ${ethers.formatEther(out)} WWBT`);
    const floor = BigInt(env("REFILL_MIN_WBT_PER_USDT", "10760000000000000"));
    if (floor > out) warn(`REFILL_MIN_WBT_PER_USDT (${ethers.formatEther(floor)}) is ABOVE the live quote: refills will revert`);
    else ok(`price floor ${ethers.formatEther(floor)} WBT/USDT is ${((Number(floor) / Number(out)) * 100).toFixed(1)}% of live`);
  } catch (e) {
    warn(`QuoterV2 call failed (${e.shortMessage || e.message})`);
  }

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
