/**
 * REST routes of the PayKit API (plan.md §14). The server implements exactly these;
 * @paykit/js and @paykit/node call them. Base path: /v1.
 */

const e = encodeURIComponent;

export const API_VERSION_PREFIX = "/v1";

export const routes = {
  // Public (publishable key)
  config: () => "/v1/config",
  status: () => "/v1/status",
  directory: () => "/v1/directory",
  merchant: (slug: string) => `/v1/merchants/${e(slug)}`,
  merchantProducts: (slug: string) => `/v1/merchants/${e(slug)}/products`,
  /** Public loyalty program: earn rate and rewards. */
  merchantLoyalty: (slug: string) => `/v1/merchants/${e(slug)}/loyalty`,
  invoicePublic: (id: string) => `/v1/invoices/${e(id)}/public`,
  checkoutSessions: () => "/v1/checkout/sessions",
  checkoutSession: (id: string) => `/v1/checkout/sessions/${e(id)}`,
  checkoutAuthorize: (id: string) => `/v1/checkout/sessions/${e(id)}/authorize`,
  /** Apply (or remove) a points reward: re-quotes the session with a discount. */
  checkoutReward: (id: string) => `/v1/checkout/sessions/${e(id)}/reward`,
  payment: (paymentId: string) => `/v1/payments/${e(paymentId)}`,
  planSessions: () => "/v1/plans/sessions",
  planAuthorize: (id: string) => `/v1/plans/sessions/${e(id)}/authorize`,
  planCancel: (planId: string) => `/v1/plans/${e(planId)}/cancel`,

  // Wallet login (SIWE)
  siweNonce: () => "/v1/auth/siwe/nonce",
  siweVerify: () => "/v1/auth/siwe/verify",
  logout: () => "/v1/auth/logout",

  // Consumer dashboard (wallet session)
  myPayments: () => "/v1/me/payments",
  myPlans: () => "/v1/me/plans",
  myRefunds: () => "/v1/me/refunds",
  myPoints: () => "/v1/me/points",
  /** Public points balance of any wallet (PayKitPoints balances are public onchain). */
  pointsOf: (address: string) => `/v1/points/${e(address)}`,

  // Merchant dashboard (owner-wallet session) and server SDK (secret key) share these
  merchantSignup: () => "/v1/portal/merchants",
  merchantSignupSignature: (draftId: string) => `/v1/portal/merchants/drafts/${e(draftId)}/signature`,
  myMerchant: () => "/v1/portal/merchant",
  merchantStats: () => "/v1/portal/merchant/stats",
  /** The signed-in merchant's loyalty program (GET, PATCH). */
  portalLoyalty: () => "/v1/portal/merchant/loyalty",
  merchantPayments: () => "/v1/portal/merchant/payments",
  merchantPlans: () => "/v1/portal/merchant/plans",
  merchantRefunds: () => "/v1/portal/merchant/refunds",
  merchantDomains: () => "/v1/portal/merchant/domains",
  merchantDomainCheck: (domain: string) => `/v1/portal/merchant/domains/${e(domain)}/check`,
  /** DELETE: stop using a domain and revoke its onchain attestation. */
  merchantDomain: (domain: string) => `/v1/portal/merchant/domains/${e(domain)}`,
  merchantApiKeys: () => "/v1/portal/merchant/api-keys",
  merchantApiKey: (id: string) => `/v1/portal/merchant/api-keys/${e(id)}`,
  merchantSigners: () => "/v1/portal/merchant/signers",
  merchantSplits: () => "/v1/portal/merchant/splits",
  merchantPayout: () => "/v1/portal/merchant/payout",
  /** Submit the owner's signature for a prepared registry change (signer, split or payout). */
  registryActionSignature: (requestId: string) => `/v1/portal/merchant/registry-actions/${e(requestId)}/signature`,

  // Server SDK (secret key) — also usable from a merchant session
  invoices: () => "/v1/invoices",
  invoice: (id: string) => `/v1/invoices/${e(id)}`,
  invoiceQuotes: (id: string) => `/v1/invoices/${e(id)}/quotes`,
  invoiceQuoteSignature: (id: string, quoteId: string) => `/v1/invoices/${e(id)}/quotes/${e(quoteId)}/signature`,
  products: () => "/v1/products",
  product: (id: string) => `/v1/products/${e(id)}`,
  payments: () => "/v1/payments",
  refunds: () => "/v1/refunds",
  refund: (id: string) => `/v1/refunds/${e(id)}`,
  refundSignatures: (id: string) => `/v1/refunds/${e(id)}/signatures`,
  plans: () => "/v1/plans",
  plan: (id: string) => `/v1/plans/${e(id)}`,
  journalExport: () => "/v1/exports/journal.csv",
  webhookEndpoints: () => "/v1/webhook-endpoints",
  webhookReplay: (id: string) => `/v1/webhook-endpoints/${e(id)}/replay`,
  webhookEndpoint: (id: string) => `/v1/webhook-endpoints/${e(id)}`,
} as const;

export type RouteName = keyof typeof routes;
