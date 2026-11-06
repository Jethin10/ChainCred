import type { Address, Hex } from "viem";
import { z } from "zod";

/**
 * Wire types shared by the API, @paykit/js, @paykit/node and @paykit/react.
 * Amounts are base-unit decimal strings ("10500000" = 10.5 USDT). Times are ISO-8601 strings.
 * These are the data shapes the UI mock must match.
 */

export const zAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Expected a 0x address")
  .transform((v) => v as Address);
export const zHex32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Expected 32-byte hex")
  .transform((v) => v as Hex);
export const zHex = z
  .string()
  .regex(/^0x([0-9a-fA-F]{2})*$/, "Expected hex")
  .transform((v) => v as Hex);
export const zAmount = z.string().regex(/^\d+$/, "Expected a base-unit integer string");
export const zTime = z.string();
export const zToken = z.literal("USDT");

export const zFinality = z.enum(["pending", "included", "safe", "finalized"]);
export type Finality = z.infer<typeof zFinality>;

// ---------- Merchants and products ----------

export const zVerifiedDomain = z.object({
  domain: z.string(),
  verifiedAt: zTime,
  expiresAt: zTime,
});

export const zMerchant = z.object({
  /** Our database ID / slug used in URLs. */
  slug: z.string(),
  /** Onchain bytes32 merchant ID. Null until registration is included onchain. */
  merchantId: zHex32.nullable(),
  name: z.string(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  logoUrl: z.string().nullable(),
  website: z.string().nullable(),
  owner: zAddress,
  payout: zAddress,
  pendingPayout: z.object({ address: zAddress, executableAt: zTime }).nullable().optional(),
  status: z.enum(["pending", "active", "suspended"]),
  verifiedDomains: z.array(zVerifiedDomain),
  listed: z.boolean(),
  acceptedTokens: z.array(zToken),
  createdAt: zTime,
});
export type Merchant = z.infer<typeof zMerchant>;

export const zProduct = z.object({
  id: z.string(),
  merchantSlug: z.string(),
  sku: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  price: zAmount,
  token: zToken,
  active: z.boolean(),
});
export type Product = z.infer<typeof zProduct>;

export const zCartItem = z.object({ productId: z.string(), quantity: z.number().int().positive() });
export type CartItem = z.infer<typeof zCartItem>;

// ---------- Invoices ----------

export const zLineItem = z.object({
  name: z.string(),
  quantity: z.number().int().positive(),
  unitAmount: zAmount,
  amount: zAmount,
  productId: z.string().nullable().optional(),
});
export type LineItem = z.infer<typeof zLineItem>;

export const zInvoiceSchedule = z.discriminatedUnion("type", [
  z.object({ type: z.literal("full") }),
  z.object({ type: z.literal("deposit"), depositPercent: z.number().int().min(1).max(99), parts: z.array(zAmount) }),
  z.object({ type: z.literal("parts"), parts: z.array(zAmount) }),
]);
export type InvoiceSchedule = z.infer<typeof zInvoiceSchedule>;

export const zInvoiceStatus = z.enum([
  "draft",
  "open",
  "partially_paid",
  "paid",
  "partially_refunded",
  "refunded",
  "expired",
  "void",
]);
export type InvoiceStatus = z.infer<typeof zInvoiceStatus>;

export const zInvoice = z.object({
  id: z.string(),
  /** Onchain bytes32 ID: keccak256(id). */
  invoiceId: zHex32,
  merchantSlug: z.string(),
  number: z.string(),
  lineItems: z.array(zLineItem),
  total: zAmount,
  paid: zAmount,
  refunded: zAmount,
  token: zToken,
  status: zInvoiceStatus,
  schedule: zInvoiceSchedule,
  digest: zHex32,
  validUntil: zTime,
  createdAt: zTime,
  customerWallet: zAddress.nullable(),
  externalOrderId: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  splitProfileId: z.number().int().nonnegative().optional(),
});
export type Invoice = z.infer<typeof zInvoice>;

// ---------- Quotes and checkout ----------

/** A merchant-signed PaymentQuote in wire form. */
export const zSignedQuote = z.object({
  merchantId: zHex32,
  invoiceId: zHex32,
  invoiceDigest: zHex32,
  paymentId: zHex32,
  token: zAddress,
  invoiceTotal: zAmount,
  gross: zAmount,
  fee: zAmount,
  payer: zAddress,
  splitProfileId: z.number().int().nonnegative(),
  validUntil: z.string().regex(/^\d+$/),
  merchantSignature: zHex,
  /** EIP-712 digest the server computed. The client recomputes and compares it. */
  quoteHash: zHex32,
});
export type SignedQuote = z.infer<typeof zSignedQuote>;

/**
 * A quote prepared by the API for the merchant's own server key to sign
 * (self-hosted signer). `merchantSignature` is set when the hosted signer already signed.
 */
export const zQuoteDraft = z.object({
  quoteId: z.string(),
  invoiceId: z.string(),
  quote: zSignedQuote.omit({ merchantSignature: true, quoteHash: true }),
  merchantSignature: zHex.nullable(),
});
export type QuoteDraft = z.infer<typeof zQuoteDraft>;

export const zCheckoutSession = z.object({
  id: z.string(),
  merchant: zMerchant,
  invoice: zInvoice,
  /** Index of the part this quote pays (0 for a full payment). */
  partIndex: z.number().int().nonnegative(),
  quote: zSignedQuote,
  router: zAddress,
  chainId: z.number().int(),
  expiresAt: zTime,
});
export type CheckoutSession = z.infer<typeof zCheckoutSession>;

export const zPayerAuthorization = z.object({
  payer: zAddress,
  refundTo: zAddress,
  salt: zHex32,
  validAfter: z.string().regex(/^\d+$/),
  validBefore: z.string().regex(/^\d+$/),
  signature: zHex,
});
export type PayerAuthorization = z.infer<typeof zPayerAuthorization>;

// ---------- Payments ----------

export const zPaymentKind = z.enum(["one_time", "installment", "down_payment"]);
export const zPaymentStatus = z.enum([
  "awaiting_signature",
  "queued",
  "submitted",
  "included",
  "safe",
  "finalized",
  "failed",
  "expired",
]);
export type PaymentStatus = z.infer<typeof zPaymentStatus>;

export const zPayment = z.object({
  paymentId: zHex32,
  merchantSlug: z.string(),
  merchantName: z.string(),
  invoiceId: z.string().nullable(),
  planId: z.string().nullable(),
  kind: zPaymentKind,
  payer: zAddress,
  refundTo: zAddress,
  token: zToken,
  gross: zAmount,
  fee: zAmount,
  net: zAmount,
  refunded: zAmount,
  status: zPaymentStatus,
  txHash: zHex32.nullable(),
  blockNumber: z.string().nullable(),
  explorerUrl: z.string().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: zTime,
  settledAt: zTime.nullable(),
  externalOrderId: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  blockHash: zHex32.nullable().optional(),
});
export type Payment = z.infer<typeof zPayment>;

// ---------- Installment plans ----------

export const zPlanStatus = z.enum(["pending", "active", "delinquent", "cancelled", "completed"]);
export type PlanStatus = z.infer<typeof zPlanStatus>;

export const zInstallment = z.object({
  index: z.number().int().nonnegative(),
  dueAt: zTime,
  amount: zAmount,
  status: z.enum(["scheduled", "collected", "missed"]),
  paymentId: zHex32.nullable(),
});
export type Installment = z.infer<typeof zInstallment>;

export const zPlan = z.object({
  id: z.string(),
  planId: zHex32,
  merchantSlug: z.string(),
  merchantName: z.string(),
  payer: zAddress,
  token: zToken,
  kind: z.enum(["installments", "subscription"]),
  downPayment: zAmount,
  installmentAmount: zAmount,
  count: z.number().int().positive(),
  collected: z.number().int().nonnegative(),
  periodSeconds: z.number().int().positive(),
  graceSeconds: z.number().int().nonnegative(),
  status: zPlanStatus,
  nextDueAt: zTime.nullable(),
  installments: z.array(zInstallment),
  createdAt: zTime,
});
export type Plan = z.infer<typeof zPlan>;

/** A plan offered at checkout, e.g. "3 payments, every 30 days". */
export const zPlanOption = z.object({
  count: z.number().int().min(1).max(65_535),
  periodSeconds: z.number().int().positive(),
  downPaymentPercent: z.number().int().min(0).max(99).default(0),
  graceSeconds: z.number().int().nonnegative().default(3 * 24 * 3600),
});
export type PlanOption = z.input<typeof zPlanOption>;

/** Plan terms the merchant signed, in wire form. */
export const zSignedPlanTerms = z.object({
  merchantId: zHex32,
  planId: zHex32,
  invoiceDigest: zHex32,
  payer: zAddress,
  token: zAddress,
  downPayment: zAmount,
  installmentAmount: zAmount,
  feePerInstallment: zAmount,
  downPaymentFee: zAmount,
  count: z.number().int(),
  period: z.number().int(),
  firstDue: z.string().regex(/^\d+$/),
  grace: z.number().int(),
  splitProfileId: z.number().int(),
  kind: z.number().int(),
  validUntil: z.string().regex(/^\d+$/),
  merchantSignature: zHex,
  termsHash: zHex32,
});
export type SignedPlanTerms = z.infer<typeof zSignedPlanTerms>;

export const zPlanSession = z.object({
  id: z.string(),
  merchant: zMerchant,
  invoice: zInvoice,
  terms: zSignedPlanTerms,
  /** USDT already committed by this payer to other active plans (permit must cover it too). */
  committed: zAmount,
  /** The payer's current USDT permit nonce. */
  permitNonce: z.string().regex(/^\d+$/),
  router: zAddress,
  chainId: z.number().int(),
  expiresAt: zTime,
});
export type PlanSession = z.infer<typeof zPlanSession>;

// ---------- Refunds ----------

export const zRefundStatus = z.enum(["requested", "awaiting_signatures", "queued", "submitted", "settled", "failed"]);
export type RefundStatus = z.infer<typeof zRefundStatus>;

export const zRefund = z.object({
  id: z.string(),
  refundId: zHex32,
  paymentId: zHex32,
  merchantSlug: z.string(),
  merchantName: z.string(),
  to: zAddress,
  amount: zAmount,
  fee: zAmount,
  reason: z.string().nullable(),
  status: zRefundStatus,
  txHash: zHex32.nullable(),
  explorerUrl: z.string().nullable(),
  createdAt: zTime,
  settledAt: zTime.nullable(),
});
export type Refund = z.infer<typeof zRefund>;

/** What the merchant must sign to execute a refund. */
export const zRefundSigningRequest = z.object({
  refund: zRefund,
  terms: z.object({
    paymentId: zHex32,
    refundId: zHex32,
    amount: zAmount,
    fee: zAmount,
    funder: zAddress,
    validUntil: z.string().regex(/^\d+$/),
  }),
  /** Present when the platform's hosted signer already signed the terms. */
  merchantSignature: zHex.nullable(),
  termsHash: zHex32,
  router: zAddress,
  chainId: z.number().int(),
});
export type RefundSigningRequest = z.infer<typeof zRefundSigningRequest>;

// ---------- Merchant dashboard ----------

export const zMerchantStats = z.object({
  gross: zAmount,
  fees: zAmount,
  net: zAmount,
  refunded: zAmount,
  paymentCount: z.number().int(),
  pendingCount: z.number().int(),
  activePlans: z.number().int(),
  from: zTime,
  to: zTime,
});
export type MerchantStats = z.infer<typeof zMerchantStats>;

export const zMerchantSignupInput = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "Lowercase letters, numbers and dashes, 3–40 characters"),
  category: z.string().max(40).optional(),
  description: z.string().max(500).optional(),
  logoUrl: z.string().url().optional(),
  website: z.string().min(3),
  payout: zAddress,
  pendingPayout: z.object({ address: zAddress, executableAt: zTime }).nullable().optional(),
  maxFeeBps: z.number().int().min(1).max(10_000).default(300),
});
export type MerchantSignupInput = z.input<typeof zMerchantSignupInput>;

