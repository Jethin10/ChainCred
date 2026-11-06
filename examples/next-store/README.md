# Existing-store Next.js integration

This example uses `plan.md` and the built SDK, with an existing server-priced order rather than a PayKit catalogue. Copy `.env.example` to `.env.local`, configure the API and a merchant's keys, and run `npm run dev -w paykit-next-store`. The API service and contract addresses are operator configuration.

Register `/api/paykit/webhook` as a `payment.finalized` destination. Public webhook delivery requires a public HTTPS endpoint; the example's loopback URL is only for local manual requests and tests. Never expose a secret in a NEXT_PUBLIC variable.

The fixed order is intentional demo data. Replace the lookup in `app/api/checkout/route.ts` and the transaction in `lib/fulfillment.ts` with your existing authenticated order system. Repeated checkout requests resume the same invoice/session. For a fresh expired attempt use `checkout.createSession({ invoiceId }, { idempotencyKey: 'your-order:attempt-2' })`.

React components can be imported from server pages because the package supplies its client boundary. Custom interfaces can use `useCheckout`, `usePayment`, and the headless browser client. Styles are opt-in; omit the stylesheet and render your own hook-driven UI.
