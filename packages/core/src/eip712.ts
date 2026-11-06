import { hashTypedData, type Address, type Hex, type TypedDataDomain } from "viem";

/** A typed-data payload ready for a wallet's eth_signTypedData_v4. */
export type TypedDataPayload = {
  domain: TypedDataDomain;
  types: Record<string, readonly { readonly name: string; readonly type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
};
import { requireContract, requireUsdt, type NetworkConfig } from "./chains.ts";

/**
 * EIP-712 signing formats. The contracts (plan.md §8–9) MUST use exactly these
 * names, versions, field names, field types and field order, or signatures fail.
 */

export const ROUTER_DOMAIN_NAME = "PayKit Router";
export const REGISTRY_DOMAIN_NAME = "PayKit Registry";
export const DOMAIN_VERSION = "1";

export function usdtDomain(network: NetworkConfig): TypedDataDomain {
  const usdt = requireUsdt(network);
  return {
    name: usdt.eip712Name,
    version: usdt.eip712Version,
    chainId: network.chain.id,
    verifyingContract: usdt.address,
  };
}

export function routerDomain(network: NetworkConfig): TypedDataDomain {
  return {
    name: ROUTER_DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: network.chain.id,
    verifyingContract: requireContract(network, "router"),
  };
}

export function registryDomain(network: NetworkConfig): TypedDataDomain {
  return {
    name: REGISTRY_DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: network.chain.id,
    verifyingContract: requireContract(network, "registry"),
  };
}

// ---- Token (USDT) types: standard EIP-3009 / EIP-2612, signed by the payer or funder ----

export const receiveWithAuthorizationTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const cancelAuthorizationTypes = {
  CancelAuthorization: [
    { name: "authorizer", type: "address" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

// ---- PaymentRouter types ----

export const paymentQuoteTypes = {
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
} as const;

export const refundTermsTypes = {
  RefundTerms: [
    { name: "paymentId", type: "bytes32" },
    { name: "refundId", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "fee", type: "uint256" },
    { name: "funder", type: "address" },
    { name: "validUntil", type: "uint64" },
  ],
} as const;

export const planTermsTypes = {
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
} as const;

export const planConsentTypes = {
  PlanConsent: [
    { name: "termsHash", type: "bytes32" },
    { name: "payer", type: "address" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export const cancelPlanTypes = {
  CancelPlan: [
    { name: "planId", type: "bytes32" },
    { name: "signer", type: "address" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

// ---- MerchantRegistry types (signed by the merchant owner wallet, relayed gaslessly) ----

export const registerMerchantTypes = {
  RegisterMerchant: [
    { name: "owner", type: "address" },
    { name: "payout", type: "address" },
    { name: "maxFeeBps", type: "uint16" },
    { name: "metadataHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export const setSignerTypes = {
  SetSigner: [
    { name: "merchantId", type: "bytes32" },
    { name: "signer", type: "address" },
    { name: "expiresAt", type: "uint64" },
    { name: "enabled", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export const queuePayoutTypes = {
  QueuePayout: [
    { name: "merchantId", type: "bytes32" },
    { name: "newPayout", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export const setSplitProfileTypes = {
  SetSplitProfile: [
    { name: "merchantId", type: "bytes32" },
    { name: "profileId", type: "uint32" },
    { name: "splitHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

// ---- Message shapes (bigint in memory; decimal strings over JSON) ----

export type PaymentQuoteMessage = {
  merchantId: Hex;
  invoiceId: Hex;
  invoiceDigest: Hex;
  paymentId: Hex;
  token: Address;
  invoiceTotal: bigint;
  gross: bigint;
  fee: bigint;
  /** 0x000…000 means any payer may pay this quote. */
  payer: Address;
  splitProfileId: number;
  validUntil: bigint;
}

export type ReceiveWithAuthorizationMessage = {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

export type PermitMessage = {
  owner: Address;
  spender: Address;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
}

export type RefundTermsMessage = {
  paymentId: Hex;
  refundId: Hex;
  amount: bigint;
  fee: bigint;
  funder: Address;
  validUntil: bigint;
}

export const PLAN_KIND = { Installments: 0, Subscription: 1 } as const;
export type PlanKind = (typeof PLAN_KIND)[keyof typeof PLAN_KIND];

export type PlanTermsMessage = {
  merchantId: Hex;
  planId: Hex;
  invoiceDigest: Hex;
  payer: Address;
  token: Address;
  downPayment: bigint;
  installmentAmount: bigint;
  feePerInstallment: bigint;
  downPaymentFee: bigint;
  count: number;
  period: number;
  firstDue: bigint;
  grace: number;
  splitProfileId: number;
  kind: number;
  validUntil: bigint;
}

export type PlanConsentMessage = {
  termsHash: Hex;
  payer: Address;
  deadline: bigint;
}

export type CancelPlanMessage = {
  planId: Hex;
  signer: Address;
  deadline: bigint;
}

export type RegisterMerchantMessage = {
  owner: Address;
  payout: Address;
  maxFeeBps: number;
  metadataHash: Hex;
  nonce: bigint;
  deadline: bigint;
}

export type SetSignerMessage = {
  merchantId: Hex;
  signer: Address;
  expiresAt: bigint;
  enabled: boolean;
  nonce: bigint;
  deadline: bigint;
}

// ---- Typed-data builders: pass the result straight to signTypedData / hashTypedData ----

export function paymentQuoteTypedData(network: NetworkConfig, message: PaymentQuoteMessage) {
  return { domain: routerDomain(network), types: paymentQuoteTypes, primaryType: "PaymentQuote" as const, message };
}

export function receiveWithAuthorizationTypedData(network: NetworkConfig, message: ReceiveWithAuthorizationMessage) {
  return {
    domain: usdtDomain(network),
    types: receiveWithAuthorizationTypes,
    primaryType: "ReceiveWithAuthorization" as const,
    message,
  };
}

export function cancelAuthorizationTypedData(network: NetworkConfig, message: { authorizer: Address; nonce: Hex }) {
  return { domain: usdtDomain(network), types: cancelAuthorizationTypes, primaryType: "CancelAuthorization" as const, message };
}

export function permitTypedData(network: NetworkConfig, message: PermitMessage) {
  return { domain: usdtDomain(network), types: permitTypes, primaryType: "Permit" as const, message };
}

export function refundTermsTypedData(network: NetworkConfig, message: RefundTermsMessage) {
  return { domain: routerDomain(network), types: refundTermsTypes, primaryType: "RefundTerms" as const, message };
}

export function planTermsTypedData(network: NetworkConfig, message: PlanTermsMessage) {
  return { domain: routerDomain(network), types: planTermsTypes, primaryType: "PlanTerms" as const, message };
}

export function planConsentTypedData(network: NetworkConfig, message: PlanConsentMessage) {
  return { domain: routerDomain(network), types: planConsentTypes, primaryType: "PlanConsent" as const, message };
}

export function cancelPlanTypedData(network: NetworkConfig, message: CancelPlanMessage) {
  return { domain: routerDomain(network), types: cancelPlanTypes, primaryType: "CancelPlan" as const, message };
}

export function registerMerchantTypedData(network: NetworkConfig, message: RegisterMerchantMessage) {
  return { domain: registryDomain(network), types: registerMerchantTypes, primaryType: "RegisterMerchant" as const, message };
}

export type QueuePayoutMessage = {
  merchantId: Hex;
  newPayout: Address;
  nonce: bigint;
  deadline: bigint;
};

export type SetSplitProfileMessage = {
  merchantId: Hex;
  profileId: number;
  splitHash: Hex;
  nonce: bigint;
  deadline: bigint;
};

export function queuePayoutTypedData(network: NetworkConfig, message: QueuePayoutMessage) {
  return { domain: registryDomain(network), types: queuePayoutTypes, primaryType: "QueuePayout" as const, message };
}

export function setSplitProfileTypedData(network: NetworkConfig, message: SetSplitProfileMessage) {
  return { domain: registryDomain(network), types: setSplitProfileTypes, primaryType: "SetSplitProfile" as const, message };
}

export function setSignerTypedData(network: NetworkConfig, message: SetSignerMessage) {
  return { domain: registryDomain(network), types: setSignerTypes, primaryType: "SetSigner" as const, message };
}

// ---- Digests used inside nonce commitments ----

/** EIP-712 digest of a quote. The contract computes the same with `_hashTypedDataV4`. */
export function hashPaymentQuote(network: NetworkConfig, quote: PaymentQuoteMessage): Hex {
  return hashTypedData(paymentQuoteTypedData(network, quote));
}

export function hashRefundTerms(network: NetworkConfig, terms: RefundTermsMessage): Hex {
  return hashTypedData(refundTermsTypedData(network, terms));
}

export function hashPlanTerms(network: NetworkConfig, terms: PlanTermsMessage): Hex {
  return hashTypedData(planTermsTypedData(network, terms));
}
