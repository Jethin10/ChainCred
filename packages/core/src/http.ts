import { isErrorCode, PayKitError } from "./errors.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  baseUrl: string;
  /** Returns headers for each request (API key, session token). */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Send cookies (same-site dashboards). */
  credentials?: RequestCredentials;
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** Defaults to a random UUID for POST/PATCH/PUT/DELETE so retries are safe. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Return raw text instead of JSON (CSV exports). */
  raw?: boolean;
}

export interface HttpClient {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  delete<T>(path: string, options?: RequestOptions): Promise<T>;
  request<T>(method: string, path: string, options?: RequestOptions): Promise<T>;
}

/** JSON-safe body: bigints become decimal strings. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
}

export function buildUrl(baseUrl: string, path: string, query?: Query): string {
  // baseUrl may carry a path prefix ("https://shop.com/api/paykit"); paths start with "/".
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

export function createHttpClient(options: HttpOptions): HttpClient {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 30_000;

  async function request<T>(method: string, path: string, req: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { accept: req.raw ? "text/csv, text/plain, */*" : "application/json" };
    Object.assign(headers, options.headers ? await options.headers() : {});
    const init: RequestInit = { method, headers };
    if (options.credentials) init.credentials = options.credentials;
    if (req.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = toJson(req.body);
    }
    if (method !== "GET" && method !== "HEAD") {
      headers["idempotency-key"] = req.idempotencyKey ?? globalThis.crypto.randomUUID();
    }

    const timeout = AbortSignal.timeout(timeoutMs);
    init.signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await doFetch(buildUrl(options.baseUrl, path, req.query), init);
    } catch (cause) {
      if (timeout.aborted) throw new PayKitError("timeout", `Request to ${path} timed out`, { cause });
      if (req.signal?.aborted) throw cause;
      throw new PayKitError("network_error", `Could not reach the PayKit API (${path})`, { cause });
    }

    const text = await response.text();
    if (!response.ok) throw errorFromResponse(response.status, text, path);
    if (req.raw) return text as T;
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new PayKitError("server_error", `Invalid JSON from ${path}`, { status: response.status, cause });
    }
  }

  return {
    request,
    get: (path, o) => request("GET", path, o),
    post: (path, body, o) => request("POST", path, { ...o, body }),
    patch: (path, body, o) => request("PATCH", path, { ...o, body }),
    delete: (path, o) => request("DELETE", path, o),
  };
}

export function errorFromResponse(status: number, text: string, path: string): PayKitError {
  let parsed: { error?: { code?: unknown; message?: unknown; details?: unknown } } | undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  const err = parsed?.error;
  const fallback =
    status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status === 404 ? "not_found" : status === 429 ? "rate_limited" : status >= 500 ? "server_error" : "validation_failed";
  const code = isErrorCode(err?.code) ? err.code : fallback;
  const message = typeof err?.message === "string" ? err.message : `PayKit API ${status} on ${path}`;
  return new PayKitError(code, message, { status, details: err?.details });
}
