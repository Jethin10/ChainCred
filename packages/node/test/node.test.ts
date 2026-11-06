import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress, isAddressEqual, keccak256, recoverTypedDataAddress, stringToBytes, zeroAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  generateMerchantSigner,
  hashPaymentQuote,
  hashRefundTerms,
  isPayKitError,
  paymentQuoteTypedData,
  PayKit,
  receiveWithAuthorizationTypedData,
  refundNonce,
  resolveNetwork,
  resolveValidUntil,
  signWebhookPayload,
  verifyWebhook,
  type PaymentQuoteMessage,
} from "../src/index.ts";

const CONTRACTS = {
  registry: getAddress(`0x${"e915".padStart(40, "0")}`),
  router: getAddress(`0x${"f0a7".padStart(40, "0")}`),
  treasury: getAddress(`0x${"fee5".padStart(40, "0")}`),
};
const network = resolveNetwork("whitechain-testnet", CONTRACTS);
const USDT = network.usdt!.address;

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

/** Tiny fake API: records requests and answers a few routes. */
function fakeApi(handlers: Record<string, (body: any) => unknown | Promise<unknown>>) {
  const calls: Array<{ method: string; path: string; headers: Headers; body: any }> = [];
  const fetch = async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname, headers: new Headers(init.headers), body });
    if (url.pathname === "/v1/config") {
      return json({ network: "whitechain-testnet", chainId: 1874, contracts: CONTRACTS, usdt: USDT, feeSchedule: { bps: 100, minFee: "50000", maxFee: "25000000" } });
    }
    const handler = handlers[`${method} ${url.pathname}`];
    if (!handler) return json({ error: { code: "not_found", message: `no ${method} ${url.pathname}` } }, 404);
    try {
      return json(await handler(body));
    } catch (e) {
      return json({ error: { code: "signature_invalid", message: String(e) } }, 400);
    }
  };
  return { fetch, calls };
}

const quote = (over: Partial<PaymentQuoteMessage> = {}): PaymentQuoteMessage => ({
  merchantId: keccak256(stringToBytes("m")),
  invoiceId: keccak256(stringToBytes("i")),
  invoiceDigest: keccak256(stringToBytes("d")),
  paymentId: keccak256(stringToBytes("p")),
  token: USDT,
  invoiceTotal: 100_000_000n,
  gross: 100_000_000n,
  fee: 1_000_000n,
  payer: zeroAddress,
  splitProfileId: 0,
  validUntil: 2_000_000_000n,
  ...over,
});

describe("webhooks", () => {
  const secret = "whsec_test_123";
  const event = { id: "evt_1", type: "payment.finalized", createdAt: "2026-11-06T00:00:00Z", merchantSlug: "chai-co", chainId: 1874, data: { paymentId: "0x1" } };
  const body = JSON.stringify(event);

  it("verifies a signed delivery", () => {
    const header = signWebhookPayload(body, secret, 1_000);
    const verified = verifyWebhook(body, header, secret, { now: 1_100 });
    assert.equal(verified.id, "evt_1");
    assert.equal(verified.type, "payment.finalized");
  });

  it("rejects tampered bodies, wrong secrets, stale timestamps and junk headers", () => {
    const header = signWebhookPayload(body, secret, 1_000);
    const bad = (fn: () => unknown) => assert.throws(fn, (e: unknown) => isPayKitError(e) && e.code === "signature_invalid");
    bad(() => verifyWebhook(body.replace("chai-co", "evil"), header, secret, { now: 1_000 }));
    bad(() => verifyWebhook(body, header, "whsec_other", { now: 1_000 }));
    bad(() => verifyWebhook(body, header, secret, { now: 1_000 + 301 }));
    bad(() => verifyWebhook(body, "t=1000,v1=zz", secret, { now: 1_000 }));
    bad(() => verifyWebhook(body, null, secret));
  });

  it("accepts either secret during rotation", () => {
    const header = signWebhookPayload(body, "whsec_new", 50);
    assert.equal(verifyWebhook(body, header, ["whsec_old", "whsec_new"], { now: 50 }).id, "evt_1");
  });
});

