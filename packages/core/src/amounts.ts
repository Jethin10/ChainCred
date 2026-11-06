import { formatUnits, parseUnits } from "viem";
import { PayKitError } from "./errors.ts";

/**
 * Amount math. Everything is integer base units (USDT has 6 decimals).
 * Never use floats for money.
 */

export const USDT_DECIMALS = 6;
export const BPS_DENOMINATOR = 10_000n;

/** "10.5" → 10_500_000n. Rejects more than 6 decimals, negatives and junk. */
export function parseUsdt(value: string | number): bigint {
  const text = typeof value === "number" ? numberToPlainString(value) : value.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new PayKitError("validation_failed", `Invalid USDT amount "${value}"`);
  const fraction = text.split(".")[1];
  if (fraction && fraction.length > USDT_DECIMALS) {
    throw new PayKitError("validation_failed", `USDT has at most ${USDT_DECIMALS} decimals: "${value}"`);
  }
  return parseUnits(text, USDT_DECIMALS);
}

function numberToPlainString(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new PayKitError("validation_failed", `Invalid USDT amount ${value}`);
  if (Number(value.toFixed(USDT_DECIMALS)) !== value) throw new PayKitError("validation_failed", "USDT has at most 6 decimals; use a decimal string");
  return value.toFixed(USDT_DECIMALS).replace(/\.?0+$/, "");
}

/** 10_500_000n → "10.5". */
export function formatUsdt(amount: bigint | string): string {
  return formatUnits(toBigInt(amount), USDT_DECIMALS);
}