/** Server-prepared registration the owner wallet signs (RegisterMerchant). */
export const zRegistrationRequest = z.object({
  draftId: z.string(),
  owner: zAddress,
  payout: zAddress,
  pendingPayout: z.object({ address: zAddress, executableAt: zTime }).nullable().optional(),
  maxFeeBps: z.number().int(),
  metadataHash: zHex32,
  /** Signed as part of RegisterMerchant, so it is fixed before the owner signs. */
  metadataURI: z.string().default(""),
  nonce: z.string().regex(/^\d+$/),
  deadline: z.string().regex(/^\d+$/),
  registry: zAddress,
  chainId: z.number().int(),
  /** Message the payout wallet signs to prove control, when payout ≠ owner. */
  payoutProofMessage: z.string().nullable(),
  /** The platform's hosted signer. The owner authorizes it so PayKit can sign payment offers. */
  hostedSigner: zAddress.nullable().optional(),
});
export type RegistrationRequest = z.infer<typeof zRegistrationRequest>;

export const zDomainChallenge = z.object({
  domain: z.string(),
  method: z.enum(["dns", "wellknown"]),
  dnsName: z.string(),
  dnsValue: z.string(),
  wellKnownUrl: z.string(),
  wellKnownBody: z.record(z.string(), z.unknown()),
  status: z.enum(["pending", "verified", "failed", "expired"]),
  lastCheckedAt: zTime.nullable(),
  error: z.string().nullable(),
});
export type DomainChallenge = z.infer<typeof zDomainChallenge>;

