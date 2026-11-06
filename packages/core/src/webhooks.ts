import type { Invoice, Merchant, Payment, Plan, Refund } from "./types.ts";

/** Webhook event names (plan.md §15). */
export const WEBHOOK_EVENTS = [
  "invoice.created",
  "invoice.expired",
  "invoice.voided",
  "invoice.partially_paid",
  "invoice.paid",
  "payment.pending",
  "payment.confirmed",
  "payment.safe",
  "payment.finalized",
  "payment.failed",
  "refund.pending",
  "refund.succeeded",
  "refund.failed",
  "plan.created",
  "plan.installment_collected",
  "plan.installment_missed",
  "plan.cancelled",
  "plan.completed",
  "merchant.domain_verified",
  "merchant.domain_revoked",
  "merchant.payout_changed",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookEventDataMap {
  "invoice.created": Invoice;
  "invoice.expired": Invoice;
  "invoice.voided": Invoice;
  "invoice.partially_paid": Invoice;
  "invoice.paid": Invoice;
  "payment.pending": Payment;
  "payment.confirmed": Payment;
  "payment.safe": Payment;
  "payment.finalized": Payment;
  "payment.failed": Payment;
  "refund.pending": Refund;
  "refund.succeeded": Refund;
  "refund.failed": Refund;
  "plan.created": Plan;
  "plan.installment_collected": Plan;
  "plan.installment_missed": Plan;
  "plan.cancelled": Plan;
  "plan.completed": Plan;
  "merchant.domain_verified": Merchant;
  "merchant.domain_revoked": Merchant;
  "merchant.payout_changed": Merchant;
}

export interface WebhookEvent<T extends WebhookEventType = WebhookEventType> {
  /** Stable ID. Deduplicate on it: delivery is at-least-once. */
  id: string;
  type: T;
  createdAt: string;
  merchantSlug: string;
  chainId: number;
  data: WebhookEventDataMap[T];
}

export type AnyWebhookEvent = { [K in WebhookEventType]: WebhookEvent<K> }[WebhookEventType];

export const WEBHOOK_SIGNATURE_HEADER = "paykit-signature";
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export function isWebhookEventType(value: unknown): value is WebhookEventType {
  return typeof value === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(value);
}
