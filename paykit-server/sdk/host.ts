/**
 * The PayKit SDK API (packages/server) hosted inside paykit-server, so the app and the SDK talk to
 * one backend. It serves every route @paykit/js and @paykit/react call, with the exact shapes they
 * validate, while paykit-server keeps its own routes (/v1/public/*, admin, points campaigns, …).
 *
 * Serverless notes:
 * - State is one PayKitDb document in Neon (paykit.sdk_state), versioned. Each request reloads it
 *   when another instance wrote a newer version, and writes it back when the request changed it.
 * - Settlement is simulated (as in `npm run server:demo`): the preview wallets have no USDT. The
 *   chain is stateless (block number = time), so any instance can follow any payment.
 *
 * Bundled to sdk/dist/paykit-sdk.mjs by sdk/vite.config.mjs (npm run bundle-sdk).
 */
import { resolveNetwork } from "@paykit/core";
import { createPayKitApi, createSimulatedChain, emptyDb, seedDemo, seedDemoLoyalty, type ChainAdapter, type PayKitDb } from "@paykit/server";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type Query = (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

// The public demo merchant key: the app's "Merchant" preview wallet owns the demo shops with it.
const DEMO_SIGNER = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" as const;
const STEP_MS = 1500;

/** Simulated settlement that needs no memory: a tx "mines" after STEP_MS, then ages into safe/final. */
function statelessChain(): ChainAdapter {
  const base = createSimulatedChain({ stepMs: STEP_MS });
  return {
    ...base,
    async waitForReceipt() {
      await new Promise((r) => setTimeout(r, STEP_MS));
      return { success: true, blockNumber: BigInt(Math.floor(Date.now() / 1000)) };
    },
    async finality(bn) {
      const age = Date.now() - Number(bn) * 1000;
      return age >= STEP_MS * 2 ? "finalized" : age >= STEP_MS ? "safe" : "included";
    },
  };
}

export async function createSdkHost({ query, siweDomains }: { query: Query; siweDomains?: string[] }) {
  await query("CREATE SCHEMA IF NOT EXISTS paykit");
  await query("CREATE TABLE IF NOT EXISTS paykit.sdk_state (id text PRIMARY KEY, version bigint NOT NULL, body text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())");

  const network = resolveNetwork("whitechain-testnet", {
    router: getAddress(`0x${"f0a7".padStart(40, "0")}`),
    registry: getAddress(`0x${"e915".padStart(40, "0")}`),
    points: getAddress(`0x${"9017".padStart(40, "0")}`),
    routerVersion: "2",
  });
  const signer = privateKeyToAccount(DEMO_SIGNER);
  const db: PayKitDb = emptyDb();
  let version = 0;
  let dirty = false;
  let saving: Promise<void> | null = null;

  const replace = (next: Partial<PayKitDb>) => {
    for (const k of Object.keys(db)) delete (db as Record<string, unknown>)[k];
    Object.assign(db, emptyDb(), next);
  };

  /** Pulls the newest state if another instance wrote one. Returns false when none exists yet. */
  async function sync(): Promise<boolean> {
    const { rows } = await query("SELECT version, body FROM paykit.sdk_state WHERE id = 'db'");
    const row = rows[0];
    if (!row) return false;
    const v = Number(row.version);
    if (v > version) {
      replace(JSON.parse(String(row.body)));
      version = v;
    }
    return true;
  }

  async function flush(): Promise<void> {
    if (saving) await saving;
    if (!dirty) return;
    dirty = false;
    const body = JSON.stringify(db);
    saving = query(
      `INSERT INTO paykit.sdk_state (id, version, body) VALUES ('db', 1, $1)
       ON CONFLICT (id) DO UPDATE SET version = paykit.sdk_state.version + 1, body = EXCLUDED.body, updated_at = now()
       RETURNING version`,
      [body],
    ).then(({ rows }) => { version = Number(rows[0]?.version ?? version); }).finally(() => { saving = null; });
    await saving;
  }

  if (!(await sync())) {
    seedDemo(db, signer.address, network);
    dirty = true;
    await flush();
  } else if (!db.loyalty) {
    seedDemoLoyalty(db);
    dirty = true;
    await flush();
  }

  const api = createPayKitApi({
    network,
    chain: statelessChain(),
    signer,
    db,
    onChange: () => { dirty = true; },
    siweDomains,
    domainCheck: "trust",
    finalityPollMs: STEP_MS,
    deliverWebhooks: true,
  });
  api.resume();

  const busy = () =>
    db.payments.some((p) => ["queued", "submitted", "included", "safe"].includes(p.status)) ||
    db.refunds.some((r) => ["queued", "submitted"].includes(r.status)) ||
    Object.keys(db.jobs).length > 0;

  return {
    /** Serves one SDK request against the latest shared state. */
    async handle(request: Request): Promise<Response> {
      await sync();
      const response = await api.handle(request);
      await flush();
      return response;
    },
    /**
     * Keeps relays, plan jobs and webhooks moving after a response, until nothing is in flight
     * (bounded). Pass the promise to Vercel's waitUntil.
     */
    async settle(maxMs = 45_000): Promise<void> {
      const until = Date.now() + maxMs;
      do {
        await api.tick().catch(() => {});
        await flush();
        if (!busy()) break;
        await new Promise((r) => setTimeout(r, STEP_MS));
      } while (Date.now() < until);
      await flush();
    },
  };
}
