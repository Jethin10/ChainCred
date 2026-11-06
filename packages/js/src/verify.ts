import {
  hashPaymentQuote,
  hashPlanTerms,
  hashRefundTerms,
  nowSeconds,
  paymentQuoteTypedData,
  PayKitError,
  planTermsFromWire,
  quoteFromWire,
  refundTermsFromWire,
  requireContract,
  requireUsdt,
  type CheckoutSession,
  type NetworkConfig,
  type PaymentQuoteMessage,
  type PlanSession,
  type PlanTermsMessage,
  type RefundSigningRequest,
  type RefundTermsMessage,
} from "@paykit/core";
import { getAddress, isAddressEqual, recoverTypedDataAddress, zeroAddress, type Address } from "viem";

/** Minimum time left on a quote before we ask the payer to sign. */
export const MIN_QUOTE_LIFETIME_SECONDS = 30n;

function mismatch(message: string): never {
  throw new PayKitError("quote_mismatch", `The payment details from the server don't add up: ${message}. Nothing was signed.`);
}

/**
 * Checks a checkout session before the payer signs. It never trusts the server's
 * summary: it recomputes the quote hash and compares every field the payer sees.
 */
export async function verifyCheckoutSession(
  network: NetworkConfig,
  session: CheckoutSession,
  payer: Address,
): Promise<{ quote: PaymentQuoteMessage; merchantSigner: Address }> {
  const usdt = requireUsdt(network);
  const router = requireContract(network, "router");
  const quote = quoteFromWire(session.quote);

  if (session.chainId !== network.chain.id) mismatch(`chain ${session.chainId} is not ${network.chain.id}`);
  if (!isAddressEqual(session.router, router)) mismatch("unexpected payment contract");
  if (!isAddressEqual(quote.token, usdt.address)) mismatch("the token is not the supported USDT");
  if (hashPaymentQuote(network, quote) !== session.quote.quoteHash) mismatch("quote hash differs");
  if (session.merchant.merchantId === null || quote.merchantId !== session.merchant.merchantId) mismatch("merchant differs");
  if (quote.invoiceId !== session.invoice.invoiceId) mismatch("invoice differs");
  if (quote.invoiceDigest !== session.invoice.digest) mismatch("invoice contents differ");
  if (quote.invoiceTotal !== BigInt(session.invoice.total)) mismatch("invoice total differs");
  if (quote.gross <= 0n) mismatch("amount is zero");
  if (quote.gross + BigInt(session.invoice.paid) > quote.invoiceTotal) mismatch("amount exceeds what is still due");
  if (quote.fee > quote.gross) mismatch("fee exceeds amount");
  if (!isAddressEqual(quote.payer, zeroAddress) && !isAddressEqual(quote.payer, payer)) {
    throw new PayKitError("forbidden", "This invoice is assigned to a different wallet");
  }
  if (quote.validUntil < nowSeconds() + MIN_QUOTE_LIFETIME_SECONDS) {
    throw new PayKitError("quote_expired", "This payment offer has expired. Start checkout again.");
  }

  const merchantSigner = await recoverTypedDataAddress({
    ...paymentQuoteTypedData(network, quote),
    signature: session.quote.merchantSignature as `0x${string}`,
  });
  return { quote, merchantSigner };
}

export function verifyPlanSession(network: NetworkConfig, session: PlanSession, payer: Address): PlanTermsMessage {
  const usdt = requireUsdt(network);
  const router = requireContract(network, "router");
  const terms = planTermsFromWire(session.terms);
  if (session.chainId !== network.chain.id) mismatch("wrong chain");
  if (!isAddressEqual(session.router, router)) mismatch("unexpected payment contract");
  if (!isAddressEqual(terms.token, usdt.address)) mismatch("the token is not the supported USDT");
  if (!isAddressEqual(terms.payer, payer)) mismatch("the plan is for a different wallet");
  if (hashPlanTerms(network, terms) !== session.terms.termsHash) mismatch("plan hash differs");
  if (session.merchant.merchantId === null || terms.merchantId !== session.merchant.merchantId) mismatch("merchant differs");
  if (terms.invoiceDigest !== session.invoice.digest) mismatch("invoice contents differ");
  const total = terms.downPayment + terms.installmentAmount * BigInt(terms.count);
  if (total !== BigInt(session.invoice.total)) mismatch("plan total differs from the invoice");
  if (terms.count < 1 || terms.installmentAmount <= 0n || terms.period <= 0) mismatch("invalid schedule");
  if (terms.validUntil < nowSeconds() + MIN_QUOTE_LIFETIME_SECONDS) {
    throw new PayKitError("quote_expired", "This plan offer has expired. Start again.");
  }
  return terms;
}

export function verifyRefundRequest(
  network: NetworkConfig,
  request: RefundSigningRequest,
  expected: { paymentId: string; amount: bigint },
): { terms: RefundTermsMessage; funder: Address } {
  const router = requireContract(network, "router");
  const terms = refundTermsFromWire(request.terms);
  if (request.chainId !== network.chain.id) mismatch("wrong chain");
  if (!isAddressEqual(request.router, router)) mismatch("unexpected payment contract");
  if (terms.paymentId.toLowerCase() !== expected.paymentId.toLowerCase()) mismatch("refund is for a different payment");
  if (terms.amount !== expected.amount) mismatch("refund amount differs");
  if (hashRefundTerms(network, terms) !== request.termsHash) mismatch("refund hash differs");
  return { terms, funder: getAddress(terms.funder) };
}
