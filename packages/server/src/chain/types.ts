import type { RefillState, RefillQuote } from "../refill.ts";
import type { ChainEvent } from "@paykit/observer";
import type {
  CancelPlanMessage,
  PaymentQuoteMessage,
  PlanTermsMessage,
  RefundTermsMessage,
  RegisterMerchantMessage,
  RegistryActionRequest,
} from "@paykit/core";
import type { Address, Hex } from "viem";

/**
 * Everything the API needs from the chain. `createViemChain` talks to the real PayKit
 * contracts; `createSimulatedChain` fakes it for the mock and tests.
 *
 * Every write is sent by the relay wallet, which pays the WBT gas. Each returns the tx hash
 * once submitted; `waitForReceipt` then reports whether it succeeded.
 */
export interface ChainAdapter {
  pay(args: {
    quote: PaymentQuoteMessage;
    merchantSignature: Hex;
    auth: { from: Address; refundTo: Address; salt: Hex; validAfter: bigint; validBefore: bigint; signature: Hex };
  }): Promise<Hex>;
  refund(args: { terms: RefundTermsMessage; merchantSignature: Hex; funder: { validAfter: bigint; validBefore: bigint; signature: Hex } }): Promise<Hex>;
  createPlan(args: {
    terms: PlanTermsMessage;
    merchantSignature: Hex;
    consentSignature: Hex;
    /** Deadline the payer signed in PlanConsent; sent as PayerConsent{deadline, signature}. */
    consentDeadline: bigint;
    permit: { value: bigint; deadline: bigint; signature: Hex };
  }): Promise<Hex>;
  collectInstallment(planId: Hex, index?: number): Promise<Hex>;
  cancelPlan(args: { message: CancelPlanMessage; signature: Hex }): Promise<Hex>;
  registerMerchant(args: { message: RegisterMerchantMessage; signature: Hex }): Promise<Hex>;
  registryAction(args: { request: RegistryActionRequest; signature: Hex }): Promise<Hex>;
  revokeDomain?(args: { merchantId: Hex; domainHash: Hex }): Promise<Hex>;
  attestDomain(args: { merchantId: Hex; domainHash: Hex; expiresAt: bigint }): Promise<Hex>;

  /**
   * The router's canonical storage keys. PaymentRouter stores payments under
   * paymentKeyOf(merchantId, quote.paymentId) and plans under planKeyOf(merchantId, terms.planId),
   * using tag constants from libraries/PayKitTypes.sol. Events, refunds, cancellations and
   * collections all use these keys. The real adapter asks the deployed router (pure functions);
   * without it the server uses the local IDs unchanged (simulated chain, tests).
   */
  keys?: {
    payment(merchantId: Hex, localPaymentId: Hex): Promise<Hex>;
    plan(merchantId: Hex, localPlanId: Hex): Promise<Hex>;
    installment(planKey: Hex, index: number): Promise<Hex>;
  };

  waitForReceipt(hash: Hex): Promise<{ success: boolean; blockNumber: bigint; blockHash?: Hex; transactionHash?: Hex; error?: string }>;
  refillState?(): Promise<RefillState>;
  quoteRefill?(amount: bigint): Promise<RefillQuote>;
  refill?(args: { amount: bigint; minOutput: bigint; deadline: bigint }): Promise<Hex>;
  observe?(from: bigint): Promise<{ nextBlock: bigint; events: ChainEvent[] }>;
  transactionStatus?(hash: Hex): Promise<{ success: boolean; blockNumber: bigint; blockHash: Hex; finality: "included" | "safe" | "finalized" } | null>;
  /** How settled a block is, as reported by the RPC (latest / safe / finalized heads). */
  finality(blockNumber: bigint): Promise<"included" | "safe" | "finalized">;

  /** MerchantRegistry.ownerNonces(owner): nonce for RegisterMerchant and *WithSig changes. */
  ownerNonce(owner: Address): Promise<bigint>;
  /** USDT.nonces(owner): the payer's permit nonce. */
  permitNonce(owner: Address): Promise<bigint>;
  /** PaymentRouter.committed(payer, token): USDT already promised to active plans. */
  committed(payer: Address): Promise<bigint>;
  /** Whether the relay wallet has enough WBT to keep sponsoring gas. */
  sponsorship(): Promise<{ ok: boolean; reason: string | null }>;
}

/** A proven revert or explicit local policy rejection, never an RPC timeout. */
export class PermanentChainError extends Error {}

export interface RelayTransaction { hash: Hex; raw: Hex; sender: Address; nonce: number; cost: string; createdAt: number; settled: boolean; hashes?: Hex[]; rawHistory?: Record<string, Hex>; replacements?: number; replacedAt?: number; }
