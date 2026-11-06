/**
 * PayKit API server. Configure with environment variables (see .env.example):
 *
 *   npm run server
 *
 * Real mode needs the deployed contract addresses and a funded relay wallet.
 * DEMO=1 runs the same API on a simulated chain with demo shops (no keys needed).
 */
import { resolveNetwork, type NetworkKey } from "@paykit/core";
import { getAddress, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPayKitApi } from "./api.ts";
import { createSimulatedChain } from "./chain/simulated.ts";
import { createViemChain } from "./chain/viem.ts";
import { sqliteStore, safeFetch, listen } from "./node.ts";
import { seedDemo } from "./seed.ts";

const env = process.env;
const demo = env.DEMO === "1" || process.argv.includes("--demo");
const port = Number(env.PORT ?? 8787);
const fail = (message: string): never => {
  console.error(`[paykit] ${message}`);
  process.exit(1);
};
const key = (name: string, fallback?: Hex): Hex => {
  const value = env[name] ?? fallback;
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) return fail(`${name} must be a 0x-prefixed 32-byte private key`);
  return value as Hex;
};
const address = (name: string, required: boolean) => {
  const value = env[name];
  if (!value) return required ? fail(`${name} is required (your teammate's deployed contract address)`) : undefined;
  try {
    return getAddress(value);
  } catch {
    return fail(`${name} is not a valid address`);
  }
};

const network = resolveNetwork((env.NETWORK ?? "whitechain-testnet") as NetworkKey, {
  router: address("ROUTER_ADDRESS", !demo) ?? getAddress(`0x${"f0a7".padStart(40, "0")}`),
  registry: address("REGISTRY_ADDRESS", !demo) ?? getAddress(`0x${"e915".padStart(40, "0")}`),
  treasury: address("TREASURY_ADDRESS", false),
  // PayKitPoints (loyalty). In demo mode a fake address turns points on with the simulated chain.
  points: address("POINTS_ADDRESS", false) ?? (demo ? getAddress(`0x${"9017".padStart(40, "0")}`) : undefined),
  routerVersion: env.ROUTER_VERSION === "1" ? "1" : "2",
});

const relayer = privateKeyToAccount(demo ? key("RELAYER_KEY", generatePrivateKey()) : key("RELAYER_KEY"));
const signer = privateKeyToAccount(key("SIGNER_KEY", demo ? "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" : undefined));
const admin = env.ADMIN_KEY ? privateKeyToAccount(key("ADMIN_KEY")) : undefined;

const store = sqliteStore(env.DATA_FILE ?? (demo ? "./data/paykit-demo.sqlite" : "./data/paykit.sqlite"));
const chain = demo ? createSimulatedChain({ stepMs: 1500 }) : createViemChain({ network, rpcUrl: env.RPC_URL, relayer, admin, journal: store.db.transactions, onJournalChange: () => store.save(store.db) });
if (demo && store.db.merchants.length === 0) seedDemo(store.db, signer.address, network);

const api = createPayKitApi({
  network,
  chain,
  signer,
  db: store.db,
  onChange: store.save,
  siweDomains: env.SIWE_DOMAINS ? env.SIWE_DOMAINS.split(",").map((d) => d.trim()).filter(Boolean) : demo ? undefined : fail("SIWE_DOMAINS must allowlist your login sites"),
  domainCheck: demo ? "trust" : "fetch",
  finalityPollMs: demo ? 1500 : 4000,
  publicUrl: env.PUBLIC_URL,
  fetch: demo ? undefined : safeFetch,
  refill: env.REFILL_ENABLED === "1" ? { reserve: parseEther(env.RESERVE_WBT ?? "0.02"), measuredPaymentCost: parseEther(env.MEASURED_PAYMENT_COST_WBT ?? fail("Measure payment gas cost before enabling refill")) } : undefined,
  observerStartBlock: demo ? undefined : BigInt(env.DEPLOYMENT_BLOCK ?? fail("DEPLOYMENT_BLOCK is required for event reconciliation")),
});
api.resume();
setInterval(() => void api.tick().catch((e) => console.error("[paykit] tick failed", e)), Number(env.TICK_MS ?? 5000));
const server = listen(api, port, env.HOST ?? "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { server.close(); store.save(store.db); store.close(); process.exit(0); });

console.log(`[paykit] API on http://localhost:${port} (${demo ? "DEMO: simulated chain" : network.key})`);
console.log(`[paykit] router ${network.contracts.router}, registry ${network.contracts.registry}`);
console.log(`[paykit] relay wallet ${relayer.address} (needs WBT), hosted signer ${signer.address}`);
