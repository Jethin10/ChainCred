import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { domainSeparator, encodeAbiParameters, keccak256, recoverTypedDataAddress, stringToBytes, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildUrl,
  canonicalJson,
  checkQuoteFee,
  depositSchedule,
  displayUsdt,
  domainHash,
  errorFromResponse,
  formatUsdt,
  hashPaymentQuote,
  installmentPaymentId,
  installmentSplit,
  invoiceDigest,
  merchantIdFor,
  minimumTicket,
  parseUsdt,
  PAY_NONCE_TAG,
  paymentQuoteTypedData,
  payNonce,
  planTotal,
  protocolFee,
  quoteFromWire,
  quoteToWire,
  refundNonce,
  resolveNetwork,
  splitByBps,
  stagesFromBps,
  TESTNET_USDT_DOMAIN_SEPARATOR,
  usdtDomain,
  zCheckoutSession,
  zPayment,
  type PaymentQuoteMessage,
} from "../src/index.ts";

const ROUTER = "0x1111111111111111111111111111111111111111";
const network = resolveNetwork("whitechain-testnet", { router: ROUTER, registry: "0x2222222222222222222222222222222222222222" });
const merchantKey = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

const quote: PaymentQuoteMessage = {
  merchantId: keccak256(stringToBytes("merchant")),
  invoiceId: keccak256(stringToBytes("invoice")),
  invoiceDigest: keccak256(stringToBytes("digest")),
  paymentId: keccak256(stringToBytes("payment")),
  token: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7",
  invoiceTotal: 10_000_000n,
  gross: 6_000_000n,
  fee: 60_000n,
  payer: zeroAddress,
  splitProfileId: 0,
  validUntil: 2_000_000_000n,
};

describe("amounts", () => {
  it("parses and formats USDT without floats", () => {
    assert.equal(parseUsdt("10.5"), 10_500_000n);
    assert.equal(parseUsdt("0.000001"), 1n);
    assert.equal(parseUsdt(10), 10_000_000n);
    assert.equal(parseUsdt(0.1), 100_000n);
    assert.throws(() => parseUsdt("1.0000001"));
    assert.throws(() => parseUsdt("-1"));
    assert.throws(() => parseUsdt("1e3"));
    assert.equal(formatUsdt(10_500_000n), "10.5");
    assert.equal(displayUsdt("1234567890"), "1,234.56789 USDT");
    assert.equal(displayUsdt(10_000_000n), "10.00 USDT");
  });

  it("computes the protocol fee with floor and cap", () => {
    assert.equal(protocolFee(1_000_000n), 50_000n); // 1% of 1 USDT = 0.01 → floor 0.05
    assert.equal(protocolFee(100_000_000n), 1_000_000n); // 1%
    assert.equal(protocolFee(10_000_000_000n), 25_000_000n); // capped at 25
    assert.equal(protocolFee(10_000n), 10_000n); // never above gross
  });

  it("derives the minimum ticket from the merchant cap", () => {
    assert.equal(minimumTicket(), 1_666_667n); // 0.05 / 3% ≈ 1.67 USDT
    assert.equal(minimumTicket(undefined, 1000), 500_000n); // 10% cap → 0.50
  });

  it("mirrors the router's fee checks", () => {
    assert.deepEqual(checkQuoteFee(100_000_000n, 1_000_000n), { ok: true });
    assert.equal(checkQuoteFee(100_000_000n, 500_000n).ok, false); // below floor
    const small = checkQuoteFee(1_000_000n, 50_000n); // 5% > 3% cap
    assert.equal(small.ok, false);
    assert.equal(small.ok === false && small.code, "amount_too_small");
  });

  it("splits by basis points with the remainder to the last recipient", () => {
    assert.deepEqual(splitByBps(1_000_001n, [9000, 800, 200]), [900_000n, 80_000n, 20_001n]);
    assert.throws(() => splitByBps(100n, [5000, 4000]));
  });

  it("builds percentage stages exactly", () => {
    assert.deepEqual(stagesFromBps(10_000_001n, [3333, 3333, 3334]), [3_333_000n, 3_333_000n, 3_334_001n]);
    assert.deepEqual(depositSchedule(100_000_000n, 30), [30_000_000n, 70_000_000n]);
    assert.deepEqual(depositSchedule(5n, 100), [5n]);
  });

  it("splits installments into equal parts plus a down payment", () => {
    const s = installmentSplit(100_000_001n, 3);
    assert.equal(s.installmentAmount, 33_333_333n);
    assert.equal(s.downPayment, 2n);
    assert.equal(planTotal(s), 100_000_001n);
    const d = installmentSplit(100_000_000n, 4, 20);
    assert.deepEqual(d, { downPayment: 20_000_000n, installmentAmount: 20_000_000n, count: 4 });
  });
});

