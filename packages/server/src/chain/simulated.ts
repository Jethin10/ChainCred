import { getAddress, keccak256, stringToBytes, type Address, type Hex } from "viem";
import type { ChainAdapter } from "./types.ts";

/**
 * A fake chain for the mock API and tests. Transactions "mine" after `stepMs` and become
 * safe after 2×, final after 3×. Nothing is sent anywhere.
 */
export function createSimulatedChain(options: { stepMs?: number } = {}): ChainAdapter & { blocks: Map<bigint, number> } {
  const stepMs = options.stepMs ?? 1200;
  let block = 12_300_000n;
  let n = 0;
  const minedAt = new Map<bigint, number>();
  const pending = new Map<Hex, bigint>();
  const ownerNonces = new Map<string, bigint>();
  const permitNonces = new Map<string, bigint>();
  const committed = new Map<string, bigint>();
  const bump = (m: Map<string, bigint>, a: Address) => m.set(getAddress(a), (m.get(getAddress(a)) ?? 0n) + 1n);

  const send = async (label: string): Promise<Hex> => {
    const hash = keccak256(stringToBytes(`${label}:${++n}:${Math.random()}`));
    pending.set(hash, ++block);
    return hash;
  };

  return {
    blocks: minedAt,
    pay: () => send("pay"),
    refund: () => send("refund"),
    async createPlan({ terms }) {
      bump(permitNonces, terms.payer);
      const total = terms.downPayment + terms.installmentAmount * BigInt(terms.count);
      committed.set(getAddress(terms.payer), (committed.get(getAddress(terms.payer)) ?? 0n) + total - terms.downPayment);
      return send("plan");
    },
    collectInstallment: () => send("collect"),
    cancelPlan: () => send("cancel"),
    async registerMerchant({ message }) {
      bump(ownerNonces, message.owner);
      return send("register");
    },
    async registryAction({ request }) {
      void request;
      return send("registry");
    },
    attestDomain: () => send("attest"),
    executePayoutChange: () => send("payout"),
    markDelinquent: () => send("delinquent"),
    async waitForReceipt(hash) {
      const bn = pending.get(hash);
      if (bn === undefined) return { success: false, blockNumber: 0n, error: "Unknown transaction" };
      await new Promise((r) => setTimeout(r, stepMs));
      minedAt.set(bn, Date.now());
      return { success: true, blockNumber: bn };
    },
    async finality(bn) {
      const at = minedAt.get(bn) ?? Date.now();
      const age = Date.now() - at;
      return age >= stepMs * 2 ? "finalized" : age >= stepMs ? "safe" : "included";
    },
    ownerNonce: async (owner) => ownerNonces.get(getAddress(owner)) ?? 0n,
    permitNonce: async (owner) => permitNonces.get(getAddress(owner)) ?? 0n,
    committed: async (payer) => committed.get(getAddress(payer)) ?? 0n,
    sponsorship: async () => ({ ok: true, reason: null }),
  };
}
