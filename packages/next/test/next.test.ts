import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signWebhookPayload } from "@paykit/node";
import { createMerchantDataHandler, createWebhookHandler } from "../src/index.ts";

const secret = "whsec_next";
const event = { id: "evt_9", type: "payment.finalized", createdAt: "2026-11-06T00:00:00Z", merchantSlug: "chai-co", chainId: 1874, data: { invoiceId: "inv_1" } };

const delivery = (body: string, header: string | null) =>
  new Request("https://shop.test/api/paykit/webhook", { method: "POST", body, headers: header ? { "paykit-signature": header } : {} });

describe("createWebhookHandler", () => {
  it("runs the typed handler for a verified event", async () => {
    const seen: string[] = [];
    const handler = createWebhookHandler({ secret, on: { "payment.finalized": (e) => void seen.push(e.id) } });
    const body = JSON.stringify(event);
    const res = await handler(delivery(body, signWebhookPayload(body, secret)));
    assert.equal(res.status, 200);
    assert.deepEqual(seen, ["evt_9"]);
  });

  it("returns 400 for a bad signature and 500 when the handler fails", async () => {
    const body = JSON.stringify(event);
    const ok = createWebhookHandler({ secret, on: {} });
    assert.equal((await ok(delivery(body, signWebhookPayload(body, "whsec_wrong")))).status, 400);
    assert.equal((await ok(delivery(body, null))).status, 400);
    const failing = createWebhookHandler({ secret, on: { "payment.finalized": () => { throw new Error("db down"); } } });
    const original = console.error;
    console.error = () => {};
    try {
      assert.equal((await failing(delivery(body, signWebhookPayload(body, secret)))).status, 500);
    } finally {
      console.error = original;
    }
  });
});

describe("createMerchantDataHandler", () => {
  const upstreamCalls: Array<{ url: string; auth: string | null }> = [];
  const fakeFetch = async (url: string, init?: RequestInit) => {
    upstreamCalls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    return Response.json({ data: [], nextCursor: null });
  };
  const make = (authorized: boolean) =>
    createMerchantDataHandler({ secretKey: "sk_test_x", baseUrl: "https://api.paykit.test/", authorize: () => authorized, fetch: fakeFetch });

  it("forwards allowed merchant routes with the secret key", async () => {
    const res = await make(true)(new Request("https://shop.test/api/paykit/v1/portal/merchant/payments?status=pending"));
    assert.equal(res.status, 200);
    assert.equal(upstreamCalls.at(-1)!.url, "https://api.paykit.test/v1/portal/merchant/payments?status=pending");
    assert.equal(upstreamCalls.at(-1)!.auth, "Bearer sk_test_x");
  });

  it("requires the developer's own authorization", async () => {
    const res = await make(false)(new Request("https://shop.test/api/paykit/v1/portal/merchant/stats"));
    assert.equal(res.status, 401);
  });

  it("refuses routes outside the allowlist, including key creation", async () => {
    const before = upstreamCalls.length;
    assert.equal((await make(true)(new Request("https://shop.test/api/paykit/v1/admin/pause", { method: "POST" }))).status, 403);
    assert.equal((await make(true)(new Request("https://shop.test/api/paykit/v1/portal/merchant/api-keys", { method: "POST", body: "{}" }))).status, 403);
    assert.equal((await make(true)(new Request("https://shop.test/api/paykit/v1/me/payments"))).status, 403);
    assert.equal(upstreamCalls.length, before);
  });

  it("refuses to start without a secret key or an authorize check", () => {
    assert.throws(() => createMerchantDataHandler({ secretKey: "pk_test_x", baseUrl: "https://x", authorize: () => true }));
    assert.throws(() => createMerchantDataHandler({ secretKey: "sk_test_x", baseUrl: "https://x" } as never));
  });
});

it("allows key management only when explicitly enabled", async () => {
  const handler = createMerchantDataHandler({ secretKey: "sk_test_fixture", baseUrl: "https://api.example.com", authorize: () => true, allowApiKeyManagement: true, fetch: async () => Response.json({ ok: true }) });
  assert.equal((await handler(new Request("https://shop.example.com/api/paykit/v1/portal/merchant/api-keys", { method: "POST", body: "{}" }))).status, 200);
  assert.equal((await handler(new Request("https://shop.example.com/api/paykit/v1/portal/merchant/api-keys/key_1", { method: "DELETE" }))).status, 200);
});
