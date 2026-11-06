import { merchantIdFor, rewardIdFor, type Merchant, type NetworkConfig } from "@paykit/core";
import type { Address } from "viem";
import type { PayKitDb } from "./api.ts";

/** Demo shops and products (mock and local demos only). */
export function seedDemo(db: PayKitDb, owner: Address, network: NetworkConfig): void {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const merchant = (slug: string, name: string, category: string, nonce: bigint): Merchant => ({
    slug,
    merchantId: merchantIdFor(network.chain.id, owner, nonce),
    name,
    category,
    description: `${name} accepts USDT on Whitechain. No gas needed.`,
    logoUrl: null,
    website: `https://${slug}.example`,
    owner,
    payout: owner,
    status: "active",
    verifiedDomains: [{ domain: `${slug}.example`, verifiedAt: iso(now - 86_400_000), expiresAt: iso(now + 29 * 86_400_000) }],
    listed: true,
    acceptedTokens: ["USDT"],
    createdAt: iso(now - 7 * 86_400_000),
  });
  db.merchants.push(merchant("chai-co", "Mumbai Chai Co.", "Food & drink", 0n), merchant("pixel-studio", "Pixel Studio", "Design", 1n), merchant("byte-books", "Byte Books", "Books", 2n));
  const products: Array<[string, string, string]> = [
    ["chai-co", "Masala chai", "2500000"],
    ["chai-co", "Vada pav", "3000000"],
    ["chai-co", "Chai subscription box", "45000000"],
    ["pixel-studio", "Logo design", "150000000"],
    ["pixel-studio", "Website build", "1000000000"],
    ["byte-books", "Solidity handbook", "19990000"],
  ];
  // Loyalty: Mumbai Chai Co. gives 10 points per USDT; 25 points buys 1 USDT off.
  // Points are only ever minted by real (simulated) payments: pay first, then redeem.
  const chai = (name: string) => rewardIdFor("chai-co", name.toLowerCase());
  db.loyalty = {
    "chai-co": {
      enabled: true,
      pointsPerUsdt: 10,
      rewards: [
        { id: chai("1 USDT off"), name: "1 USDT off", pointsCost: "25", discount: "1000000", active: true },
        { id: chai("Free masala chai"), name: "Free masala chai", pointsCost: "60", discount: "2500000", active: true },
      ],
    },
    "byte-books": { enabled: true, pointsPerUsdt: 5, rewards: [{ id: rewardIdFor("byte-books", "2 usdt off"), name: "2 USDT off", pointsCost: "40", discount: "2000000", active: true }] },
  };
  for (const [merchantSlug, name, price] of products) {
    db.products.push({ id: `prod_${++db.counter}`, merchantSlug, sku: null, name, description: null, imageUrl: null, price, token: "USDT", active: true });
  }
}
