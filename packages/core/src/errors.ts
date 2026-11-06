/** Error codes shared by the API, the SDK clients and the UI. See plan.md §14.4. */
export const ERROR_CODES = [
  "amount_too_small",
  "quote_expired",
  "invoice_overpaid",
  "merchant_inactive",
  "merchant_unverified",
  "sponsorship_paused",
  "rate_limited",
  "insufficient_usdt",
  "address_blocked",
  "signature_invalid",
  "already_settled",
  "refund_exceeds_payment",
  "allowance_insufficient",
  "not_found",
  "unauthorized",
  "forbidden",
  "validation_failed",
  "config_invalid",
  "wallet_not_connected",
  "wrong_network",
  "user_rejected",
  "quote_mismatch",
  "timeout",
  "network_error",
  "server_error",
] as const;

export type PayKitErrorCode = (typeof ERROR_CODES)[number];

export class PayKitError extends Error {
  readonly code: PayKitErrorCode;
  readonly status: number | undefined;
  readonly details: unknown;

  constructor(code: PayKitErrorCode, message: string, options: { status?: number; details?: unknown; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PayKitError";
    this.code = code;
    this.status = options.status;
    this.details = options.details;
  }
}

export function isPayKitError(value: unknown): value is PayKitError {
  return value instanceof PayKitError;
}

export function isErrorCode(value: unknown): value is PayKitErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}
