// Provider, relayer wallet, contracts, and the shared EIP-712 helpers from paykit-contracts.
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const config = require("./config");

function loadAbi(name) {
  const file = path.join(config.contractsDir, "artifacts", "contracts", `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`ABI not found: ${file}\nRun "npx hardhat compile" in paykit-contracts (or fix CONTRACTS_DIR).`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")).abi;
}

const typedDataFile = path.join(config.contractsDir, "scripts", "lib", "typedData.js");
if (!fs.existsSync(typedDataFile)) throw new Error(`Not found: ${typedDataFile} (check CONTRACTS_DIR)`);
const T = require(typedDataFile);

const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
const adminWallet = new ethers.Wallet(config.adminKey, provider);
const relayerSigner = new ethers.NonceManager(adminWallet);

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function authorizationState(address,bytes32) view returns (bool)",
  "function isBlocked(address) view returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function nonces(address) view returns (uint256)",
];
const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256,uint160,uint32,uint256)",
];

const routerAbi = loadAbi("PaymentRouter");
const registryAbi = loadAbi("MerchantRegistry");
const treasuryAbi = loadAbi("FeeTreasury");

const router = new ethers.Contract(config.router, routerAbi, relayerSigner); // v1
const registry = new ethers.Contract(config.registry, registryAbi, relayerSigner);
const treasury = new ethers.Contract(config.treasury, treasuryAbi, relayerSigner);
const usdt = new ethers.Contract(config.usdt, ERC20_ABI, provider);
const quoter = new ethers.Contract(config.quoter, QUOTER_ABI, provider);

// v2 (points + discounts) is optional: without ROUTER_V2_ADDRESS the server runs exactly as before
const routerV2 = config.routerV2 ? new ethers.Contract(config.routerV2, loadAbi("PaymentRouterV2"), relayerSigner) : null;
const points = config.points ? new ethers.Contract(config.points, loadAbi("PayKitPoints"), relayerSigner) : null;

const domains = {
  usdt: T.usdtDomain(config.chainId, config.usdt),
  router: T.routerDomain(config.chainId, config.router),
  routerV2: config.routerV2 ? T.routerDomainV2(config.chainId, config.routerV2) : null,
  registry: T.registryDomain(config.chainId, config.registry),
};

/** Both routers behind one shape, so services pick by version or by address. */
const routers = {
  v1: { version: 1, address: config.router, contract: router, domain: domains.router },
  ...(routerV2 ? { v2: { version: 2, address: config.routerV2, contract: routerV2, domain: domains.routerV2 } } : {}),
};
/** The router new invoices, quotes and subscriptions use. */
const currentRouter = () => routers.v2 || routers.v1;
/** Look up a router by address (as stored on payments / subscriptions). Defaults to v1 for old records. */
function routerAt(address) {
  if (!address) return routers.v1;
  const a = address.toLowerCase();
  return Object.values(routers).find((r) => r.address.toLowerCase() === a) || routers.v1;
}

const txUrl = (hash) => `${config.explorerUrl}/tx/${hash}`;
const addressUrl = (a) => `${config.explorerUrl}/address/${a}`;

/** Turn an ethers error into a short reason, decoding PayKit custom errors when possible. */
function reasonOf(e) {
  if (e?.revert?.name) return e.revert.name;
  const data = e?.data || e?.info?.error?.data || e?.error?.data;
  if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
    for (const c of [routerV2, router, registry, treasury, points].filter(Boolean)) {
      try {
        const parsed = c.interface.parseError(data);
        if (parsed) return parsed.name;
      } catch {}
    }
  }
  return e?.shortMessage || e?.reason || e?.message || String(e);
}

module.exports = {
  ethers,
  T,
  provider,
  adminWallet,
  relayerSigner,
  router,
  routerV2,
  points,
  routers,
  currentRouter,
  routerAt,
  registry,
  treasury,
  usdt,
  quoter,
  domains,
  txUrl,
  addressUrl,
  reasonOf,
};