export const zMerchantSigner = z.object({
  address: zAddress,
  kind: z.enum(["self", "hosted"]),
  enabled: z.boolean(),
  expiresAt: zTime.nullable(),
  status: z.enum(["pending", "active", "disabled"]),
  createdAt: zTime,
});
export type MerchantSigner = z.infer<typeof zMerchantSigner>;

export const zSplitRecipient = z.object({ address: zAddress, bps: z.number().int().min(1).max(10_000), label: z.string().nullable().optional() });
export type SplitRecipient = z.infer<typeof zSplitRecipient>;

export const zSplitProfile = z.object({
  profileId: z.number().int().nonnegative(),
  name: z.string(),
  recipients: z.array(zSplitRecipient),
  status: z.enum(["pending", "active"]),
});
export type SplitProfile = z.infer<typeof zSplitProfile>;

const zRegistryBase = {
  requestId: z.string(),
  merchantId: zHex32,
  nonce: z.string().regex(/^\d+$/),
  deadline: z.string().regex(/^\d+$/),
  registry: zAddress,
  chainId: z.number().int(),
};

/** A registry change the owner wallet must sign. The server prepares it; the relay node submits it. */
export const zRegistryActionRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_signer"), ...zRegistryBase, signer: zAddress, expiresAt: z.string().regex(/^\d+$/), enabled: z.boolean() }),
  z.object({ action: z.literal("set_split"), ...zRegistryBase, profileId: z.number().int().positive(), recipients: z.array(zAddress), bps: z.array(z.number().int()), splitHash: zHex32 }),
  z.object({
    action: z.literal("queue_payout"),
    ...zRegistryBase,
    newPayout: zAddress,
    /** The new payout wallet signs this to prove control. */
    payoutProofMessage: z.string(),
    /** When the change takes effect after the safety delay. */
    executableAt: zTime,
  }),
]);
export type RegistryActionRequest = z.infer<typeof zRegistryActionRequest>;

