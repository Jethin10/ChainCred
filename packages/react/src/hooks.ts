"use client";

import {
  type CheckoutInput,
  type CheckoutSession,
  type LoyaltyProgram,
  type LoyaltyProgramUpdate,
  type MerchantLoyalty,
  type PointsSummary,
  type DomainChallenge,
  type Invoice,
  type Merchant,
  type MerchantSignupInput,
  type MerchantStats,
  type Payment,
  type PaymentStatus,
  type Plan,
  type PlanOption,
  type Product,
  type Refund,
  type WalletSigner,
} from "@paykit/js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { usePayKit } from "./context.tsx";

// ---------- tiny data-fetching hook ----------

export interface QueryState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  refetch(): void;
}

/**
 * Runs `fn` when `key` changes (null = skip) and whenever data is invalidated.
 * `refetchMs` keeps it fresh while mounted.
 */
export function useQuery<T>(key: string | null, fn: () => Promise<T>, options: { refetchMs?: number } = {}): QueryState<T> {
  const { version } = usePayKit();
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean; key: string | null }>({ key, data: undefined, error: undefined, loading: key !== null });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (key === null) {
      setState({ key, data: undefined, error: undefined, loading: false });
      return;
    }
    let live = true;
    setState((previous) => ({ key, data: previous.key === key ? previous.data : undefined, error: undefined, loading: true }));
    fnRef.current().then(
      (data) => live && setState({ key, data, error: undefined, loading: false }),
      (error: unknown) => live && setState((s) => ({ key, data: s.key === key ? s.data : undefined, error, loading: false })),
    );
    return () => {
      live = false;
    };
  }, [key, version, tick]);

  useEffect(() => {
    if (!options.refetchMs || key === null) return;
    const id = setInterval(() => setTick((t) => t + 1), options.refetchMs);
    return () => clearInterval(id);
  }, [options.refetchMs, key]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  return { data: state.key === key ? state.data : undefined, error: state.key === key ? state.error : undefined, loading: state.key !== key ? key !== null : state.loading, refetch };
}

// ---------- wallet ----------

export function useWallet() {
  const { wallet, connect, disconnect, switchNetwork, chain } = usePayKit();
  return { ...wallet, connect, disconnect, switchNetwork, chain };
}

export function useAuth() {
  const { session, login, logout, wallet } = usePayKit();
  return { session, signedIn: !!session, login, logout, wallet };
}

// ---------- shops ----------

export function useMerchants(filter: { q?: string; category?: string } = {}) {
  const { client } = usePayKit();
  return useQuery(`merchants:${filter.q ?? ""}:${filter.category ?? ""}`, () => client.merchants.list(filter).then((p) => p.data));
}

export function useMerchant(slug: string | null) {
  const { client } = usePayKit();
  return useQuery<Merchant>(slug ? `merchant:${slug}` : null, () => client.merchants.get(slug!));
}

export function useProducts(slug: string | null) {
  const { client } = usePayKit();
  return useQuery<Product[]>(slug ? `products:${slug}` : null, () => client.merchants.products(slug!));
}

export function useCart(merchantSlug: string) {
  const { cart } = usePayKit();
  return {
    lines: cart.lines(merchantSlug),
    total: cart.total(merchantSlug),
    count: cart.count(merchantSlug),
    items: cart.items(merchantSlug),
    add: cart.add,
    setQuantity: (productId: string, quantity: number) => cart.setQuantity(merchantSlug, productId, quantity),
    clear: () => cart.clear(merchantSlug),
  };
}

export function useSponsorshipStatus() {
  const { client } = usePayKit();
  return useQuery("status", () => client.status(), { refetchMs: 60_000 });
}

// ---------- paying ----------

/** idle → connecting → signing → processing → done (or error). */
export type CheckoutPhase = "idle" | "connecting" | "signing" | "processing" | "done" | "error";

const PROCESSING: PaymentStatus[] = ["queued", "submitted"];

export function useCheckout() {
  const { client, connect, invalidate } = usePayKit();
  const [phase, setPhase] = useState<CheckoutPhase>("idle");
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState<unknown>(null);

  const pay = useCallback(
    async (input: CheckoutInput, options: { refundTo?: Address; until?: "included" | "safe" | "finalized"; expectedAmount?: string | bigint } = {}) => {
      setError(null);
      setPayment(null);
      try {
        setPhase("connecting");
        const signer = await connect();
        setPhase("signing");
        const payer = await signer.getAddress();
        const session = await client.checkout.createSession(input, { payer });
        const queued = await client.checkout.authorize(session, signer, options);
        setPayment(queued);
        setPhase("processing");
        const final = await client.payments.wait(queued.paymentId, {
          until: options.until ?? "included",
          onUpdate: (p) => setPayment(p),
        });
        setPayment(final);
        setPhase("done");
        invalidate();
        return final;
      } catch (e) {
        setError(e);
        setPhase("error");
        throw e;
      }
    },
    [client, connect, invalidate],
  );

  const reset = useCallback(() => {
    setPhase("idle");
    setPayment(null);
    setError(null);
  }, []);

  return { pay, phase, payment, error, reset, busy: phase === "connecting" || phase === "signing" || phase === "processing" };
}

