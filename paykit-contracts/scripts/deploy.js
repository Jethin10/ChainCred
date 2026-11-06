// Deploys MerchantRegistry -> FeeTreasury -> PaymentRouter and configures them.
//   npx hardhat run scripts/deploy.js --network whitechainTestnet
//   npx hardhat run scripts/deploy.js            (local in-process network, deploys mocks)
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== "" ? process.env[k] : d);
const list = (k) =>
  env(k, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

async function send(label, txPromise) {
  const tx = await txPromise;
  const rc = await tx.wait();
  console.log(`  ✓ ${label}  (${rc.hash}, gas ${rc.gasUsed})`);
  return rc;
}

async function deploy(name, args) {
  const c = await ethers.deployContract(name, args);
  await c.waitForDeployment();
  const rc = await c.deploymentTransaction().wait();
  console.log(`  ✓ ${name} at ${await c.getAddress()}  (block ${rc.blockNumber}, gas ${rc.gasUsed})`);
  return { c, rc };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const isLocal = chainId === 31337;
  const admin = deployer.address;

  console.log(`Network ${network.name} (chain ${chainId})`);
  console.log(`Deployer/admin ${admin}, balance ${ethers.formatEther(await ethers.provider.getBalance(admin))} WBT\n`);

  let usdt = env("USDT_ADDRESS");
  let wwbt = env("WWBT_ADDRESS");
  let swapRouter = env("SWAP_ROUTER02");
  const poolFee = Number(env("POOL_FEE", "3000"));

  if (isLocal) {
    console.log("Local network: deploying mocks");
    usdt = await (await deploy("MockUSDT3009", [])).c.getAddress();
    const w = (await deploy("MockWWBT", [])).c;
    wwbt = await w.getAddress();
    const s = (await deploy("MockSwapRouter02", [ethers.parseEther("0.01345")])).c;
    swapRouter = await s.getAddress();
  } else if (chainId !== 1874) {
    throw new Error(`Refusing to deploy to chain ${chainId}; expected Whitechain Sepolia (1874)`);
  }
  for (const [k, v] of Object.entries({ usdt, wwbt, swapRouter })) {
    if (!ethers.isAddress(v)) throw new Error(`Missing/invalid address for ${k}`);
  }

  console.log("\nDeploying core contracts");
  const { c: registry, rc: regRc } = await deploy("MerchantRegistry", [admin, BigInt(env("PAYOUT_CHANGE_DELAY", "0"))]);
  const { c: treasury } = await deploy("FeeTreasury", [usdt, wwbt, swapRouter, poolFee, admin]);
  const { c: router } = await deploy("PaymentRouter", [
    await registry.getAddress(),
    await treasury.getAddress(),
    admin,
  ]);

  console.log("\nConfiguring");
  const feeBps = Number(env("FEE_BPS", "100"));
  const minFee = BigInt(env("MIN_FEE", "50000"));
  const maxFee = BigInt(env("MAX_FEE", "25000000"));
  await send("router.setAllowedToken(USDT)", router.setAllowedToken(usdt, true));
  await send(`router.setFeeSchedule(${feeBps} bps, min ${minFee}, max ${maxFee})`, router.setFeeSchedule(usdt, feeBps, minFee, maxFee));

  const limits = {
    maxUsdtPerRun: BigInt(env("REFILL_MAX_PER_RUN", "20000000")),
    maxUsdtPerDay: BigInt(env("REFILL_MAX_PER_DAY", "100000000")),
    minWbtPerUsdt: BigInt(env("REFILL_MIN_WBT_PER_USDT", "10760000000000000")),
    maxDeadlineWindow: Number(env("REFILL_MAX_DEADLINE", "120")),
  };
  await send("treasury.setLimits", treasury.setLimits(limits));

  const reserved = BigInt(env("RESERVED_USDT", "0"));
  if (reserved > 0n) await send("treasury.setReservedUsdt", treasury.setReservedUsdt(reserved));

  const relayers = list("RELAYER_ADDRESSES");
  if (relayers.length === 0) relayers.push(admin);
  for (const r of relayers) await send(`treasury.setRelayer(${r})`, treasury.setRelayer(r, true));

  for (const a of list("ATTESTOR_ADDRESSES")) await send(`registry.setAttestor(${a})`, registry.setAttestor(a, true));

  const out = {
    chainId,
    network: network.name,
    deployedAt: new Date().toISOString(),
    deployer: admin,
    deployBlock: regRc.blockNumber,
    contracts: {
      MerchantRegistry: await registry.getAddress(),
      FeeTreasury: await treasury.getAddress(),
      PaymentRouter: await router.getAddress(),
    },
    constructorArgs: {
      MerchantRegistry: [admin, env("PAYOUT_CHANGE_DELAY", "0")],
      FeeTreasury: [usdt, wwbt, swapRouter, poolFee, admin],
      PaymentRouter: [await registry.getAddress(), await treasury.getAddress(), admin],
    },
    tokens: { USDT: usdt, WWBT: wwbt },
    swapRouter,
    feeSchedule: { bps: feeBps, minFee: minFee.toString(), maxFee: maxFee.toString() },
    refillLimits: Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, v.toString()])),
    relayers,
    domains: {
      router: { name: "PayKit Router", version: "1" },
      registry: { name: "PayKit Registry", version: "1" },
    },
  };

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${chainId}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nSaved ${path.relative(process.cwd(), file)}\n`);
  console.log("Add to the server .env:");
  console.log(`REGISTRY_ADDRESS=${out.contracts.MerchantRegistry}`);
  console.log(`ROUTER_ADDRESS=${out.contracts.PaymentRouter}`);
  console.log(`TREASURY_ADDRESS=${out.contracts.FeeTreasury}`);
  console.log(`DEPLOY_BLOCK=${out.deployBlock}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
