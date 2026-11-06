// EIP-712 types and helpers shared by tests, scripts and (later) the server.
// Keep in lock-step with contracts/libraries/PayKitTypes.sol and MerchantRegistry.sol.
const { ethers } = require("ethers");

const abi = ethers.AbiCoder.defaultAbiCoder();
const tag = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

const TAGS = {
  PAY_NONCE: tag("PayKit.pay.v1"),
  REFUND_NONCE: tag("PayKit.refund.v1"),
  ONE_TIME: tag("PayKit.payment.v1"),
  PLAN: tag("PayKit.plan.v1"),
  INSTALLMENT: tag("PayKit.installment.v1"),
};

const usdtDomain = (chainId, usdt) => ({ name: "Tether USD", version: "1", chainId, verifyingContract: usdt });
const routerDomain = (chainId, router) => ({ name: "PayKit Router", version: "1", chainId, verifyingContract: router });
// PaymentRouterV2 (points + discounts)
const routerDomainV2 = (chainId, router) => ({ name: "PayKit Router", version: "2", chainId, verifyingContract: router });
const registryDomain = (chainId, registry) => ({
  name: "PayKit Registry",
  version: "1",
  chainId,
  verifyingContract: registry,
});

const types = {
  // USDT domain
  ReceiveWithAuthorization: {
    ReceiveWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  Permit: {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  },
  // Router domain
  PaymentQuote: {
    PaymentQuote: [
      { name: "merchantId", type: "bytes32" },
      { name: "invoiceId", type: "bytes32" },
      { name: "invoiceDigest", type: "bytes32" },
      { name: "paymentId", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "invoiceTotal", type: "uint256" },
      { name: "gross", type: "uint256" },
      { name: "fee", type: "uint256" },
      { name: "payer", type: "address" },
      { name: "splitProfileId", type: "uint32" },
      { name: "validUntil", type: "uint64" },
    ],
  },
  // v2 router: same type names, extra fields at the end
  PaymentQuoteV2: {
    PaymentQuote: [
      { name: "merchantId", type: "bytes32" },
      { name: "invoiceId", type: "bytes32" },
      { name: "invoiceDigest", type: "bytes32" },
      { name: "paymentId", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "invoiceTotal", type: "uint256" },
      { name: "gross", type: "uint256" },
      { name: "fee", type: "uint256" },
      { name: "payer", type: "address" },
      { name: "splitProfileId", type: "uint32" },
      { name: "validUntil", type: "uint64" },
      { name: "discount", type: "uint256" },
      { name: "pointsEarned", type: "uint256" },
      { name: "campaignId", type: "bytes32" },
      { name: "pointsRedeemed", type: "uint256" },
      { name: "rewardId", type: "bytes32" },
    ],
  },
  PlanTermsV2: {
    PlanTerms: [
      { name: "merchantId", type: "bytes32" },
      { name: "planId", type: "bytes32" },
      { name: "invoiceDigest", type: "bytes32" },
      { name: "payer", type: "address" },
      { name: "token", type: "address" },
      { name: "downPayment", type: "uint256" },
      { name: "installmentAmount", type: "uint256" },
      { name: "feePerInstallment", type: "uint256" },
      { name: "downPaymentFee", type: "uint256" },
      { name: "count", type: "uint16" },
      { name: "period", type: "uint32" },
      { name: "firstDue", type: "uint64" },
      { name: "grace", type: "uint32" },
      { name: "splitProfileId", type: "uint32" },
      { name: "kind", type: "uint8" },
      { name: "validUntil", type: "uint64" },
      { name: "pointsPerCharge", type: "uint256" },
      { name: "downPaymentPoints", type: "uint256" },
      { name: "campaignId", type: "bytes32" },
    ],
  },
  RefundTerms: {
    RefundTerms: [
      { name: "paymentId", type: "bytes32" },
      { name: "refundId", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "fee", type: "uint256" },
      { name: "funder", type: "address" },
      { name: "validUntil", type: "uint64" },
    ],
  },
  PlanTerms: {
    PlanTerms: [
      { name: "merchantId", type: "bytes32" },
      { name: "planId", type: "bytes32" },
      { name: "invoiceDigest", type: "bytes32" },
      { name: "payer", type: "address" },
      { name: "token", type: "address" },
      { name: "downPayment", type: "uint256" },
      { name: "installmentAmount", type: "uint256" },
      { name: "feePerInstallment", type: "uint256" },
      { name: "downPaymentFee", type: "uint256" },
      { name: "count", type: "uint16" },
      { name: "period", type: "uint32" },
      { name: "firstDue", type: "uint64" },
      { name: "grace", type: "uint32" },
      { name: "splitProfileId", type: "uint32" },
      { name: "kind", type: "uint8" },
      { name: "validUntil", type: "uint64" },
    ],
  },
  PlanConsent: {
    PlanConsent: [
      { name: "termsHash", type: "bytes32" },
      { name: "payer", type: "address" },
      { name: "deadline", type: "uint64" },
    ],
  },
  CancelPlan: {
    CancelPlan: [
      { name: "planId", type: "bytes32" },
      { name: "signer", type: "address" },
      { name: "deadline", type: "uint64" },
    ],
  },
  // Registry domain
  RegisterMerchant: {
    RegisterMerchant: [
      { name: "owner", type: "address" },
      { name: "payout", type: "address" },
      { name: "maxFeeBps", type: "uint16" },
      { name: "metadataHash", type: "bytes32" },
      { name: "metadataURI", type: "string" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint64" },
    ],
  },
  SetSigner: {
    SetSigner: [
      { name: "merchantId", type: "bytes32" },
      { name: "signer", type: "address" },
      { name: "expiresAt", type: "uint64" },
      { name: "enabled", type: "bool" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint64" },
    ],
  },
  QueuePayout: {
    QueuePayout: [
      { name: "merchantId", type: "bytes32" },
      { name: "newPayout", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint64" },
    ],
  },
  SetSplitProfile: {
    SetSplitProfile: [
      { name: "merchantId", type: "bytes32" },
      { name: "profileId", type: "uint32" },
      { name: "splitHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint64" },
    ],
  },
  SetMetadata: {
    SetMetadata: [
      { name: "merchantId", type: "bytes32" },
      { name: "metadataHash", type: "bytes32" },
      { name: "metadataURI", type: "string" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint64" },
    ],
  },
};

const digest = (domain, t, value) => ethers.TypedDataEncoder.hash(domain, t, value);

// IDs (§9.4) — onchain keys are scoped by merchant so one merchant cannot squat another's ids.
const idFromUuid = (uuid) => ethers.keccak256(ethers.toUtf8Bytes(uuid));
const merchantIdOf = (chainId, owner, nonce) =>
  ethers.keccak256(abi.encode(["uint256", "address", "uint256"], [chainId, owner, nonce]));
const invoiceKeyOf = (merchantId, invoiceId) =>
  ethers.keccak256(abi.encode(["bytes32", "bytes32"], [merchantId, invoiceId]));
const paymentKeyOf = (merchantId, localPaymentId) =>
  ethers.keccak256(abi.encode(["bytes32", "bytes32", "bytes32"], [TAGS.ONE_TIME, merchantId, localPaymentId]));
const planKeyOf = (merchantId, localPlanId) =>
  ethers.keccak256(abi.encode(["bytes32", "bytes32", "bytes32"], [TAGS.PLAN, merchantId, localPlanId]));
const installmentPaymentId = (planKey, index) =>
  ethers.keccak256(abi.encode(["bytes32", "bytes32", "uint256"], [TAGS.INSTALLMENT, planKey, index]));

const payNonce = (quoteHash, refundTo, salt) =>
  ethers.keccak256(abi.encode(["bytes32", "bytes32", "address", "bytes32"], [TAGS.PAY_NONCE, quoteHash, refundTo, salt]));
const refundNonce = (refundTermsHash) =>
  ethers.keccak256(abi.encode(["bytes32", "bytes32"], [TAGS.REFUND_NONCE, refundTermsHash]));
const splitHash = (recipients, bps) => ethers.keccak256(abi.encode(["address[]", "uint16[]"], [recipients, bps]));

module.exports = {
  TAGS,
  types,
  usdtDomain,
  routerDomain,
  routerDomainV2,
  registryDomain,
  digest,
  idFromUuid,
  merchantIdOf,
  invoiceKeyOf,
  paymentKeyOf,
  planKeyOf,
  installmentPaymentId,
  payNonce,
  refundNonce,
  splitHash,
};
