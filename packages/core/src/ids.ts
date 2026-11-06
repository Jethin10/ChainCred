import {
  bytesToHex,
  encodeAbiParameters,
  getAddress,
  keccak256,
  stringToBytes,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { PayKitError } from "./errors.ts";

/** Nonce tags. Contracts must use the same constants. */
export const PAY_NONCE_TAG: Hex = keccak256(stringToBytes("PayKit.pay.v1"));
export const REFUND_NONCE_TAG: Hex = keccak256(stringToBytes("PayKit.refund.v1"));

/** Index used for the down-payment of an installment plan (plan.md §8.2). */
export const DOWN_PAYMENT_INDEX = 0xffff;

/** Random 32 bytes as hex, using Web Crypto (browsers and Node 20+). */
export function randomBytes32(): Hex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** Onchain ID for an offchain UUID (invoice, refund, plan). The UUID itself stays private. */
export function idFromUuid(uuid: string): Hex {
  if (!uuid) throw new PayKitError("validation_failed", "ID source must not be empty");
  return keccak256(stringToBytes(uuid));
}

export const invoiceIdFromUuid = idFromUuid;
export const refundIdFromUuid = idFromUuid;
export const planIdFromUuid = idFromUuid;

/** Payment ID for one part of an invoice. A fresh salt makes every part unique. */
export function paymentIdForPart(invoiceId: Hex, partIndex: number, salt: Hex = randomBytes32()): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "bytes32" }], [invoiceId, BigInt(partIndex), salt]),
  );
}

/** Payment ID of installment `index` of a plan. Use DOWN_PAYMENT_INDEX for the down payment. */
export function installmentPaymentId(planId: Hex, index: number): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint16" }], [planId, index]));
}

/** Onchain invoice storage key: keccak256(abi.encode(merchantId, invoiceId)). */
export function invoiceKey(merchantId: Hex, invoiceId: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [merchantId, invoiceId]));
}

/** Deterministic merchant ID: keccak256(abi.encode(chainId, owner, ownerNonce)). */
export function merchantIdFor(chainId: number, owner: Address, ownerNonce: bigint): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }], [BigInt(chainId), getAddress(owner), ownerNonce]),
  );
}

/**
 * The EIP-3009 nonce the payer signs. It commits to the merchant's quote, the refund
 * address and a per-part salt, so a relayer cannot change any of them.
 */
export function payNonce(quoteHash: Hex, refundTo: Address, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }],
      [PAY_NONCE_TAG, quoteHash, getAddress(refundTo), salt],
    ),
  );
}

/** The EIP-3009 nonce the refund funder signs, committing to the merchant's refund terms. */
export function refundNonce(refundTermsHash: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [REFUND_NONCE_TAG, refundTermsHash]));
}

/** Commitment to a split profile: keccak256(abi.encode(address[] recipients, uint16[] bps)). */
export function splitHash(recipients: readonly Address[], bps: readonly number[]): Hex {
  if (recipients.length !== bps.length || recipients.length === 0 || recipients.length > 5) {
    throw new PayKitError("validation_failed", "A split needs 1 to 5 recipients, each with a share");
  }
  return keccak256(
    encodeAbiParameters([{ type: "address[]" }, { type: "uint16[]" }], [recipients.map((r) => getAddress(r)), [...bps]]),
  );
}

/** The exact text the owner wallet signs inside /.well-known/paykit.json. */
export function wellKnownSigningText(body: Record<string, unknown>): string {
  const { ownerSignature: _ignored, ...rest } = body;
  return `PayKit domain verification
${canonicalJson(rest)}`;
}

/** keccak256 of the lowercase ASCII (punycode) hostname, as stored by the registry. */
export function domainHash(domain: string): Hex {
  return keccak256(stringToBytes(normalizeDomain(domain)));
}

export function normalizeDomain(domain: string): string {
  const trimmed = domain.trim();
  if (!trimmed) throw new PayKitError("validation_failed", "Domain must not be empty");
  let host: string;
  try {
    host = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch (cause) {
    throw new PayKitError("validation_failed", `Invalid domain "${domain}"`, { cause });
  }
  host = host.replace(/\.$/, "").toLowerCase();
  if (!host.includes(".") || host.startsWith("[")) {
    throw new PayKitError("validation_failed", `"${domain}" is not a public domain name`);
  }
  return host;
}

/**
 * Canonical JSON (RFC 8785 style for the values we use): sorted object keys, no
 * whitespace. Amounts must be strings. Numbers must be safe integers.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new PayKitError("validation_failed", "Canonical JSON only allows safe integers; encode amounts as strings");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  throw new PayKitError("validation_failed", `Cannot canonicalize a ${typeof value}`);
}

/** Invoice digest committed onchain: keccak256(canonical JSON of the invoice document). */
export function invoiceDigest(document: unknown): Hex {
  return keccak256(stringToBytes(canonicalJson(document)));
}

/** keccak256 of canonical merchant metadata JSON. */
export const metadataHash = invoiceDigest;

export const ANY_PAYER: Address = zeroAddress;
