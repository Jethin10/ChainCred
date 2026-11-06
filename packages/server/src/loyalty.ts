import { pointsForAmount, rewardIdFor, type LoyaltyProgram, type LoyaltyProgramUpdate, type Payment, type PointsEntry, type Reward } from "@paykit/core";
import { getAddress, type Address } from "viem";

/**
 * The API's mirror of PayKitPoints.sol. The contract is the source of truth onchain; this ledger
 * replays the same rules so the simulated chain, the mock and the dashboards agree with it:
 *  - earn is capped at maxPointsPerUsdt per 1 USDT of gross,
 *  - redeem burns before earn (a payment cannot spend points it earns),
 *  - a refund removes the same share of earned points and restores the same share of redeemed
 *    ones; points already spent become a recorded shortfall.
 */

export interface LoyaltyDb {
  loyalty?: Record<string, { enabled: boolean; pointsPerUsdt: number; rewards: Reward[] }>;
  points?: Record<string, { balance: string; lifetimeEarned: string; lifetimeRedeemed: string }>;
  paymentPoints?: Record<string, { wallet: Address; earned: string; redeemed: string; earnedReversed: string; redeemedRestored: string; rewardName: string | null }>;
  pointsLedger?: (PointsEntry & { wallet: Address })[];
}

const key = (wallet: string) => getAddress(wallet).toLowerCase();

export function programOf(db: LoyaltyDb, slug: string, maxPointsPerUsdt: number): LoyaltyProgram {
  const p = db.loyalty?.[slug];
  return { merchantSlug: slug, enabled: p?.enabled ?? false, pointsPerUsdt: Math.min(p?.pointsPerUsdt ?? 0, maxPointsPerUsdt), maxPointsPerUsdt, rewards: p?.rewards ?? [] };
}

export function updateProgram(db: LoyaltyDb, slug: string, update: LoyaltyProgramUpdate, maxPointsPerUsdt: number): LoyaltyProgram {
  db.loyalty ??= {};
  const current = db.loyalty[slug] ?? { enabled: false, pointsPerUsdt: 0, rewards: [] };
  if (update.pointsPerUsdt !== undefined && update.pointsPerUsdt > maxPointsPerUsdt) {
    throw Object.assign(new Error(`Earn rate is capped at ${maxPointsPerUsdt} points per USDT`), { code: "validation_failed" });
  }
  const rewards = update.rewards?.map((r) => {
    if (BigInt(r.pointsCost) <= 0n || BigInt(r.discount) <= 0n) throw Object.assign(new Error("Rewards need a points cost and a discount above zero"), { code: "validation_failed" });
    return { id: rewardIdFor(slug, r.name.trim().toLowerCase()), name: r.name.trim(), pointsCost: r.pointsCost, discount: r.discount, active: r.active ?? true };
  });
  db.loyalty[slug] = { enabled: update.enabled ?? current.enabled, pointsPerUsdt: update.pointsPerUsdt ?? current.pointsPerUsdt, rewards: rewards ?? current.rewards };
  return programOf(db, slug, maxPointsPerUsdt);
}

export function earnFor(db: LoyaltyDb, slug: string, gross: bigint, maxPointsPerUsdt: number): bigint {
  const p = programOf(db, slug, maxPointsPerUsdt);
  return p.enabled ? pointsForAmount(gross, p.pointsPerUsdt, maxPointsPerUsdt) : 0n;
}

export function balanceOf(db: LoyaltyDb, wallet: string): { balance: bigint; lifetimeEarned: bigint; lifetimeRedeemed: bigint } {
  const a = db.points?.[key(wallet)];
  return { balance: BigInt(a?.balance ?? "0"), lifetimeEarned: BigInt(a?.lifetimeEarned ?? "0"), lifetimeRedeemed: BigInt(a?.lifetimeRedeemed ?? "0") };
}

function account(db: LoyaltyDb, wallet: string) {
  db.points ??= {};
  return (db.points[key(wallet)] ??= { balance: "0", lifetimeEarned: "0", lifetimeRedeemed: "0" });
}

