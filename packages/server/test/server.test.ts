import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveNetwork } from "@paykit/core";
import { createPayKitClient, fromLocalAccount } from "@paykit/js";
import { PayKit, verifyWebhook } from "@paykit/node";
import { getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPayKitApi, createSimulatedChain, createViemChain, emptyDb, seedDemo } from "../src/index.ts";
import { fileStore, listen } from "../src/node.ts";

const OWNER_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" as const;
const contracts = { router: getAddress(`0x${"f0a7".padStart(40, "0")}`), registry: getAddress(`0x${"e915".padStart(40, "0")}`) };
const network = resolveNetwork("whitechain-testnet", contracts);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function startApi(dataFile?: string) {
  const signer = privateKeyToAccount(OWNER_KEY);
  const store = dataFile ? fileStore(dataFile) : { db: emptyDb(), save: () => {} };
  if (store.db.merchants.length === 0) seedDemo(store.db, signer.address, network);
  const api = createPayKitApi({ network, chain: createSimulatedChain({ stepMs: 10 }), signer, db: store.db, onChange: store.save, domainCheck: "trust", finalityPollMs: 10 });
  const server = listen(api, 0, "127.0.0.1");
  return new Promise<{ url: string; api: typeof api; close: () => void }>((resolve) =>
    server.on("listening", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}`, api, close: () => server.close() });
    }),
  );
}

describe("PayKit API server over HTTP", () => {
  it("serves the SDK end to end: pay, secret-key access, signed webhooks", async () => {
    const { url, api, close } = await startApi();
    // A merchant webhook receiver that verifies signatures with @paykit/node.
    const received: string[] = [];
    let secret = "";
    const hook = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          received.push(verifyWebhook(body, req.headers["paykit-signature"] as string, secret).type);
          res.writeHead(200).end("ok");
        } catch {
          res.writeHead(400).end("bad");
        }
      });
    }).listen(0, "127.0.0.1");
    await new Promise((r) => hook.on("listening", r));
    const hookUrl = `http://127.0.0.1:${(hook.address() as { port: number }).port}/webhook`;

    try {
      const owner = fromLocalAccount(privateKeyToAccount(OWNER_KEY), 1874);
      const merchant = createPayKitClient({ baseUrl: url, siwe: { domain: "localhost:5174", uri: "http://localhost:5174" } });
      await merchant.auth.login(owner);
      const endpoint = await merchant.merchant.webhooks.create({ url: hookUrl, events: ["payment.confirmed", "payment.finalized"] });
      secret = endpoint.secret!;
      const sk = (await merchant.merchant.apiKeys.create({ kind: "secret" })).key!;

      const shopper = createPayKitClient({ baseUrl: url, publishableKey: (await merchant.merchant.apiKeys.create({ kind: "publishable" })).key! });
      const [product] = await shopper.merchants.products("chai-co");
      const { payment } = await shopper.checkout.pay({ merchant: "chai-co", items: [{ productId: product!.id, quantity: 1 }] }, fromLocalAccount(privateKeyToAccount(generatePrivateKey()), 1874), {
        wait: { until: "finalized", intervalMs: 10 },
      });
      assert.equal(payment.status, "finalized");
      assert.match(payment.explorerUrl!, /^https:\/\/explorer\.testnet\.whitechain\.io\/tx\/0x/);

      // The merchant's backend reads the same data with its secret key.
      const backend = new PayKit({ secretKey: sk, baseUrl: url });
      const list = await backend.payments.list({ status: "settled" });
      assert.equal(list.data[0]!.paymentId, payment.paymentId);
      await assert.rejects(() => new PayKit({ secretKey: "sk_test_wrong", baseUrl: url }).payments.list(), /Unknown or revoked/);

      await api.tick();
      await sleep(20);
      assert.deepEqual(received.sort(), ["payment.confirmed", "payment.finalized"]);
    } finally {
      close();
      hook.close();
    }
  });

  it("keeps its data across a restart", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "paykit-")), "db.json");
    const first = await startApi(file);
    const shopper = createPayKitClient({ baseUrl: first.url });
    const [product] = await shopper.merchants.products("byte-books");
    const { payment } = await shopper.checkout.pay({ merchant: "byte-books", items: [{ productId: product!.id, quantity: 1 }] }, fromLocalAccount(privateKeyToAccount(generatePrivateKey()), 1874), {
      wait: { until: "finalized", intervalMs: 10 },
    });
    await sleep(400); // debounced save
    first.close();
    assert.ok(readFileSync(file, "utf8").includes(payment.paymentId));

    const second = await startApi(file);
    try {
      const again = await createPayKitClient({ baseUrl: second.url }).payments.get(payment.paymentId);
      assert.equal(again.status, "finalized");
    } finally {
      second.close();
    }
  });

  it("answers browser preflight requests (CORS)", async () => {
    const { url, close } = await startApi();
    try {
      const res = await fetch(`${url}/v1/status`, { method: "OPTIONS" });
      assert.equal(res.status, 204);
      assert.equal(res.headers.get("access-control-allow-origin"), "*");
    } finally {
      close();
    }
  });
});

describe("real chain adapter (read-only, live Whitechain RPC)", { timeout: 60_000 }, () => {
  it("reads finality heads, USDT permit nonces and the relay wallet balance", async () => {
    if (process.env.SKIP_LIVE) return;
    const chain = createViemChain({ network, relayer: privateKeyToAccount(generatePrivateKey()) });
    assert.equal(await chain.finality(1n), "finalized");
    assert.equal(await chain.finality(10n ** 12n), "included");
    assert.equal(await chain.permitNonce(privateKeyToAccount(generatePrivateKey()).address), 0n);
    const s = await chain.sponsorship();
    assert.equal(s.ok, false); // a fresh wallet has no WBT, so sponsorship pauses
    assert.match(s.reason!, /low on WBT/);
  });
});
