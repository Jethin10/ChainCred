import { parseAbi } from "viem";

/**
 * Contract interfaces the SDK and server call. These mirror plan.md §8 and are the
 * spec the contracts must implement. When the contracts land, regenerate from their
 * build artifacts and diff against this file.
 */

export const usdtAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function nonces(address owner) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function RECEIVE_WITH_AUTHORIZATION_TYPEHASH() view returns (bytes32)",
  "function CANCEL_AUTHORIZATION_TYPEHASH() view returns (bytes32)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function isBlocked(address account) view returns (bool)",
  "function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
  "function cancelAuthorization(address authorizer, bytes32 nonce, bytes signature)",
  "function permit(address owner_, address spender, uint256 value, uint256 deadline, bytes signature)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
]);

export const paymentRouterAbi = parseAbi([
  "struct PaymentQuote { bytes32 merchantId; bytes32 invoiceId; bytes32 invoiceDigest; bytes32 paymentId; address token; uint256 invoiceTotal; uint256 gross; uint256 fee; address payer; uint32 splitProfileId; uint64 validUntil; }",
  "struct PayerAuth { address from; address refundTo; bytes32 salt; uint256 validAfter; uint256 validBefore; bytes signature; }",
  "struct RefundTerms { bytes32 paymentId; bytes32 refundId; uint256 amount; uint256 fee; address funder; uint64 validUntil; }",
  "struct FunderAuth { uint256 validAfter; uint256 validBefore; bytes signature; }",
  "struct PlanTerms { bytes32 merchantId; bytes32 planId; bytes32 invoiceDigest; address payer; address token; uint256 downPayment; uint256 installmentAmount; uint256 feePerInstallment; uint256 downPaymentFee; uint16 count; uint32 period; uint64 firstDue; uint32 grace; uint32 splitProfileId; uint8 kind; uint64 validUntil; }",
  "struct PermitData { uint256 value; uint256 deadline; uint8 v; bytes32 r; bytes32 s; }",
  "struct CancelPlan { bytes32 planId; address signer; uint64 deadline; }",
  "function pay(PaymentQuote q, bytes merchantSig, PayerAuth a) returns (bytes32 paymentId)",
  "function refund(RefundTerms t, bytes merchantSig, FunderAuth f) returns (uint128 cumulativeRefunded)",
  "function createPlan(PlanTerms t, bytes merchantSig, bytes payerConsentSig, PermitData permit) returns (bytes32 planId)",
  "function collectInstallment(bytes32 planId) returns (bytes32 paymentId)",
  "function markDelinquent(bytes32 planId)",
  "function cancelPlan(CancelPlan c, bytes sig)",
  "function invoices(bytes32 invoiceKey) view returns (uint128 total, uint128 paid, uint128 refunded)",
  "function payments(bytes32 paymentId) view returns (bytes32 merchantId, bytes32 invoiceKey, bytes32 planId, address payer, address refundTo, address token, uint128 gross, uint128 fee, uint128 refunded, uint32 splitProfileId, uint64 settledAt)",
  "function committed(address payer, address token) view returns (uint256)",
  "function feeSchedule(address token) view returns (uint16 bps, uint96 minFee, uint96 maxFee)",
  "function paused() view returns (bool)",
  "event PaymentSettled(bytes32 indexed paymentId, bytes32 indexed merchantId, bytes32 indexed invoiceKey, bytes32 planId, address payer, address refundTo, address token, uint256 gross, uint256 fee, uint256 net, uint32 splitProfileId, bytes32 quoteHash, uint8 kind)",
  "event SplitPaid(bytes32 indexed paymentId, address indexed recipient, uint256 amount)",
  "event InvoiceProgress(bytes32 indexed invoiceKey, uint256 total, uint256 paid, uint256 refunded)",
  "event RefundSettled(bytes32 indexed refundId, bytes32 indexed paymentId, address to, uint256 amount, uint256 fee, uint256 cumulativeRefunded, address funder)",
  "event PlanCreated(bytes32 indexed planId, bytes32 indexed merchantId, address indexed payer, address token, uint256 installmentAmount, uint16 count, uint32 period, uint64 firstDue, uint32 grace, bytes32 termsHash)",
  "event InstallmentCollected(bytes32 indexed planId, uint16 index, bytes32 paymentId, uint256 amount, uint256 fee)",
  "event InstallmentMissed(bytes32 indexed planId, uint16 index)",
  "event PlanCancelled(bytes32 indexed planId, address by)",
  "event PlanCompleted(bytes32 indexed planId)",
  "event FeeScheduleSet(address indexed token, uint16 bps, uint96 minFee, uint96 maxFee)",
]);

