import { isPayKitError, WEBHOOK_SIGNATURE_HEADER, type WebhookEvent, type WebhookEventType } from "@paykit/core";
import { verifyWebhook } from "@paykit/node";

/**
 * Next.js App Router helpers. They use the standard Request/Response API, so they also
 * work in Node-compatible runtimes exposing Request/Response. Webhook verification uses node:crypto.
 */

type Handlers = { [K in WebhookEventType]?: (event: WebhookEvent<K>) => unknown | Promise<unknown> };

export interface WebhookHandlerOptions {
  /** Endpoint secret(s) (whsec_…). Pass two during rotation. */
  secret: string | string[];
  on: Handlers;
  /** Called for every verified event before the typed handler. */
  onEvent?: (event: WebhookEvent) => unknown | Promise<unknown>;
  toleranceSeconds?: number;
}

/**
 * app/api/paykit/webhook/route.ts:
 *
 *   export const POST = createWebhookHandler({
 *     secret: process.env.PAYKIT_WEBHOOK_SECRET!,
 *     on: { "payment.finalized": (e) => fulfillOrder(e.data.invoiceId) },
 *   });
 *
 * Delivery is at-least-once: make handlers idempotent on `event.id`.
 * A handler that throws returns 500, so PayKit retries later.
 */
export function createWebhookHandler(options: WebhookHandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    const raw = await request.text();
    let event: WebhookEvent;
    try {
      event = verifyWebhook(raw, request.headers.get(WEBHOOK_SIGNATURE_HEADER), options.secret, { toleranceSeconds: options.toleranceSeconds });
    } catch (error) {
      const message = isPayKitError(error) ? error.message : "Invalid webhook";
      return Response.json({ error: { code: "signature_invalid", message } }, { status: 400 });
    }
    try {
      await options.onEvent?.(event);
      const handler = options.on[event.type] as ((e: WebhookEvent) => unknown) | undefined;
      await handler?.(event);
    } catch (error) {
      console.error(`[paykit] webhook handler for ${event.type} (${event.id}) failed`, error);
      return Response.json({ error: { code: "server_error", message: "Handler failed" } }, { status: 500 });
    }
    return Response.json({ received: true, id: event.id });
  };
}

/** Routes the merchant dashboard components may call through the proxy. Everything else is refused. */
const MERCHANT_ROUTES: Array<{ methods: string[]; pattern: RegExp }> = [
  { methods: ["GET"], pattern: /^\/v1\/config$/ },
  { methods: ["GET"], pattern: /^\/v1\/portal\/merchant(\/(stats|payments|plans|refunds|domains|api-keys))?$/ },
  { methods: ["POST"], pattern: /^\/v1\/portal\/merchant\/domains(\/[^/]+\/check)?$/ },
  { methods: ["POST"], pattern: /^\/v1\/portal\/merchant\/api-keys$/ },
  { methods: ["DELETE"], pattern: /^\/v1\/portal\/merchant\/api-keys\/[^/]+$/ },
  { methods: ["POST"], pattern: /^\/v1\/webhook-endpoints\/[^/]+\/replay$/ },
  { methods: ["GET", "POST"], pattern: /^\/v1\/(invoices|products|refunds|webhook-endpoints)$/ },
  { methods: ["GET", "PATCH", "DELETE"], pattern: /^\/v1\/(invoices|products|webhook-endpoints)\/[^/]+$/ },
  { methods: ["GET"], pattern: /^\/v1\/(payments|plans)$/ },
  { methods: ["GET"], pattern: /^\/v1\/(payments|plans|refunds)\/[^/]+$/ },
  { methods: ["POST"], pattern: /^\/v1\/refunds\/[^/]+\/signatures$/ },
  { methods: ["GET"], pattern: /^\/v1\/exports\/journal\.csv$/ },
];

export interface MerchantDataHandlerOptions {
  /** Secret key (sk_…). Read it from server env; it never reaches the browser. */
  secretKey: string;
  /** PayKit API base URL. */
  baseUrl: string;
  /**
   * REQUIRED: decide whether this request comes from someone allowed to see the
   * merchant's data (your own admin login). Return false to send 401.
   * Without this check anyone could read your sales through your site.
   */
  authorize: (request: Request) => boolean | Promise<boolean>;
  /** Allow creating/revoking API keys through the proxy. Default false. */
  allowApiKeyManagement?: boolean;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

/**
 * Backend proxy for merchant dashboard components on a developer's own site.
 *
 * app/api/paykit/[...path]/route.ts:
 *
 *   const handler = createMerchantDataHandler({
 *     secretKey: process.env.PAYKIT_SECRET_KEY!,
 *     baseUrl: process.env.PAYKIT_API_URL!,
 *     authorize: async (req) => (await getSession(req))?.isAdmin === true,
 *   });
 *   export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
 *
 * Then: <PayKitProvider merchantDataUrl="/api/paykit" …>
 */
export function createMerchantDataHandler(options: MerchantDataHandlerOptions): (request: Request) => Promise<Response> {
  if (!options.secretKey?.startsWith("sk_")) throw new Error("createMerchantDataHandler needs a secret key (sk_…)");
  if (typeof options.authorize !== "function") throw new Error("createMerchantDataHandler needs an `authorize` check");
  const doFetch = options.fetch ?? ((i: string, init?: RequestInit) => globalThis.fetch(i, init));
  const base = options.baseUrl.replace(/\/+$/, "");

  return async (request) => {
    const url = new URL(request.url);
    const at = url.pathname.indexOf("/v1/");
    const path = at >= 0 ? url.pathname.slice(at) : "";
    const method = request.method.toUpperCase();
    const isKeyRoute = /^\/v1\/portal\/merchant\/api-keys/.test(path);
    const allowed =
      MERCHANT_ROUTES.some((r) => r.methods.includes(method) && r.pattern.test(path)) &&
      (!isKeyRoute || method === "GET" || options.allowApiKeyManagement === true);
    if (!allowed) return Response.json({ error: { code: "forbidden", message: `${method} ${path || url.pathname} is not available through this proxy` } }, { status: 403 });

    let ok = false;
    try {
      ok = await options.authorize(request);
    } catch {
      ok = false;
    }
    if (!ok) return Response.json({ error: { code: "unauthorized", message: "Sign in to view merchant data" } }, { status: 401 });

    const headers: Record<string, string> = { authorization: `Bearer ${options.secretKey}`, accept: request.headers.get("accept") ?? "application/json" };
    const contentType = request.headers.get("content-type");
    if (contentType) headers["content-type"] = contentType;
    const idem = request.headers.get("idempotency-key");
    if (idem) headers["idempotency-key"] = idem;
    const init: RequestInit = { method, headers };
    if (method !== "GET" && method !== "HEAD") init.body = await request.text();

    let upstream: Response;
    try {
      upstream = await doFetch(`${base}${path}${url.search}`, init);
    } catch {
      return Response.json({ error: { code: "network_error", message: "Could not reach PayKit" } }, { status: 502 });
    }
    const body = await upstream.text();
    return new Response(body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" } });
  };
}

export { verifyWebhook } from "@paykit/node";
