import { decideRefill, refillAmount } from "./refill.ts";
import { applyPayment, applyRefund, balanceOf, earnFor, historyOf, programOf, updateProgram, type LoyaltyDb } from "./loyalty.ts";
import type { ChainEvent } from "@paykit/observer";
/**
 * The PayKit API: every route in @paykit/core `routes`, as one `handle(Request) → Response`.
 *
 * Browser-safe (no Node imports), so the same code powers the real server (with the viem
 * chain + a JSON file) and @paykit/js/mock (with the simulated chain, in memory).
 */
import {
  cancelPlanTypedData,
  DEFAULT_FEE_SCHEDULE,
  DOWN_PAYMENT_INDEX,
  canonicalJson,
  normalizeDomain,
  isWebhookEventType,
  depositSchedule,
  domainHash,
  explorerTxUrl,
  hashPaymentQuote,
  hashPlanTerms,
  hashRefundTerms,
  idFromUuid,
  installmentPaymentId,
  installmentSplit,
  invoiceDigest,
  invoiceKey,
  merchantIdFor,
  nowSeconds,
  paymentIdForPart,
  paymentQuoteTypedData,
  payNonce,
  permitTypedData,
  planConsentTypedData,
  planTermsFromWire,
  planTermsToWire,
  planTermsTypedData,
  protocolFee,
  queuePayoutTypedData,
  quoteFromWire,
  quoteToWire,
  receiveWithAuthorizationTypedData,
  refundNonce,
  refundTermsFromWire,
  refundTermsTypedData,
  registerMerchantTypedData,
  routerVersionOf,
  pointsForAmount,
  zLoyaltyProgramUpdate,
  type Reward,
  requireContract,
  routes,
  setSignerTypedData,
  setSplitProfileTypedData,
  splitHash,
  wellKnownSigningText,
  type CheckoutSession,
  type DomainChallenge,
  type FeeSchedule,
  type Invoice,
  type Merchant,
  type MerchantSigner,
  type NetworkConfig,
  type Payment,
  type Plan,
  type PlanSession,
  type Product,
  type Refund,
  type RefundSigningRequest,
  type RefundTermsWire,
  type SignedQuote,
  zSignedQuote,
  type RegistryActionRequest,
  type SplitProfile,
  type WebhookEventType,
} from "@paykit/core";
import { getAddress, isAddressEqual, recoverMessageAddress, recoverTypedDataAddress, zeroAddress, type Address, type Hex, type LocalAccount } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { invoiceInput, planOption, publicUrl } from "./validation.ts";
import { PermanentChainError, type ChainAdapter, type RelayTransaction } from "./chain/types.ts";

type Json = Record<string, unknown>;

interface RegistrationDraft {
  draftId: string;
  owner: Address;
  payout: Address;
  maxFeeBps: number;
  metadataHash: Hex;
  metadataURI?: string;
  nonce: string;
  deadline: string;
  registry: Address;
  chainId: number;
  payoutProofMessage: string | null;
  hostedSigner: Address;
}

/** All state. Plain JSON (no bigint/Map), so it can be saved to a file. */
export interface PayKitDb extends LoyaltyDb {
  refill: { lastAt: number; paused: boolean; runs: Array<{ id: string; action: string; reason: string; amount?: string; output?: string; cost?: string; minOutput?: string; deadline?: string; txHash?: Hex; nativeBefore?: string; nativeAfter?: string; createdAt: number }> };
  observer: { nextBlock: string | null; events: ChainEvent[] };
  domainRevocations: Record<string, { merchantId: Hex; domainHash: Hex; txHash: Hex | null }>;
  quotes: Record<string, SignedQuote>;
  failureBudgets: Record<string, { day: string; count: number }>;
  transactions: Record<string, RelayTransaction>;
  idempotency: Record<string, { fingerprint: string; value: unknown; createdAt: number }>;
  refundJobs: Record<string, { merchantSignature: Hex; funder: { validAfter: string; validBefore: string; signature: Hex } }>;
  jobs: Record<string, { kind: "plan" | "collect" | "cancel"; sessionId?: string; planId?: string; index?: number; body: Json; txHash: Hex | null }>;
  planInvoices: Record<string, string>;
  counter: number;
  merchants: Merchant[];
  products: Product[];
  invoices: Invoice[];
  payments: Payment[];
  plans: Plan[];
  refunds: Refund[];
  sessions: Record<string, { kind: "checkout"; value: CheckoutSession } | { kind: "plan"; value: PlanSession }>;
  logins: Record<string, { address: Address; merchantSlug: string | null; expiresAt: number }>;
  nonces: Record<string, number>;
  drafts: Record<string, { request: RegistrationDraft; input: Json }>;
  refundTerms: Record<string, RefundTermsWire>;
  /** Signed plan terms by planId (needed to collect installments and know fees). */
  planTerms: Record<string, PlanSession["terms"]>;
  /** Signed payer authorizations waiting to be relayed, by paymentId (survive restarts). */
  pendingPays: Record<string, { sessionId: string; auth: { from: Address; refundTo: Address; salt: Hex; validAfter: string; validBefore: string; signature: Hex } }>;
  domains: Record<string, { owner: string; challenge: DomainChallenge }>;
  signers: Array<MerchantSigner & { owner: string }>;
  splits: Array<SplitProfile & { owner: string }>;
  pendingSplits: Record<string, { name: string; labels: Array<string | null> }>;
  registryRequests: Record<string, { request: RegistryActionRequest; owner: string }>;
  apiKeys: Array<{ id: string; kind: "publishable" | "secret"; prefix: string; hash: string; allowedOrigins: string[]; createdAt: string; lastUsedAt: string | null; revokedAt: string | null; owner: string }>;
  webhooks: Array<{ id: string; url: string; events: string[]; active: boolean; createdAt: string; owner: string; secret: string }>;
  outbox: Array<{ id: string; endpointId: string; body: string; attempts: number; nextAt: number; delivered: boolean; lastStatus: number | null }>;
}

export function emptyDb(): PayKitDb {
  return {
    refill: { lastAt: 0, paused: false, runs: [] }, observer: { nextBlock: null, events: [] }, domainRevocations: {}, quotes: {}, failureBudgets: {}, transactions: {}, idempotency: {}, refundJobs: {}, jobs: {}, planInvoices: {},
    counter: 0,
    merchants: [],
    products: [],
    invoices: [],
    payments: [],
    plans: [],
    refunds: [],
    sessions: {},
    logins: {},
    nonces: {},
    drafts: {},
    refundTerms: {},
    planTerms: {},
    pendingPays: {},
    domains: {},
    signers: [],
    splits: [],
    pendingSplits: {},
    registryRequests: {},
    apiKeys: [],
    webhooks: [],
    outbox: [],
  };
}

export interface PayKitApiOptions {
  /** Network with the deployed PayKit contract addresses. */
  network: NetworkConfig;
  chain: ChainAdapter;
  /** The platform's hosted signer: signs payment offers for merchants who authorized it. */
  signer: LocalAccount;
  db?: PayKitDb;
  /** Called after state changes (e.g. save to disk). */
  onChange?: (db: PayKitDb) => void;
  feeSchedule?: FeeSchedule;
  /** SIWE domains accepted for sign-in (e.g. "shop.example.com"). Omit to accept any. */
  siweDomains?: string[];
  /**
   * How domain ownership is checked. Default: fetch https://<domain>/.well-known/paykit.json
   * and verify the owner's signature. "trust" (mock only) accepts any domain.
   */
  domainCheck?: "fetch" | "trust";
  /** Send webhooks over HTTP. Default true. */
  deliverWebhooks?: boolean;
  /** How often to re-check finality of included transactions. Default 4000 ms. */
  finalityPollMs?: number;
  /** Public base URL of this API (used in merchant metadata URIs). */
  publicUrl?: string;
  fetch?: typeof fetch;
  /** Only demo/test servers may disable publishable keys and public outbound restrictions. */
  requirePublishableKey?: boolean;
  requestLimit?: number;
  observerStartBlock?: bigint;
  refill?: { reserve: bigint; measuredPaymentCost: bigint; intervalMs?: number };
  /** PayKitPoints.maxPointsPerUsdt: platform cap on points per 1 USDT. Default 100. */
  maxPointsPerUsdt?: number;
}

export interface PayKitApi {
  handle(request: Request): Promise<Response>;
  /** Same as handle, with fetch's signature (for the SDK's `fetch` option). */
  fetch(input: string, init?: RequestInit): Promise<Response>;
  /** Background work: collect due installments, deliver webhooks. Call every few seconds. */
  tick(): Promise<void>;
  /** Re-attach to payments that were in flight when the server stopped. */
  resume(): void;
  db: PayKitDb;
  hostedSigner: Address;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const httpError = (status: number, code: string, message: string) => new HttpError(status, code, message);

const SETTLED: Payment["status"][] = ["included", "safe", "finalized"];
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,idempotency-key,x-paykit-key",
};
const RETRY_MS = [10_000, 60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];