export const zRegistryActionResult = z.object({
  requestId: z.string(),
  action: z.enum(["set_signer", "set_split", "queue_payout"]),
  status: z.enum(["queued", "submitted", "included", "failed"]),
  txHash: zHex32.nullable(),
});
export type RegistryActionResult = z.infer<typeof zRegistryActionResult>;

export const zApiKey = z.object({
  id: z.string(),
  kind: z.enum(["publishable", "secret"]),
  prefix: z.string(),
  /** Only returned once, at creation. */
  key: z.string().optional(),
  allowedOrigins: z.array(z.string()),
  createdAt: zTime,
  lastUsedAt: zTime.nullable(),
  revokedAt: zTime.nullable(),
});
export type ApiKey = z.infer<typeof zApiKey>;

export const zWebhookEndpoint = z.object({
  id: z.string(),
  url: z.string().url(),
  events: z.array(z.string()),
  active: z.boolean(),
  /** Only returned once, at creation. */
  secret: z.string().optional(),
  createdAt: zTime,
});
export type WebhookEndpoint = z.infer<typeof zWebhookEndpoint>;

// ---------- Platform ----------

export const zPlatformStatus = z.object({
  sponsorshipAvailable: z.boolean(),
  reason: z.string().nullable(),
  chainId: z.number().int(),
});
export type PlatformStatus = z.infer<typeof zPlatformStatus>;

/** Public config served by GET /v1/config (deployed addresses, fee schedule). */
export const zPublicConfig = z.object({
  network: z.enum(["whitechain-testnet", "whitechain-mainnet"]),
  chainId: z.number().int(),
  contracts: z.object({
    registry: zAddress,
    router: zAddress,
    treasury: zAddress,
    /** PayKitPoints, when the router is V2. */
    points: zAddress.optional(),
    /** EIP-712 domain version of the router ("2" = PaymentRouterV2). */
    routerVersion: z.enum(["1", "2"]).optional(),
  }),
  usdt: zAddress,
  feeSchedule: z.object({ bps: z.number().int(), minFee: zAmount, maxFee: zAmount }),
});
export type PublicConfig = z.infer<typeof zPublicConfig>;

export const zPage = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), nextCursor: z.string().nullable() });
export type Page<T> = { data: T[]; nextCursor: string | null };

export const zApiError = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
