// Deploys the points upgrade next to the existing contracts:
//   PayKitPoints (new) + PaymentRouterV2 (new), reusing the deployed MerchantRegistry and FeeTreasury.
//   npm run deploy:v2
// Reads deployments/<chainId>.json (from npm run deploy:testnet) and adds a "v2" section to it.
// The v1 router stays live for existing payments, refunds and subscriptions.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== "" ? process.env[k] : d);

async function send(label, txPromise) {
  const rc = await (await txPromise).wait();
  console.log(`  ✓ ${label}  (${rc.hash})`);
  return rc;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const file = path.join(__dirname, "..", "deployments", `${chainId}.json`);
  if (!fs.existsSync(file)) throw new Error(`No ${file}. Deploy v1 first (npm run deploy:testnet / deploy:local).`);
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  if (d.v2) throw new Error(`v2 is already deployed: router ${d.v2.contracts.PaymentRouterV2}. Remove "v2" from ${file} to redeploy.`);

  const admin = deployer.address;
  const registry = d.contracts.MerchantRegistry;
  const treasury = d.contracts.FeeTreasury;
  const usdt = d.tokens.USDT;
  console.log(`Network ${network.name} (chain ${chainId}), deployer ${admin}`);
  console.log(`  balance ${ethers.formatEther(await ethers.provider.getBalance(admin))} WBT`);
  console.log(`  reusing MerchantRegistry ${registry}, FeeTreasury ${treasury}\n`);

  const maxPointsPerUsdt = BigInt(env("MAX_POINTS_PER_USDT", "100"));
  const points = await ethers.deployContract("PayKitPoints", [admin, maxPointsPerUsdt]);
  await points.waitForDeployment();
  const prc = await points.deploymentTransaction().wait();
  console.log(`  ✓ PayKitPoints at ${await points.getAddress()} (block ${prc.blockNumber})`);

  const router = await ethers.deployContract("PaymentRouterV2", [registry, treasury, await points.getAddress(), admin]);
  await router.waitForDeployment();
  console.log(`  ✓ PaymentRouterV2 at ${await router.getAddress()}`);

  console.log("\nConfiguring");
  await send("points.setRouter(PaymentRouterV2)", points.setRouter(await router.getAddress()));
  await send("router.setAllowedToken(USDT)", router.setAllowedToken(usdt, true));
  const feeBps = Number(env("FEE_BPS", String(d.feeSchedule.bps)));
  const minFee = BigInt(env("MIN_FEE", d.feeSchedule.minFee));
  const maxFee = BigInt(env("MAX_FEE", d.feeSchedule.maxFee));
  await send(`router.setFeeSchedule(${feeBps} bps, min ${minFee}, max ${maxFee})`, router.setFeeSchedule(usdt, feeBps, minFee, maxFee));

  d.v2 = {
    deployedAt: new Date().toISOString(),
    deployBlock: prc.blockNumber,
    contracts: { PayKitPoints: await points.getAddress(), PaymentRouterV2: await router.getAddress() },
    constructorArgs: {
      PayKitPoints: [admin, maxPointsPerUsdt.toString()],
      PaymentRouterV2: [registry, treasury, await points.getAddress(), admin],
    },
    feeSchedule: { bps: feeBps, minFee: minFee.toString(), maxFee: maxFee.toString() },
    maxPointsPerUsdt: maxPointsPerUsdt.toString(),
    domains: { router: { name: "PayKit Router", version: "2" } },
  };
  fs.writeFileSync(file, JSON.stringify(d, null, 2));
  console.log(`\nSaved v2 section to ${path.relative(process.cwd(), file)}\n`);
  console.log("Add to paykit-server/.env:");
  console.log(`ROUTER_V2_ADDRESS=${d.v2.contracts.PaymentRouterV2}`);
  console.log(`POINTS_ADDRESS=${d.v2.contracts.PayKitPoints}`);
  console.log(`DEPLOY_BLOCK_V2=${d.v2.deployBlock}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
