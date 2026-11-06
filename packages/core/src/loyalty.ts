import { keccak256, stringToBytes, type Hex } from "viem";
import { z } from "zod";
import { zAddress, zAmount, zHex32 } from "./types.ts";

/**
 * Universal loyalty points (PayKitPoints.sol, PKP, 0 decimals). One balance per wallet, earned at
 * any PayKit merchant and spendable at any other. The router mints and burns inside the payment the
 * customer signs, so points can never be moved or minted outside a real payment.
 */

/** Points per 1 USDT for `gross` base units (6 decimals), floored and capped by the platform maximum. */
export function pointsForAmount(gross: bigint, pointsPerUsdt: number, maxPointsPerUsdt: number): bigint {
  const rate = BigInt(Math.max(0, Math.min(Math.floor(pointsPerUsdt), Math.floor(maxPointsPerUsdt))));
  return (gross * rate) / 1_000_000n;
}

/** Onchain reward ID: keccak256 of a stable reward key (merchant slug + name). */
export function rewardIdFor(merchantSlug: string, key: string): Hex {
  return keccak256(stringToBytes(`PayKit.reward:${merchantSlug}:${key}`));
}

export const zReward = z.object({
  /** bytes32 sent as `rewardId` in the quote. */
  id: zHex32,
  name: z.string().min(1).max(60),
  /** Points burned to claim it. */
  pointsCost: z.string().regex(/^\d+$/),
  /** USDT base units knocked off the order. The merchant funds it. */
  discount: zAmount,
  active: z.boolean(),
});
export type Reward = z.infer<typeof zReward>;

export const zLoyaltyProgram = z.object({
  merchantSlug: z.string(),
  enabled: z.boolean(),
  /** Points customers earn per 1 USDT paid here. Capped by `maxPointsPerUsdt`. */
  pointsPerUsdt: z.number().int().nonnegative(),
  /** Platform cap from PayKitPoints.maxPointsPerUsdt. */
  maxPointsPerUsdt: z.number().int().nonnegative(),
  rewards: z.array(zReward),
});
export type LoyaltyProgram = z.infer<typeof zLoyaltyProgram>;

export const zLoyaltyProgramUpdate = z.object({
  enabled: z.boolean().optional(),
  pointsPerUsdt: z.number().int().nonnegative().optional(),
  rewards: z.array(z.object({ name: z.string().min(1).max(60), pointsCost: z.string().regex(/^\d+$/), discount: zAmount, active: z.boolean().default(true) })).max(12).optional(),
});
export type LoyaltyProgramUpdate = z.input<typeof zLoyaltyProgramUpdate>;

export const zPointsEntry = z.object({
  id: z.string(),
  paymentId: zHex32,
  merchantSlug: z.string(),
  merchantName: z.string(),
  /** earned / redeemed in a payment; reversed / restored by a refund (PointsReversed). */
  kind: z.enum(["earned", "redeemed", "reversed", "restored"]),
  amount: z.string().regex(/^\d+$/),
  rewardName: z.string().nullable(),
  at: z.string(),
});
export type PointsEntry = z.infer<typeof zPointsEntry>;

export const zPointsSummary = z.object({
  wallet: zAddress,
  balance: z.string().regex(/^\d+$/),
  lifetimeEarned: z.string().regex(/^\d+$/),
  lifetimeRedeemed: z.string().regex(/^\d+$/),
  /** "chain" when read from PayKitPoints, "ledger" when from the API's own records. */
  source: z.enum(["chain", "ledger"]),
  history: z.array(zPointsEntry),
});
export type PointsSummary = z.infer<typeof zPointsSummary>;

export const zPointsBalance = z.object({ wallet: zAddress, balance: z.string().regex(/^\d+$/), source: z.enum(["chain", "ledger"]) });
export type PointsBalance = z.infer<typeof zPointsBalance>;

/** The merchant's own view: `available` is false until the API runs PaymentRouterV2 with PayKitPoints. */
export const zMerchantLoyalty = zLoyaltyProgram.extend({ available: z.boolean() });
export type MerchantLoyalty = z.infer<typeof zMerchantLoyalty>;