/** Follows one payment until it is final (or failed). */
export function usePayment(paymentId: string | null) {
  const { client } = usePayKit();
  const [finishedId, setFinishedId] = useState<string | null>(null);
  const done = finishedId === paymentId;
  const q = useQuery<Payment>(paymentId ? `payment:${paymentId}` : null, () => client.payments.get(paymentId!), { refetchMs: done ? undefined : 2_000 });
  useEffect(() => {
    const s = q.data?.status;
    if (s === "finalized" || s === "failed" || s === "expired") setFinishedId(paymentId);
  }, [q.data?.status, paymentId]);
  return q;
}

export function isProcessing(status: PaymentStatus): boolean {
  return PROCESSING.includes(status);
}

export function useInvoice(id: string | null) {
  const { client } = usePayKit();
  return useQuery<Invoice>(id ? `invoice:${id}` : null, () => client.invoices.get(id!));
}

export function usePlanCheckout() {
  const { client, connect, invalidate } = usePayKit();
  const [phase, setPhase] = useState<CheckoutPhase>("idle");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<unknown>(null);

  const start = useCallback(
    async (input: CheckoutInput, option: PlanOption, expectedAmount?: string | bigint) => {
      setError(null);
      try {
        setPhase("connecting");
        const signer = await connect();
        setPhase("signing");
        const session = await client.plans.createSession(input, option, await signer.getAddress());
        let created = await client.plans.authorize(session, signer, { expectedAmount, option });
        setPlan(created);
        if (created.status === "pending") { setPhase("processing"); created = await client.plans.wait(created.planId); setPlan(created); }
        setPhase("done");
        invalidate();
        return created;
      } catch (e) {
        setError(e);
        setPhase("error");
        throw e;
      }
    },
    [client, connect, invalidate],
  );
  return { start, phase, plan, error, busy: phase === "connecting" || phase === "signing" || phase === "processing", reset: () => setPhase("idle") };
}

// ---------- user dashboard ----------

function useSessionKey(base: string): string | null {
  const { session } = usePayKit();
  return session ? `${base}:${session.address}` : null;
}

export function useMyPayments(status: "pending" | "settled" | "all" = "all") {
  const { client } = usePayKit();
  return useQuery<Payment[]>(useSessionKey(`me-payments:${status}`), () => client.me.payments({ status }).then((p) => p.data), { refetchMs: 10_000 });
}

export function useMyPlans() {
  const { client } = usePayKit();
  return useQuery<Plan[]>(useSessionKey("me-plans"), () => client.me.plans().then((p) => p.data));
}

export function useMyRefunds() {
  const { client } = usePayKit();
  return useQuery<Refund[]>(useSessionKey("me-refunds"), () => client.me.refunds().then((p) => p.data));
}

/** The signed-in wallet's universal PayKit points and history. */
export function usePoints() {
  const { client } = usePayKit();
  return useQuery<PointsSummary>(useSessionKey("me-points"), () => client.me.points(), { refetchMs: 10_000 });
}

/** A shop's loyalty program (earn rate and rewards). */
export function useLoyaltyProgram(slug: string | null) {
  const { client } = usePayKit();
  return useQuery<LoyaltyProgram>(slug ? `loyalty:${slug}` : null, () => client.merchants.loyalty(slug!));
}

/**
 * Points rewards for one checkout session: the connected wallet's balance, the shop's rewards,
 * and `apply(rewardId | null)`, which re-quotes the session. Pay the returned `session.quote.gross`.
 */
