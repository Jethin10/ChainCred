import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPayKitClient, fromLocalAccount, isPayKitError, parseUsdt, type CheckoutSession, type PayKitClient } from "../src/index.ts";
import { createMockApi } from "../src/mock.ts";

const CHAIN = 1874;
// Same well-known test key the mock merchant uses (owner of the demo shops).
const merchantAccount = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");

function setup() {
  const mock = createMockApi({ latencyMs: 0, stepMs: 20 });
  const client = (key?: string) =>
    createPayKitClient({ baseUrl: mock.baseUrl, fetch: mock.fetch, siwe: mock.siwe, publishableKey: key });
  return { mock, client };
}

const newWallet = () => fromLocalAccount(privateKeyToAccount(generatePrivateKey()), CHAIN);

async function rejectsWith(fn: () => Promise<unknown>, code: string) {
  await assert.rejects(fn, (e: unknown) => {
    assert.ok(isPayKitError(e), `expected PayKitError, got ${String(e)}`);
    assert.equal(e.code, code);
    return true;
  });
}

describe("client safety", () => {
  it("refuses a secret key in the browser client", () => {
    assert.throws(() => createPayKitClient({ baseUrl: "https://x", publishableKey: "sk_test_123" }), /secret key/);
  });

  it("requires a wallet session for dashboards", async () => {
    const { client } = setup();
    await rejectsWith(() => client().me.payments(), "unauthorized");
    await rejectsWith(() => client().merchant.stats(), "unauthorized");
  });
});

describe("shops", () => {
  it("lists merchants and products", async () => {
    const { client } = setup();
    const c = client();
    const shops = await c.merchants.list();
    assert.ok(shops.data.length >= 3);
    const products = await c.merchants.products("chai-co");
    assert.ok(products.length > 0);
    assert.equal((await c.merchants.list({ q: "pixel" })).data.length, 1);
  });
});

describe("pay now", () => {
  it("pays a cart with one gasless signature and follows it to finalized", async () => {
    const { client, mock } = setup();
    const c = client();
    const payer = newWallet();
    const [product] = await c.merchants.products("chai-co");
    const seen: string[] = [];
    const { payment, session } = await c.checkout.pay({ merchant: "chai-co", items: [{ productId: product!.id, quantity: 2 }] }, payer, {
      wait: { until: "finalized", intervalMs: 10, onUpdate: (p) => seen.push(p.status) },
    });
    assert.equal(payment.status, "finalized");
    assert.equal(payment.gross, (BigInt(product!.price) * 2n).toString());
    assert.equal(payment.payer, await payer.getAddress());
    assert.ok(payment.txHash);
    assert.ok(seen.includes("finalized"));
    assert.equal(mock.db.invoices.find((i) => i.id === session.invoice.id)?.status, "paid");
  });

  it("does not charge twice when the same session is authorized again", async () => {
    const { client, mock } = setup();
    const c = client();
    const payer = newWallet();
    const [product] = await c.merchants.products("chai-co");
    const session = await c.checkout.createSession({ merchant: "chai-co", items: [{ productId: product!.id, quantity: 1 }] });
    const first = await c.checkout.authorize(session, payer);
    const second = await c.checkout.authorize(session, payer);
    assert.equal(first.paymentId, second.paymentId);
    assert.equal(mock.db.payments.filter((p) => p.paymentId === first.paymentId).length, 1);
  });

  it("refuses to sign tampered or expired sessions", async () => {
    const { client } = setup();
    const c = client();
    const payer = newWallet();
    const [product] = await c.merchants.products("chai-co");
    const session = await c.checkout.createSession({ merchant: "chai-co", items: [{ productId: product!.id, quantity: 1 }] });
    const tamper = (fn: (s: CheckoutSession) => void) => {
      const copy = structuredClone(session);
      fn(copy);
      return copy;
    };
    await rejectsWith(() => c.checkout.authorize(tamper((s) => (s.quote.gross = "1")), payer), "quote_mismatch");
    await rejectsWith(() => c.checkout.authorize(tamper((s) => (s.router = "0x000000000000000000000000000000000000dEaD")), payer), "quote_mismatch");
    await rejectsWith(() => c.checkout.authorize(tamper((s) => (s.invoice.total = "1")), payer), "quote_mismatch");
    await rejectsWith(() => c.checkout.authorize(tamper((s) => (s.quote.token = "0xaa7962d073935D387e8d442DA1D7149C81388f46")), payer), "quote_mismatch");
    await rejectsWith(() => c.checkout.authorize(tamper((s) => (s.merchant.merchantId = s.invoice.invoiceId)), payer), "quote_mismatch");
  });
});

describe("pay in parts", () => {
  it("pays a 30% deposit then the remaining 70%", async () => {
    const { client } = setup();
    const merchant = client();
    await merchant.auth.login(fromLocalAccount(merchantAccount, CHAIN));
    const invoice = await merchant.merchant.createInvoice({
      lineItems: [{ name: "Website build", quantity: 1, unitAmount: parseUsdt("100").toString() }],
      schedule: { type: "deposit", depositPercent: 30 },
    });
    assert.deepEqual(invoice.schedule, { type: "deposit", depositPercent: 30, parts: ["30000000", "70000000"] });

    const c = client();
    const payer = newWallet();
    const deposit = await c.checkout.pay({ invoiceId: invoice.id }, payer, { wait: { intervalMs: 10 } });
    assert.equal(deposit.payment.gross, "30000000");
    const rest = await c.checkout.pay({ invoiceId: invoice.id }, payer, { wait: { intervalMs: 10 } });
    assert.equal(rest.payment.gross, "70000000");
    assert.notEqual(deposit.payment.paymentId, rest.payment.paymentId);
    assert.equal((await c.invoices.get(invoice.id)).status, "paid");
    await rejectsWith(() => c.checkout.createSession({ invoiceId: invoice.id }), "invoice_overpaid");
  });
});