export const merchantRegistryAbi = parseAbi([
  "struct RegisterMerchant { address owner; address payout; uint16 maxFeeBps; bytes32 metadataHash; uint256 nonce; uint64 deadline; }",
  "struct SetSigner { bytes32 merchantId; address signer; uint64 expiresAt; bool enabled; uint256 nonce; uint64 deadline; }",
  "struct SetSplitProfile { bytes32 merchantId; uint32 profileId; bytes32 splitHash; uint256 nonce; uint64 deadline; }",
  "struct QueuePayout { bytes32 merchantId; address newPayout; uint256 nonce; uint64 deadline; }",
  "function registerWithSig(RegisterMerchant m, string metadataURI, bytes sig) returns (bytes32 merchantId)",
  "function setSignerWithSig(SetSigner m, bytes sig)",
  "function setSplitProfileWithSig(SetSplitProfile m, address[] recipients, uint16[] bps, bytes sig)",
  "function queuePayoutChangeWithSig(QueuePayout m, bytes sig)",
  "function attestDomain(bytes32 merchantId, bytes32 domainHash, uint64 expiresAt)",
  "function revokeDomain(bytes32 merchantId, bytes32 domainHash)",
  "function ownerNonces(address owner) view returns (uint256)",
  "function merchants(bytes32 merchantId) view returns (address owner, address payout, uint16 maxFeeBps, uint8 status, uint64 createdAt, bytes32 metadataHash, string metadataURI)",
  "function isActive(bytes32 merchantId) view returns (bool)",
  "function isSigner(bytes32 merchantId, address signer) view returns (bool)",
  "function getSplit(bytes32 merchantId, uint32 profileId) view returns (address[] recipients, uint16[] bps)",
  "function isDomainVerified(bytes32 merchantId, bytes32 domainHash) view returns (bool)",
  "event MerchantRegistered(bytes32 indexed merchantId, address indexed owner, address payout, uint16 maxFeeBps, bytes32 metadataHash, string metadataURI)",
  "event SignerSet(bytes32 indexed merchantId, address indexed signer, uint64 expiresAt, bool enabled)",
  "event PayoutChanged(bytes32 indexed merchantId, address oldPayout, address newPayout)",
  "event SplitProfileSet(bytes32 indexed merchantId, uint32 indexed profileId, address[] recipients, uint16[] bps)",
  "event DomainAttested(bytes32 indexed merchantId, bytes32 indexed domainHash, uint64 expiresAt, address attestor)",
  "event DomainRevoked(bytes32 indexed merchantId, bytes32 indexed domainHash)",
]);

export const feeTreasuryAbi = parseAbi([
  "function limits() view returns (uint128 maxUsdtPerRun, uint128 maxUsdtPerDay, uint128 minWbtPerUsdt, uint32 maxDeadlineWindow)",
  "function spentToday() view returns (uint256)",
  "function dayStart() view returns (uint64)",
  "function reservedUsdt() view returns (uint256)",
  "function refill(uint256 usdtIn, uint256 minWbtOut, uint256 deadline) returns (uint256 wbtOut)",
  "function isRelayer(address account) view returns (bool)",
  "event Refill(bytes32 indexed runId, uint256 usdtIn, uint256 wbtOut, address recipient, uint256 minWbtOut, uint256 timestamp)",
]);