export function useCheckoutRewards(sessionId: string) {
  const { client, wallet, connect, invalidate } = usePayKit();
  const base = useQuery<CheckoutSession>(`checkout-session:${sessionId}`, () => client.checkout.getSession(sessionId));
  const [override, setOverride] = useState<CheckoutSession | null>(null);
  const session = override ?? base.data ?? null;
  const program = useLoyaltyProgram(session?.merchant.slug ?? null);
  const address = wallet.address ?? null;
  const balance = useQuery<bigint>(address ? `points-of:${address}` : null, () => client.merchants.points(address as Address).then((b) => BigInt(b.balance)), { refetchMs: 15_000 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const apply = useCallback(
    async (rewardId: Hex | null) => {
      setBusy(true);
      setError(null);
      try {
        const signer = await connect();
        const next = await client.checkout.applyReward(sessionId, rewardId, await signer.getAddress());
        setOverride(next);
        invalidate();
        return next;
      } catch (e) {
        setError(e);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [client, connect, invalidate, sessionId],
  );
  return { session, program: program.data ?? null, balance: balance.data ?? null, apply, busy, error, loading: base.loading };
}

export function useCancelPlan() {
  const { client, connect, invalidate } = usePayKit();
  return useCallback(
    async (planId: string) => {
      const signer = await connect();
      let plan = await client.plans.cancel(planId as Hex, signer);
      if (plan.status !== "cancelled" && plan.status !== "completed") plan = await client.plans.wait(planId, { until: "cancelled" });
      invalidate();
      return plan;
    },
    [client, connect, invalidate],
  );
}

// ---------- merchant dashboard ----------

function useMerchantKey(base: string): string | null {
  const { session, merchantViaBackend } = usePayKit();
  if (merchantViaBackend) return base;
  return session ? `${base}:${session.address}:${session.merchantSlug ?? "-"}` : null;
}

/** The signed-in merchant. `data === null` means this wallet hasn't signed up yet. */
export function useMerchantAccount() {
  const { client, connect, invalidate } = usePayKit();
  const q = useQuery<Merchant | null>(useMerchantKey("merchant-me"), () => client.merchant.get());
  const signup = useCallback(
    async (input: MerchantSignupInput, options: { payoutSigner?: WalletSigner } = {}) => {
      const owner = await connect();
      const merchant = await client.merchant.signup(input, owner, options);
      invalidate();
      return merchant;
    },
    [client, connect, invalidate],
  );
  return { ...q, signup };
}

/** The merchant's loyalty program, with `save(update)`. */
export function useMerchantLoyalty() {
  const { client, invalidate } = usePayKit();
  const q = useQuery<MerchantLoyalty>(useMerchantKey("merchant-loyalty"), () => client.merchant.loyalty.get());
  const save = useCallback(
    async (update: LoyaltyProgramUpdate) => {
      const next = await client.merchant.loyalty.update(update);
      invalidate();
      return next;
    },
    [client, invalidate],
  );
  return { ...q, save };
}

export function useMerchantStats() {
  const { client } = usePayKit();
  return useQuery<MerchantStats>(useMerchantKey("merchant-stats"), () => client.merchant.stats(), { refetchMs: 15_000 });
}

export function useMerchantPayments(status: "pending" | "settled" | "all" = "all") {
  const { client } = usePayKit();
  return useQuery<Payment[]>(useMerchantKey(`merchant-payments:${status}`), () => client.merchant.payments({ status }).then((p) => p.data), { refetchMs: 10_000 });
}

export function useMerchantPlans() {
  const { client } = usePayKit();
  return useQuery<Plan[]>(useMerchantKey("merchant-plans"), () => client.merchant.plans().then((p) => p.data));
}

export function useMerchantRefunds() {
  const { client } = usePayKit();
  return useQuery<Refund[]>(useMerchantKey("merchant-refunds"), () => client.merchant.refunds().then((p) => p.data), { refetchMs: 10_000 });
}

export function useRefund(signers: { merchant?: WalletSigner; funder?: WalletSigner } = {}) {
  const { client, connect, invalidate } = usePayKit();
  const [busy, setBusy] = useState(false);
  const refund = useCallback(
    async (paymentId: string, amount: bigint, reason?: string) => {
      setBusy(true);
      try {
        const merchant = signers.merchant ?? await connect();
        const r = await client.merchant.refund(paymentId, amount, { merchant, funder: signers.funder }, { reason });
        invalidate();
        return r;
      } finally {
        setBusy(false);
      }
    },
    [client, connect, invalidate, signers.merchant, signers.funder],
  );
  return { refund, busy };
}

export function useMerchantInvoices() {
  const { client } = usePayKit();
  return useQuery<Invoice[]>(useMerchantKey("merchant-invoices"), () => client.merchant.invoices().then((p) => p.data));
}

export function useMerchantProducts() {
  const { client } = usePayKit();
  return useQuery<Product[]>(useMerchantKey("merchant-products"), () => client.merchant.products.list());
}

export function useMerchantDomains() {
  const { client } = usePayKit();
  return useQuery<DomainChallenge[]>(useMerchantKey("merchant-domains"), () => client.merchant.domains.list());
}