/** 10_500_000n → "10.50 USDT" (2–6 decimals, never rounded away). */
export function displayUsdt(amount: bigint | string, options: { symbol?: boolean } = {}): string {
  const [whole, fraction = ""] = formatUsdt(amount).split(".");
  const shown = fraction.padEnd(2, "0");
  const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${shown}${options.symbol === false ? "" : " USDT"}`;
}

/** Parses a base-unit decimal string (as sent over JSON) into a bigint. */
export function toBigInt(value: bigint | string | number): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new PayKitError("validation_failed", `Unsafe integer amount ${value}`);
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value)) throw new PayKitError("validation_failed", `Invalid base-unit amount "${value}"`);
  return BigInt(value);
}

export interface FeeSchedule {
  /** Percentage fee in basis points, e.g. 100 = 1%. */
  bps: number;
  /** Minimum fee in base units. */
  minFee: bigint;
  /** Maximum fee in base units. */
  maxFee: bigint;
}

/** Default testnet schedule: 1%, min 0.05 USDT, max 25 USDT (plan.md §10.2). */
export const DEFAULT_FEE_SCHEDULE: FeeSchedule = { bps: 100, minFee: 50_000n, maxFee: 25_000_000n };
export const DEFAULT_MAX_FEE_BPS = 300;

/** Protocol fee for a gross amount: clamp(gross × bps, minFee, maxFee), never above gross. */
export function protocolFee(gross: bigint, schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE): bigint {
  assertPositive(gross, "gross");
  let fee = (gross * BigInt(schedule.bps)) / BPS_DENOMINATOR;
  if (fee < schedule.minFee) fee = schedule.minFee;
  if (fee > schedule.maxFee) fee = schedule.maxFee;
  return fee > gross ? gross : fee;
}

/** Smallest gross for which the fee floor stays within the merchant's consent cap. */
export function minimumTicket(schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE, maxFeeBps = DEFAULT_MAX_FEE_BPS): bigint {
  if (maxFeeBps <= 0) throw new PayKitError("validation_failed", "maxFeeBps must be positive");
  const cap = BigInt(maxFeeBps);
  return (schedule.minFee * BPS_DENOMINATOR + cap - 1n) / cap;
}

export type FeeCheck =
  | { ok: true }
  | { ok: false; code: "amount_too_small" | "validation_failed"; reason: string };

/** Mirrors the router's fee checks (plan.md §8.2 step 7) so bad quotes fail before signing. */
export function checkQuoteFee(
  gross: bigint,
  fee: bigint,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
  maxFeeBps = DEFAULT_MAX_FEE_BPS,
): FeeCheck {
  if (gross <= 0n) return { ok: false, code: "validation_failed", reason: "Gross must be positive" };
  if (fee > gross) return { ok: false, code: "validation_failed", reason: "Fee exceeds gross" };
  if (fee < protocolFee(gross, schedule)) return { ok: false, code: "validation_failed", reason: "Fee is below the protocol floor" };
  if (fee * BPS_DENOMINATOR > gross * BigInt(maxFeeBps)) {
    return { ok: false, code: "amount_too_small", reason: "Fee exceeds the merchant's fee cap; the amount is below the minimum ticket" };
  }
  return { ok: true };
}

/** Splits a net amount by basis points. The last recipient gets the remainder (no dust). */
export function splitByBps(net: bigint, bps: readonly number[]): bigint[] {
  assertBpsSum(bps);
  if (net < 0n) throw new PayKitError("validation_failed", "Net must not be negative");
  const parts: bigint[] = [];
  let allocated = 0n;
  bps.forEach((share, i) => {
    const amount = i === bps.length - 1 ? net - allocated : (net * BigInt(share)) / BPS_DENOMINATOR;
    parts.push(amount);
    allocated += amount;
  });
  return parts;
}

/**
 * Converts percentage stages (basis points, summing to 10 000) into fixed amounts.
 * All but the last use floor division; the last receives the exact residual.
 * Example: total 10_000_001 with [3333, 3333, 3334] → 3_333_000, 3_333_000, 3_334_001.
 */
export function stagesFromBps(total: bigint, bps: readonly number[]): bigint[] {
  assertPositive(total, "total");
  const stages = splitByBps(total, bps);
  if (stages.some((s) => s <= 0n)) throw new PayKitError("validation_failed", "Every stage must be positive");
  return stages;
}

/** Deposit now + remainder later, e.g. depositSchedule(100 USDT, 30) → [30, 70]. */
export function depositSchedule(total: bigint, depositPercent: number): bigint[] {
  if (!Number.isInteger(depositPercent) || depositPercent <= 0 || depositPercent > 100) {
    throw new PayKitError("validation_failed", "depositPercent must be an integer from 1 to 100");
  }
  if (depositPercent === 100) return [total];
  const depositBps = depositPercent * 100;
  return stagesFromBps(total, [depositBps, 10_000 - depositBps]);
}

export interface InstallmentSplit {
  downPayment: bigint;
  installmentAmount: bigint;
  count: number;
}

/**
 * Splits a total into an optional down payment plus `count` equal installments.
 * The contract needs equal installments, so any remainder is added to the down payment.
 */
export function installmentSplit(total: bigint, count: number, downPaymentPercent = 0): InstallmentSplit {
  assertPositive(total, "total");
  if (!Number.isInteger(count) || count < 1 || count > 65_535) {
    throw new PayKitError("validation_failed", "count must be an integer from 1 to 65535");
  }
  if (!Number.isInteger(downPaymentPercent) || downPaymentPercent < 0 || downPaymentPercent >= 100) {
    throw new PayKitError("validation_failed", "downPaymentPercent must be an integer from 0 to 99");
  }
  const baseDown = (total * BigInt(downPaymentPercent)) / 100n;
  const rest = total - baseDown;
  const installmentAmount = rest / BigInt(count);
  if (installmentAmount <= 0n) throw new PayKitError("validation_failed", "Installments would be zero; lower the count");
  const remainder = rest - installmentAmount * BigInt(count);
  return { downPayment: baseDown + remainder, installmentAmount, count };
}

export function planTotal(split: InstallmentSplit): bigint {
  return split.downPayment + split.installmentAmount * BigInt(split.count);
}

export function assertBpsSum(bps: readonly number[]): void {
  if (bps.length === 0) throw new PayKitError("validation_failed", "At least one share is required");
  if (bps.some((b) => !Number.isInteger(b) || b <= 0 || b > 10_000)) {
    throw new PayKitError("validation_failed", "Shares must be integers from 1 to 10000 basis points");
  }
  const sum = bps.reduce((a, b) => a + b, 0);
  if (sum !== 10_000) throw new PayKitError("validation_failed", `Shares must sum to 10000 basis points, got ${sum}`);
}

function assertPositive(value: bigint, name: string): void {
  if (value <= 0n) throw new PayKitError("validation_failed", `${name} must be positive`);
}
