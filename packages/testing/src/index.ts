/**
 * The real PayKit API running in memory on a simulated chain. Use it to build and test UI
 * without a server, with the REAL client:
 *
 *   import { createPayKitClient } from "@paykit/js";
 *   import { createMockApi } from "@paykit/js/mock";
 *   const mock = createMockApi();
 *   const paykit = createPayKitClient({ baseUrl: mock.baseUrl, fetch: mock.fetch, siwe: mock.siwe });
 *
 * It is the same code as @paykit/server, with a fake chain: quotes are really signed and
 * wallet signatures really checked; payments move queued → included → safe → final in
 * seconds. Nothing touches a chain. Data resets on reload.
 */
import { resolveNetwork } from "@paykit/core";
import { createPayKitApi, createSimulatedChain, emptyDb, seedDemo, type PayKitDb } from "@paykit/server";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const fakeAddress = (tail: string) => getAddress(`0x${tail.padStart(40, "0")}`);

/** Fake contract addresses. The real ones come from GET /v1/config. */
const MOCK_CONTRACTS = {
  registry: fakeAddress("e915"),
  router: fakeAddress("f0a7"),
  treasury: fakeAddress("fee5"),
};

/**
 * Publicly known test keys (Anvil defaults). `merchant` owns the demo shops and is the mock's
 * hosted signer. Never fund or reuse these anywhere real.
 */
export const MOCK_TEST_KEYS = {
  merchant: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  customer: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
} as const;

export interface MockApiOptions {
  baseUrl?: string;
  /** Simulated delay per request in ms. Default 150. */
  latencyMs?: number;
  /** ms per chain step (mined → safe → final). Default 1200. */
  stepMs?: number;
}

export interface MockApi {
  baseUrl: string;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  siwe: { domain: string; uri: string };
  contracts: typeof MOCK_CONTRACTS;
  /** The API's state, for tests and preview pages. */
  db: PayKitDb;
}

export function createMockApi(options: MockApiOptions = {}): MockApi {
  const baseUrl = options.baseUrl ?? "https://mock.paykit.local";
  const latency = options.latencyMs ?? 150;
  const stepMs = options.stepMs ?? 1200;
  const network = resolveNetwork("whitechain-testnet", MOCK_CONTRACTS);
  const signer = privateKeyToAccount(MOCK_TEST_KEYS.merchant);
  const db = emptyDb();
  seedDemo(db, signer.address, network);
  const api = createPayKitApi({
    network,
    chain: createSimulatedChain({ stepMs }),
    signer,
    db,
    domainCheck: "trust",
    deliverWebhooks: false,
    finalityPollMs: stepMs,
  });
  return {
    baseUrl,
    fetch: async (input, init) => {
      if (latency > 0) await new Promise((r) => setTimeout(r, latency));
      return api.fetch(input, init);
    },
    siwe: { domain: "localhost:5174", uri: "http://localhost:5174" },
    contracts: MOCK_CONTRACTS,
    db,
  };
}