describe("PayKit server SDK", () => {
  it("refuses publishable keys", () => {
    assert.throws(() => new PayKit({ secretKey: "pk_test_1", baseUrl: "https://x" }), /secret key/);
  });

  it("sends the secret key as a bearer token", async () => {
    const api = fakeApi({ "GET /v1/payments": () => ({ data: [], nextCursor: null }) });
    const paykit = new PayKit({ secretKey: "sk_test_abc", baseUrl: "https://api.test", fetch: api.fetch });
    await paykit.payments.list();
    assert.equal(api.calls[0]!.headers.get("authorization"), "Bearer sk_test_abc");
  });

  it("signs quotes locally and refuses fees below the floor", async () => {
    const { privateKey, address } = generateMerchantSigner();
    const api = fakeApi({});
    const paykit = new PayKit({ secretKey: "sk_test_abc", baseUrl: "https://api.test", fetch: api.fetch, signerKey: privateKey });
    assert.equal(paykit.signerAddress, address);
    const q = quote();
    const { signature, quoteHash } = await paykit.signQuote(q);
    assert.equal(quoteHash, hashPaymentQuote(network, q));
    assert.ok(isAddressEqual(await recoverTypedDataAddress({ ...paymentQuoteTypedData(network, q), signature }), address));
    await assert.rejects(() => paykit.signQuote(quote({ fee: 1n })), /floor/);
    await assert.rejects(() => paykit.signQuote(quote({ gross: 200_000_000n, fee: 2_000_000n })), /exceeds the invoice/);
  });

  it("creates and signs the next invoice quote", async () => {
    const { privateKey, address } = generateMerchantSigner();
    const q = quote();
    const wireQuote = { ...q, invoiceTotal: q.invoiceTotal.toString(), gross: q.gross.toString(), fee: q.fee.toString(), validUntil: q.validUntil.toString() };
    const api = fakeApi({
      "POST /v1/invoices/inv_1/quotes": () => ({ quoteId: "q_1", invoiceId: "inv_1", quote: wireQuote, merchantSignature: null }),
      "POST /v1/invoices/inv_1/quotes/q_1/signature": async (body: { signature: Hex; quoteHash: Hex }) => {
        const signer = await recoverTypedDataAddress({ ...paymentQuoteTypedData(network, q), signature: body.signature });
        if (!isAddressEqual(signer, address)) throw new Error("bad signer");
        return { ...wireQuote, merchantSignature: body.signature, quoteHash: body.quoteHash };
      },
    });
    const paykit = new PayKit({ secretKey: "sk_test_abc", baseUrl: "https://api.test", fetch: api.fetch, signerKey: privateKey });
    const signed = await paykit.invoices.createQuote("inv_1");
    assert.equal(signed.quoteHash, hashPaymentQuote(network, q));
  });

  it("funds and submits a refund automatically with a refund-reserve key", async () => {
    const signer = generateMerchantSigner();
    const funderKey = generatePrivateKey();
    const funder = privateKeyToAccount(funderKey).address;
    const terms = { paymentId: keccak256(stringToBytes("p")), refundId: keccak256(stringToBytes("r")), amount: 5_000_000n, fee: 0n, funder, validUntil: 2_000_000_000n };
    const termsHash = hashRefundTerms(network, terms);
    const refund = {
      id: "re_1", refundId: terms.refundId, paymentId: terms.paymentId, merchantSlug: "chai-co", merchantName: "Chai", to: funder,
      amount: "5000000", fee: "0", reason: null, status: "awaiting_signatures", txHash: null, explorerUrl: null, createdAt: "2026-11-06T00:00:00Z", settledAt: null,
    };
    const api = fakeApi({
      "POST /v1/refunds": () => ({
        refund,
        terms: { ...terms, amount: "5000000", fee: "0", validUntil: terms.validUntil.toString() },
        merchantSignature: null,
        termsHash,
        router: CONTRACTS.router,
        chainId: 1874,
      }),
      "POST /v1/refunds/re_1/signatures": async (body: { funderSignature: Hex; validBefore: string }) => {
        const recovered = await recoverTypedDataAddress({
          ...receiveWithAuthorizationTypedData(network, { from: funder, to: CONTRACTS.router, value: 5_000_000n, validAfter: 0n, validBefore: BigInt(body.validBefore), nonce: refundNonce(termsHash) }),
          signature: body.funderSignature,
        });
        if (!isAddressEqual(recovered, funder)) throw new Error("bad funder");
        return { ...refund, status: "queued" };
      },
    });
    const paykit = new PayKit({ secretKey: "sk_test_abc", baseUrl: "https://api.test", fetch: api.fetch, signerKey: signer.privateKey, refundFunderKey: funderKey });
    const result = await paykit.refunds.create({ paymentId: terms.paymentId, amount: "5000000" });
    assert.equal(result.needsFunderSignature, false);
    assert.equal(result.refund.status, "queued");
  });

  it("parses validUntil durations", () => {
    assert.equal(resolveValidUntil("2d", 0), new Date(2 * 86_400_000).toISOString());
    assert.equal(resolveValidUntil("30m", 0), new Date(30 * 60_000).toISOString());
    assert.throws(() => resolveValidUntil("soon"));
  });
});