function log(db: LoyaltyDb, p: Payment, wallet: Address, kind: PointsEntry["kind"], amount: bigint, rewardName: string | null) {
  if (amount <= 0n) return;
  db.pointsLedger ??= [];
  db.pointsLedger.unshift({ id: `${p.paymentId}:${kind}:${db.pointsLedger.length}`, wallet, paymentId: p.paymentId, merchantSlug: p.merchantSlug, merchantName: p.merchantName, kind, amount: amount.toString(), rewardName, at: new Date().toISOString() });
}

/** Applies a payment's redeem and earn once (idempotent per paymentId). Returns false if already applied. */
export function applyPayment(db: LoyaltyDb, p: Payment, rewardName: string | null = null): boolean {
  const earned = BigInt(p.pointsEarned ?? "0");
  const redeemed = BigInt(p.pointsRedeemed ?? "0");
  if (earned === 0n && redeemed === 0n) return false;
  db.paymentPoints ??= {};
  if (db.paymentPoints[p.paymentId]) return false;
  const wallet = getAddress(p.payer);
  const a = account(db, wallet);
  if (redeemed > 0n) {
    if (BigInt(a.balance) < redeemed) throw Object.assign(new Error("Not enough points"), { code: "validation_failed" });
    a.balance = (BigInt(a.balance) - redeemed).toString();
    a.lifetimeRedeemed = (BigInt(a.lifetimeRedeemed) + redeemed).toString();
    log(db, p, wallet, "redeemed", redeemed, rewardName);
  }
  if (earned > 0n) {
    a.balance = (BigInt(a.balance) + earned).toString();
    a.lifetimeEarned = (BigInt(a.lifetimeEarned) + earned).toString();
    log(db, p, wallet, "earned", earned, null);
  }
  db.paymentPoints[p.paymentId] = { wallet, earned: earned.toString(), redeemed: redeemed.toString(), earnedReversed: "0", redeemedRestored: "0", rewardName };
  return true;
}

/** PayKitPoints.onRefund: proportional reversal for the payment's cumulative refunded amount. */
export function applyRefund(db: LoyaltyDb, p: Payment): { removed: bigint; restored: bigint; shortfall: bigint } {
  const pp = db.paymentPoints?.[p.paymentId];
  const gross = BigInt(p.gross);
  if (!pp || gross === 0n) return { removed: 0n, restored: 0n, shortfall: 0n };
  const refunded = BigInt(p.refunded) > gross ? gross : BigInt(p.refunded);
  const earnedTarget = (BigInt(pp.earned) * refunded) / gross;
  const restoreTarget = (BigInt(pp.redeemed) * refunded) / gross;
  const toRemove = earnedTarget - BigInt(pp.earnedReversed);
  const toRestore = restoreTarget - BigInt(pp.redeemedRestored);
  if (toRemove <= 0n && toRestore <= 0n) return { removed: 0n, restored: 0n, shortfall: 0n };
  pp.earnedReversed = earnedTarget.toString();
  pp.redeemedRestored = restoreTarget.toString();
  const a = account(db, pp.wallet);
  if (toRestore > 0n) { a.balance = (BigInt(a.balance) + toRestore).toString(); log(db, p, pp.wallet, "restored", toRestore, pp.rewardName); }
  const removable = toRemove > BigInt(a.balance) ? BigInt(a.balance) : toRemove;
  if (removable > 0n) { a.balance = (BigInt(a.balance) - removable).toString(); log(db, p, pp.wallet, "reversed", removable, null); }
  return { removed: removable, restored: toRestore, shortfall: toRemove - removable };
}

export function historyOf(db: LoyaltyDb, wallet: string): PointsEntry[] {
  const k = key(wallet);
  return (db.pointsLedger ?? []).filter((e) => e.wallet.toLowerCase() === k).map(({ wallet: _w, ...entry }) => { void _w; return entry; });
}
