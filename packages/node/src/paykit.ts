import {
  checkQuoteFee,
  createHttpClient,
  hashPaymentQuote,
  hashPlanTerms,
  hashRefundTerms,
  paymentQuoteTypedData,
  PayKitError,
  planTermsTypedData,
  quoteFromWire,
  receiveWithAuthorizationTypedData,
  refundNonce,
  refundTermsFromWire,
  refundTermsTypedData,
  requireContract,
  resolveNetwork,
  routes,
  toBigInt,
  zInvoice,
  zCheckoutSession,
  type CheckoutSession,
  zPage,
  zPayment,
  zPlan,
  zProduct,
  zPublicConfig,
  zQuoteDraft,
  zRefund,
  zRefundSigningRequest,
  zSignedQuote,
  zWebhookEndpoint,
  type FeeSchedule,
  type FetchLike,
  type HttpClient,
  type Invoice,
  type NetworkConfig,
  type NetworkKey,
  type Page,
  type PayKitContracts,
  type Payment,
  type PaymentQuoteMessage,
  type Plan,
  type PlanTermsMessage,
  type Product,
  type PublicConfig,
  type Refund,
  type RefundSigningRequest,
  type RefundTermsMessage,
  type SignedQuote,
  type WebhookEndpoint,
} from "@paykit/core";
import { isAddressEqual, type Hex, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { z } from "zod";

export interface PayKitOptions {
  /** Secret key (sk_…). Keep it on the server only. */
  secretKey: string;
  /** API base URL, e.g. "https://api.paykit.app". */
  baseUrl: string;
  network?: NetworkKey;
  /** Deployed contract addresses. If omitted they are loaded from GET /v1/config. */
  contracts?: PayKitContracts;
  /**
   * The merchant's server signing key (registered onchain as a merchant signer).
   * When set, quotes, plan terms and refund terms are signed locally and the key
   * never leaves this server. When omitted, the platform's hosted signer is used.
   */
  signerKey?: Hex;
  /**
   * Optional refund-reserve wallet key. When set, refunds are funded and submitted
   * automatically. When omitted, the payout wallet signs refunds in the dashboard.
   */
  refundFunderKey?: Hex;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export type CreateInvoiceInput = {
  lineItems: Array<{ name: string; quantity: number; unitAmount: string | bigint; productId?: string }>;
  /** ISO time or a duration like "7d", "12h", "30m". Default 7 days. */
  validUntil?: string;
  schedule?: { type: "full" } | { type: "deposit"; depositPercent: number } | { type: "parts"; parts: Array<string | bigint> };
  /** Bind the invoice to one wallet (B2B). */
  customerWallet?: string;
  metadata?: Record<string, string>;
  externalOrderId?: string;
  splitProfileId?: number;
};

function parse<T extends z.ZodType>(schema: T, value: unknown, what: string): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new PayKitError("server_error", `Unexpected ${what} from the PayKit API`, { details: result.error.issues });
  return result.data;
}

/** "7d" | "12h" | "30m" | ISO → ISO time. */
export function resolveValidUntil(value: string | undefined, now = Date.now()): string {
  if (!value) return new Date(now + 7 * 86_400_000).toISOString();
  const m = value.match(/^(\d+)([dhm])$/);
  if (m) {
    const unit = { d: 86_400_000, h: 3_600_000, m: 60_000 }[m[2] as "d" | "h" | "m"];
    return new Date(now + Number(m[1]) * unit).toISOString();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new PayKitError("validation_failed", `Invalid validUntil "${value}"`);
  return date.toISOString();
}

/** Server SDK. Use from the merchant's backend only. */
export class PayKit {
  private readonly http: HttpClient;
  private readonly options: PayKitOptions;
  private readonly signer: LocalAccount | undefined;
  private readonly funder: LocalAccount | undefined;
  private configPromise: Promise<PublicConfig> | null = null;
  private networkPromise: Promise<NetworkConfig> | null = null;

  constructor(options: PayKitOptions) {
    if (!options.secretKey?.startsWith("sk_")) {
      throw new PayKitError("config_invalid", "PayKit server SDK needs a secret key (sk_…). Publishable keys belong in the browser.");
    }
    if ("window" in globalThis && "document" in globalThis) {
      throw new PayKitError("config_invalid", "@paykit/node must not run in a browser: it holds your secret key");
    }
    this.options = options;
    this.signer = options.signerKey ? privateKeyToAccount(options.signerKey) : undefined;
    this.funder = options.refundFunderKey ? privateKeyToAccount(options.refundFunderKey) : undefined;
    this.http = createHttpClient({
      baseUrl: options.baseUrl,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      headers: () => ({ authorization: `Bearer ${options.secretKey}` }),
    });
  }

  /** Address of the local merchant signer, if configured. Register it onchain via the dashboard. */
  get signerAddress(): Hex | undefined {
    return this.signer?.address;
  }

  getConfig(): Promise<PublicConfig> {
    this.configPromise ??= this.http.get(routes.config()).then((v) => parse(zPublicConfig, v, "config"));
    this.configPromise.catch(() => (this.configPromise = null));
    return this.configPromise;
  }

  getNetwork(): Promise<NetworkConfig> {
    this.networkPromise ??= (async () => {
      const key = this.options.network ?? "whitechain-testnet";
      const given = this.options.contracts;
      if (given?.router && given.registry) return resolveNetwork(key, given);
      const config = await this.getConfig();
      if (config.chainId !== resolveNetwork(key).chain.id) throw new PayKitError("config_invalid", "The API serves a different chain");
      return resolveNetwork(key, { ...config.contracts, ...given });
    })();
    this.networkPromise.catch(() => (this.networkPromise = null));
    return this.networkPromise;
  }

  private async feeSchedule(): Promise<FeeSchedule> {
    const c = await this.getConfig();
    return { bps: c.feeSchedule.bps, minFee: BigInt(c.feeSchedule.minFee), maxFee: BigInt(c.feeSchedule.maxFee) };
  }

  private requireSigner(): LocalAccount {
    if (!this.signer) throw new PayKitError("config_invalid", "No signerKey configured; this action needs the merchant's server key or the hosted signer");
    return this.signer;
  }

  // ---------- local signing ----------

  /** Signs a payment quote with the merchant server key after checking the fee. */
  async signQuote(quote: PaymentQuoteMessage, options: { maxFeeBps?: number } = {}): Promise<{ signature: Hex; quoteHash: Hex }> {
    const signer = this.requireSigner();
    const network = await this.getNetwork();
    const fee = checkQuoteFee(quote.gross, quote.fee, await this.feeSchedule(), options.maxFeeBps ?? 10_000);
    if (!fee.ok) throw new PayKitError(fee.code, fee.reason);
    if (quote.gross > quote.invoiceTotal) throw new PayKitError("invoice_overpaid", "Quote amount exceeds the invoice total");
    const signature = await signer.signTypedData(paymentQuoteTypedData(network, quote));
    return { signature, quoteHash: hashPaymentQuote(network, quote) };
  }

  async signPlanTerms(terms: PlanTermsMessage): Promise<{ signature: Hex; termsHash: Hex }> {
    const signer = this.requireSigner();
    const network = await this.getNetwork();
    if (terms.count < 1 || terms.installmentAmount <= 0n) throw new PayKitError("validation_failed", "Invalid installment schedule");
    const signature = await signer.signTypedData(planTermsTypedData(network, terms));
    return { signature, termsHash: hashPlanTerms(network, terms) };
  }

  async signRefundTerms(terms: RefundTermsMessage): Promise<{ signature: Hex; termsHash: Hex }> {
    const signer = this.requireSigner();
    const network = await this.getNetwork();
    const signature = await signer.signTypedData(refundTermsTypedData(network, terms));
    return { signature, termsHash: hashRefundTerms(network, terms) };
  }

  // ---------- invoices and quotes ----------

  invoices = {
    create: async (input: CreateInvoiceInput, options: { idempotencyKey?: string } = {}): Promise<Invoice> => {
      const body = {
        ...input,
        lineItems: input.lineItems.map((li) => ({ ...li, unitAmount: toBigInt(li.unitAmount).toString() })),
        schedule: input.schedule?.type === "parts" ? { type: "parts", parts: input.schedule.parts.map((p) => toBigInt(p).toString()) } : input.schedule,
        validUntil: input.validUntil,
      };
      return parse(zInvoice, await this.http.post(routes.invoices(), body, { idempotencyKey: options.idempotencyKey ?? input.externalOrderId }), "invoice");
    },
    get: async (id: string): Promise<Invoice> => parse(zInvoice, await this.http.get(routes.invoice(id)), "invoice"),
    list: async (query: { status?: string; cursor?: string; limit?: number } = {}): Promise<Page<Invoice>> =>
      parse(zPage(zInvoice), await this.http.get(routes.invoices(), { query }), "invoices"),
    void: async (id: string): Promise<Invoice> => parse(zInvoice, await this.http.patch(routes.invoice(id), { status: "void" }), "invoice"),

    /**
     * Creates the quote for the next part of an invoice. With a local signerKey, the
     * quote is checked and signed here and the signature is attached.
     */
    createQuote: async (invoiceId: string, options: { payer?: string; idempotencyKey?: string } = {}): Promise<SignedQuote> => {
      const draft = parse(zQuoteDraft, await this.http.post(routes.invoiceQuotes(invoiceId), { payer: options.payer }, { idempotencyKey: options.idempotencyKey }), "quote");
      const message = quoteFromWire({ ...draft.quote, merchantSignature: "0x", quoteHash: `0x${"0".repeat(64)}` });
      const network = await this.getNetwork();
      if (draft.merchantSignature) {
        return { ...draft.quote, merchantSignature: draft.merchantSignature, quoteHash: hashPaymentQuote(network, message) };
      }
      const { signature, quoteHash } = await this.signQuote(message);
      const signed = await this.http.post(routes.invoiceQuoteSignature(invoiceId, draft.quoteId), { signature, quoteHash }, { idempotencyKey: options.idempotencyKey });
      return parse(zSignedQuote, signed, "signed quote");
    },
  };

  /** Use your existing order/catalogue. Keep pricing and the secret key on your server. */
  checkout = {
    createSession: async (input: CreateInvoiceInput | { invoiceId: string }, options: { idempotencyKey?: string } = {}): Promise<CheckoutSession> => {
      const invoice = "invoiceId" in input ? await this.invoices.get(input.invoiceId) : await this.invoices.create(input, { idempotencyKey: input.externalOrderId ?? options.idempotencyKey });
      const quote = this.signer ? await this.invoices.createQuote(invoice.id, { idempotencyKey: options.idempotencyKey ?? invoice.externalOrderId ?? invoice.id }) : undefined;
      return parse(zCheckoutSession, await this.http.post(routes.checkoutSessions(), { invoiceId: invoice.id, quote }, { idempotencyKey: options.idempotencyKey ?? invoice.externalOrderId ?? invoice.id }), "checkout session");
    },
  };

  // ---------- payments, plans, refunds ----------

  payments = {
    get: async (paymentId: string): Promise<Payment> => parse(zPayment, await this.http.get(routes.payment(paymentId)), "payment"),
    list: async (query: { status?: "pending" | "settled" | "all"; invoice?: string; from?: string; to?: string; cursor?: string; limit?: number } = {}): Promise<Page<Payment>> =>
      parse(zPage(zPayment), await this.http.get(routes.payments(), { query }), "payments"),
  };

  plans = {
    get: async (id: string): Promise<Plan> => parse(zPlan, await this.http.get(routes.plan(id)), "plan"),
    list: async (query: { status?: string; cursor?: string } = {}): Promise<Page<Plan>> =>
      parse(zPage(zPlan), await this.http.get(routes.plans(), { query }), "plans"),
  };

  refunds = {
    /**
     * Requests a refund. Signs the refund terms with the server key (unless the hosted
     * signer did). If a refundFunderKey is configured and it is the funder, also funds and
     * submits it. Otherwise returns `needsFunderSignature: true`: the payout wallet must
     * sign in the merchant dashboard (RefundButton).
     */
    create: async (input: { paymentId: string; amount: string | bigint; reason?: string }, options: { idempotencyKey?: string } = {}): Promise<{ refund: Refund; request: RefundSigningRequest; needsFunderSignature: boolean }> => {
      const amount = toBigInt(input.amount);
      if (amount <= 0n) throw new PayKitError("validation_failed", "Refund amount must be positive");
      const network = await this.getNetwork();
      const request = parse(zRefundSigningRequest, await this.http.post(routes.refunds(), { ...input, amount: amount.toString() }, options), "refund request");
      const terms = refundTermsFromWire(request.terms);
      if (terms.amount !== amount || terms.paymentId.toLowerCase() !== input.paymentId.toLowerCase()) {
        throw new PayKitError("quote_mismatch", "Refund terms from the API differ from the request");
      }
      if (hashRefundTerms(network, terms) !== request.termsHash) throw new PayKitError("quote_mismatch", "Refund hash differs");
      const merchantSignature = (request.merchantSignature as Hex | null) ?? (this.signer ? (await this.signRefundTerms(terms)).signature : null);
      if (!merchantSignature) throw new PayKitError("config_invalid", "Refund terms need a merchant signature: configure signerKey or the hosted signer");

      if (!this.funder || !isAddressEqual(this.funder.address, terms.funder)) {
        return { refund: request.refund, request: { ...request, merchantSignature }, needsFunderSignature: true };
      }
      const funderSignature = await this.funder.signTypedData(
        receiveWithAuthorizationTypedData(network, {
          from: terms.funder,
          to: requireContract(network, "router"),
          value: terms.amount + terms.fee,
          validAfter: 0n,
          validBefore: terms.validUntil,
          nonce: refundNonce(request.termsHash as Hex),
        }),
      );
      const refund = await this.refunds.submitSignatures(request.refund.id, { merchantSignature, funderSignature, validBefore: terms.validUntil });
      return { refund, request: { ...request, merchantSignature }, needsFunderSignature: false };
    },
    submitSignatures: async (id: string, s: { merchantSignature: Hex; funderSignature: Hex; validBefore: bigint | string }): Promise<Refund> =>
      parse(zRefund, await this.http.post(routes.refundSignatures(id), { ...s, validAfter: "0", validBefore: s.validBefore.toString() }), "refund"),
    get: async (id: string): Promise<Refund> => parse(zRefund, await this.http.get(routes.refund(id)), "refund"),
  };

  // ---------- catalog ----------

  products = {
    list: async (): Promise<Product[]> => parse(zPage(zProduct), await this.http.get(routes.products()), "products").data,
    create: async (input: { name: string; price: string | bigint; description?: string; imageUrl?: string; sku?: string }): Promise<Product> =>
      parse(zProduct, await this.http.post(routes.products(), { ...input, price: toBigInt(input.price).toString() }), "product"),
    update: async (id: string, input: Partial<{ name: string; price: string | bigint; description: string; imageUrl: string; active: boolean }>): Promise<Product> =>
      parse(zProduct, await this.http.patch(routes.product(id), input.price === undefined ? input : { ...input, price: toBigInt(input.price).toString() }), "product"),
    remove: async (id: string): Promise<void> => {
      await this.http.delete(routes.product(id));
    },
  };

  // ---------- accounting and webhooks ----------

  exports = {
    /** Journal CSV over a date range with a versioned account mapping (plan.md §20). */
    journalCsv: (query: { from: string; to: string; mappingVersion?: string }): Promise<string> =>
      this.http.get<string>(routes.journalExport(), { query: { mappingVersion: "v1", ...query }, raw: true }),
  };

  webhookEndpoints = {
    replay: (id: string, eventId?: string): Promise<{ replayed: number }> => this.http.post(routes.webhookReplay(id), { eventId }),
    create: async (input: { url: string; events: string[] }): Promise<WebhookEndpoint> =>
      parse(zWebhookEndpoint, await this.http.post(routes.webhookEndpoints(), input), "webhook endpoint"),
    list: async (): Promise<WebhookEndpoint[]> => parse(zPage(zWebhookEndpoint), await this.http.get(routes.webhookEndpoints()), "webhooks").data,
    remove: async (id: string): Promise<void> => {
      await this.http.delete(routes.webhookEndpoint(id));
    },
  };

  /** Low-level access for endpoints not wrapped yet. */
  get raw(): HttpClient {
    return this.http;
  }
}
