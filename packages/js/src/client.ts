import {
  cancelPlanTypedData,
  createHttpClient,
  hashPlanTerms,
  installmentSplit,
  nowSeconds,
  PayKitError,
  payNonce,
  permitTypedData,
  planConsentTypedData,
  randomBytes32,
  receiveWithAuthorizationTypedData,
  refundNonce,
  refundTermsTypedData,
  queuePayoutTypedData,
  registerMerchantTypedData,
  requireContract,
  setSignerTypedData,
  setSplitProfileTypedData,
  splitHash,
  wellKnownSigningText,
  zMerchantSigner,
  zRegistryActionRequest,
  zRegistryActionResult,
  zSplitProfile,
  resolveNetwork,
  routes,
  toBigInt,
  zApiKey,
  zCheckoutSession,
  zDomainChallenge,
  zInvoice,
  zMerchant,
  zMerchantSignupInput,
  zMerchantStats,
  zLoyaltyProgram,
  zMerchantLoyalty,
  zPointsSummary,
  zPointsBalance,
  type PointsBalance,
  type LoyaltyProgram,
  type LoyaltyProgramUpdate,
  type PointsSummary,
  zPage,
  zPayment,
  zPlan,
  zPlanSession,
  zPlatformStatus,
  zProduct,
  zPublicConfig,
  zRefund,
  zRefundSigningRequest,
  zRegistrationRequest,
  zWebhookEndpoint,
  type ApiKey,
  type CartItem,
  type CheckoutSession,
  type DomainChallenge,
  type FetchLike,
  type HttpClient,
  type Invoice,
  type LineItem,
  type Merchant,
  type MerchantSignupInput,
  type MerchantSigner,
  type RegistryActionRequest,
  type RegistryActionResult,
  type SplitProfile,
  type MerchantStats,
  type NetworkConfig,
  type NetworkKey,
  type Page,
  type PayKitContracts,
  type Payment,
  type PaymentStatus,
  type Plan,
  type PlanOption,
  type PlanSession,
  type PlatformStatus,
  type Product,
  type PublicConfig,
  type Query,
  type Refund,
  type WebhookEndpoint,
} from "@paykit/core";
import { getAddress, isAddressEqual, type Address, type Hex } from "viem";
import { createSiweMessage } from "viem/siwe";
import type { z } from "zod";
import { ensureChain, type WalletSigner } from "./signer.ts";
import { verifyCheckoutSession, verifyPlanSession, verifyRefundRequest } from "./verify.ts";

export interface PayKitClientOptions {
  /** API base URL, e.g. "https://api.paykit.app" (no /v1). */
  baseUrl: string;
  /** Publishable key (pk_…). Never pass a secret key (sk_…) to the browser client. */
  publishableKey?: string;
  network?: NetworkKey;
  /** Deployed contract addresses. If omitted they are loaded from GET /v1/config. */
  contracts?: PayKitContracts;
  /** Restore a wallet session token (from a previous `auth.login`). */
  sessionToken?: string;
  /**
   * On a developer's own site, merchant dashboard calls go through the developer's
   * backend (which holds the secret key) instead of a wallet session, e.g. "/api/paykit".
   */
  merchantDataUrl?: string;
  fetch?: FetchLike;
  credentials?: RequestCredentials;
  timeoutMs?: number;
  /** SIWE domain/origin. Defaults to window.location in browsers. */
  siwe?: { domain: string; uri: string };
}

export interface WalletSession {
  token: string;
  address: Address;
  expiresAt: string;
  /** Set when this wallet owns a registered merchant. */
  merchantSlug: string | null;
}

/** What to pay: a cart (priced by the server) or the next part of an invoice. */
export type CheckoutInput = { merchant: string; items: CartItem[]; splitProfileId?: number } | { invoiceId: string } | { sessionId: string };

export interface CheckoutOptions {
  refundTo?: Address;
  /** The amount shown to the customer, in base units. Changes require a fresh approval. */
  expectedAmount?: string | bigint;
  idempotencyKey?: string;
}

export interface WaitOptions {
  /** Resolve once the payment reaches this status. Default "included". */
  until?: "included" | "safe" | "finalized";
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
  onUpdate?: (payment: Payment) => void;
}

const STATUS_RANK: Record<PaymentStatus, number> = {
  awaiting_signature: 0,
  queued: 1,
  submitted: 2,
  included: 3,
  safe: 4,
  finalized: 5,
  failed: -1,
  expired: -1,
};

/** Seconds a payer authorization stays valid at most (bounded by the quote). */
export const AUTHORIZATION_LIFETIME_SECONDS = 30n * 60n;

function parse<T extends z.ZodType>(schema: T, value: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new PayKitError("server_error", `Unexpected ${what} from the PayKit API`, { details: result.error.issues });
  }
  return result.data;
}

