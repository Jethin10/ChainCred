require("dotenv").config();
const path = require("path");
const { ethers } = require("ethers");

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== "" ? process.env[k] : d);
function required(k) {
  const v = env(k);
  if (v === undefined) throw new Error(`Missing ${k} in .env (see .env.example)`);
  return v;
}
const addr = (k) => {
  const v = required(k);
  if (!ethers.isAddress(v)) throw new Error(`${k} is not a valid address`);
  return ethers.getAddress(v);
};

const optAddr = (k) => {
  const v = env(k);
  if (v === undefined) return null;
  if (!ethers.isAddress(v)) throw new Error(`${k} is not a valid address`);
  return ethers.getAddress(v);
};

const masterKey = required("MASTER_KEY");
if (!/^(0x)?[0-9a-fA-F]{64}$/.test(masterKey)) throw new Error("MASTER_KEY must be 32 bytes of hex (npm run gen-secrets)");

const config = {
  port: Number(env("PORT", "8787")),
  checkoutBaseUrl: env("CHECKOUT_BASE_URL", "http://localhost:3000/pay").replace(/\/$/, ""),

  databaseUrl: env("DATABASE_URL"),
  databaseUrlUnpooled: env("DATABASE_URL_UNPOOLED"),

  adminToken: required("ADMIN_TOKEN"),
  masterKey: Buffer.from(masterKey.replace(/^0x/, ""), "hex"),

  rpcUrl: env("RPC_URL", "https://rpc.testnet.whitechain.io"),
  chainId: Number(env("CHAIN_ID", "1874")),
  explorerUrl: env("EXPLORER_URL", "https://explorer.testnet.whitechain.io").replace(/\/$/, ""),
  adminKey: required("PLATFORM_ADMIN_KEY"),

  registry: addr("REGISTRY_ADDRESS"),
  router: addr("ROUTER_ADDRESS"),
  treasury: addr("TREASURY_ADDRESS"),
  deployBlock: Number(required("DEPLOY_BLOCK")),
  // points upgrade (optional): PaymentRouterV2 + PayKitPoints from "npm run deploy:v2"
  routerV2: optAddr("ROUTER_V2_ADDRESS"),
  points: optAddr("POINTS_ADDRESS"),
  deployBlockV2: env("DEPLOY_BLOCK_V2") ? Number(env("DEPLOY_BLOCK_V2")) : null,
  usdt: addr("USDT_ADDRESS"),
  wwbt: addr("WWBT_ADDRESS"),
  quoter: addr("QUOTER_V2"),
  poolFee: Number(env("POOL_FEE", "3000")),
  contractsDir: path.resolve(__dirname, "..", env("CONTRACTS_DIR", "../paykit-contracts")),

  quoteTtlSec: Number(env("QUOTE_TTL_SEC", "600")),
  merchantMaxFeeBps: Number(env("MERCHANT_MAX_FEE_BPS", "300")),
  confirmations: Number(env("CONFIRMATIONS", "2")),
  observerPollMs: Number(env("OBSERVER_POLL_MS", "3000")),
  observerChunk: Number(env("OBSERVER_CHUNK", "2000")),
  webhookMaxAttempts: Number(env("WEBHOOK_MAX_ATTEMPTS", "8")),

  subscriptions: {
    schedulerPollMs: Number(env("SCHEDULER_POLL_MS", "15000")),
    // after a failed charge (low balance / allowance), wait this long before trying again
    retryAfterSec: Number(env("CHARGE_RETRY_SEC", "300")),
    defaultGraceSec: Number(env("DEFAULT_GRACE_SEC", "259200")), // 3 days
  },

  refill: {
    enabled: env("REFILL_ENABLED", "true") === "true",
    intervalMin: Number(env("REFILL_INTERVAL_MIN", "30")),
    minUsdt: ethers.parseUnits(env("REFILL_MIN_USDT", "0.5"), 6),
    profitMultiple: BigInt(env("REFILL_PROFIT_MULTIPLE", "3")),
    slippageBps: BigInt(env("REFILL_SLIPPAGE_BPS", "200")),
  },
};

module.exports = config;