describe("ids and nonces", () => {
  it("derives the pay nonce exactly as the contract spec says", () => {
    const quoteHash = hashPaymentQuote(network, quote);
    const salt = keccak256(stringToBytes("salt"));
    const refundTo = "0x3333333333333333333333333333333333333333";
    const expected = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }],
        [keccak256(stringToBytes("PayKit.pay.v1")), quoteHash, refundTo, salt],
      ),
    );
    assert.equal(PAY_NONCE_TAG, keccak256(stringToBytes("PayKit.pay.v1")));
    assert.equal(payNonce(quoteHash, refundTo, salt), expected);
    assert.notEqual(payNonce(quoteHash, "0x4444444444444444444444444444444444444444", salt), expected);
    assert.notEqual(refundNonce(quoteHash), payNonce(quoteHash, refundTo, salt));
  });

  it("changes the quote hash when any field changes", () => {
    const base = hashPaymentQuote(network, quote);
    assert.notEqual(hashPaymentQuote(network, { ...quote, gross: quote.gross + 1n }), base);
    assert.notEqual(hashPaymentQuote(network, { ...quote, splitProfileId: 1 }), base);
    const otherRouter = resolveNetwork("whitechain-testnet", { router: "0x5555555555555555555555555555555555555555" });
    assert.notEqual(hashPaymentQuote(otherRouter, quote), base);
  });

  it("signs and recovers a merchant quote", async () => {
    const typed = paymentQuoteTypedData(network, quote);
    const signature = await merchantKey.signTypedData(typed);
    const recovered = await recoverTypedDataAddress({ ...typed, signature });
    assert.equal(recovered, merchantKey.address);
  });

  it("round-trips quotes through wire form", () => {
    const wire = quoteToWire(quote, "0xabcd", hashPaymentQuote(network, quote));
    assert.deepEqual(quoteFromWire(wire), quote);
  });

  it("builds deterministic IDs", () => {
    const planId = keccak256(stringToBytes("plan"));
    assert.equal(
      installmentPaymentId(planId, 2),
      keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [planId, 2n])),
    );
    assert.equal(
      merchantIdFor(1874, merchantKey.address, 0n),
      keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }], [1874n, merchantKey.address, 0n])),
    );
    assert.equal(domainHash("https://Shop.Example.com/path"), keccak256(stringToBytes("shop.example.com")));
    assert.equal(domainHash("münchen.de"), keccak256(stringToBytes("xn--mnchen-3ya.de")));
    assert.throws(() => domainHash("localhost"));
  });

  it("canonicalizes JSON for invoice digests", () => {
    assert.equal(canonicalJson({ b: "2", a: [1, { d: true, c: null }] }), '{"a":[1,{"c":null,"d":true}],"b":"2"}');
    assert.equal(invoiceDigest({ x: "1", y: "2" }), invoiceDigest({ y: "2", x: "1" }));
    assert.throws(() => canonicalJson({ amount: 1.5 }));
  });
});

describe("token domain", () => {
  it("matches the verified testnet USDT DOMAIN_SEPARATOR", () => {
    assert.equal(domainSeparator({ domain: usdtDomain(network) }), TESTNET_USDT_DOMAIN_SEPARATOR);
  });
});

describe("http helpers", () => {
  it("joins base URLs with path prefixes", () => {
    assert.equal(buildUrl("https://api.x.io", "/v1/status"), "https://api.x.io/v1/status");
    assert.equal(buildUrl("https://shop.com/api/paykit/", "/v1/me/payments", { limit: 5, skip: undefined }), "https://shop.com/api/paykit/v1/me/payments?limit=5");
  });

  it("maps API errors to PayKitError codes", () => {
    const e1 = errorFromResponse(409, JSON.stringify({ error: { code: "already_settled", message: "dup" } }), "/x");
    assert.equal(e1.code, "already_settled");
    assert.equal(e1.status, 409);
    assert.equal(errorFromResponse(404, "nope", "/x").code, "not_found");
    assert.equal(errorFromResponse(502, "", "/x").code, "server_error");
    assert.equal(errorFromResponse(400, JSON.stringify({ error: { code: "made_up", message: "m" } }), "/x").code, "validation_failed");
  });
});

describe("schemas", () => {
  it("rejects malformed wire data", () => {
    assert.equal(zPayment.safeParse({ paymentId: "0x12" }).success, false);
    assert.equal(zCheckoutSession.safeParse({}).success, false);
  });
});
