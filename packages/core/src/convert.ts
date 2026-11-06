import { getAddress, type Hex } from "viem";
import type { PaymentQuoteMessage, PlanTermsMessage, RefundTermsMessage } from "./eip712.ts";
import type { SignedPlanTerms, SignedQuote } from "./types.ts";

/** Wire ↔ signing-message conversions. Wire uses decimal strings; signing uses bigint. */

export function quoteFromWire(q: SignedQuote): PaymentQuoteMessage {
  return {
    merchantId: q.merchantId as Hex,
    invoiceId: q.invoiceId as Hex,
    invoiceDigest: q.invoiceDigest as Hex,
    paymentId: q.paymentId as Hex,
    token: getAddress(q.token),
    invoiceTotal: BigInt(q.invoiceTotal),
    gross: BigInt(q.gross),
    fee: BigInt(q.fee),
    payer: getAddress(q.payer),
    splitProfileId: q.splitProfileId,
    validUntil: BigInt(q.validUntil),
  };
}

export function quoteToWire(q: PaymentQuoteMessage, merchantSignature: Hex, quoteHash: Hex): SignedQuote {
  return {
    merchantId: q.merchantId,
    invoiceId: q.invoiceId,
    invoiceDigest: q.invoiceDigest,
    paymentId: q.paymentId,
    token: q.token,
    invoiceTotal: q.invoiceTotal.toString(),
    gross: q.gross.toString(),
    fee: q.fee.toString(),
    payer: q.payer,
    splitProfileId: q.splitProfileId,
    validUntil: q.validUntil.toString(),
    merchantSignature,
    quoteHash,
  };
}

export function planTermsFromWire(t: SignedPlanTerms): PlanTermsMessage {
  return {
    merchantId: t.merchantId as Hex,
    planId: t.planId as Hex,
    invoiceDigest: t.invoiceDigest as Hex,
    payer: getAddress(t.payer),
    token: getAddress(t.token),
    downPayment: BigInt(t.downPayment),
    installmentAmount: BigInt(t.installmentAmount),
    feePerInstallment: BigInt(t.feePerInstallment),
    downPaymentFee: BigInt(t.downPaymentFee),
    count: t.count,
    period: t.period,
    firstDue: BigInt(t.firstDue),
    grace: t.grace,
    splitProfileId: t.splitProfileId,
    kind: t.kind,
    validUntil: BigInt(t.validUntil),
  };
}

export function planTermsToWire(t: PlanTermsMessage, merchantSignature: Hex, termsHash: Hex): SignedPlanTerms {
  return {
    merchantId: t.merchantId,
    planId: t.planId,
    invoiceDigest: t.invoiceDigest,
    payer: t.payer,
    token: t.token,
    downPayment: t.downPayment.toString(),
    installmentAmount: t.installmentAmount.toString(),
    feePerInstallment: t.feePerInstallment.toString(),
    downPaymentFee: t.downPaymentFee.toString(),
    count: t.count,
    period: t.period,
    firstDue: t.firstDue.toString(),
    grace: t.grace,
    splitProfileId: t.splitProfileId,
    kind: t.kind,
    validUntil: t.validUntil.toString(),
    merchantSignature,
    termsHash,
  };
}

export interface RefundTermsWire {
  paymentId: string;
  refundId: string;
  amount: string;
  fee: string;
  funder: string;
  validUntil: string;
}

export function refundTermsFromWire(t: RefundTermsWire): RefundTermsMessage {
  return {
    paymentId: t.paymentId as Hex,
    refundId: t.refundId as Hex,
    amount: BigInt(t.amount),
    fee: BigInt(t.fee),
    funder: getAddress(t.funder),
    validUntil: BigInt(t.validUntil),
  };
}

/** Unix seconds now, as bigint. */
export function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}