/**
 * Browser client. Every method that moves money verifies what the server sent,
 * asks the wallet for a gasless signature, and hands it to the relay node.
 */

export class PayKitClient {
  readonly options: PayKitClientOptions;
  private readonly http: HttpClient;
  private readonly merchantHttp: HttpClient;
  private session: WalletSession | null = null;
  private configPromise: Promise<PublicConfig> | null = null;
  private networkPromise: Promise<NetworkConfig> | null = null;

  constructor(options: PayKitClientOptions) {
    if (options.publishableKey?.startsWith("sk_")) {
      throw new PayKitError("config_invalid", "A secret key (sk_…) must never be used in the browser. Use the publishable key (pk_…).");
    }
    this.options = options;
    if (options.sessionToken) {
      this.session = { token: options.sessionToken, address: "0x0000000000000000000000000000000000000000", expiresAt: "", merchantSlug: null };
    }
    const shared = { fetch: options.fetch, credentials: options.credentials, timeoutMs: options.timeoutMs };
    this.http = createHttpClient({ ...shared, baseUrl: options.baseUrl, headers: () => this.headers() });
    this.merchantHttp = options.merchantDataUrl
      ? createHttpClient({ ...shared, baseUrl: absoluteUrl(options.merchantDataUrl), headers: () => ({}) })
      : this.http;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.options.publishableKey) h["x-paykit-key"] = this.options.publishableKey;
    if (this.session) h.authorization = `Bearer ${this.session.token}`;
    return h;
  }

  // ---------- config ----------

  /** Public config (deployed addresses, fee schedule). Cached. */
  getConfig(): Promise<PublicConfig> {
    this.configPromise ??= this.http.get(routes.config()).then((v) => parse(zPublicConfig, v, "config"));
    this.configPromise.catch(() => (this.configPromise = null));
    return this.configPromise;
  }

  /** Network config with contract addresses resolved. */
  getNetwork(): Promise<NetworkConfig> {
    this.networkPromise ??= (async () => {
      const key = this.options.network ?? "whitechain-testnet";
      const given = this.options.contracts;
      if (given?.router && given.registry) return resolveNetwork(key, given);
      const config = await this.getConfig();
      if (config.chainId !== resolveNetwork(key).chain.id) {
        throw new PayKitError("config_invalid", `The API serves chain ${config.chainId}, but the client is set to ${key}`);
      }
      return resolveNetwork(key, { ...config.contracts, ...given });
    })();
    this.networkPromise.catch(() => (this.networkPromise = null));
    return this.networkPromise;
  }

  status = async (): Promise<PlatformStatus> => parse(zPlatformStatus, await this.http.get(routes.status()), "status");

  // ---------- shops ----------

  merchants = {
    /** Verified merchants for the shops page. */
    list: async (query: { q?: string; category?: string; cursor?: string; limit?: number } = {}): Promise<Page<Merchant>> =>
      parse(zPage(zMerchant), await this.http.get(routes.directory(), { query }), "merchant list"),
    get: async (slug: string): Promise<Merchant> => parse(zMerchant, await this.http.get(routes.merchant(slug)), "merchant"),
    products: async (slug: string): Promise<Product[]> =>
      parse(zPage(zProduct), await this.http.get(routes.merchantProducts(slug)), "products").data,
    /** Any wallet's PayKit points balance (public, like the onchain token balance). */
    points: async (address: Address): Promise<PointsBalance> => parse(zPointsBalance, await this.http.get(routes.pointsOf(address)), "points balance"),
    /** The shop's loyalty program: earn rate and the rewards points can buy. */
    loyalty: async (slug: string): Promise<LoyaltyProgram> => parse(zLoyaltyProgram, await this.http.get(routes.merchantLoyalty(slug)), "loyalty program"),
  };

  invoices = {
    /** Public view of an invoice sent as a link (/pay/:invoiceId). */
    get: async (id: string): Promise<Invoice> => parse(zInvoice, await this.http.get(routes.invoicePublic(id)), "invoice"),
  };

  // ---------- pay now / pay in parts ----------

  checkout = {
    /** Creates a session for a cart or for the next part of an invoice. */
    createSession: async (input: CheckoutInput, options: { payer?: Address; idempotencyKey?: string } = {}): Promise<CheckoutSession> => {
      const session = "sessionId" in input ? await this.checkout.getSession(input.sessionId) : parse(zCheckoutSession, await this.http.post(routes.checkoutSessions(), { ...input, payer: options.payer }, { idempotencyKey: options.idempotencyKey }), "checkout session");
      if (("invoiceId" in input && session.invoice.id !== input.invoiceId) || ("merchant" in input && session.merchant.slug !== input.merchant)) throw new PayKitError("quote_mismatch", "Checkout identity differs from your request");
      if ("items" in input) {
        const aggregate = (items: Array<{ productId?: string | null; quantity: number }>) => {
          const totals = new Map<string, number>();
          for (const item of items) totals.set(item.productId ?? "", (totals.get(item.productId ?? "") ?? 0) + item.quantity);
          return JSON.stringify([...totals].sort(([a], [b]) => a.localeCompare(b)));
        };
        if (aggregate(input.items) !== aggregate(session.invoice.lineItems)) throw new PayKitError("quote_mismatch", "Checkout items differ from your cart");
      }
      return session;
    },

    getSession: async (id: string): Promise<CheckoutSession> =>
      parse(zCheckoutSession, await this.http.get(routes.checkoutSession(id)), "checkout session"),

    /**
     * Spends points on a reward (or removes it with `rewardId: null`). The server re-signs the quote
     * with the discount; the new `quote.gross` is what the customer pays. Needs PaymentRouterV2.
     */
    applyReward: async (sessionId: string, rewardId: Hex | null, payer: Address): Promise<CheckoutSession> =>
      parse(zCheckoutSession, await this.http.post(routes.checkoutReward(sessionId), { rewardId, payer }), "checkout session"),

    /**
     * Verifies the session, asks the wallet for one gasless USDT authorization and
     * submits it. Returns the payment (status "queued"); use `payments.wait` to follow it.
     */
    authorize: async (session: CheckoutSession, signer: WalletSigner, options: CheckoutOptions = {}): Promise<Payment> => {
      const network = await this.getNetwork();
      const payer = await signer.getAddress();
      if (options.expectedAmount !== undefined && BigInt(session.quote.gross) !== toBigInt(options.expectedAmount)) throw new PayKitError("quote_mismatch", "The payment amount changed. Review the updated price before paying.");
      try {
        const existing = await this.payments.get(session.quote.paymentId);
        if (!isAddressEqual(existing.payer, payer)) throw new PayKitError("forbidden", "This checkout was already authorized by another wallet");
        return existing;
      } catch (error) { if (!(error instanceof PayKitError) || error.code !== "not_found") throw error; }
      const { quote } = await verifyCheckoutSession(network, session, payer);
      if (options.expectedAmount !== undefined && quote.gross !== toBigInt(options.expectedAmount)) throw new PayKitError("quote_mismatch", "The payment amount changed. Review the updated price before paying.");
      const refundTo = getAddress(options.refundTo ?? payer);
      const salt = randomBytes32();
      const nonce = payNonce(session.quote.quoteHash as Hex, refundTo, salt);
      const latest = nowSeconds() + AUTHORIZATION_LIFETIME_SECONDS;
      const validBefore = quote.validUntil < latest ? quote.validUntil : latest;
      await ensureChain(signer, network.chain);
      const signature = await signer.signTypedData(
        receiveWithAuthorizationTypedData(network, {
          from: payer,
          to: requireContract(network, "router"),
          value: quote.gross,
          validAfter: 0n,
          validBefore,
          nonce,
        }),
      );
      const body = { payer, refundTo, salt, validAfter: "0", validBefore: validBefore.toString(), signature };
      return parse(zPayment, await this.http.post(routes.checkoutAuthorize(session.id), body), "payment");
    },

    /** createSession + authorize (+ wait, if `wait` is given). */
    pay: async (
      input: CheckoutInput,
      signer: WalletSigner,
      options: CheckoutOptions & { wait?: WaitOptions | true } = {},
    ): Promise<{ session: CheckoutSession; payment: Payment }> => {
      const payer = await signer.getAddress();
      const session = await this.checkout.createSession(input, { payer, idempotencyKey: options.idempotencyKey });
      let payment = await this.checkout.authorize(session, signer, options);
      if (options.wait) payment = await this.payments.wait(payment.paymentId, options.wait === true ? {} : options.wait);
      return { session, payment };
    },
  };

  payments = {
    get: async (paymentId: string): Promise<Payment> => parse(zPayment, await this.http.get(routes.payment(paymentId)), "payment"),

    /** Polls until the payment reaches `until`, fails, or times out. */
    wait: async (paymentId: string, options: WaitOptions = {}): Promise<Payment> => {
      const target = STATUS_RANK[options.until ?? "included"];
      const deadline = Date.now() + (options.timeoutMs ?? 120_000);
      const interval = options.intervalMs ?? 1_500;
      let last: string | undefined;
      for (;;) {
        if (options.signal?.aborted) throw options.signal.reason ?? new Error("Aborted");
        const payment = await this.payments.get(paymentId);
        if (payment.status !== last) {
          last = payment.status;
          options.onUpdate?.(payment);
        }
        const rank = STATUS_RANK[payment.status];
        if (rank < 0) {
          const code = payment.error?.code;
          throw new PayKitError(
            code === "quote_expired" || code === "insufficient_usdt" || code === "already_settled" ? code : "server_error",
            payment.error?.message ?? `Payment ${payment.status}`,
            { details: payment },
          );
        }
        if (rank >= target) return payment;
        if (Date.now() + interval > deadline) {
          throw new PayKitError("timeout", "The payment is still processing. Check its status again shortly.", { details: payment });
        }
        await sleep(interval, options.signal);
      }
    },
  };

  // ---------- installments ----------

  plans = {
    get: async (id: string): Promise<Plan> => parse(zPlan, await this.http.get(routes.plan(id)), "plan"),
    wait: async (id: string, options: { until?: "active" | "cancelled"; timeoutMs?: number; intervalMs?: number } = {}): Promise<Plan> => {
      const deadline = Date.now() + (options.timeoutMs ?? 120000);
      for (;;) {
        const plan = await this.plans.get(id);
        if (plan.status === (options.until ?? "active") || (options.until !== "cancelled" && plan.status === "completed")) return plan;
        if (plan.status === "cancelled" && options.until !== "cancelled") throw new PayKitError("server_error", "Plan creation failed or was cancelled", { details: plan });
        if (Date.now() >= deadline) throw new PayKitError("timeout", "Plan is still being reconciled; resume with its planId", { details: plan });
        await sleep(options.intervalMs ?? 1500);
      }
    },
    /** Plan offer for a cart or invoice. The payer must be known: the plan is bound to it. */
    createSession: async (input: CheckoutInput, option: PlanOption, payer: Address): Promise<PlanSession> => {
      const session = parse(zPlanSession, await this.http.post(routes.planSessions(), { ...input, option, payer: getAddress(payer) }), "plan session");
      if (("invoiceId" in input && input.invoiceId !== session.invoice.id) || ("merchant" in input && input.merchant !== session.merchant.slug)) throw new PayKitError("quote_mismatch", "Plan identity differs from your request");
      if (session.terms.count !== option.count || session.terms.period !== option.periodSeconds || (option.graceSeconds !== undefined && session.terms.grace !== option.graceSeconds)) throw new PayKitError("quote_mismatch", "Plan schedule differs from your request");
      return session;
    },

    /**
     * Two gasless signatures: consent to the plan terms, and a USDT permit letting the
     * router collect up to (already committed + this plan's total) on schedule.
     */
    authorize: async (session: PlanSession, signer: WalletSigner, options: { expectedAmount?: string | bigint; option?: PlanOption } = {}): Promise<Plan> => {
      const network = await this.getNetwork();
      const payer = await signer.getAddress();
      const terms = verifyPlanSession(network, session, payer);
      if (options.expectedAmount !== undefined && terms.downPayment + terms.installmentAmount * BigInt(terms.count) !== toBigInt(options.expectedAmount)) throw new PayKitError("quote_mismatch", "The plan amount changed; review the updated price");
      if (options.option) {
        const expected = installmentSplit(terms.downPayment + terms.installmentAmount * BigInt(terms.count), options.option.count, options.option.downPaymentPercent ?? 0);
        if (terms.downPayment !== expected.downPayment || terms.installmentAmount !== expected.installmentAmount) throw new PayKitError("quote_mismatch", "The selected down payment differs from the plan");
      }
      if (options.option && (terms.count !== options.option.count || terms.period !== options.option.periodSeconds || (options.option.graceSeconds !== undefined && terms.grace !== options.option.graceSeconds))) throw new PayKitError("quote_mismatch", "The plan schedule changed");
      const total = terms.downPayment + terms.installmentAmount * BigInt(terms.count);
      const deadline = nowSeconds() + AUTHORIZATION_LIFETIME_SECONDS;
      const termsHash = hashPlanTerms(network, terms);
      await ensureChain(signer, network.chain);
      const consentSignature = await signer.signTypedData(planConsentTypedData(network, { termsHash, payer, deadline }));
      const permitValue = toBigInt(session.committed) + total;
      const permitSignature = await signer.signTypedData(
        permitTypedData(network, {
          owner: payer,
          spender: requireContract(network, "router"),
          value: permitValue,
          nonce: BigInt(session.permitNonce),
          deadline,
        }),
      );
      const body = { payer, consentSignature, permit: { value: permitValue.toString(), deadline: deadline.toString(), signature: permitSignature }, consentDeadline: deadline.toString() };
      return parse(zPlan, await this.http.post(routes.planAuthorize(session.id), body), "plan");
    },

    /** Consumer cancels a plan (gasless). Past installments stay refundable. */
    cancel: async (planId: Hex, signer: WalletSigner): Promise<Plan> => {
      const network = await this.getNetwork();
      const address = await signer.getAddress();
      const deadline = nowSeconds() + 600n;
      await ensureChain(signer, network.chain);
      const signature = await signer.signTypedData(cancelPlanTypedData(network, { planId, signer: address, deadline }));
      return parse(zPlan, await this.http.post(routes.planCancel(planId), { signer: address, deadline: deadline.toString(), signature }), "plan");
    },
  };

  // ---------- wallet login ----------

  auth = {
    /** Sign-In with Ethereum. Needed for the user dashboard and the merchant dashboard. */
    login: async (signer: WalletSigner, options: { statement?: string } = {}): Promise<WalletSession> => {
      const network = await this.getNetwork();
      const address = await signer.getAddress();
      const { nonce } = (await this.http.post(routes.siweNonce(), { address })) as { nonce: string };
      const origin = this.options.siwe ?? browserOrigin();
      const message = createSiweMessage({
        address,
        chainId: network.chain.id,
        domain: origin.domain,
        uri: origin.uri,
        nonce,
        version: "1",
        statement: options.statement ?? "Sign in to PayKit. This does not cost anything or move any funds.",
        issuedAt: new Date(),
        expirationTime: new Date(Date.now() + 10 * 60_000),
      });
      const signature = await signer.signMessage(message);
      const result = (await this.http.post(routes.siweVerify(), { message, signature })) as WalletSession;
      if (!result?.token || !isAddressEqual(result.address, address)) {
        throw new PayKitError("server_error", "Login response did not match the signing wallet");
      }
      this.session = { ...result, address: getAddress(result.address) };
      return this.session;
    },
    logout: async (): Promise<void> => {
      if (this.session) await this.http.post(routes.logout()).catch(() => undefined);
      this.session = null;
    },
    get: (): WalletSession | null => this.session,
    setToken: (token: string | null): void => {
      this.session = token ? { token, address: "0x0000000000000000000000000000000000000000", expiresAt: "", merchantSlug: null } : null;
    },
  };

  private requireSession(): void {
    if (!this.session) throw new PayKitError("unauthorized", "Sign in with your wallet first");
  }

  // ---------- user dashboard ----------

  me = {
    payments: async (query: { status?: "pending" | "settled" | "all"; cursor?: string; limit?: number } = {}): Promise<Page<Payment>> => {
      this.requireSession();
      return parse(zPage(zPayment), await this.http.get(routes.myPayments(), { query }), "payments");
    },
    plans: async (query: { status?: "active" | "all"; cursor?: string } = {}): Promise<Page<Plan>> => {
      this.requireSession();
      return parse(zPage(zPlan), await this.http.get(routes.myPlans(), { query }), "plans");
    },
    refunds: async (query: { cursor?: string } = {}): Promise<Page<Refund>> => {
      this.requireSession();
      return parse(zPage(zRefund), await this.http.get(routes.myRefunds(), { query }), "refunds");
    },
    /** Universal PayKit points: balance (from PayKitPoints when deployed) and history. */
    points: async (): Promise<PointsSummary> => {
      this.requireSession();
      return parse(zPointsSummary, await this.http.get(routes.myPoints()), "points");
    },
  };

  // ---------- merchant dashboard ----------

  private requireMerchantAccess(): void {
    if (!this.options.merchantDataUrl) this.requireSession();
  }

  private async mget<T extends z.ZodType>(schema: T, path: string, what: string, query?: Query): Promise<z.infer<T>> {
    this.requireMerchantAccess();
    return parse(schema, await this.merchantHttp.get(path, { query }), what);
  }

  private async mpost<T extends z.ZodType>(schema: T, path: string, body: unknown, what: string): Promise<z.infer<T>> {
    this.requireMerchantAccess();
    return parse(schema, await this.merchantHttp.post(path, body), what);
  }

  /** Asks the server to prepare a registry change, checks it, has the owner sign it, and submits. */
  private async registryAction(path: string, body: unknown, owner: WalletSigner, proofSigner?: WalletSigner): Promise<RegistryActionResult> {
    this.requireSession();
    const network = await this.getNetwork();
    const request: RegistryActionRequest = parse(zRegistryActionRequest, await this.http.post(path, body), "registry change");
    if (!isAddressEqual(request.registry, requireContract(network, "registry")) || request.chainId !== network.chain.id) {
      throw new PayKitError("quote_mismatch", "Unexpected registry contract");
    }
    const b = body as Record<string, unknown>;
    const base = { merchantId: request.merchantId as Hex, nonce: BigInt(request.nonce), deadline: BigInt(request.deadline) };
    let typed;
    let proof: Hex | null = null;
    if (request.action === "set_signer") {
      if (!isAddressEqual(request.signer, b.address as Address) || request.enabled !== b.enabled) throw new PayKitError("quote_mismatch", "Signer change differs from your request");
      typed = setSignerTypedData(network, { ...base, signer: getAddress(request.signer), expiresAt: BigInt(request.expiresAt), enabled: request.enabled });
    } else if (request.action === "set_split") {
      const wanted = b.recipients as Array<{ address: Address; bps: number }>;
      const same = wanted.length === request.recipients.length && wanted.every((r, i) => isAddressEqual(r.address, request.recipients[i]!) && r.bps === request.bps[i]);
      if (!same) throw new PayKitError("quote_mismatch", "Split differs from your request");
      const hash = splitHash(request.recipients.map((r) => getAddress(r)), request.bps);
      if (hash !== request.splitHash) throw new PayKitError("quote_mismatch", "Split hash differs");
      typed = setSplitProfileTypedData(network, { ...base, profileId: request.profileId, splitHash: hash });
    } else {
      if (!isAddressEqual(request.newPayout, b.newPayout as Address)) throw new PayKitError("quote_mismatch", "Payout change differs from your request");
      if (!proofSigner) throw new PayKitError("validation_failed", "The new payout wallet must sign");
      proof = await proofSigner.signMessage(request.payoutProofMessage);
      typed = queuePayoutTypedData(network, { ...base, newPayout: getAddress(request.newPayout) });
    }
    await ensureChain(owner, network.chain);
    const signature = await owner.signTypedData(typed);
    return parse(zRegistryActionResult, await this.http.post(routes.registryActionSignature(request.requestId), { signature, payoutProof: proof }), "registry change");
  }

  merchant = {
    /**
     * Registers the signed-in wallet as a merchant (gasless). The owner wallet signs the
     * registration; if the payout wallet differs, it signs a proof-of-control message too.
     */
    signup: async (
      input: MerchantSignupInput,
      owner: WalletSigner,
      options: { payoutSigner?: WalletSigner; /** Default true. Set false if you'll only sign with your own server key. */ authorizeHostedSigner?: boolean } = {},
    ): Promise<Merchant> => {
      this.requireSession();
      const details = zMerchantSignupInput.parse(input);
      const network = await this.getNetwork();
      const ownerAddress = await owner.getAddress();
      const request = parse(zRegistrationRequest, await this.http.post(routes.merchantSignup(), details), "registration");
      if (!isAddressEqual(request.owner, ownerAddress)) throw new PayKitError("quote_mismatch", "Registration is for a different owner wallet");
      if (!isAddressEqual(request.payout, details.payout)) throw new PayKitError("quote_mismatch", "Registration payout differs from what you entered");
      if (request.maxFeeBps !== details.maxFeeBps) throw new PayKitError("quote_mismatch", "Registration fee cap differs from what you entered");
      if (!isAddressEqual(request.registry, requireContract(network, "registry")) || request.chainId !== network.chain.id) {
        throw new PayKitError("quote_mismatch", "Unexpected registry contract");
      }
      let payoutProof: Hex | null = null;
      if (request.payoutProofMessage) {
        const payoutSigner = options.payoutSigner;
        if (!payoutSigner) throw new PayKitError("validation_failed", "The payout wallet must sign to prove you control it. Pass `payoutSigner`.");
        if (!isAddressEqual(await payoutSigner.getAddress(), request.payout)) {
          throw new PayKitError("validation_failed", "Connect the payout wallet to sign the proof");
        }
        payoutProof = await payoutSigner.signMessage(request.payoutProofMessage);
      }
      await ensureChain(owner, network.chain);
      const signature = await owner.signTypedData(
        registerMerchantTypedData(network, {
          owner: ownerAddress,
          payout: getAddress(request.payout),
          maxFeeBps: request.maxFeeBps,
          metadataHash: request.metadataHash as Hex,
          metadataURI: request.metadataURI,
          nonce: BigInt(request.nonce),
          deadline: BigInt(request.deadline),
        }),
      );
      const merchant = parse(zMerchant, await this.http.post(routes.merchantSignupSignature(request.draftId), { signature, payoutProof }), "merchant");
      if (this.session) this.session = { ...this.session, merchantSlug: merchant.slug };
      // Let PayKit sign payment offers for this shop (one more signature from the owner).
      if (request.hostedSigner && options.authorizeHostedSigner !== false) {
        await this.registryAction(routes.merchantSigners(), { address: getAddress(request.hostedSigner), enabled: true, expiresAt: null }, owner);
      }
      return merchant;
    },

    /** The signed-in merchant, or null if this wallet has not registered yet. */
    get: async (): Promise<Merchant | null> => {
      this.requireMerchantAccess();
      try {
        return parse(zMerchant, await this.merchantHttp.get(routes.myMerchant()), "merchant");
      } catch (error) {
        if (error instanceof PayKitError && error.code === "not_found") return null;
        throw error;
      }
    },
    stats: (query: { from?: string; to?: string } = {}): Promise<MerchantStats> => this.mget(zMerchantStats, routes.merchantStats(), "stats", query),
    loyalty: {
      /** Your loyalty program. `available` is false until the API runs PaymentRouterV2 with PayKitPoints. */
      get: (): Promise<LoyaltyProgram & { available: boolean }> => this.mget(zMerchantLoyalty, routes.portalLoyalty(), "loyalty program"),
      update: async (update: LoyaltyProgramUpdate): Promise<LoyaltyProgram & { available: boolean }> => {
        this.requireMerchantAccess();
        return parse(zMerchantLoyalty, await this.merchantHttp.patch(routes.portalLoyalty(), update), "loyalty program");
      },
    },
    payments: (query: { status?: "pending" | "settled" | "all"; cursor?: string; limit?: number } = {}): Promise<Page<Payment>> =>
      this.mget(zPage(zPayment), routes.merchantPayments(), "payments", query),
    plans: (query: { status?: "active" | "delinquent" | "all"; cursor?: string } = {}): Promise<Page<Plan>> =>
      this.mget(zPage(zPlan), routes.merchantPlans(), "plans", query),
    refunds: (query: { cursor?: string } = {}): Promise<Page<Refund>> => this.mget(zPage(zRefund), routes.merchantRefunds(), "refunds", query),

    /**
     * Accountant export: double-entry journal lines (CSV) for a date range, using the
     * versioned account mapping (gross, fee, net, refunds) from plan.md §20.
     */
    exportJournal: async (query: { from?: string; to?: string; mappingVersion?: string } = {}): Promise<string> => {
      this.requireMerchantAccess();
      return this.merchantHttp.get<string>(routes.journalExport(), { query: { mappingVersion: "v1", ...query }, raw: true });
    },

    /**
     * Refunds part or all of a payment. The merchant (owner or server key) signs the refund
     * terms unless the hosted signer already did; the funder (payout wallet by default) signs
     * a gasless USDT authorization for the amount. Defaults: funder = merchant signer.
     */
    refund: async (
      paymentId: string,
      amount: bigint | string,
      signers: { merchant: WalletSigner; funder?: WalletSigner },
      options: { reason?: string } = {},
    ): Promise<Refund> => {
      const network = await this.getNetwork();
      const value = toBigInt(amount);
      const request = await this.mpost(zRefundSigningRequest, routes.refunds(), { paymentId, amount: value.toString(), reason: options.reason }, "refund request");
      const { terms, funder } = verifyRefundRequest(network, request, { paymentId, amount: value });
      const funderSigner = signers.funder ?? signers.merchant;
      if (!isAddressEqual(await funderSigner.getAddress(), funder)) {
        throw new PayKitError("validation_failed", `Connect the refund funder wallet ${funder} to sign`);
      }
      await ensureChain(signers.merchant, network.chain);
      const merchantSignature = (request.merchantSignature as Hex | null) ?? (await signers.merchant.signTypedData(refundTermsTypedData(network, terms)));
      if (funderSigner !== signers.merchant) await ensureChain(funderSigner, network.chain);
      const funderSignature = await funderSigner.signTypedData(
        receiveWithAuthorizationTypedData(network, {
          from: funder,
          to: requireContract(network, "router"),
          value: terms.amount + terms.fee,
          validAfter: 0n,
          validBefore: terms.validUntil,
          nonce: refundNonce(request.termsHash as Hex),
        }),
      );
      const body = { merchantSignature, funderSignature, validAfter: "0", validBefore: terms.validUntil.toString() };
      return this.mpost(zRefund, routes.refundSignatures(request.refund.id), body, "refund");
    },

    createInvoice: (input: {
      lineItems: Array<Pick<LineItem, "name" | "quantity" | "unitAmount"> & { productId?: string }>;
      validUntil?: string;
      schedule?: { type: "full" } | { type: "deposit"; depositPercent: number } | { type: "parts"; parts: string[] };
      customerWallet?: Address;
    }): Promise<Invoice> => this.mpost(zInvoice, routes.invoices(), input, "invoice"),
    invoices: (query: { status?: string; cursor?: string } = {}): Promise<Page<Invoice>> => this.mget(zPage(zInvoice), routes.invoices(), "invoices", query),

    products: {
      list: async (): Promise<Product[]> => (await this.mget(zPage(zProduct), routes.products(), "products")).data,
      create: (input: { name: string; price: string; description?: string; imageUrl?: string; sku?: string }): Promise<Product> =>
        this.mpost(zProduct, routes.products(), input, "product"),
      update: async (id: string, input: Partial<{ name: string; price: string; description: string; imageUrl: string; active: boolean }>): Promise<Product> => {
        this.requireMerchantAccess();
        return parse(zProduct, await this.merchantHttp.patch(routes.product(id), input), "product");
      },
      remove: async (id: string): Promise<void> => {
        this.requireMerchantAccess();
        await this.merchantHttp.delete(routes.product(id));
      },
    },

    domains: {
      list: async (): Promise<DomainChallenge[]> => (await this.mget(zPage(zDomainChallenge), routes.merchantDomains(), "domains")).data,
      start: (domain: string, method: "dns" | "wellknown" = "wellknown"): Promise<DomainChallenge> =>
        this.mpost(zDomainChallenge, routes.merchantDomains(), { domain, method }, "domain challenge"),
      check: (domain: string): Promise<DomainChallenge> => this.mpost(zDomainChallenge, routes.merchantDomainCheck(domain), {}, "domain challenge"),
      /**
       * Signs the /.well-known/paykit.json body with the owner wallet and returns the exact
       * file contents to upload. The signature stops anyone faking the file.
       */
      signWellKnownFile: async (challenge: DomainChallenge, owner: WalletSigner): Promise<string> => {
        const signature = await owner.signMessage(wellKnownSigningText(challenge.wellKnownBody));
        return `${JSON.stringify({ ...challenge.wellKnownBody, ownerSignature: signature }, null, 2)}
`;
      },
    },

    apiKeys: {
      list: async (): Promise<ApiKey[]> => (await this.mget(zPage(zApiKey), routes.merchantApiKeys(), "API keys")).data,
      create: (input: { kind: "publishable" | "secret"; allowedOrigins?: string[] }): Promise<ApiKey> =>
        this.mpost(zApiKey, routes.merchantApiKeys(), input, "API key"),
      revoke: async (id: string): Promise<void> => {
        this.requireMerchantAccess();
        await this.merchantHttp.delete(routes.merchantApiKey(id));
      },
    },

    /**
     * Merchant server keys (delegated signers). Adding one lets the merchant's backend
     * sign payment terms with @paykit/node. A server key can never change where money goes.
     */
    signers: {
      list: async (): Promise<MerchantSigner[]> => (await this.mget(zPage(zMerchantSigner), routes.merchantSigners(), "signers")).data,
      add: (address: Address, owner: WalletSigner, options: { expiresAt?: Date } = {}): Promise<RegistryActionResult> =>
        this.registryAction(routes.merchantSigners(), { address: getAddress(address), enabled: true, expiresAt: options.expiresAt?.toISOString() ?? null }, owner),
      disable: (address: Address, owner: WalletSigner): Promise<RegistryActionResult> =>
        this.registryAction(routes.merchantSigners(), { address: getAddress(address), enabled: false, expiresAt: null }, owner),
    },

    /** Percentage splits of each payment's net amount (e.g. seller 90%, platform 8%, affiliate 2%). */
    splits: {
      list: async (): Promise<SplitProfile[]> => (await this.mget(zPage(zSplitProfile), routes.merchantSplits(), "splits")).data,
      create: (name: string, recipients: Array<{ address: Address; bps: number; label?: string }>, owner: WalletSigner): Promise<RegistryActionResult> =>
        this.registryAction(routes.merchantSplits(), { name, recipients: recipients.map((r) => ({ ...r, address: getAddress(r.address) })) }, owner),
    },

    /** Changes the payout wallet. The new wallet proves control; the change applies after a safety delay. */
    changePayout: async (newPayout: Address, owner: WalletSigner, newPayoutWallet: WalletSigner): Promise<RegistryActionResult> => {
      if (!isAddressEqual(await newPayoutWallet.getAddress(), newPayout)) {
        throw new PayKitError("validation_failed", "Connect the new payout wallet to prove you control it");
      }
      return this.registryAction(routes.merchantPayout(), { newPayout: getAddress(newPayout) }, owner, newPayoutWallet);
    },

    webhooks: {
      replay: async (id: string, eventId?: string): Promise<{ replayed: number }> => { this.requireMerchantAccess(); return this.merchantHttp.post(routes.webhookReplay(id), { eventId }); },
      list: async (): Promise<WebhookEndpoint[]> => (await this.mget(zPage(zWebhookEndpoint), routes.webhookEndpoints(), "webhooks")).data,
      create: (input: { url: string; events: string[] }): Promise<WebhookEndpoint> =>
        this.mpost(zWebhookEndpoint, routes.webhookEndpoints(), input, "webhook endpoint"),
      remove: async (id: string): Promise<void> => {
        this.requireMerchantAccess();
        await this.merchantHttp.delete(routes.webhookEndpoint(id));
      },
    },
  };
}

/** The public surface of the client. A UI mock can implement this type. */
export type PayKitClientLike = Pick<
  PayKitClient,
  "getConfig" | "getNetwork" | "status" | "merchants" | "invoices" | "checkout" | "payments" | "plans" | "auth" | "me" | "merchant"
>;

export function createPayKitClient(options: PayKitClientOptions): PayKitClient {
  return new PayKitClient(options);
}

function browserOrigin(): { domain: string; uri: string } {
  const location = (globalThis as { location?: { host: string; origin: string } }).location;
  if (!location) throw new PayKitError("config_invalid", "Pass `siwe: { domain, uri }` when not running in a browser");
  return { domain: location.host, uri: location.origin };
}

function absoluteUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  const location = (globalThis as { location?: { origin: string } }).location;
  if (!location) throw new PayKitError("config_invalid", "merchantDataUrl must be absolute outside the browser");
  return `${location.origin}${url.startsWith("/") ? url : `/${url}`}`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Aborted"));
      },
      { once: true },
    );
  });
}
