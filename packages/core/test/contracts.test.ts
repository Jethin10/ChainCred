/**
 * Pins the SDK's signing formats and ABIs to the contract sources (MerchantRegistry.sol,
 * PaymentRouterV2.sol, PayKitPoints.sol, FeeTreasury.sol). The registry writes its typehash
 * strings out in full, so those checks are exact. Router struct layouts live in
 * libraries/PayKitTypes*.sol (not provided); those are checked against a deployment by
 * scripts/check-contracts.mjs instead.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashTypedData, keccak256, stringToBytes, toEventSelector, zeroAddress, type Hex } from "viem";
import {
  feeTreasuryAbi,
  hashPaymentQuote,
  merchantRegistryAbi,
  payKitPointsAbi,
  paymentQuoteTypedData,
  paymentRouterV2Abi,
  planTermsTypedData,
  queuePayoutTypes,
  registerMerchantTypes,
  resolveNetwork,
  routerDomain,
  setMetadataTypes,
  setSignerTypes,
  setSplitProfileTypes,
  type PaymentQuoteMessage,
  type PlanTermsMessage,
} from "../src/index.ts";

const encodeType = (name: string, fields: readonly { name: string; type: string }[]) => `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;

// Copied verbatim from MerchantRegistry.sol.
const REGISTRY_TYPEHASHES = {
  RegisterMerchant: "RegisterMerchant(address owner,address payout,uint16 maxFeeBps,bytes32 metadataHash,string metadataURI,uint256 nonce,uint64 deadline)",
  SetSigner: "SetSigner(bytes32 merchantId,address signer,uint64 expiresAt,bool enabled,uint256 nonce,uint64 deadline)",
  QueuePayout: "QueuePayout(bytes32 merchantId,address newPayout,uint256 nonce,uint64 deadline)",
  SetSplitProfile: "SetSplitProfile(bytes32 merchantId,uint32 profileId,bytes32 splitHash,uint256 nonce,uint64 deadline)",
  SetMetadata: "SetMetadata(bytes32 merchantId,bytes32 metadataHash,string metadataURI,uint256 nonce,uint64 deadline)",
};

const contracts = { registry: "0x00000000000000000000000000000000000000e9", router: "0x00000000000000000000000000000000000000f0", points: "0x0000000000000000000000000000000000000077" } as const;
const v2 = resolveNetwork("whitechain-testnet", contracts);
const v1 = resolveNetwork("whitechain-testnet", { ...contracts, routerVersion: "1" });
const H32 = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;

const quote: PaymentQuoteMessage = {
  merchantId: H32(1), invoiceId: H32(2), invoiceDigest: H32(3), paymentId: H32(4), token: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7",
  invoiceTotal: 10_000_000n, gross: 9_000_000n, fee: 90_000n, payer: zeroAddress, splitProfileId: 0, validUntil: 2_000_000_000n,
};

describe("MerchantRegistry signing formats", () => {
  for (const [name, types] of [["RegisterMerchant", registerMerchantTypes.RegisterMerchant], ["SetSigner", setSignerTypes.SetSigner], ["QueuePayout", queuePayoutTypes.QueuePayout], ["SetSplitProfile", setSplitProfileTypes.SetSplitProfile], ["SetMetadata", setMetadataTypes.SetMetadata]] as const) {
    it(`${name} matches the contract typehash string`, () => {
      assert.equal(encodeType(name, types), REGISTRY_TYPEHASHES[name]);
      assert.equal(keccak256(stringToBytes(encodeType(name, types))), keccak256(stringToBytes(REGISTRY_TYPEHASHES[name])));
    });
  }
  it("registerWithSig takes the RegisterMerchant struct with metadataURI inside it", () => {
    const fn = merchantRegistryAbi.find((x) => x.type === "function" && x.name === "registerWithSig");
    assert.ok(fn && fn.type === "function");
    assert.equal(fn.inputs.length, 2);
    assert.deepEqual((fn.inputs[0] as unknown as { components: { name: string }[] }).components.map((c) => c.name), ["owner", "payout", "maxFeeBps", "metadataHash", "metadataURI", "nonce", "deadline"]);
  });
  it("setSplitProfileWithSig sends the arrays, not the hash", () => {
    const fn = merchantRegistryAbi.find((x) => x.type === "function" && x.name === "setSplitProfileWithSig");
    assert.ok(fn && fn.type === "function");
    assert.deepEqual((fn.inputs[0] as unknown as { components: { name: string }[] }).components.map((c) => c.name), ["merchantId", "profileId", "recipients", "bps", "nonce", "deadline"]);
  });
});

describe("PaymentRouter domains", () => {
  it("V2 uses domain version 2 by default, v1 when configured", () => {
    assert.equal(routerDomain(v2).version, "2");
    assert.equal(routerDomain(v1).version, "1");
  });
  it("a V2 quote with no points hashes differently from v1 (different domain and type)", () => {
    assert.notEqual(hashPaymentQuote(v2, quote), hashPaymentQuote(v1, quote));
  });
  it("V2 quote carries points and discount; v1 refuses them", () => {
    const withPoints = { ...quote, discount: 500_000n, pointsEarned: 90n, pointsRedeemed: 50n, rewardId: H32(9) };
    const typed = paymentQuoteTypedData(v2, withPoints);
    assert.deepEqual(typed.types.PaymentQuote!.slice(-5).map((f) => f.name), ["discount", "pointsEarned", "campaignId", "pointsRedeemed", "rewardId"]);
    assert.equal(typed.message.campaignId, H32(0));
    assert.notEqual(hashTypedData(typed as never), hashPaymentQuote(v2, quote));
    assert.throws(() => paymentQuoteTypedData(v1, withPoints), /PaymentRouterV2/);
  });
  it("V2 plan terms append points per charge", () => {
    const terms: PlanTermsMessage = { merchantId: H32(1), planId: H32(5), invoiceDigest: H32(3), payer: "0x0000000000000000000000000000000000000001", token: quote.token, downPayment: 0n, installmentAmount: 1_000_000n, feePerInstallment: 10_000n, downPaymentFee: 0n, count: 3, period: 86_400, firstDue: 1n, grace: 0, splitProfileId: 0, kind: 0, validUntil: 2n };
    assert.deepEqual(planTermsTypedData(v2, terms).types.PlanTerms!.slice(-3).map((f) => f.name), ["pointsPerCharge", "downPaymentPoints", "campaignId"]);
    assert.equal(planTermsTypedData(v1, terms).types.PlanTerms!.length, 16);
  });
  it("createPlan takes a PayerConsent struct, not a bare signature", () => {
    const fn = paymentRouterV2Abi.find((x) => x.type === "function" && x.name === "createPlan");
    assert.ok(fn && fn.type === "function");
    assert.equal(fn.inputs[2]!.type, "tuple");
  });
});

describe("Event signatures match the contracts", () => {
  const selector = (abi: readonly unknown[], name: string) => toEventSelector(abi.find((x) => (x as { type: string; name: string }).type === "event" && (x as { name: string }).name === name) as never);
  it("FeeTreasury.Refill has a uint256 runId and indexed recipient", () => {
    assert.equal(selector(feeTreasuryAbi, "Refill"), keccak256(stringToBytes("Refill(uint256,uint256,uint256,address,uint256,uint256)")));
  });
  it("PaymentSettled keeps the v1 signature in V2", () => {
    assert.equal(selector(paymentRouterV2Abi, "PaymentSettled"), keccak256(stringToBytes("PaymentSettled(bytes32,bytes32,bytes32,bytes32,address,address,address,uint256,uint256,uint256,uint32,bytes32,uint8)")));
  });
  it("PayKitPoints events", () => {
    assert.equal(selector(payKitPointsAbi, "PointsEarned"), keccak256(stringToBytes("PointsEarned(address,bytes32,bytes32,bytes32,uint256)")));
    assert.equal(selector(payKitPointsAbi, "PointsRedeemed"), keccak256(stringToBytes("PointsRedeemed(address,bytes32,bytes32,bytes32,uint256)")));
    assert.equal(selector(payKitPointsAbi, "PointsReversed"), keccak256(stringToBytes("PointsReversed(address,bytes32,uint256,uint256,uint256)")));
  });
  it("DiscountApplied", () => {
    assert.equal(selector(paymentRouterV2Abi, "DiscountApplied"), keccak256(stringToBytes("DiscountApplied(bytes32,bytes32,uint256,uint256)")));
  });
});
