// Copies what the server needs from ../paykit-contracts into ./contracts-bundle, so the server can
// be deployed on its own (Vercel): the ABIs of the five contracts and the shared EIP-712 helpers.
// Run after `npx hardhat compile` in paykit-contracts:  npm run bundle-contracts
const fs = require("fs");
const path = require("path");

const src = path.resolve(__dirname, "..", "..", "paykit-contracts");
const out = path.resolve(__dirname, "..", "contracts-bundle");
const names = ["MerchantRegistry", "PaymentRouter", "PaymentRouterV2", "PayKitPoints", "FeeTreasury"];

for (const name of names) {
  const file = path.join(src, "artifacts", "contracts", `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}. Run "npx hardhat compile" in paykit-contracts first.`);
  const { contractName, abi } = JSON.parse(fs.readFileSync(file, "utf8"));
  const dest = path.join(out, "artifacts", "contracts", `${name}.sol`, `${name}.json`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify({ contractName, abi }, null, 2) + "\n");
}

const typed = path.join(out, "scripts", "lib", "typedData.js");
fs.mkdirSync(path.dirname(typed), { recursive: true });
fs.copyFileSync(path.join(src, "scripts", "lib", "typedData.js"), typed);
console.log(`Bundled ${names.length} ABIs and typedData.js into ${path.relative(process.cwd(), out) || "."}`);