describe("installments", () => {
  it("creates a 3-part plan with consent + permit, then the payer cancels it", async () => {
    const { client } = setup();
    const c = client();
    const wallet = newWallet();
    const payer = await wallet.getAddress();
    const products = await c.merchants.products("chai-co");
    const box = products.find((p) => p.name.includes("subscription"))!;
    const session = await c.plans.createSession({ merchant: "chai-co", items: [{ productId: box.id, quantity: 1 }] }, { count: 3, periodSeconds: 120 }, payer);
    const plan = await c.plans.authorize(session, wallet);
    assert.equal(plan.status, "active");
    assert.equal(plan.count, 3);
    assert.equal(BigInt(plan.downPayment) + BigInt(plan.installmentAmount) * 3n, BigInt(box.price));

    await c.auth.login(wallet);
    assert.equal((await c.me.plans()).data.length, 1);
    const cancelled = await c.plans.cancel(plan.planId as `0x${string}`, wallet);
    assert.equal(cancelled.status, "cancelled");

    // Someone else's wallet cannot use this payer's plan session.
    const other = newWallet();
    const again = await c.plans.createSession({ merchant: "chai-co", items: [{ productId: box.id, quantity: 1 }] }, { count: 2, periodSeconds: 60 }, payer);
    await rejectsWith(() => c.plans.authorize(again, other), "quote_mismatch");
  });
});

describe("user dashboard", () => {
  it("shows only the signed-in wallet's payments", async () => {
    const { client } = setup();
    const c = client();
    const alice = newWallet();
    const bob = newWallet();
    const [product] = await c.merchants.products("byte-books");
    await c.checkout.pay({ merchant: "byte-books", items: [{ productId: product!.id, quantity: 1 }] }, alice, { wait: { intervalMs: 10 } });
    await c.checkout.pay({ merchant: "byte-books", items: [{ productId: product!.id, quantity: 1 }] }, bob, { wait: { intervalMs: 10 } });
    const session = await c.auth.login(alice);
    assert.equal(session.address, await alice.getAddress());
    const mine = await c.me.payments();
    assert.equal(mine.data.length, 1);
    assert.equal(mine.data[0]!.payer, await alice.getAddress());
  });
});

describe("merchant dashboard", () => {
  it("signs up a new merchant, proving a separate payout wallet", async () => {
    const { client } = setup();
    const c = client();
    const owner = newWallet();
    const payout = newWallet();
    await c.auth.login(owner);
    assert.equal(await c.merchant.get(), null);
    const input = { name: "Dosa Hub", slug: "dosa-hub", website: "dosahub.in", payout: await payout.getAddress() };
    await rejectsWith(() => c.merchant.signup(input, owner), "validation_failed");
    const merchant = await c.merchant.signup(input, owner, { payoutSigner: payout });
    assert.equal(merchant.slug, "dosa-hub");
    assert.equal(merchant.payout, await payout.getAddress());
    assert.equal((await c.merchant.get())?.slug, "dosa-hub");

    const challenge = await c.merchant.domains.start("dosahub.in");
    assert.equal(challenge.wellKnownUrl, "https://dosahub.in/.well-known/paykit.json");
    assert.equal((await c.merchant.domains.check("dosahub.in")).status, "verified");
  });

  it("refunds part of a payment and rejects refunding more than was paid", async () => {
    const { client } = setup();
    const shopper = client();
    const payer = newWallet();
    // The demo merchant wallet signs in as its first shop, chai-co.
    const product = (await shopper.merchants.products("chai-co")).find((p) => p.name === "Chai subscription box");
    const { payment } = await shopper.checkout.pay({ merchant: "chai-co", items: [{ productId: product!.id, quantity: 1 }] }, payer, {
      wait: { intervalMs: 10 },
    });

    const m: PayKitClient = client();
    const owner = fromLocalAccount(merchantAccount, CHAIN);
    await m.auth.login(owner);
    const stats = await m.merchant.stats();
    assert.equal(stats.paymentCount, 1);
    const refund = await m.merchant.refund(payment.paymentId, parseUsdt("10"), { merchant: owner }, { reason: "partial" });
    assert.equal(refund.amount, "10000000");
    assert.equal(refund.to, payment.refundTo);
    await rejectsWith(() => m.merchant.refund(payment.paymentId, BigInt(payment.gross) + 1n, { merchant: owner }), "refund_exceeds_payment");

    // A funder wallet that is not the payout wallet is refused before signing.
    await rejectsWith(() => m.merchant.refund(payment.paymentId, 1n, { merchant: owner, funder: newWallet() }), "validation_failed");
  });

  it("manages products, API keys and webhooks", async () => {
    const { client } = setup();
    const m = client();
    await m.auth.login(fromLocalAccount(merchantAccount, CHAIN));
    const p = await m.merchant.products.create({ name: "Cutting chai", price: "1500000" });
    assert.equal((await m.merchant.products.update(p.id, { active: false })).active, false);
    const key = await m.merchant.apiKeys.create({ kind: "publishable", allowedOrigins: ["https://chai.example"] });
    assert.match(key.key!, /^pk_test_/);
    const hook = await m.merchant.webhooks.create({ url: "https://chai.example/api/paykit/webhook", events: ["payment.finalized"] });
    assert.match(hook.secret!, /^whsec_/);
    assert.equal((await m.merchant.webhooks.list()).length, 1);
  });
});