export function createPayKitApi(options: PayKitApiOptions): PayKitApi {
  const { network, chain, signer } = options;
  const router = requireContract(network, "router");
  const registry = requireContract(network, "registry");
  const usdt = network.usdt!.address;
  const fees = options.feeSchedule ?? DEFAULT_FEE_SCHEDULE;
  const maxPoints = options.maxPointsPerUsdt ?? 100;
  /** Points and discounts need PaymentRouterV2 and a PayKitPoints deployment. */
  const pointsOn = !!network.contracts.points && routerVersionOf(network) === "2";
  const pollMs = options.finalityPollMs ?? 4000;
  const doFetch = options.fetch ?? ((i: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(i, init));
  const db = options.db ?? emptyDb();
  if (options.domainCheck !== "trust" && !options.fetch) throw new Error("Real APIs require a guarded outbound fetch; pass safeFetch from @paykit/server/node");
  const t0 = Date.now();
  const mutationTails = new Map<string, Promise<unknown>>();
  let ticking = false;
  const requestCounts = new Map<string, { count: number; until: number }>();
  async function browserMerchant(headers: Headers): Promise<string | null> {
    const token = headers.get("x-paykit-key");
    if (!token) return null;
    const hash = await sha256Hex(token);
    const key = db.apiKeys.find((k) => k.hash === hash && k.kind === "publishable" && !k.revokedAt);
    if (!key) throw httpError(401, "unauthorized", "Unknown or revoked publishable key");
    const origin = headers.get("origin");
    if (origin && key.allowedOrigins.length && !key.allowedOrigins.includes(origin)) throw httpError(403, "forbidden", "This origin is not allowed for the publishable key");
    return key.owner;
  }
  function scope(slug: string, browser: string | null) {
    if (browser && slug !== browser) throw httpError(403, "forbidden", "This key belongs to another merchant");
  }
  const inFlight = new Set<string>();
  const iso = (ms = Date.now()) => new Date(ms).toISOString();
  const uid = (p: string) => `${p}_${(++db.counter).toString(36)}${randomHex(16)}`;
  const save = () => options.onChange?.(db);
  const page = <T>(data: T[]) => ({ data, nextCursor: null });
  const findMerchant = (slug: string) => db.merchants.find((m) => m.slug === slug);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // ---------- auth ----------

  type Who = { address: Address; merchantSlug: string | null };

  async function auth(headers: Headers): Promise<Who> {
    const token = headers.get("authorization")?.replace(/^Bearer /, "");
    if (token?.startsWith("sk_")) {
      const hash = await sha256Hex(token);
      const key = db.apiKeys.find((k) => k.hash === hash && k.kind === "secret" && !k.revokedAt);
      const m = key && findMerchant(key.owner);
      if (!key || !m) throw httpError(401, "unauthorized", "Unknown or revoked secret key");
      key.lastUsedAt = iso();
      return { address: m.owner, merchantSlug: m.slug };
    }
    const login = token ? db.logins[token] : undefined;
    if (!login || login.expiresAt < Date.now()) throw httpError(401, "unauthorized", "Sign in with your wallet first");
    return login;
  }

  async function myMerchant(headers: Headers): Promise<Merchant> {
    const who = await auth(headers);
    const m = db.merchants.find((x) => isAddressEqual(x.owner, who.address) && (who.merchantSlug === null || x.slug === who.merchantSlug));
    if (!m) throw httpError(404, "not_found", "This wallet has not registered a merchant yet");
    return m;
  }

  /** Signers allowed to sign for a merchant: the owner, its active server keys, and our hosted signer if authorized. */
  function isMerchantSigner(m: Merchant, address: Address): boolean {
    if (isAddressEqual(address, m.owner)) return true;
    return db.signers.some((s) => s.owner === m.slug && s.status === "active" && (!s.expiresAt || Date.parse(s.expiresAt) > Date.now()) && isAddressEqual(s.address, address));
  }

  // ---------- webhooks ----------

  function emit(type: WebhookEventType, merchantSlug: string, key: string, data: unknown) {
    for (const w of db.webhooks.filter((x) => x.owner === merchantSlug && x.active && (x.events.length === 0 || x.events.includes(type)))) {
      const id = idFromUuid(`${network.chain.id}:${merchantSlug}:${type}:${key}`);
      if (db.outbox.some((o) => o.id === id && o.endpointId === w.id)) continue;
      const body = JSON.stringify({ id, type, createdAt: iso(), merchantSlug, chainId: network.chain.id, data });
      db.outbox.push({ id, endpointId: w.id, body, attempts: 0, nextAt: Date.now(), delivered: false, lastStatus: null });
    }
  }

  async function deliverWebhooks() {
    if (options.deliverWebhooks === false) return;
    for (const item of db.outbox.filter((o) => !o.delivered && o.nextAt <= Date.now() && o.attempts <= RETRY_MS.length)) {
      const w = db.webhooks.find((x) => x.id === item.endpointId);
      if (!w || !w.active) continue;
      const t = Math.floor(Date.now() / 1000);
      const sig = await hmacHex(w.secret, `${t}.${item.body}`);
      let status = 0;
      try {
        const res = await doFetch(w.url, { method: "POST", body: item.body, headers: { "content-type": "application/json", "paykit-signature": `t=${t},v1=${sig}` }, redirect: "error", signal: AbortSignal.timeout(10_000) });
        status = res.status;
      } catch {
        status = 0;
      }
      item.attempts += 1;
      item.lastStatus = status;
      if (status >= 200 && status < 300) item.delivered = true;
      else item.nextAt = Date.now() + RETRY_MS[Math.min(item.attempts - 1, RETRY_MS.length - 1)]!;
    }
    // keep the outbox from growing forever
    if (db.outbox.length > 5000) db.outbox = db.outbox.filter((o) => !o.delivered);
  }

  // ---------- invoices & checkout ----------

  function newInvoice(m: Merchant, lineItems: Invoice["lineItems"], schedule: Invoice["schedule"], customerWallet: Address | null, validUntil?: string, extra: { externalOrderId?: string; metadata?: Record<string, string>; splitProfileId?: number } = {}): Invoice {
    const id = uid("inv");
    const total = lineItems.reduce((s, li) => s + BigInt(li.amount), 0n);
    if (total <= 0n) throw httpError(400, "validation_failed", "Invoice total must be positive");
    const invoice: Invoice = {
      id,
      invoiceId: idFromUuid(id),
      merchantSlug: m.slug,
      number: `INV-${String(db.invoices.filter((i) => i.merchantSlug === m.slug).length + 1).padStart(4, "0")}`,
      lineItems,
      total: total.toString(),
      paid: "0",
      refunded: "0",
      token: "USDT",
      status: "open",
      schedule,
      digest: invoiceDigest({ id, merchant: m.slug, lineItems, total: total.toString(), token: "USDT" }),
      validUntil: validUntil ?? iso(Date.now() + 7 * 86_400_000),
      createdAt: iso(),
      customerWallet,
      externalOrderId: extra.externalOrderId ?? null,
      metadata: extra.metadata ?? {},
      splitProfileId: extra.splitProfileId ?? 0,
    };
    db.invoices.push(invoice);
    emit("invoice.created", m.slug, invoice.id, invoice);
    return invoice;
  }

  function lineItemsFor(slug: string, items: Array<{ productId: string; quantity: number }>): Invoice["lineItems"] {
    if (!Array.isArray(items) || items.length === 0) throw httpError(400, "validation_failed", "Cart is empty");
    return items.map((it) => {
      const p = db.products.find((x) => x.id === it.productId && x.merchantSlug === slug && x.active);
      if (!p) throw httpError(404, "not_found", `Product ${it.productId} not found`);
      const q = Number(it.quantity);
      if (!Number.isInteger(q) || q < 1 || q > 999) throw httpError(400, "validation_failed", "Quantity must be 1–999");
      return { name: p.name, quantity: q, unitAmount: p.price, amount: (BigInt(p.price) * BigInt(q)).toString(), productId: p.id };
    });
  }

  function nextPartAmount(inv: Invoice): bigint {
    const remaining = BigInt(inv.total) - BigInt(inv.paid);
    if (inv.schedule.type === "full") return remaining;
    let paid = BigInt(inv.paid);
    for (const part of inv.schedule.parts.map(BigInt)) {
      if (paid >= part) {
        paid -= part;
        continue;
      }
      return part - paid;
    }
    return remaining;
  }

  function validateInvoice(inv: Invoice, m: Merchant) {
    if (m.status !== "active") throw httpError(409, "merchant_inactive", "Merchant is inactive");
    if (inv.status === "void" || inv.status === "expired") throw httpError(409, "quote_expired", "Invoice is not payable");
    if (!Number.isFinite(Date.parse(inv.validUntil)) || Date.parse(inv.validUntil) <= Date.now()) throw httpError(409, "quote_expired", "Invoice expired");
    if (BigInt(inv.paid) >= BigInt(inv.total)) throw httpError(409, "invoice_overpaid", "Invoice is already paid");
    if (inv.splitProfileId && !db.splits.some((s) => s.owner === m.slug && s.profileId === inv.splitProfileId && s.status === "active")) throw httpError(400, "validation_failed", "Unknown split profile");
  }

  async function signQuote(m: Merchant, inv: Invoice, gross: bigint, partIndex: number, allowUnsigned = false, reward?: Reward) {
    const quote = {
      merchantId: m.merchantId as Hex,
      invoiceId: inv.invoiceId as Hex,
      invoiceDigest: inv.digest as Hex,
      paymentId: paymentIdForPart(inv.invoiceId as Hex, partIndex),
      token: usdt,
      invoiceTotal: BigInt(inv.total),
      gross,
      fee: protocolFee(gross, fees),
      payer: inv.customerWallet ? getAddress(inv.customerWallet) : zeroAddress,
      splitProfileId: inv.splitProfileId ?? 0,
      validUntil: BigInt(Math.min(Number(nowSeconds() + 900n), Math.floor(Date.parse(inv.validUntil) / 1000))),
      // V2: points earned on what the customer actually pays; a reward burns points for a discount.
      ...(pointsOn ? { pointsEarned: earnFor(db, m.slug, gross, maxPoints) } : {}),
      ...(pointsOn && reward ? { discount: BigInt(reward.discount), pointsRedeemed: BigInt(reward.pointsCost), rewardId: reward.id } : {}),
    };
    const authorized = isMerchantSigner(m, signer.address);
    if (!authorized && !allowUnsigned) throw httpError(409, "config_invalid", "Authorize the hosted signer or create the checkout session through your server signer");
    const merchantSignature = authorized ? await signer.signTypedData(paymentQuoteTypedData(network, quote)) : "0x" as Hex;
    return quoteToWire(quote, merchantSignature, hashPaymentQuote(network, quote));
  }

  async function validateSignedQuote(quote: SignedQuote, merchant: Merchant, invoice: Invoice, gross: bigint): Promise<SignedQuote> {
    const message = quoteFromWire(quote);
    if (quote.invoiceId !== invoice.invoiceId || quote.invoiceDigest !== invoice.digest || quote.merchantId !== merchant.merchantId || BigInt(quote.gross) !== gross || BigInt(quote.invoiceTotal) !== BigInt(invoice.total) || quote.token.toLowerCase() !== usdt.toLowerCase() || BigInt(quote.validUntil) <= nowSeconds() || BigInt(quote.validUntil) > BigInt(Math.floor(Date.parse(invoice.validUntil) / 1000)) || quote.splitProfileId !== (invoice.splitProfileId ?? 0) || BigInt(quote.fee) !== protocolFee(gross, fees) || (invoice.customerWallet && !isAddressEqual(message.payer, invoice.customerWallet))) throw httpError(400, "quote_mismatch", "Signed quote differs from the invoice");
    if (BigInt(quote.discount ?? "0") > 0n || BigInt(quote.pointsRedeemed ?? "0") > 0n) throw httpError(400, "quote_mismatch", "Apply rewards through the checkout session, not a self-signed quote");
    if (BigInt(quote.pointsEarned ?? "0") > pointsForAmount(gross, maxPoints, maxPoints)) throw httpError(400, "quote_mismatch", "Points earned exceed the platform cap");
    const hash = hashPaymentQuote(network, message);
    if (hash !== quote.quoteHash) throw httpError(400, "quote_mismatch", "Quote hash differs");
    const recovered = await recoverTypedDataAddress({ ...paymentQuoteTypedData(network, message), signature: quote.merchantSignature as Hex });
    if (!isMerchantSigner(merchant, recovered)) throw httpError(400, "signature_invalid", "Quote signer is not authorized");
    return quote;
  }
  async function checkoutSession(body: Json): Promise<CheckoutSession> {
    let inv: Invoice | undefined;
    if (typeof body.invoiceId === "string") {
      inv = db.invoices.find((i) => i.id === body.invoiceId);
      if (!inv) throw httpError(404, "not_found", "Invoice not found");
      if (inv.status === "void") throw httpError(409, "validation_failed", "This invoice was cancelled");
      if (new Date(inv.validUntil).getTime() < Date.now()) throw httpError(409, "quote_expired", "This invoice has expired");
    } else {
      const m = findMerchant(String(body.merchant));
      if (!m || m.status !== "active") throw httpError(404, "not_found", "Merchant not found");
      inv = newInvoice(m, lineItemsFor(m.slug, body.items as never), { type: "full" }, null);
    }
    const m = findMerchant(inv.merchantSlug)!;
    validateInvoice(inv, m);
    if (!m.merchantId) throw httpError(409, "merchant_inactive", "This merchant isn't registered onchain yet");
    const gross = nextPartAmount(inv);
    if (gross <= 0n) throw httpError(409, "invoice_overpaid", "This invoice is already paid");
    if (db.refill.paused) throw httpError(503, "sponsorship_paused", "Manual relay top-up required");
    const sponsor = await chain.sponsorship();
    if (!sponsor.ok) throw httpError(503, "sponsorship_paused", sponsor.reason ?? "Payments are paused");
    const partIndex = db.payments.filter((p) => p.invoiceId === inv!.id && p.status !== "failed").length;
    const session: CheckoutSession = {
      id: uid("cs"),
      merchant: m,
      invoice: inv,
      partIndex,
      quote: body.quote ? await validateSignedQuote(body.quote as SignedQuote, m, inv, gross) : await signQuote(m, inv, gross, partIndex),
      router,
      chainId: network.chain.id,
      expiresAt: iso(Date.now() + 900_000),
      reward: null,
    };
    db.sessions[session.id] = { kind: "checkout", value: session };
    return session;
  }

  /** Points balance: PayKitPoints when deployed, otherwise the API's mirror ledger. */
  async function pointsBalance(wallet: Address) {
    const onchain = chain.pointsOf ? await chain.pointsOf(wallet).catch(() => null) : null;
    return { ...(onchain ?? balanceOf(db, wallet)), source: onchain ? "chain" as const : "ledger" as const };
  }

  /** Applies (rewardId) or removes (null) a points reward, re-signing the session's quote. */
  async function applyReward(id: string, body: Json): Promise<CheckoutSession> {
    const entry = db.sessions[id];
    if (!entry || entry.kind !== "checkout") throw httpError(404, "not_found", "Checkout session not found");
    if (!pointsOn) throw httpError(409, "config_invalid", "Points need PaymentRouterV2 and PayKitPoints");
    const s = entry.value;
    const m = findMerchant(s.merchant.slug)!;
    validateInvoice(s.invoice, m);
    if (db.payments.some((p) => p.invoiceId === s.invoice.id && p.status !== "failed" && db.pendingPays[p.paymentId]?.sessionId === id)) throw httpError(409, "already_settled", "This checkout is already being paid");
    const base = nextPartAmount(s.invoice);
    let reward: Reward | undefined;
    if (body.rewardId) {
      const program = programOf(db, m.slug, maxPoints);
      reward = program.rewards.find((r) => r.active && r.id.toLowerCase() === String(body.rewardId).toLowerCase());
      if (!program.enabled || !reward) throw httpError(404, "not_found", "Reward not found");
      const payer = getAddress(String(body.payer));
      if ((await pointsBalance(payer)).balance < BigInt(reward.pointsCost)) throw httpError(409, "validation_failed", "Not enough points for this reward");
      if (BigInt(reward.discount) >= base) throw httpError(409, "validation_failed", "This reward is worth more than the order");
    }
    const gross = base - (reward ? BigInt(reward.discount) : 0n);
    s.quote = await signQuote(m, s.invoice, gross, s.partIndex, false, reward);
    s.reward = reward ? { id: reward.id, name: reward.name, pointsCost: reward.pointsCost, discount: reward.discount } : null;
    save();
    return s;
  }

  async function authorizeCheckout(id: string, body: Json): Promise<Payment> {
    const entry = db.sessions[id];
    if (!entry || entry.kind !== "checkout") throw httpError(404, "not_found", "Checkout session not found");
    const s = entry.value;
    const canonicalId = await keys.payment(s.quote.merchantId as Hex, s.quote.paymentId as Hex);
    const existing = db.payments.find((p) => p.paymentId === canonicalId);
    if (existing) return existing; // idempotent: no second charge
    validateInvoice(s.invoice, findMerchant(s.invoice.merchantSlug)!);
    if (db.payments.some((p) => p.invoiceId === s.invoice.id && ["queued", "submitted"].includes(p.status))) throw httpError(409, "already_settled", "An attempt for this invoice is already processing; resume that payment");
    const payer = getAddress(String(body.payer));
    const today = iso().slice(0, 10);
    for (const key of [payer.toLowerCase(), s.merchant.slug]) { const budget = db.failureBudgets[key]; if (budget?.day === today && budget.count >= 3) throw httpError(429, "rate_limited", "Sponsorship failure budget exhausted for today"); }
    const refundTo = getAddress(String(body.refundTo));
    const salt = body.salt as Hex;
    const validAfter = BigInt(String(body.validAfter));
    const validBefore = BigInt(String(body.validBefore));
    const nonce = payNonce(s.quote.quoteHash as Hex, refundTo, salt);
    const recovered = await recoverTypedDataAddress({
      ...receiveWithAuthorizationTypedData(network, { from: payer, to: router, value: BigInt(s.quote.gross), validAfter, validBefore, nonce }),
      signature: body.signature as Hex,
    });
    if (!isAddressEqual(recovered, payer)) throw httpError(400, "signature_invalid", "Payer signature does not match");
    if (BigInt(s.quote.validUntil) < nowSeconds()) throw httpError(409, "quote_expired", "This payment offer expired. Start again.");
    const redeem = BigInt(s.quote.pointsRedeemed ?? "0");
    if (redeem > 0n && (await pointsBalance(payer)).balance < redeem) throw httpError(409, "validation_failed", "Not enough points for this reward");
    const payment: Payment = {
      paymentId: canonicalId,
      ...(BigInt(s.quote.discount ?? "0") > 0n ? { discount: s.quote.discount } : {}),
      ...(BigInt(s.quote.pointsEarned ?? "0") > 0n ? { pointsEarned: s.quote.pointsEarned } : {}),
      ...(redeem > 0n ? { pointsRedeemed: redeem.toString() } : {}),
      merchantSlug: s.merchant.slug,
      merchantName: s.merchant.name,
      invoiceId: s.invoice.id,
      planId: null,
      kind: "one_time",
      payer,
      refundTo,
      token: "USDT",
      gross: s.quote.gross,
      fee: s.quote.fee,
      net: (BigInt(s.quote.gross) - BigInt(s.quote.fee)).toString(),
      refunded: "0",
      status: "queued",
      txHash: null,
      blockNumber: null,
      explorerUrl: null,
      error: null,
      createdAt: iso(),
      settledAt: null,
      externalOrderId: s.invoice.externalOrderId ?? null,
      metadata: s.invoice.metadata ?? {},
    };
    db.payments.unshift(payment);
    db.pendingPays[payment.paymentId] = {
      sessionId: id,
      auth: { from: payer, refundTo, salt, validAfter: validAfter.toString(), validBefore: validBefore.toString(), signature: body.signature as Hex },
    };
    emit("payment.pending", payment.merchantSlug, payment.paymentId, payment);
    save();
    void relayPayment(payment.paymentId);
    return payment;
  }

  function projectInvoices() {
    for (const inv of db.invoices) {
      const payments = db.payments.filter((p) => p.invoiceId === inv.id && SETTLED.includes(p.status));
      inv.paid = payments.reduce((sum, p) => sum + BigInt(p.gross) + BigInt(p.discount ?? "0"), 0n).toString();
      inv.refunded = payments.reduce((sum, p) => sum + BigInt(p.refunded), 0n).toString();
      if (inv.status === "void") continue;
      inv.status = BigInt(inv.paid) === 0n ? (Date.parse(inv.validUntil) <= Date.now() ? "expired" : "open") : BigInt(inv.refunded) >= BigInt(inv.paid) ? "refunded" : BigInt(inv.refunded) > 0n ? "partially_refunded" : BigInt(inv.paid) >= BigInt(inv.total) ? "paid" : "partially_paid";
    }
  }
  function includePayment(payment: Payment, receipt: { blockNumber: bigint; blockHash?: Hex; transactionHash?: Hex }) {
    const previous = db.invoices.find((i) => i.id === payment.invoiceId)?.paid;
    payment.status = "included";
    payment.error = null;
    payment.blockNumber = receipt.blockNumber.toString();
    payment.blockHash = receipt.blockHash ?? null;
    if (receipt.transactionHash) { payment.txHash = receipt.transactionHash; payment.explorerUrl = explorerTxUrl(network, receipt.transactionHash); }
    payment.settledAt ??= iso();
    if (pointsOn) {
      const sessionId = db.pendingPays[payment.paymentId]?.sessionId;
      const session = sessionId ? db.sessions[sessionId] : undefined;
      try { applyPayment(db, payment, session?.kind === "checkout" ? session.value.reward?.name ?? null : null); } catch { /* onchain the router would have reverted; the ledger stays consistent */ }
    }
    projectInvoices();
    const inv = db.invoices.find((i) => i.id === payment.invoiceId);
    if (inv && inv.paid !== previous) emit(inv.status === "paid" ? "invoice.paid" : "invoice.partially_paid", inv.merchantSlug, `${inv.id}_${inv.paid}`, inv);
    emit("payment.confirmed", payment.merchantSlug, payment.paymentId, payment);
    save();
  }
  /** All transfer types share receipt projection and canonical finality tracking. */
  async function relayPayment(paymentId: string) {
    if (inFlight.has(paymentId)) return;
    inFlight.add(paymentId);
    const payment = db.payments.find((p) => p.paymentId === paymentId);
    const pending = db.pendingPays[paymentId];
    try {
      if (!payment) return;
      if (!payment.txHash) {
        const entry = pending && db.sessions[pending.sessionId];
        if (!pending || !entry || entry.kind !== "checkout") throw new PermanentChainError("Payment details are missing");
        const a = pending.auth;
        const hash = await chain.pay({ quote: quoteFromWire(entry.value.quote), merchantSignature: entry.value.quote.merchantSignature as Hex, auth: { from: a.from, refundTo: a.refundTo, salt: a.salt, validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), signature: a.signature } });
        payment.status = "submitted";
        payment.txHash = hash;
        payment.explorerUrl = explorerTxUrl(network, hash);
        save();
      }
      if (payment.status === "submitted" || payment.status === "queued") {
        const receipt = await chain.waitForReceipt(payment.txHash as Hex);
        if (!receipt.success) throw new PermanentChainError(receipt.error ?? "Transaction reverted");
        includePayment(payment, receipt);
      }
      await followFinality(payment);
    } catch (error) {
      if (payment) {
        if (error instanceof PermanentChainError) {
          payment.status = "failed";
          if (payment.txHash) for (const key of [payment.payer.toLowerCase(), payment.merchantSlug]) { const day = iso().slice(0, 10); const previous = db.failureBudgets[key]; db.failureBudgets[key] = { day, count: previous?.day === day ? previous.count + 1 : 1 }; }
          emit("payment.failed", payment.merchantSlug, payment.paymentId, payment);
        }
        payment.error = { code: "server_error", message: error instanceof PermanentChainError ? error.message : "Payment outcome is being reconciled. Do not create a second payment." };
        projectInvoices();
        save();
      }
    } finally { inFlight.delete(paymentId); }
  }
  async function followFinality(payment: Payment) {
    const started = Date.now();
    while (payment.status !== "finalized" && payment.blockNumber && Date.now() - started < 60_000) {
      const status = chain.transactionStatus && payment.txHash ? await chain.transactionStatus(payment.txHash as Hex) : undefined;
      if (status === null) {
        payment.status = "submitted";
        payment.blockNumber = null;
        payment.blockHash = null;
        payment.settledAt = null;
        projectInvoices();
        save();
        return;
      }
      if (status && !status.success) throw new PermanentChainError("Canonical transaction reverted");
      if (status) { payment.blockNumber = status.blockNumber.toString(); payment.blockHash = status.blockHash; }
      const level = status?.finality ?? await chain.finality(BigInt(payment.blockNumber));
      if (level !== payment.status) {
        payment.status = level;
        payment.error = null;
        if (level !== "included") emit(level === "safe" ? "payment.safe" : "payment.finalized", payment.merchantSlug, payment.paymentId, payment);
        save();
      }
      if (payment.status === "finalized") break;
      await sleep(pollMs);
    }
  }

  // ---------- installment plans ----------

  async function planSession(body: Json): Promise<PlanSession> {
    const payer = getAddress(String(body.payer));
    const option = planOption.parse(body.option ?? {});
    let inv: Invoice;
    if (typeof body.invoiceId === "string") {
      const found = db.invoices.find((i) => i.id === body.invoiceId);
      if (!found) throw httpError(404, "not_found", "Invoice not found");
      inv = found;
    } else {
      const m = findMerchant(String(body.merchant));
      if (!m) throw httpError(404, "not_found", "Merchant not found");
      inv = newInvoice(m, lineItemsFor(m.slug, body.items as never), { type: "full" }, payer);
    }
    const m = findMerchant(inv.merchantSlug)!;
    validateInvoice(inv, m);
    if (inv.paid !== "0") throw httpError(409, "invoice_overpaid", "A plan needs an unpaid invoice");
    const period = Math.max(60, Number(option.periodSeconds ?? 30 * 86_400));
    const split = installmentSplit(BigInt(inv.total), option.count ?? 3, option.downPaymentPercent ?? 0);
    const terms = {
      merchantId: m.merchantId as Hex,
      planId: idFromUuid(uid("plan")),
      invoiceDigest: inv.digest as Hex,
      payer,
      token: usdt,
      downPayment: split.downPayment,
      installmentAmount: split.installmentAmount,
      feePerInstallment: protocolFee(split.installmentAmount, fees),
      downPaymentFee: split.downPayment > 0n ? protocolFee(split.downPayment, fees) : 0n,
      count: split.count,
      period,
      firstDue: nowSeconds() + BigInt(period),
      grace: option.graceSeconds ?? 3 * 86_400,
      splitProfileId: inv.splitProfileId ?? 0,
      kind: 0,
      validUntil: BigInt(Math.min(Number(nowSeconds() + 900n), Math.floor(Date.parse(inv.validUntil) / 1000))),
      ...(pointsOn ? { pointsPerCharge: earnFor(db, m.slug, split.installmentAmount, maxPoints), downPaymentPoints: split.downPayment > 0n ? earnFor(db, m.slug, split.downPayment, maxPoints) : 0n } : {}),
    };
    if (!isMerchantSigner(m, signer.address)) throw httpError(409, "config_invalid", "Authorize the hosted signer before creating a plan");
    const sig = await signer.signTypedData(planTermsTypedData(network, terms));
    const [committed, permitNonce] = await Promise.all([chain.committed(payer), chain.permitNonce(payer)]);
    const session: PlanSession = {
      id: uid("ps"),
      merchant: m,
      invoice: inv,
      terms: planTermsToWire(terms, sig, hashPlanTerms(network, terms)),
      committed: committed.toString(),
      permitNonce: permitNonce.toString(),
      router,
      chainId: network.chain.id,
      expiresAt: iso(Date.now() + 900_000),
    };
    db.sessions[session.id] = { kind: "plan", value: session };
    return session;
  }

  async function authorizePlan(id: string, body: Json): Promise<Plan> {
    const entry = db.sessions[id];
    if (!entry || entry.kind !== "plan") throw httpError(404, "not_found", "Plan session not found");
    const s = entry.value;
    const existing = db.plans.find((p) => p.planId === s.terms.planId);
    if (existing) { if (existing.status === "pending") await runPlanJob(existing.planId); return existing; }
    const payer = getAddress(String(body.payer));
    const consentDeadline = BigInt(String(body.consentDeadline));
    const consent = await recoverTypedDataAddress({
      ...planConsentTypedData(network, { termsHash: s.terms.termsHash as Hex, payer, deadline: consentDeadline }),
      signature: body.consentSignature as Hex,
    });
    const permit = body.permit as { value: string; deadline: string; signature: Hex };
    const permitSigner = await recoverTypedDataAddress({
      ...permitTypedData(network, { owner: payer, spender: router, value: BigInt(permit.value), nonce: BigInt(s.permitNonce), deadline: BigInt(permit.deadline) }),
      signature: permit.signature,
    });
    if (!isAddressEqual(consent, payer) || !isAddressEqual(permitSigner, payer)) throw httpError(400, "signature_invalid", "Plan signatures do not match the payer");
    const terms = planTermsFromWire(s.terms);
    validateInvoice(s.invoice, s.merchant);
    if (!isAddressEqual(payer, terms.payer)) throw httpError(403, "forbidden", "Plan belongs to another payer");
    if (db.plans.some((p) => db.planInvoices[p.planId] === s.invoice.id && p.status !== "cancelled")) throw httpError(409, "already_settled", "This invoice already has a plan");
    const firstDueMs = Number(s.terms.firstDue) * 1000;
    const plan: Plan = {
      id: uid("plan"),
      planId: await keys.plan(s.terms.merchantId as Hex, s.terms.planId as Hex),
      merchantSlug: s.merchant.slug,
      merchantName: s.merchant.name,
      payer,
      token: "USDT",
      kind: "installments",
      downPayment: s.terms.downPayment,
      installmentAmount: s.terms.installmentAmount,
      count: s.terms.count,
      collected: 0,
      periodSeconds: s.terms.period,
      graceSeconds: s.terms.grace,
      status: "pending",
      nextDueAt: iso(firstDueMs),
      installments: Array.from({ length: s.terms.count }, (_, index) => ({
        index,
        dueAt: iso(firstDueMs + index * s.terms.period * 1000),
        amount: s.terms.installmentAmount,
        status: "scheduled" as const,
        paymentId: null,
      })),
      createdAt: iso(),
    };
    db.plans.unshift(plan);
    db.planTerms[plan.planId] = s.terms;
    db.planInvoices[plan.planId] = s.invoice.id;
    db.jobs[plan.planId] = { kind: "plan", sessionId: id, body, txHash: null };
    save();
    await runPlanJob(plan.planId);
    return plan;
  }

  async function cancelPlan(planId: string, body: Json): Promise<Plan> {
    const plan = db.plans.find((p) => p.planId === planId);
    if (!plan) throw httpError(404, "not_found", "Plan not found");
    if (plan.status === "cancelled" || plan.status === "completed") return plan;
    const signerAddress = getAddress(String(body.signer));
    const message = { planId: planId as Hex, signer: signerAddress, deadline: BigInt(String(body.deadline)) };
    const recovered = await recoverTypedDataAddress({ ...cancelPlanTypedData(network, message), signature: body.signature as Hex });
    const m = findMerchant(plan.merchantSlug);
    const allowed = isAddressEqual(signerAddress, plan.payer) || (m && isMerchantSigner(m, signerAddress));
    if (!isAddressEqual(recovered, signerAddress) || !allowed) throw httpError(403, "forbidden", "Only the payer or the merchant can cancel this plan");
    db.jobs[`cancel:${planId}`] = db.jobs[`cancel:${planId}`] ?? { kind: "cancel", planId, body, txHash: null };
    save();
    await runPlanJob(`cancel:${planId}`);
    return plan;
  }

  async function planPayment(plan: Plan, gross: string, fee: string, index: number, hash: Hex, receipt: { blockNumber: bigint; blockHash?: Hex; transactionHash?: Hex }) {
    const paymentId = await keys.installment(plan.planId as Hex, index);
    const existing = db.payments.find((p) => p.paymentId === paymentId);
    if (existing) return existing;
    const inv = db.invoices.find((i) => i.id === db.planInvoices[plan.planId]);
    const planTerms = db.planTerms[plan.planId];
    const earned = index === DOWN_PAYMENT_INDEX ? planTerms?.downPaymentPoints : planTerms?.pointsPerCharge;
    const payment: Payment = { ...(pointsOn && earned && earned !== "0" ? { pointsEarned: earned } : {}), paymentId, merchantSlug: plan.merchantSlug, merchantName: plan.merchantName, invoiceId: inv?.id ?? null, planId: plan.planId, kind: index === DOWN_PAYMENT_INDEX ? "down_payment" : "installment", payer: plan.payer, refundTo: plan.payer, token: "USDT", gross, fee, net: (BigInt(gross) - BigInt(fee)).toString(), refunded: "0", status: "submitted", txHash: hash, blockNumber: null, explorerUrl: explorerTxUrl(network, hash), error: null, createdAt: iso(), settledAt: null, externalOrderId: inv?.externalOrderId ?? null, metadata: inv?.metadata ?? {} };
    db.payments.unshift(payment);
    includePayment(payment, receipt);
    void relayPayment(payment.paymentId);
    return payment;
  }
  async function runPlanJob(key: string) {
    if (inFlight.has(key)) return;
    const job = db.jobs[key];
    if (!job) return;
    const plan = db.plans.find((p) => p.planId === (job.planId ?? key));
    if (!plan) return;
    if (job.kind === "plan" && ["cancelled", "completed"].includes(plan.status)) { delete db.jobs[key]; save(); return; }
    inFlight.add(key);
    try {
      const terms = db.planTerms[plan.planId]!;
      if (!job.txHash) {
        if (job.kind === "plan") {
          const permit = job.body.permit as { value: string; deadline: string; signature: Hex };
          job.txHash = await chain.createPlan({ terms: planTermsFromWire(terms), merchantSignature: terms.merchantSignature as Hex, consentSignature: job.body.consentSignature as Hex, consentDeadline: BigInt(String(job.body.consentDeadline ?? "0")), permit: { value: BigInt(permit.value), deadline: BigInt(permit.deadline), signature: permit.signature } });
        } else if (job.kind === "cancel") {
          job.txHash = await chain.cancelPlan({ message: { planId: plan.planId as Hex, signer: getAddress(String(job.body.signer)), deadline: BigInt(String(job.body.deadline)) }, signature: job.body.signature as Hex });
        } else job.txHash = await chain.collectInstallment(plan.planId as Hex, job.index);
        save();
      }
      const receipt = await chain.waitForReceipt(job.txHash);
      if (!receipt.success) throw new PermanentChainError(receipt.error ?? "Plan transaction reverted");
      // Plan schedule/cancellation projections are committed only after canonical finality.
      // Until then retain the durable job and prevent the next collection advancing its index.
      if (chain.transactionStatus) {
        const status = await chain.transactionStatus(job.txHash);
        if (!status || status.finality !== "finalized") return;
        if (!status.success) throw new PermanentChainError("Canonical plan transaction reverted");
      }
      if (job.kind === "plan") {
        plan.status = "active";
        if (BigInt(plan.downPayment) > 0n) await planPayment(plan, plan.downPayment, terms.downPaymentFee, DOWN_PAYMENT_INDEX, job.txHash, receipt);
        emit("plan.created", plan.merchantSlug, plan.planId, plan);
      } else if (job.kind === "cancel") {
        plan.status = "cancelled";
        plan.nextDueAt = null;
        emit("plan.cancelled", plan.merchantSlug, plan.planId, plan);
      } else {
        const inst = plan.installments[job.index!]!;
        const payment = await planPayment(plan, inst.amount, terms.feePerInstallment, inst.index, job.txHash, receipt);
        inst.status = "collected";
        inst.paymentId = payment.paymentId;
        plan.collected = Math.max(plan.collected, inst.index + 1);
        plan.status = plan.status === "cancelled" ? "cancelled" : plan.collected >= plan.count ? "completed" : "active";
        plan.nextDueAt = plan.status === "cancelled" ? null : plan.installments[plan.collected]?.dueAt ?? null;
        emit("plan.installment_collected", plan.merchantSlug, `${plan.planId}_${inst.index}`, plan);
        if (plan.status === "completed") emit("plan.completed", plan.merchantSlug, plan.planId, plan);
      }
      delete db.jobs[key];
      save();
    } catch (error) {
      if (error instanceof PermanentChainError) {
        if (job.kind === "plan") plan.status = "cancelled";
        if (job.kind === "collect") {
          const inst = plan.installments[job.index!]!;
          if (Date.now() > Date.parse(inst.dueAt) + plan.graceSeconds * 1000) { plan.status = "delinquent"; inst.status = "missed"; emit("plan.installment_missed", plan.merchantSlug, `${plan.planId}_${inst.index}`, plan); }
        }
        delete db.jobs[key];
      }
      save();
      throw error;
    } finally { inFlight.delete(key); }
  }
  async function collectDue() {
    for (const plan of db.plans.filter((p) => (p.status === "active" || p.status === "delinquent") && p.collected < p.count)) {
      const inst = plan.installments[plan.collected];
      if (!inst || Date.parse(inst.dueAt) > Date.now()) continue;
      const key = `collect:${plan.planId}:${inst.index}`;
      db.jobs[key] ??= { kind: "collect", planId: plan.planId, index: inst.index, body: {}, txHash: null };
      save();
      await runPlanJob(key).catch(() => {});
    }
  }

  // ---------- refunds ----------

  async function relayRefund(refund: Refund) {
    const key = `refund:${refund.id}`;
    if (inFlight.has(key) || refund.status === "settled" || refund.status === "failed") return;
    const job = db.refundJobs[refund.id];
    const terms = db.refundTerms[refund.id];
    if (!job || !terms) return;
    inFlight.add(key);
    try {
      if (!refund.txHash) {
        refund.txHash = await chain.refund({ terms: refundTermsFromWire(terms), merchantSignature: job.merchantSignature, funder: { ...job.funder, validAfter: BigInt(job.funder.validAfter), validBefore: BigInt(job.funder.validBefore) } });
        refund.status = "submitted";
        refund.explorerUrl = explorerTxUrl(network, refund.txHash);
        save();
      }
      const receipt = await chain.waitForReceipt(refund.txHash as Hex);
      if (receipt.transactionHash) { refund.txHash = receipt.transactionHash; refund.explorerUrl = explorerTxUrl(network, receipt.transactionHash); }
      if (!receipt.success) throw new PermanentChainError(receipt.error ?? "Refund reverted");
      if (chain.transactionStatus) {
        const current = await chain.transactionStatus(refund.txHash as Hex);
        if (!current || current.finality !== "finalized") return;
        if (!current.success) throw new PermanentChainError("Refund reverted");
      }
      refund.status = "settled";
      refund.settledAt = iso();
      for (const payment of db.payments) payment.refunded = db.refunds.filter((r) => r.paymentId === payment.paymentId && r.status === "settled").reduce((sum, r) => sum + BigInt(r.amount), 0n).toString();
      const refunded = db.payments.find((p) => p.paymentId === refund.paymentId);
      if (pointsOn && refunded) applyRefund(db, refunded);
      projectInvoices();
      emit("refund.succeeded", refund.merchantSlug, refund.refundId, refund);
    } catch (error) {
      if (error instanceof PermanentChainError) { refund.status = "failed"; emit("refund.failed", refund.merchantSlug, refund.refundId, refund); }
    } finally { inFlight.delete(key); save(); }
  }

  // ---------- domains ----------

  async function checkDomain(m: Merchant, challenge: DomainChallenge, file?: unknown): Promise<string | null> {
    let body: Record<string, unknown> | null = null;
    if (options.domainCheck === "trust" && typeof file === "string") body = JSON.parse(file) as Record<string, unknown>;
    else if (options.domainCheck !== "trust") {
      try {
        const res = await doFetch(challenge.wellKnownUrl, { redirect: "error", headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return `${challenge.wellKnownUrl} returned ${res.status}`;
        body = (await res.json()) as Record<string, unknown>;
      } catch {
        return `Couldn't load ${challenge.wellKnownUrl}`;
      }
    }
    if (!body && options.domainCheck !== "trust") return "The verification file is empty or invalid";
    if (body) {
      if (body.payout !== m.payout) return "The payout does not match";
      if (body.merchantId !== m.merchantId || body.token !== challenge.wellKnownBody.token) return "The file's merchant ID or token doesn't match";
      try {
        const owner = await recoverMessageAddress({ message: wellKnownSigningText(body), signature: body.ownerSignature as Hex });
        if (!isAddressEqual(owner, m.owner)) return "The file isn't signed by your owner wallet";
      } catch {
        return "The file's signature is missing or invalid";
      }
    }
    return null;
  }

  async function refreshDomains() {
    if (options.domainCheck === "trust") return;
    for (const entry of Object.values(db.domains)) {
      if (entry.challenge.status !== "verified" || (entry.challenge.lastCheckedAt && Date.now() - Date.parse(entry.challenge.lastCheckedAt) < 86400000)) continue;
      const merchant = findMerchant(entry.owner);
      if (!merchant) continue;
      const domain = entry.challenge.domain;
      const proof = merchant.verifiedDomains.find((d) => d.domain === domain);
      const problem = !proof || Date.parse(proof.expiresAt) <= Date.now() ? "Domain verification expired" : await checkDomain(merchant, entry.challenge);
      entry.challenge.lastCheckedAt = iso();
      if (problem) {
        entry.challenge.status = "failed"; entry.challenge.error = problem;
        merchant.verifiedDomains = merchant.verifiedDomains.filter((d) => d.domain !== domain);
        merchant.listed = merchant.verifiedDomains.length > 0;
        db.domainRevocations[`${merchant.slug}:${domain}`] = { merchantId: merchant.merchantId as Hex, domainHash: domainHash(domain), txHash: null };
        emit("merchant.domain_revoked", merchant.slug, `${domain}:${iso().slice(0, 10)}`, merchant);
        save();
      }
    }
    if (!chain.revokeDomain) return;
    for (const [id, job] of Object.entries(db.domainRevocations)) {
      try {
        if (!job.txHash) { job.txHash = await chain.revokeDomain(job); save(); }
        const receipt = await chain.waitForReceipt(job.txHash);
        const status = chain.transactionStatus ? await chain.transactionStatus(job.txHash) : null;
        if (receipt.success && (!chain.transactionStatus || status?.finality === "finalized")) delete db.domainRevocations[id];
      } catch { /* Retain uncertain revocations for the next tick. */ }
    }
  }

  // ---------- journal ----------

  function journalCsv(slug: string, from: string | null, to: string | null): string {
    const inRange = (t: string | null) => !!t && (!from || t >= from) && (!to || t <= to);
    const rows: string[][] = [["date", "entry", "reference", "account", "debit", "credit", "asset", "tx_hash", "mapping_version"]];
    const fmt = (v: string | bigint) => {
      const n = BigInt(v);
      return `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, "0")}`;
    };
    for (const p of db.payments.filter((x) => x.merchantSlug === slug && SETTLED.includes(x.status) && inRange(x.settledAt))) {
      const ref = [p.settledAt!, "payment", p.paymentId];
      rows.push([...ref, "merchant:usdt_wallet", fmt(p.net), "", "USDT", p.txHash ?? "", "v1"]);
      rows.push([...ref, "merchant:fees_expense", fmt(p.fee), "", "USDT", p.txHash ?? "", "v1"]);
      rows.push([...ref, "merchant:sales_clearing", "", fmt(p.gross), "USDT", p.txHash ?? "", "v1"]);
    }
    for (const r of db.refunds.filter((x) => x.merchantSlug === slug && x.status === "settled" && inRange(x.settledAt))) {
      const ref = [r.settledAt!, "refund", r.refundId];
      rows.push([...ref, "merchant:refunds", fmt(r.amount), "", "USDT", r.txHash ?? "", "v1"]);
      rows.push([...ref, "merchant:usdt_wallet", "", fmt(BigInt(r.amount) + BigInt(r.fee)), "USDT", r.txHash ?? "", "v1"]);
      if (r.fee !== "0") rows.push([...ref, "merchant:fees_expense", fmt(r.fee), "", "USDT", r.txHash ?? "", "v1"]);
    }
    return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n") + "\n";
  }

  const statusFilter = (status: string | null) => (p: Payment) =>
    status === "pending" ? !SETTLED.includes(p.status) && p.status !== "failed" : status === "settled" ? SETTLED.includes(p.status) : true;

  async function refill() {
    const config = options.refill;
    if (!config || !chain.refillState || !chain.quoteRefill || !chain.refill) return;
    const pending = db.refill.runs.find((r) => r.action === "SUBMITTED" || r.action === "RUN");
    if (pending) {
      if (!pending.txHash) {
        try { pending.txHash = await chain.refill({ amount: BigInt(pending.amount!), minOutput: BigInt(pending.minOutput!), deadline: BigInt(pending.deadline!) }); pending.action = "SUBMITTED"; save(); }
        catch (error) { if (error instanceof PermanentChainError) { pending.action = "FAILED"; pending.reason = error.message; save(); } return; }
      }
      const receipt = await chain.waitForReceipt(pending.txHash);
      if (chain.transactionStatus) { const status = await chain.transactionStatus(pending.txHash); if (!status || status.finality !== "finalized") return; }
      pending.action = receipt.success ? "CONFIRMED" : "FAILED";
      pending.nativeAfter = (await chain.refillState()).nativeBalance.toString();
      save(); return;
    }
    const state = await chain.refillState();
    const target = config.measuredPaymentCost * 500n;
    const available = state.nativeBalance - state.reservedGas - config.reserve;
    db.refill.paused = state.nativeBalance - state.reservedGas < config.reserve;
    if (Date.now() - db.refill.lastAt < (config.intervalMs ?? 1800000) && available >= config.measuredPaymentCost * 100n) return;
    if (db.refill.runs.filter((r) => r.createdAt > Date.now() - 3600000 && ["FAILED", "RUN", "SUBMITTED"].includes(r.action)).length >= 3) return;
    db.refill.lastAt = Date.now();
    const run = { id: uid("refill"), action: "SKIP", reason: "runway ok", createdAt: Date.now(), nativeBefore: state.nativeBalance.toString(), amount: undefined as string | undefined, minOutput: undefined as string | undefined, deadline: undefined as string | undefined, cost: undefined as string | undefined, txHash: undefined as Hex | undefined };
    db.refill.runs.push(run);
    if (available >= target) { save(); return; }
    const price = await chain.quoteRefill(1000000n);
    const amount = refillAmount(state, price.output, { reserve: config.reserve, target });
    if (amount < 1000000n) { run.reason = "batch too small"; save(); return; }
    const quote = await chain.quoteRefill(amount);
    const decision = decideRefill(state, amount, quote, { reserve: config.reserve, highWatermark: target });
    run.action = decision.action; run.reason = decision.action === "RUN" ? "economic gate passed" : decision.reason;
    if (decision.action === "PAUSE") db.refill.paused = true;
    if (decision.action === "RUN") {
      run.amount = amount.toString(); run.minOutput = decision.minOutput.toString(); run.cost = decision.cost.toString(); run.deadline = (nowSeconds() + 120n).toString();
      save();
      try { run.txHash = await chain.refill({ amount, minOutput: decision.minOutput, deadline: BigInt(run.deadline) }); run.action = "SUBMITTED"; }
      catch (error) { run.action = "FAILED"; run.reason = error instanceof Error ? error.message : "Refill failed"; }
    }
    save();
  }

  /** Canonical onchain IDs (router keys), or the local IDs on the simulated chain. */
  const keys = chain.keys ?? {
    payment: async (_merchantId: Hex, localPaymentId: Hex) => localPaymentId,
    plan: async (_merchantId: Hex, localPlanId: Hex) => localPlanId,
    installment: async (planKey: Hex, index: number) => installmentPaymentId(planKey, index),
  };

  /** Observe finalized public events, including payments submitted outside this API. */
  async function observe() {
    if (!chain.observe || options.observerStartBlock === undefined) return;
    const from = BigInt(db.observer.nextBlock ?? options.observerStartBlock.toString());
    const result = await chain.observe(from);
    for (const event of result.events) {
      if (event.chainId !== network.chain.id) throw new Error("Observer chain mismatch");
      if (db.observer.events.some((e) => e.transactionHash === event.transactionHash && e.logIndex === event.logIndex)) continue;
      const a = event.args;
      let merchant = db.merchants.find((m) => m.merchantId?.toLowerCase() === String(a.merchantId).toLowerCase());
      if (event.eventName === "MerchantRegistered" && !merchant) {
        merchant = { slug: `chain-${String(a.merchantId).slice(2, 18)}`, merchantId: a.merchantId as Hex, name: "Registered merchant", category: null, description: null, logoUrl: null, website: null, owner: getAddress(String(a.owner)), payout: getAddress(String(a.payout)), status: "active", verifiedDomains: [], listed: false, acceptedTokens: ["USDT"], createdAt: iso() };
        db.merchants.push(merchant);
      }
      if (event.eventName === "PaymentSettled" && merchant) {
        const inv = db.invoices.find((i) => i.merchantSlug === merchant!.slug && invoiceKey(merchant!.merchantId as Hex, i.invoiceId as Hex).toLowerCase() === String(a.invoiceKey).toLowerCase());
        const planId = /^0x0+$/.test(String(a.planId)) ? null : String(a.planId);
        let payment = db.payments.find((p) => p.paymentId.toLowerCase() === String(a.paymentId).toLowerCase());
        if (!payment) {
          payment = { paymentId: a.paymentId as Hex, merchantSlug: merchant.slug, merchantName: merchant.name, invoiceId: inv?.id ?? null, planId, kind: planId ? ((await keys.installment(planId as Hex, DOWN_PAYMENT_INDEX)).toLowerCase() === String(a.paymentId).toLowerCase() ? "down_payment" : "installment") : "one_time", payer: getAddress(String(a.payer)), refundTo: getAddress(String(a.refundTo)), token: "USDT", gross: String(a.gross), fee: String(a.fee), net: String(a.net), refunded: "0", status: "submitted", txHash: event.transactionHash, blockNumber: null, explorerUrl: explorerTxUrl(network, event.transactionHash), error: null, createdAt: iso(), settledAt: null, externalOrderId: inv?.externalOrderId ?? null, metadata: inv?.metadata ?? {} };
          db.payments.unshift(payment);
        }
        payment.gross = String(a.gross); payment.fee = String(a.fee); payment.net = String(a.net);
        if (payment.status !== "finalized") {
          includePayment(payment, { blockNumber: BigInt(event.blockNumber), blockHash: event.blockHash, transactionHash: event.transactionHash });
          payment.status = "finalized";
          emit("payment.safe", payment.merchantSlug, payment.paymentId, payment);
          emit("payment.finalized", payment.merchantSlug, payment.paymentId, payment);
        }
        delete db.pendingPays[payment.paymentId];
      } else if (event.eventName === "Refill") {
        const run = db.refill.runs.find((r) => r.txHash === event.transactionHash || Object.values(db.transactions).some((j) => j.hash === event.transactionHash && r.txHash && j.hashes?.includes(r.txHash)));
        if (run) { run.output = String(a.wbtOut); run.action = "CONFIRMED"; }
      } else if (event.eventName === "RefundSettled") {
        const payment = db.payments.find((p) => p.paymentId.toLowerCase() === String(a.paymentId).toLowerCase());
        if (payment) {
          let refund = db.refunds.find((r) => r.refundId.toLowerCase() === String(a.refundId).toLowerCase());
          if (!refund) { refund = { id: `chain_${a.refundId}`, refundId: a.refundId as Hex, paymentId: payment.paymentId, merchantSlug: payment.merchantSlug, merchantName: payment.merchantName, to: getAddress(String(a.to)), amount: String(a.amount), fee: String(a.fee), reason: null, status: "submitted", txHash: event.transactionHash, explorerUrl: explorerTxUrl(network, event.transactionHash), createdAt: iso(), settledAt: null }; db.refunds.push(refund); }
          refund.status = "settled"; refund.settledAt ??= iso(); refund.txHash = event.transactionHash;
          payment.refunded = String(a.cumulativeRefunded);
          if (pointsOn) applyRefund(db, payment);
          emit("refund.succeeded", refund.merchantSlug, refund.refundId, refund);
        }
      } else if (event.eventName === "PayoutChanged" && merchant) { merchant.payout = getAddress(String(a.newPayout)); merchant.pendingPayout = null;
      } else if (event.eventName === "SignerSet" && merchant) {
        const address = getAddress(String(a.signer));
        const record = { owner: merchant.slug, address, kind: isAddressEqual(address, signer.address) ? "hosted" as const : "self" as const, enabled: Boolean(a.enabled), expiresAt: String(a.expiresAt) === "0" ? null : iso(Number(a.expiresAt) * 1000), status: a.enabled ? "active" as const : "disabled" as const, createdAt: iso() };
        const existing = db.signers.find((s) => s.owner === merchant!.slug && isAddressEqual(s.address, address));
        if (existing) Object.assign(existing, record); else db.signers.push(record);
      } else if (["PlanCancelled", "PlanCompleted", "InstallmentCollected"].includes(event.eventName)) {
        const plan = db.plans.find((p) => p.planId.toLowerCase() === String(a.planId).toLowerCase());
        if (plan && event.eventName === "PlanCancelled") { plan.status = "cancelled"; plan.nextDueAt = null; emit("plan.cancelled", plan.merchantSlug, plan.planId, plan); }
        if (plan && event.eventName === "PlanCompleted") { plan.status = "completed"; plan.nextDueAt = null; emit("plan.completed", plan.merchantSlug, plan.planId, plan); }
        if (plan && event.eventName === "InstallmentCollected") { const index = Number(a.index); const inst = plan.installments[index]; if (inst) { inst.status = "collected"; inst.paymentId = a.paymentId as Hex; plan.collected = Math.max(plan.collected, index + 1); plan.nextDueAt = plan.installments[plan.collected]?.dueAt ?? null; } }
      } else if (event.eventName === "DomainRevoked" && merchant) {
        merchant.verifiedDomains = merchant.verifiedDomains.filter((d) => domainHash(d.domain).toLowerCase() !== String(a.domainHash).toLowerCase());
        merchant.listed = merchant.verifiedDomains.length > 0;
        emit("merchant.domain_revoked", merchant.slug, String(a.domainHash), merchant);
      }
      db.observer.events.push(event);
    }
    db.observer.nextBlock = result.nextBlock.toString();
    projectInvoices();
    save();
  }

  // ---------- router ----------

  async function route(method: string, path: string, query: URLSearchParams, body: Json, headers: Headers): Promise<unknown> {
    const is = (m: string, p: string) => method === m && path === p;
    const match = (m: string, re: RegExp) => (method === m ? path.match(re) : null);
    const arg = (mm: RegExpMatchArray) => decodeURIComponent(mm[1]!);
    let mm: RegExpMatchArray | null;
    const browser = await browserMerchant(headers);
    const restricted = (slug: string) => scope(slug, browser);
    if (method === "POST" && [routes.checkoutSessions(), routes.planSessions()].includes(path)) {
      if (options.requirePublishableKey !== false && options.domainCheck !== "trust" && !browser && !headers.get("authorization")) throw httpError(401, "unauthorized", "A publishable key is required for checkout");
      const sessionEntry = typeof body.sessionId === "string" ? db.sessions[body.sessionId] : null;
      if (sessionEntry) body = { ...body, invoiceId: sessionEntry.value.invoice.id };
      const invoice = typeof body.invoiceId === "string" ? db.invoices.find((i) => i.id === body.invoiceId) : null;
      restricted(invoice?.merchantSlug ?? String(body.merchant));
      if (!browser && headers.get("authorization")) { const who = await auth(headers); if (headers.get("authorization")?.startsWith("Bearer sk_") && (invoice?.merchantSlug ?? body.merchant) !== who.merchantSlug) throw httpError(403, "forbidden", "Invoice belongs to another merchant"); }
    }

    // public
    if (is("GET", routes.config())) {
      return {
        network: network.key,
        chainId: network.chain.id,
        contracts: { registry, router, treasury: network.contracts.treasury ?? zeroAddress, ...(network.contracts.points ? { points: network.contracts.points } : {}), routerVersion: routerVersionOf(network) },
        usdt,
        feeSchedule: { bps: fees.bps, minFee: fees.minFee.toString(), maxFee: fees.maxFee.toString() },
      };
    }
    if (is("GET", routes.status())) {
      const s = await chain.sponsorship();
      return { sponsorshipAvailable: s.ok, reason: s.reason, chainId: network.chain.id };
    }
    if (is("GET", routes.directory())) {
      const q = query.get("q")?.toLowerCase();
      const category = query.get("category");
      return page(db.merchants.filter((m) => m.listed && m.status === "active" && m.verifiedDomains.some((d) => Date.parse(d.expiresAt) > Date.now()) && (!q || m.name.toLowerCase().includes(q)) && (!category || m.category === category)));
    }
    if ((mm = match("GET", /^\/v1\/merchants\/([^/]+)\/loyalty$/))) {
      const m = findMerchant(arg(mm));
      if (!m) throw httpError(404, "not_found", "Merchant not found");
      const program = programOf(db, m.slug, maxPoints);
      return { ...program, enabled: pointsOn && program.enabled, rewards: program.rewards.filter((r) => r.active) };
    }
    if ((mm = match("POST", /^\/v1\/checkout\/sessions\/([^/]+)\/reward$/))) return applyReward(arg(mm), body);
    if ((mm = match("GET", /^\/v1\/merchants\/([^/]+)\/products$/))) {
      const slug = arg(mm);
      restricted(slug);
      return page(db.products.filter((p) => p.merchantSlug === slug && p.active));
    }
    if ((mm = match("GET", /^\/v1\/merchants\/([^/]+)$/))) {
      const m = findMerchant(arg(mm));
      if (!m) throw httpError(404, "not_found", "Merchant not found");
      return m;
    }
    if ((mm = match("GET", /^\/v1\/invoices\/([^/]+)\/public$/))) {
      const id = arg(mm);
      const inv = db.invoices.find((i) => i.id === id);
      if (!inv) throw httpError(404, "not_found", "Invoice not found");
      restricted(inv.merchantSlug);
      return inv;
    }
    if (is("POST", routes.checkoutSessions())) return checkoutSession(body);
    if ((mm = match("GET", /^\/v1\/checkout\/sessions\/([^/]+)$/))) {
      const entry = db.sessions[arg(mm)];
      if (!entry || entry.kind !== "checkout") throw httpError(404, "not_found", "Checkout session not found");
      restricted(entry.value.merchant.slug);
      return entry.value;
    }
    if ((mm = match("POST", /^\/v1\/checkout\/sessions\/([^/]+)\/authorize$/))) { const session = db.sessions[arg(mm)]; if (session) restricted(session.value.merchant.slug); return authorizeCheckout(arg(mm), body); }
    if ((mm = match("GET", /^\/v1\/payments\/([^/]+)$/))) {
      const id = arg(mm);
      const p = db.payments.find((x) => x.paymentId === id);
      if (!p) throw httpError(404, "not_found", "Payment not found");
      restricted(p.merchantSlug);
      return p;
    }
    if (is("POST", routes.planSessions())) return planSession(body);
    if ((mm = match("POST", /^\/v1\/plans\/sessions\/([^/]+)\/authorize$/))) { const session = db.sessions[arg(mm)]; if (session) restricted(session.value.merchant.slug); return authorizePlan(arg(mm), body); }
    if ((mm = match("POST", /^\/v1\/plans\/([^/]+)\/cancel$/))) return cancelPlan(arg(mm), body);

    if ((mm = match("GET", /^\/v1\/plans\/([^/]+)$/))) {
      const id = arg(mm);
      const plan = db.plans.find((p) => p.planId === id || p.id === id);
      if (!plan) throw httpError(404, "not_found", "Plan not found");
      restricted(plan.merchantSlug);
      if (headers.get("authorization")?.startsWith("Bearer sk_")) { const m = await myMerchant(headers); if (m.slug !== plan.merchantSlug) throw httpError(403, "forbidden", "Plan belongs to another merchant"); }
      return plan;
    }
    // sign-in
    if (is("POST", routes.siweNonce())) {
      const nonce = randomHex(12);
      db.nonces[nonce] = Date.now();
      for (const [k, at] of Object.entries(db.nonces)) if (Date.now() - at > 600_000) delete db.nonces[k];
      return { nonce };
    }
    if (is("POST", routes.siweVerify())) {
      const message = String(body.message);
      const parsed = parseSiweMessage(message);
      if (!parsed.nonce || !(parsed.nonce in db.nonces) || !parsed.address) throw httpError(401, "unauthorized", "Unknown or used login nonce");
      if (Date.now() - db.nonces[parsed.nonce]! > 600000) throw httpError(401, "unauthorized", "Login nonce expired");
      delete db.nonces[parsed.nonce];
      if (options.siweDomains && !options.siweDomains.includes(parsed.domain ?? "")) throw httpError(401, "unauthorized", `Sign-in from ${parsed.domain} is not allowed`);
      if (!parsed.uri || new URL(parsed.uri).host !== parsed.domain || parsed.version !== "1" || (parsed.issuedAt && parsed.issuedAt.getTime() > Date.now() + 60000) || (parsed.notBefore && parsed.notBefore.getTime() > Date.now())) throw httpError(401, "unauthorized", "Invalid sign-in scope or time");
      if (parsed.chainId !== network.chain.id) throw httpError(401, "unauthorized", "Sign-in is for a different chain");
      if (parsed.expirationTime && parsed.expirationTime.getTime() < Date.now()) throw httpError(401, "unauthorized", "Sign-in message expired");
      const who = await recoverMessageAddress({ message, signature: body.signature as Hex });
      if (!isAddressEqual(who, parsed.address)) throw httpError(401, "unauthorized", "Signature does not match the address");
      const token = `sess_${randomHex(24)}`;
      const owned = db.merchants.find((m) => isAddressEqual(m.owner, who));
      const expiresAt = Date.now() + 86_400_000;
      db.logins[token] = { address: who, merchantSlug: owned?.slug ?? null, expiresAt };
      return { token, address: who, expiresAt: iso(expiresAt), merchantSlug: owned?.slug ?? null };
    }
    if (is("POST", routes.logout())) {
      const token = headers.get("authorization")?.replace(/^Bearer /, "");
      if (token) delete db.logins[token];
      return {};
    }

    // customer dashboard
    if (is("GET", routes.myPoints())) {
      const { address } = await auth(headers);
      const b = await pointsBalance(address);
      return { wallet: address, balance: b.balance.toString(), lifetimeEarned: b.lifetimeEarned.toString(), lifetimeRedeemed: b.lifetimeRedeemed.toString(), source: b.source, history: historyOf(db, address) };
    }
    if (is("GET", routes.myPayments())) {
      const { address } = await auth(headers);
      return page(db.payments.filter((p) => isAddressEqual(p.payer, address) && (!browser || p.merchantSlug === browser)).filter(statusFilter(query.get("status"))));
    }
    if (is("GET", routes.myPlans())) {
      const { address } = await auth(headers);
      return page(db.plans.filter((p) => isAddressEqual(p.payer, address) && (!browser || p.merchantSlug === browser)));
    }
    if (is("GET", routes.myRefunds())) {
      const { address } = await auth(headers);
      return page(db.refunds.filter((r) => isAddressEqual(r.to, address) && (!browser || r.merchantSlug === browser)));
    }

    // merchant sign-up
    if (is("POST", routes.merchantSignup())) {
      const { address } = await auth(headers);
      const slug = String(body.slug ?? "");
      if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) throw httpError(400, "validation_failed", "Invalid shop link");
      if (findMerchant(slug)) throw httpError(409, "validation_failed", "That shop name is taken");
      const payout = getAddress(String(body.payout));
      const draftId = uid("draft");
      const request: RegistrationDraft = {
        draftId,
        owner: address,
        payout,
        maxFeeBps: Number(body.maxFeeBps ?? 300),
        metadataHash: invoiceDigest({ name: body.name, slug, website: body.website, category: body.category ?? null }),
        metadataURI: options.publicUrl ? `${options.publicUrl.replace(/\/$/, "")}/v1/merchants/${slug}` : "",
        nonce: (await chain.ownerNonce(address)).toString(),
        deadline: (nowSeconds() + 3600n).toString(),
        registry,
        chainId: network.chain.id,
        payoutProofMessage: isAddressEqual(payout, address) ? null : `PayKit payout verification: merchant ${slug}, payout ${payout}, nonce ${draftId}`,
        hostedSigner: signer.address,
      };
      db.drafts[draftId] = { request, input: body };
      return request;
    }
    if ((mm = match("POST", /^\/v1\/portal\/merchants\/drafts\/([^/]+)\/signature$/))) {
      const who = await auth(headers);
      const draft = db.drafts[arg(mm)];
      if (!draft) throw httpError(404, "not_found", "Registration draft not found");
      const r = draft.request;
      const metadataURI = r.metadataURI ?? "";
      const message = { owner: r.owner, payout: r.payout, maxFeeBps: r.maxFeeBps, metadataHash: r.metadataHash, metadataURI, nonce: BigInt(r.nonce), deadline: BigInt(r.deadline) };
      const recovered = await recoverTypedDataAddress({ ...registerMerchantTypedData(network, message), signature: body.signature as Hex });
      if (!isAddressEqual(recovered, who.address)) throw httpError(400, "signature_invalid", "Registration signature does not match the owner");
      if (r.payoutProofMessage) {
        const proof = await recoverMessageAddress({ message: r.payoutProofMessage, signature: body.payoutProof as Hex });
        if (!isAddressEqual(proof, r.payout)) throw httpError(400, "signature_invalid", "Payout proof does not match the payout wallet");
      }
      const input = draft.input;
      const slug = String(input.slug);
      const receipt = await chain.waitForReceipt(await chain.registerMerchant({ message, signature: body.signature as Hex }));
      if (!receipt.success) throw httpError(400, "server_error", receipt.error ?? "Registration failed onchain");
      const m: Merchant = {
        slug,
        merchantId: merchantIdFor(network.chain.id, r.owner, BigInt(r.nonce)),
        name: String(input.name),
        category: (input.category as string) ?? null,
        description: (input.description as string) ?? null,
        logoUrl: (input.logoUrl as string) ?? null,
        website: String(input.website),
        owner: r.owner,
        payout: r.payout,
        status: "active",
        verifiedDomains: [],
        listed: false,
        acceptedTokens: ["USDT"],
        createdAt: iso(),
      };
      db.merchants.push(m);
      delete db.drafts[draft.request.draftId];
      for (const login of Object.values(db.logins)) if (isAddressEqual(login.address, r.owner) && !login.merchantSlug) login.merchantSlug = slug;
      return m;
    }

    // merchant dashboard (wallet session or secret key)
    if (is("GET", routes.myMerchant())) return myMerchant(headers);
    if (is("GET", routes.portalLoyalty())) {
      const m = await myMerchant(headers);
      return { ...programOf(db, m.slug, maxPoints), available: pointsOn };
    }
    if (is("PATCH", routes.portalLoyalty())) {
      const m = await myMerchant(headers);
      const update = zLoyaltyProgramUpdate.safeParse(body);
      if (!update.success) throw httpError(400, "validation_failed", update.error.issues[0]?.message ?? "Invalid loyalty program");
      try { const program = updateProgram(db, m.slug, update.data, maxPoints); save(); return { ...program, available: pointsOn }; }
      catch (error) { throw httpError(400, "validation_failed", error instanceof Error ? error.message : "Invalid loyalty program"); }
    }
    if (is("GET", routes.merchantStats())) {
      const m = await myMerchant(headers);
      const mine = db.payments.filter((p) => p.merchantSlug === m.slug);
      const settled = mine.filter((p) => SETTLED.includes(p.status));
      const sum = (k: "gross" | "fee" | "net" | "refunded") => settled.reduce((s, p) => s + BigInt(p[k]), 0n).toString();
      return {
        gross: sum("gross"),
        fees: sum("fee"),
        net: sum("net"),
        refunded: sum("refunded"),
        paymentCount: settled.length,
        pendingCount: mine.filter((p) => !SETTLED.includes(p.status) && p.status !== "failed").length,
        activePlans: db.plans.filter((p) => p.merchantSlug === m.slug && p.status === "active").length,
        from: m.createdAt < iso(t0) ? m.createdAt : iso(t0),
        to: iso(),
      };
    }
    if (is("GET", routes.merchantPayments()) || is("GET", routes.payments())) {
      const m = await myMerchant(headers);
      const invoice = query.get("invoice");
      return page(db.payments.filter((p) => p.merchantSlug === m.slug && (!invoice || p.invoiceId === invoice)).filter(statusFilter(query.get("status"))));
    }
    if (is("GET", routes.merchantPlans()) || is("GET", routes.plans())) {
      const m = await myMerchant(headers);
      return page(db.plans.filter((p) => p.merchantSlug === m.slug));
    }
    if ((mm = match("GET", /^\/v1\/plans\/([^/]+)$/))) {
      const m = await myMerchant(headers);
      const id = arg(mm);
      const plan = db.plans.find((p) => (p.id === id || p.planId === id) && p.merchantSlug === m.slug);
      if (!plan) throw httpError(404, "not_found", "Plan not found");
      return plan;
    }
    if (is("GET", routes.merchantRefunds())) {
      const m = await myMerchant(headers);
      return page(db.refunds.filter((r) => r.merchantSlug === m.slug));
    }
    if ((mm = match("GET", /^\/v1\/refunds\/([^/]+)$/))) {
      const m = await myMerchant(headers);
      const id = arg(mm);
      const refund = db.refunds.find((r) => r.id === id && r.merchantSlug === m.slug);
      if (!refund) throw httpError(404, "not_found", "Refund not found");
      return refund;
    }
    if (is("POST", routes.refunds())) {
      const m = await myMerchant(headers);
      const payment = db.payments.find((p) => p.paymentId === body.paymentId && p.merchantSlug === m.slug);
      if (!payment || !SETTLED.includes(payment.status)) throw httpError(404, "not_found", "Settled payment not found");
      const amount = BigInt(String(body.amount));
      const pendingRefunds = db.refunds.filter((r) => r.paymentId === payment.paymentId && ["queued", "submitted"].includes(r.status)).reduce((s, r) => s + BigInt(r.amount), 0n);
      if (amount <= 0n || BigInt(payment.refunded) + pendingRefunds + amount > BigInt(payment.gross)) throw httpError(409, "refund_exceeds_payment", "Refund exceeds what was paid");
      const id = uid("re");
      const terms: RefundTermsWire = {
        paymentId: payment.paymentId,
        refundId: idFromUuid(id),
        amount: amount.toString(),
        fee: "0",
        funder: getAddress(m.payout),
        validUntil: (nowSeconds() + 3600n).toString(),
      };
      const refund: Refund = {
        id,
        refundId: terms.refundId as Hex,
        paymentId: payment.paymentId,
        merchantSlug: m.slug,
        merchantName: m.name,
        to: payment.refundTo,
        amount: amount.toString(),
        fee: "0",
        reason: typeof body.reason === "string" ? body.reason.slice(0, 200) : null,
        status: "awaiting_signatures",
        txHash: null,
        explorerUrl: null,
        createdAt: iso(),
        settledAt: null,
      };
      db.refunds.unshift(refund);
      db.refundTerms[id] = terms;
      const request: RefundSigningRequest = {
        refund,
        terms: terms as RefundSigningRequest["terms"],
        merchantSignature: isMerchantSigner(m, signer.address) ? await signer.signTypedData(refundTermsTypedData(network, refundTermsFromWire(terms))) : null,
        termsHash: hashRefundTerms(network, refundTermsFromWire(terms)),
        router,
        chainId: network.chain.id,
      };
      emit("refund.pending", m.slug, refund.refundId, refund);
      return request;
    }
    if ((mm = match("POST", /^\/v1\/refunds\/([^/]+)\/signatures$/))) {
      const m = await myMerchant(headers);
      const id = arg(mm);
      const refund = db.refunds.find((r) => r.id === id && r.merchantSlug === m.slug);
      const terms = db.refundTerms[id];
      if (!refund || !terms) throw httpError(404, "not_found", "Refund not found");
      if (refund.status !== "awaiting_signatures") return refund;
      const t = refundTermsFromWire(terms);
      const merchantSigner = await recoverTypedDataAddress({ ...refundTermsTypedData(network, t), signature: body.merchantSignature as Hex });
      const funder = { validAfter: BigInt(String(body.validAfter ?? "0")), validBefore: BigInt(String(body.validBefore)), signature: body.funderSignature as Hex };
      const funderSigner = await recoverTypedDataAddress({
        ...receiveWithAuthorizationTypedData(network, { from: t.funder, to: router, value: t.amount + t.fee, validAfter: funder.validAfter, validBefore: funder.validBefore, nonce: refundNonce(hashRefundTerms(network, t)) }),
        signature: funder.signature,
      });
      if (!isMerchantSigner(m, merchantSigner) || !isAddressEqual(funderSigner, t.funder)) throw httpError(400, "signature_invalid", "Refund signatures do not match");
      const pending = db.refunds.filter((r) => r.id !== refund.id && r.paymentId === refund.paymentId && ["queued", "submitted", "settled"].includes(r.status)).reduce((sum, r) => sum + BigInt(r.amount), 0n);
      const original = db.payments.find((p) => p.paymentId === refund.paymentId)!;
      if (pending + BigInt(refund.amount) > BigInt(original.gross)) throw httpError(409, "refund_exceeds_payment", "Refund exceeds the remaining balance");
      refund.status = "queued";
      db.refundJobs[refund.id] = { merchantSignature: body.merchantSignature as Hex, funder: { ...funder, validAfter: funder.validAfter.toString(), validBefore: funder.validBefore.toString() } };
      save();
      void relayRefund(refund);
      return refund;
    }
    if (is("GET", routes.journalExport())) {
      const m = await myMerchant(headers);
      return { __raw: journalCsv(m.slug, query.get("from"), query.get("to")) };
    }
    if (is("POST", routes.invoices())) {
      const m = await myMerchant(headers);
      const input = invoiceInput.parse(body);
      const lineItems = input.lineItems.map((li) => ({ ...li, amount: (BigInt(li.unitAmount) * BigInt(li.quantity)).toString(), productId: li.productId ?? null }));
      const total = lineItems.reduce((sum, li) => sum + BigInt(li.amount), 0n);
      const sched = input.schedule;
      const schedule: Invoice["schedule"] = sched?.type === "deposit" ? { ...sched, parts: depositSchedule(total, sched.depositPercent).map(String) } : sched?.type === "parts" ? sched : { type: "full" };
      if (schedule.type !== "full" && schedule.parts.reduce((sum, part) => sum + BigInt(part), 0n) !== total) throw httpError(400, "validation_failed", "Payment parts must sum to the invoice total");
      if (input.externalOrderId && db.invoices.some((i) => i.merchantSlug === m.slug && i.externalOrderId === input.externalOrderId)) throw httpError(409, "validation_failed", "This order already has an invoice; retry with the original idempotency key");
      const invoice = newInvoice(m, lineItems, schedule, input.customerWallet ? getAddress(input.customerWallet) : null, input.validUntil, input);
      validateInvoice(invoice, m);
      return invoice;
    }
    if (is("GET", routes.invoices())) {
      const m = await myMerchant(headers);
      return page(db.invoices.filter((i) => i.merchantSlug === m.slug));
    }
    if ((mm = match("GET", /^\/v1\/invoices\/([^/]+)$/))) {
      const m = await myMerchant(headers);
      const id = arg(mm);
      const inv = db.invoices.find((i) => i.id === id && i.merchantSlug === m.slug);
      if (!inv) throw httpError(404, "not_found", "Invoice not found");
      restricted(inv.merchantSlug);
      return inv;
    }
    if ((mm = match("PATCH", /^\/v1\/invoices\/([^/]+)$/))) {
      const m = await myMerchant(headers);
      const id = arg(mm);
      const inv = db.invoices.find((i) => i.id === id && i.merchantSlug === m.slug);
      if (!inv) throw httpError(404, "not_found", "Invoice not found");
      if (body.status === "void") {
        if (inv.paid !== "0") throw httpError(409, "validation_failed", "Paid invoices can't be cancelled; refund instead");
        inv.status = "void";
        emit("invoice.voided", m.slug, inv.id, inv);
      }
      return inv;
    }
    if ((mm = match("POST", /^\/v1\/invoices\/([^/]+)\/quotes$/))) {
      const m = await myMerchant(headers);
      const id = arg(mm);
      const inv = db.invoices.find((i) => i.id === id && i.merchantSlug === m.slug);
      if (!inv) throw httpError(404, "not_found", "Invoice not found");
      const gross = nextPartAmount(inv);
      if (gross <= 0n) throw httpError(409, "invoice_overpaid", "This invoice is already paid");
      const partIndex = db.payments.filter((p) => p.invoiceId === inv.id && p.status !== "failed").length;
      validateInvoice(inv, m);
      const signed = await signQuote(m, inv, gross, partIndex, true);
      const quoteId = uid("q");
      db.quotes[quoteId] = signed;
      const { merchantSignature, quoteHash: _h, ...quote } = signed;
      return { quoteId, invoiceId: inv.id, quote, merchantSignature: merchantSignature === "0x" ? null : merchantSignature };
    }
    if ((mm = match("POST", /^\/v1\/invoices\/([^/]+)\/quotes\/([^/]+)\/signature$/))) {
      const m = await myMerchant(headers);
      const invoiceId = arg(mm);
      const inv = db.invoices.find((i) => i.id === invoiceId && i.merchantSlug === m.slug);
      const quote = db.quotes[decodeURIComponent(mm[2]!)];
      if (!inv || !quote) throw httpError(404, "not_found", "Quote not found");
      const signed = zSignedQuote.parse({ ...quote, merchantSignature: body.signature, quoteHash: body.quoteHash });
      validateInvoice(inv, m);
      await validateSignedQuote(signed, m, inv, nextPartAmount(inv));
      db.quotes[decodeURIComponent(mm[2]!)] = signed;
      return signed;
    }
    if (is("GET", routes.products())) {
      const m = await myMerchant(headers);
      return page(db.products.filter((p) => p.merchantSlug === m.slug));
    }
    if (is("POST", routes.products())) {
      const m = await myMerchant(headers);
      const price = String(body.price ?? "");
      if (!/^\d+$/.test(price) || BigInt(price) <= 0n) throw httpError(400, "validation_failed", "Price must be a positive base-unit amount");
      const p: Product = {
        id: uid("prod"),
        merchantSlug: m.slug,
        sku: (body.sku as string) ?? null,
        name: String(body.name ?? "").slice(0, 120) || "Product",
        description: (body.description as string) ?? null,
        imageUrl: (body.imageUrl as string) ?? null,
        price,
        token: "USDT",
        active: true,
      };
      db.products.push(p);
      return p;
    }
    if ((mm = match("PATCH", /^\/v1\/products\/([^/]+)$/))) {
      const m = await myMerchant(headers);
      const id = arg(mm);
      const p = db.products.find((x) => x.id === id && x.merchantSlug === m.slug);
      if (!p) throw httpError(404, "not_found", "Product not found");
      for (const k of ["name", "description", "imageUrl", "sku"] as const) if (typeof body[k] === "string") p[k] = body[k] as string;
      if (typeof body.active === "boolean") p.active = body.active;
      if (typeof body.price === "string" && /^\d+$/.test(body.price)) p.price = body.price;
      return p;
    }
    if ((mm = match("DELETE", /^\/v1\/products\/([^/]+)$/))) {
      const m = await myMerchant(headers);
      const id = arg(mm);
      db.products = db.products.filter((x) => !(x.id === id && x.merchantSlug === m.slug));
      return {};
    }

    // domains
    if (is("GET", routes.merchantDomains())) {
      const m = await myMerchant(headers);
      return page(Object.values(db.domains).filter((d) => d.owner === m.slug).map((d) => d.challenge));
    }
    if (is("POST", routes.merchantDomains())) {
      const m = await myMerchant(headers);
      const domain = normalizeDomain(String(body.domain));
      if (options.domainCheck !== "trust") publicUrl(`https://${domain}`);
      domainHash(domain); // validates
      const token = randomHex(8);
      const challenge: DomainChallenge = {
        domain,
        method: "wellknown",
        dnsName: `_paykit.${domain}`,
        dnsValue: `paykit-verify=${m.merchantId}:${token}`,
        wellKnownUrl: `https://${domain}/.well-known/paykit.json`,
        wellKnownBody: { merchantId: m.merchantId, payout: m.payout, token },
        status: "pending",
        lastCheckedAt: null,
        error: null,
      };
      db.domains[`${m.slug}:${domain}`] = { owner: m.slug, challenge };
      return challenge;
    }
    if ((mm = match("POST", /^\/v1\/portal\/merchant\/domains\/([^/]+)\/check$/))) {
      const m = await myMerchant(headers);
      const d = db.domains[`${m.slug}:${arg(mm)}`] ?? db.domains[arg(mm)];
      if (!d || d.owner !== m.slug) throw httpError(404, "not_found", "Start verification first");
      const problem = await checkDomain(m, d.challenge, body.file);
      if (problem) {
        d.challenge = { ...d.challenge, status: "failed", lastCheckedAt: iso(), error: problem };
        return d.challenge;
      }
      const expires = Date.now() + 30 * 86_400_000;
      const receipt = await chain.waitForReceipt(await chain.attestDomain({ merchantId: m.merchantId as Hex, domainHash: domainHash(d.challenge.domain), expiresAt: BigInt(Math.floor(expires / 1000)) }));
      if (!receipt.success) throw httpError(400, "server_error", receipt.error ?? "Attestation failed");
      d.challenge = { ...d.challenge, status: "verified", lastCheckedAt: iso(), error: null };
      m.verifiedDomains = [...m.verifiedDomains.filter((v) => v.domain !== d.challenge.domain), { domain: d.challenge.domain, verifiedAt: iso(), expiresAt: iso(expires) }];
      m.listed = true;
      emit("merchant.domain_verified", m.slug, `${m.slug}_${d.challenge.domain}`, m);
      return d.challenge;
    }

    // registry changes: server keys, splits, payout
    if (is("GET", routes.merchantSigners())) {
      const m = await myMerchant(headers);
      return page(db.signers.filter((x) => x.owner === m.slug).map(({ owner: _o, ...x }) => x));
    }
    if (is("GET", routes.merchantSplits())) {
      const m = await myMerchant(headers);
      const def: SplitProfile = { profileId: 0, name: "Default", recipients: [{ address: m.payout, bps: 10_000, label: "Payout wallet" }], status: "active" };
      return page([def, ...db.splits.filter((x) => x.owner === m.slug).map(({ owner: _o, ...x }) => x)]);
    }
    if (is("POST", routes.merchantSigners()) || is("POST", routes.merchantSplits()) || is("POST", routes.merchantPayout())) {
      const m = await myMerchant(headers);
      const base = {
        requestId: uid("ra"),
        merchantId: m.merchantId as Hex,
        nonce: (await chain.ownerNonce(m.owner)).toString(),
        deadline: (nowSeconds() + 3600n).toString(),
        registry,
        chainId: network.chain.id,
      };
      let request: RegistryActionRequest;
      if (path === routes.merchantSigners()) {
        const expires = body.expiresAt ? BigInt(Math.floor(new Date(String(body.expiresAt)).getTime() / 1000)) : 0n;
        request = { action: "set_signer", ...base, signer: getAddress(String(body.address)), expiresAt: expires.toString(), enabled: body.enabled !== false };
      } else if (path === routes.merchantSplits()) {
        const recipients = (body.recipients as Array<{ address: string; bps: number; label?: string }>) ?? [];
        const sum = recipients.reduce((a, r) => a + r.bps, 0);
        if (recipients.length < 1 || recipients.length > 5 || sum !== 10_000) throw httpError(400, "validation_failed", "Shares must add up to 100% across 1–5 wallets");
        const addrs = recipients.map((r) => getAddress(r.address));
        const bps = recipients.map((r) => r.bps);
        request = { action: "set_split", ...base, profileId: db.splits.filter((x) => x.owner === m.slug).length + 1, recipients: addrs, bps, splitHash: splitHash(addrs, bps) };
        db.pendingSplits[request.requestId] = { name: String(body.name ?? "Split").slice(0, 60), labels: recipients.map((r) => r.label ?? null) };
      } else {
        const newPayout = getAddress(String(body.newPayout));
        request = {
          action: "queue_payout",
          ...base,
          newPayout,
          payoutProofMessage: `PayKit payout verification: merchant ${m.slug}, payout ${newPayout}, nonce ${base.requestId}`,
          executableAt: iso(Date.now() + 24 * 3_600_000),
        };
      }
      db.registryRequests[request.requestId] = { request, owner: m.slug };
      return request;
    }
    if ((mm = match("POST", /^\/v1\/portal\/merchant\/registry-actions\/([^/]+)\/signature$/))) {
      const m = await myMerchant(headers);
      const entry = db.registryRequests[arg(mm)];
      if (!entry || entry.owner !== m.slug) throw httpError(404, "not_found", "Change request not found");
      const r = entry.request;
      const base = { merchantId: r.merchantId as Hex, nonce: BigInt(r.nonce), deadline: BigInt(r.deadline) };
      const typed =
        r.action === "set_signer"
          ? setSignerTypedData(network, { ...base, signer: r.signer, expiresAt: BigInt(r.expiresAt), enabled: r.enabled })
          : r.action === "set_split"
            ? setSplitProfileTypedData(network, { ...base, profileId: r.profileId, splitHash: r.splitHash as Hex })
            : queuePayoutTypedData(network, { ...base, newPayout: r.newPayout });
      const who = await recoverTypedDataAddress({ ...typed, signature: body.signature as Hex } as never);
      if (!isAddressEqual(who, m.owner)) throw httpError(400, "signature_invalid", "Only the owner wallet can change registry settings");
      if (r.action === "queue_payout") {
        const proof = await recoverMessageAddress({ message: r.payoutProofMessage, signature: body.payoutProof as Hex });
        if (!isAddressEqual(proof, r.newPayout)) throw httpError(400, "signature_invalid", "Payout proof does not match the new wallet");
      }
      const hash = await chain.registryAction({ request: r, signature: body.signature as Hex });
      const receipt = await chain.waitForReceipt(hash);
      if (!receipt.success) throw httpError(400, "server_error", receipt.error ?? "Registry change failed onchain");
      if (r.action === "queue_payout") {
        m.pendingPayout = { address: r.newPayout, executableAt: r.executableAt };
      } else if (r.action === "set_signer") {
        const existing = db.signers.find((x) => x.owner === m.slug && isAddressEqual(x.address, r.signer));
        const record = {
          address: r.signer,
          kind: isAddressEqual(r.signer, signer.address) ? ("hosted" as const) : ("self" as const),
          enabled: r.enabled,
          expiresAt: r.expiresAt === "0" ? null : iso(Number(r.expiresAt) * 1000),
          status: r.enabled ? ("active" as const) : ("disabled" as const),
          createdAt: iso(),
          owner: m.slug,
        };
        if (existing) Object.assign(existing, record);
        else db.signers.push(record);
      } else {
        const meta = db.pendingSplits[r.requestId] ?? { name: "Split", labels: [] };
        db.splits.push({ profileId: r.profileId, name: meta.name, recipients: r.recipients.map((address, i) => ({ address, bps: r.bps[i]!, label: meta.labels[i] ?? null })), status: "active", owner: m.slug });
        delete db.pendingSplits[r.requestId];
      }
      delete db.registryRequests[r.requestId];
      return { requestId: r.requestId, action: r.action, status: "included", txHash: hash };
    }

    // API keys and webhooks
    if (is("GET", routes.merchantApiKeys())) {
      const m = await myMerchant(headers);
      return page(db.apiKeys.filter((k) => k.owner === m.slug).map(({ owner: _o, hash: _h, ...k }) => k));
    }
    if (is("POST", routes.merchantApiKeys())) {
      const m = await myMerchant(headers);
      const kind = body.kind === "secret" ? "secret" : "publishable";
      const key = `${kind === "secret" ? "sk" : "pk"}_test_${randomHex(20)}`;
      const record = { id: uid("key"), kind, prefix: key.slice(0, 12), hash: await sha256Hex(key), allowedOrigins: (body.allowedOrigins as string[]) ?? [], createdAt: iso(), lastUsedAt: null, revokedAt: null, owner: m.slug } as const;
      db.apiKeys.push({ ...record });
      const { owner: _o, hash: _h, ...pub } = record;
      return { ...pub, key };
    }
    if ((mm = match("DELETE", /^\/v1\/portal\/merchant\/api-keys\/([^/]+)$/))) {
      const m = await myMerchant(headers);
      const id = arg(mm);
      const k = db.apiKeys.find((x) => x.id === id && x.owner === m.slug);
      if (k) k.revokedAt = iso();
      return {};
    }
    if (is("GET", routes.webhookEndpoints())) {
      const m = await myMerchant(headers);
      return page(db.webhooks.filter((w) => w.owner === m.slug).map(({ owner: _o, secret: _s, ...w }) => w));
    }
    if (is("POST", routes.webhookEndpoints())) {
      const m = await myMerchant(headers);
      const url = String(body.url ?? "");
      if (options.domainCheck !== "trust") { try { publicUrl(url); } catch { throw httpError(400, "validation_failed", "Use a public HTTPS webhook URL"); } }
      else if (!/^https?:\/\//.test(url)) throw httpError(400, "validation_failed", "Use a full HTTP(S) URL");
      if (Array.isArray(body.events) && !body.events.every(isWebhookEventType)) throw httpError(400, "validation_failed", "Unknown webhook event");
      const w = { id: uid("we"), url, events: Array.isArray(body.events) ? (body.events as string[]) : [], active: true, createdAt: iso(), owner: m.slug, secret: `whsec_${randomHex(24)}` };
      db.webhooks.push(w);
      const { owner: _o, ...pub } = w;
      return pub;
    }
    if ((mm = match("POST", /^\/v1\/webhook-endpoints\/([^/]+)\/replay$/))) {
      const m = await myMerchant(headers);
      const id = arg(mm);
      if (!db.webhooks.some((w) => w.id === id && w.owner === m.slug && w.active)) throw httpError(404, "not_found", "Webhook endpoint not found");
      let count = 0;
      for (const item of db.outbox.filter((o) => o.endpointId === id && !o.delivered && (!body.eventId || o.id === body.eventId))) { item.attempts = 0; item.nextAt = Date.now(); count++; }
      return { replayed: count };
    }
    if ((mm = match("DELETE", /^\/v1\/webhook-endpoints\/([^/]+)$/))) {
      const m = await myMerchant(headers);
      const id = arg(mm);
      db.webhooks = db.webhooks.filter((w) => !(w.id === id && w.owner === m.slug));
      return {};
    }
    throw httpError(404, "not_found", `No route ${method} ${path}`);
  }

  async function handle(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    const at = url.pathname.indexOf("/v1/");
    const path = at >= 0 ? url.pathname.slice(at) : url.pathname;
    let body: Json = {};
    if (request.method !== "GET" && request.method !== "HEAD") {
      const text = await request.text();
      if (text) {
        try {
          if (new TextEncoder().encode(text).length > 262144) return json({ error: { code: "validation_failed", message: "Request exceeds 256 KiB" } }, 413);
          body = JSON.parse(text) as Json;
          if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Expected a JSON object");
        } catch {
          return json({ error: { code: "validation_failed", message: "Body must be JSON" } }, 400);
        }
      }
    }
    try {
      const identity = request.headers.get("authorization") ?? request.headers.get("x-paykit-key") ?? "public";
      const peer = request.headers.get("x-paykit-peer") ?? "direct";
      const peerKey = `peer:${peer}`;
      const peerRate = requestCounts.get(peerKey);
      if (!peerRate || peerRate.until < Date.now()) requestCounts.set(peerKey, { count: 1, until: Date.now() + 60_000 });
      else if (++peerRate.count > (options.requestLimit ?? 600)) throw httpError(429, "rate_limited", "Too many requests from this peer");
      const limitKey = await sha256Hex(identity === "public" ? peer : identity);
      const rate = requestCounts.get(limitKey);
      if (!rate || rate.until < Date.now()) requestCounts.set(limitKey, { count: 1, until: Date.now() + 60_000 });
      else if (++rate.count > (options.requestLimit ?? 300)) throw httpError(429, "rate_limited", "Too many requests; try again shortly");
      for (const [key, value] of requestCounts) if (value.until < Date.now()) requestCounts.delete(key);
      const execute = async () => {
        const supplied = request.headers.get("idempotency-key");
        const id = supplied && request.method !== "GET" ? await sha256Hex(`${identity}:${request.method}:${path}:${supplied}`) : null;
        const fingerprint = await sha256Hex(canonicalJson(body));
        const existing = id ? db.idempotency[id] : undefined;
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw httpError(409, "validation_failed", "Idempotency key was already used with different input");
          await browserMerchant(request.headers);
          if (request.headers.get("authorization")) await auth(request.headers);
          return existing.value;
        }
        const result = await route(request.method.toUpperCase(), path, url.searchParams, body, request.headers);
        if (id) {
          const cached = JSON.parse(JSON.stringify(result ?? {}));
          // API secret keys are shown once and stored only as hashes, including request-result caches.
          if (path === routes.merchantApiKeys() && cached && typeof cached === "object") delete cached.key;
          db.idempotency[id] = { fingerprint, value: cached, createdAt: Date.now() };
        }
        if (request.method !== "GET") save();
        return result;
      };
      let result: unknown;
      if (request.method === "GET") result = await execute();
      else {
        const session = typeof body.sessionId === "string" ? db.sessions[body.sessionId] : db.sessions[path.split("/")[4] ?? ""];
        const resource = session ? `invoice:${session.value.invoice.id}` : typeof body.invoiceId === "string" ? `invoice:${body.invoiceId}` : path.includes("/refunds/") ? `refund:${path.split("/")[3]}` : `${identity}:${path}`;
        const previous = mutationTails.get(resource) ?? Promise.resolve();
        const task = previous.then(execute);
        const tail = task.catch(() => {});
        mutationTails.set(resource, tail);
        try { result = await task; } finally { if (mutationTails.get(resource) === tail) mutationTails.delete(resource); }
      }
      if (result && typeof result === "object" && "__raw" in result) {
        return new Response(String((result as { __raw: string }).__raw), { status: 200, headers: { ...CORS, "content-type": "text/csv" } });
      }
      return json(result ?? {}, 200);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: { code: error.code, message: error.message } }, error.status);
      if (error instanceof Error && error.name === "ZodError") return json({ error: { code: "validation_failed", message: error.message } }, 400);
      const code = (error as { code?: string })?.code;
      const message = error instanceof Error ? error.message : String(error);
      return json({ error: { code: code === "validation_failed" ? code : "server_error", message } }, code === "validation_failed" ? 400 : 500);
    }
  }

  function json(value: unknown, status: number) {
    return new Response(JSON.stringify(value), { status, headers: { ...CORS, "content-type": "application/json" } });
  }

  return {
    handle,
    fetch: (input, init) => handle(new Request(input, init)),
    async tick() {
      if (ticking) return;
      ticking = true;
      try {
        await refreshDomains();
        await observe();
        await refill().catch(() => {
          const run = db.refill.runs.at(-1);
          if (run && run.action === "SKIP") { run.action = "FAILED"; run.reason = "Refill quote or RPC unavailable"; }
          save();
        });
        for (const payment of db.payments.filter((p) => ["queued", "submitted", "included", "safe"].includes(p.status))) void relayPayment(payment.paymentId);
        for (const refund of db.refunds.filter((r) => ["queued", "submitted"].includes(r.status))) void relayRefund(refund);
        for (const key of Object.keys(db.jobs)) await runPlanJob(key).catch(() => {});
        projectInvoices();
        await collectDue();
        await deliverWebhooks();
        save();
      } finally { ticking = false; }
    },
    resume() {
      for (const refund of db.refunds.filter((r) => ["queued", "submitted"].includes(r.status))) void relayRefund(refund);
      for (const key of Object.keys(db.jobs)) void runPlanJob(key).catch(() => {});
      for (const p of db.payments.filter((x) => ["queued", "submitted", "included", "safe"].includes(x.status))) void relayPayment(p.paymentId);
    },
    db,
    hostedSigner: signer.address,
  };
}

// ---------- small browser-safe crypto helpers ----------

const enc = new TextEncoder();

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", enc.encode(text));
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig), (x) => x.toString(16).padStart(2, "0")).join("");
}
