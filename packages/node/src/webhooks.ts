import { createHmac, timingSafeEqual } from "node:crypto";
import {
  isWebhookEventType,
  PayKitError,
  WEBHOOK_TOLERANCE_SECONDS,
  type AnyWebhookEvent,
} from "@paykit/core";

/**
 * Webhook signatures: header `paykit-signature: t=<unix>,v1=<hex>` where
 * v1 = HMAC-SHA256(secret, `${t}.${rawBody}`). Several v1 entries are allowed
 * during secret rotation.
 */

export function computeWebhookSignature(rawBody: string, secret: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/** Builds the header value. The server uses this when sending; tests use it to fake deliveries. */
export function signWebhookPayload(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${computeWebhookSignature(rawBody, secret, timestamp)}`;
}

export interface VerifyWebhookOptions {
  /** Max age in seconds. Default 300. */
  toleranceSeconds?: number;
  /** Current time in unix seconds (tests). */
  now?: number;
}

/**
 * Verifies a delivery and returns the parsed event. Pass the RAW request body
 * (exact bytes as received), not a re-serialized object.
 */
export function verifyWebhook(
  rawBody: string | Uint8Array,
  header: string | null | undefined,
  secret: string | readonly string[],
  options: VerifyWebhookOptions = {},
): AnyWebhookEvent {
  if (!header) throw new PayKitError("signature_invalid", "Missing paykit-signature header");
  const body = typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody);
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t" && v && /^\d+$/.test(v)) timestamp = Number(v);
    if (k === "v1" && v) signatures.push(v);
  }
  if (timestamp === undefined || signatures.length === 0) throw new PayKitError("signature_invalid", "Malformed paykit-signature header");

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) throw new PayKitError("signature_invalid", "Webhook timestamp is outside the tolerance window");

  const secrets = typeof secret === "string" ? [secret] : secret;
  const valid = secrets.some((s) => {
    const expected = Buffer.from(computeWebhookSignature(body, s, timestamp!), "hex");
    return signatures.some((sig) => {
      if (!/^[0-9a-f]+$/i.test(sig)) return false;
      const given = Buffer.from(sig, "hex");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
  });
  if (!valid) throw new PayKitError("signature_invalid", "Webhook signature does not match");

  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch (cause) {
    throw new PayKitError("validation_failed", "Webhook body is not JSON", { cause });
  }
  const e = event as Partial<AnyWebhookEvent>;
  if (!e || typeof e.id !== "string" || !isWebhookEventType(e.type) || typeof e.data !== "object") {
    throw new PayKitError("validation_failed", "Webhook body is not a PayKit event");
  }
  return e as AnyWebhookEvent;
}
