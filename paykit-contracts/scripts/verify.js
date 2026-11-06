// Verifies the deployed contracts on the Whitechain Blockscout explorer.
//   npx hardhat run scripts/verify.js --network whitechainTestnet
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const file = path.join(__dirname, "..", "deployments", `${chainId}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment file ${file}. Run deploy first.`);
  const d = JSON.parse(fs.readFileSync(file, "utf8"));

  const targets = ["MerchantRegistry", "FeeTreasury", "PaymentRouter"].map((name) => ({
    name,
    address: d.contracts[name],
    args: d.constructorArgs[name],
  }));
  if (d.v2) {
    for (const name of ["PayKitPoints", "PaymentRouterV2"]) {
      targets.push({ name, address: d.v2.contracts[name], args: d.v2.constructorArgs[name] });
    }
  }

  for (const { name, address, args } of targets) {
    console.log(`Verifying ${name} at ${address}`);
    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments: args,
        contract: `contracts/${name}.sol:${name}`,
      });
    } catch (e) {
      const msg = e.message || String(e);
      if (/already verified/i.test(msg)) console.log("  already verified");
      else console.log(`  failed: ${msg}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
