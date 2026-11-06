export declare const DEFAULT_SERVER_URL: string;
export declare const ONBOARDING_URL: string;

export declare class PayKitError extends Error {
  status: number;
  code: string;
  details?: unknown;
}

export type InvoiceStatus = "open" | "partially_paid" | "paid" | "expired" | string;

export interface Invoice {
  id: string;
  status: InvoiceStatus;
  merchant?: { id: string; name: string; profile: MerchantProfile | null };
  reference: string | null;
  description: string | null;
  currency: "USDT";
  amount: string;
  amountPaid: string;
  amountDue: string;
  amountRefunded: string;
  allowPartial: boolean;
  payerAddress: string | null;
  dueDate: string | null;
  /** Hosted PayKit page for this invoice. Optional: you can pay in-page with paykit/checkout instead. */
  payUrl: string;
  successUrl: string | null;
  paymentIds: string[];
  chain: { id: number; token: string; router: string };
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface CreateInvoiceInput {
  /** USDT as a decimal string, e.g. "12.50". Minimum about 1.67 (fee floor). */
  amount: string | number;
  /** Your order id. Shown to the customer and returned in webhooks. */
  reference?: string;
  description?: string;
  /** Where the hosted page sends the customer after paying. */
  successUrl?: string;
  allowPartial?: boolean;
  /** Restrict payment to one wallet. */
  payerAddress?: string;
  /** ISO date. */
  dueDate?: string;
  metadata?: Record<string, unknown>;
}

export interface MerchantProfile { website?: string | null; category?: string | null; tagline?: string | null; accent?: string | null }

export interface Merchant {
  id: string;
  name: string;
  payoutAddress: string;
  ownerAddress: string;
  signerAddress: string;
  webhookUrl: string | null;
  profile: MerchantProfile | null;
  maxFeeBps: number;
  registerTx: string | null;
  createdAt: string;
}

export interface Payment {
  id: string;
  merchantId: string;
  invoiceId: string | null;
  payer: string;
  gross: string;
  fee: string;
  net: string;
  txUrl: string | null;
  pointsEarned?: number;
  pointsRedeemed?: number;
  [key: string]: unknown;
}

export type WebhookEventType =
  | "payment.settled"
  | "invoice.paid"
  | "refund.settled"
  | "subscription.activated"
  | "subscription.charged"
  | "subscription.charge_failed"
  | "subscription.past_due"
  | "subscription.cancelled"
  | "subscription.completed"
  | "test.ping"
  | (string & {});

export interface WebhookEvent<T = any> {
  id: string;
  type: WebhookEventType;
  createdAt: string;
  data: T;
}

export interface PayKitOptions {
  /** Merchant API key (pk_test_...). Defaults to process.env.PAYKIT_API_KEY. Server-side only. */
  apiKey?: string;
  /** Defaults to process.env.PAYKIT_SERVER_URL or https://paykit-server.vercel.app */
  serverUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export declare class PayKit {
  constructor(options?: PayKitOptions);
  apiKey?: string;
  serverUrl: string;
  health(): Promise<any>;
  request<T = any>(method: string, path: string, body?: unknown, opts?: { auth?: boolean }): Promise<T>;
  merchant: {
    get(): Promise<Merchant>;
    update(patch: { webhookUrl?: string | null; profile?: MerchantProfile }): Promise<Merchant>;
  };
  invoices: {
    create(input: CreateInvoiceInput): Promise<Invoice>;
    get(id: string): Promise<Invoice>;
    list(): Promise<Invoice[]>;
    getPublic(id: string): Promise<Invoice>;
    waitForPaid(id: string, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<Invoice>;
  };
  payments: {
    list(): Promise<Payment[]>;
    get(id: string): Promise<Payment>;
    receipt(paymentId: string): Promise<{ merchant: { id: string; name?: string }; payment: Payment | null; onchain: { verified: boolean; [k: string]: unknown } }>;
  };
  refunds: {
    create(paymentId: string, input?: { amount?: string; funder?: string }): Promise<any>;
    authorize(refundId: string, signature: string): Promise<any>;
  };
  plans: {
    create(input: Record<string, unknown>): Promise<any>;
    list(): Promise<any[]>;
    get(id: string): Promise<any>;
    setActive(id: string, active: boolean): Promise<any>;
  };
  subscriptions: {
    list(status?: string): Promise<any[]>;
    get(id: string): Promise<any>;
    cancel(id: string): Promise<any>;
  };
  points: {
    summary(): Promise<any>;
    createCampaign(input: { name?: string; pointsPerUsdt: number; [k: string]: unknown }): Promise<any>;
    listCampaigns(): Promise<any[]>;
    createReward(input: { name: string; pointsCost: number; type: "fixed_off" | "percent_off"; value: string | number; minSpend?: string; [k: string]: unknown }): Promise<any>;
    listRewards(): Promise<any[]>;
    customer(wallet: string): Promise<any>;
  };
  webhooks: {
    test(): Promise<any>;
    events(): Promise<any[]>;
    redeliver(eventId: string): Promise<any>;
    verify<T = any>(rawBody: string | Uint8Array | ArrayBuffer, signatureHeader: string | null | undefined, secret?: string, opts?: { toleranceSeconds?: number }): Promise<WebhookEvent<T>>;
  };
}

export declare function verifyWebhook<T = any>(
  rawBody: string | Uint8Array | ArrayBuffer,
  signatureHeader: string | null | undefined,
  secret: string,
  opts?: { toleranceSeconds?: number; now?: number }
): Promise<WebhookEvent<T>>;

export declare function signWebhook(rawBody: string, secret: string, t?: number): Promise<string>;

export default PayKit;
