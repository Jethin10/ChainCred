# PayKit

A Whitechain USDT payment SDK. Customers sign a gasless authorization; the payment service relays it. Merchants receive USDT directly in their configured payout wallets.

`plan.md` is the only specification for this implementation. Contracts are configured by their owner; SDK work does not modify them.

## Minimal integration into an existing store

Install `@paykit/react` in your frontend and `@paykit/node` in your backend. Next.js apps also use `@paykit/next` for webhooks. Packages are local workspace packages until the team explicitly publishes them. Use the packed-package check below to test installation without publishing.

Configure your merchant once: payout wallet, domain proof, authorized hosted or local signer, publishable key, secret key and webhook endpoint. PayKit's operator runs the service and configures the contracts. Individual merchants do not implement a relayer, observer or refill worker.

Create a checkout session from your existing authenticated order handler. Prices come from your server's order data:

```ts
import { PayKit } from '@paykit/node';
const paykit = new PayKit({ baseUrl: process.env.PAYKIT_API_URL!, secretKey: process.env.PAYKIT_SECRET_KEY! });
const session = await paykit.checkout.createSession({
  externalOrderId: order.id,
  lineItems: order.items.map((item) => ({ name: item.name, quantity: item.quantity, unitAmount: item.priceBaseUnits })),
});
// Return session.id to the customer. Your secret key stays here.
```

Add checkout to your existing React page:

```tsx
import { PayKitProvider, CheckoutButton } from '@paykit/react';
import '@paykit/react/styles.css';
<PayKitProvider publishableKey={publishableKey} apiUrl={apiUrl}>
  <CheckoutButton input={{ sessionId }} amount={orderTotalBaseUnits} onSuccess={showReceipt} />
</PayKitProvider>
```

Receive verified settlement events on your backend:

```ts
import { createWebhookHandler } from '@paykit/next';
export const POST = createWebhookHandler({
  secret: process.env.PAYKIT_WEBHOOK_SECRET!,
  on: { 'payment.finalized': (event) => fulfillOrderOnce(event) },
});
```

`fulfillOrderOnce` is your order transaction: deduplicate `event.id` and `event.data.paymentId`, verify merchant/order/amount, and fulfill only the required amount once. The event carries `externalOrderId`, invoice ID and bounded metadata. Deposits and installments generate multiple payment events; fulfill according to your own order policy. A frontend callback updates UI and does not authorize shipping.

The integration is roughly 20–30 lines around your existing order logic, plus environment settings and one-time merchant setup. [The Next.js example](../examples/next-store/README.md) includes a server-priced order, client checkout and durable webhook deduplication.

## Choose the amount of UI you want

- Ready-made components: `CheckoutButton`, `InvoiceView`, `PaymentStatus`, `ReceiptView`, `ProductGrid`, `Cart`, `DepositPicker`, `InstallmentPlanPicker`, merchant settings and dashboards.
- Custom UI: use `useCheckout`, `usePayment`, `useCart`, `usePlanCheckout`, `useRefund` and other exported hooks. Money/signing logic remains in the package when you restyle the view.
- Headless: use `@paykit/js` with your own interface and any supported wallet adapter.

Styles are opt-in. Import `@paykit/react/styles.css` for defaults, override `--pk-*` variables under `.pk-root`, or omit the stylesheet entirely. `CheckoutButton` accepts `className` and `label`. The provider supports light/dark/system themes, `className`, and a typed `style` prop for `--pk-*` variables.

```tsx
const { pay, busy, error } = useCheckout();
<button disabled={busy} onClick={() => pay({ sessionId }, { expectedAmount: orderTotalBaseUnits })}>
  Pay this order
</button>
```

For installments pass the displayed total and selected schedule to `plans.authorize`, or use `InstallmentPlanPicker`, which does so automatically. Changed amounts/schedules fail before signing. Components/hooks are client exports and support direct imports from Next.js App Router server pages where their props are serializable.

Wallet adapters are `fromEip1193(provider)`, `fromWalletClient(viemWalletClient)` and `fromSignerLike(thirdwebAccount)`. Pass the adapter as `wallet` to the provider, or omit it to use an injected browser wallet. A controlled disconnected wallet should be `null` and supply `onConnectRequest`.

Open the **Components** tab in `npm run dev` for six interactive previews with source, CSS, usage and installation tabs. Search components, edit checkout labels, and test themes without connecting a real wallet.

```sh
# From this PayKit checkout; installs local packages before npm publication.
npm run ui:add -- checkout --cwd "../your-store"
```

The installer copies complete presentation files and their shared stylesheet, preserves customized files, and keeps payment logic in SDK hooks. The packaged `paykit-ui` binary works after installing the React SDK too. See [copyable components](react/registry/README.md) for all components, installer flags and the manual copy flow.

`npm run sdk:registry` builds shadcn-compatible registry files for all six components. Each includes source and styles. Registry URLs are local assets until explicitly hosted, and SDK packages remain unpublished. Use the local installer for a working first setup rather than expecting unpublished npm dependencies to resolve.

## Payments, deposits and refunds

`checkout.createSession` uses a stable order reference for safe retries. The same request resumes the same invoice/session. Reusing an idempotency key with changed terms returns a conflict. After a session expires, request another attempt for the existing unpaid invoice:

```ts
const session = await paykit.checkout.createSession({ invoiceId }, { idempotencyKey: `${orderId}:attempt-2` });
const invoice = await paykit.invoices.create({ externalOrderId: orderId, lineItems, schedule: { type: 'deposit', depositPercent: 30 } });
await paykit.refunds.create({ paymentId, amount: '1000000', reason: 'Partial return' }, { idempotencyKey: refundRequestId });
```

Refund funding requires the payout wallet's authorization. The server client returns `needsFunderSignature` unless a matching `refundFunderKey` is configured. React `RefundButton` and `useRefund` accept a separate funder signer for businesses whose owner and payout wallets differ. Never embed a funder private key in browser code.

Amounts are bigint or base-unit integer strings: `1000000` means 1 USDT. Use decimal strings with `parseUsdt('1.25')`. Excess precision is rejected. Mainnet payments remain unsupported until the permit-only token path is independently verified.

## Packages and runtimes

| Package | Purpose |
|---|---|
| `@paykit/core` | Schemas, amount math, routes, chain config and signing formats |
| `@paykit/js` | Browser/headless checkout, wallet signing, sessions and status |
| `@paykit/react` | Optional UI, hooks, provider and stylesheet |
| `@paykit/node` | Merchant server API, local signing, refunds, webhook verification |
| `@paykit/next` | Webhook and authenticated merchant-data handlers |
| `@paykit/server` | Operator API, durable relay jobs, reconciliation and workers |
| `@paykit/observer` | Independent finalized event ledger and CLI |
| `@paykit/testing` | Explicitly simulated API and public test wallets; development only |

The packages ship ESM, declarations and sourcemaps. React 18/19 is a peer dependency. Operator storage and examples use Node 24. The Next webhook helper uses Node crypto; select the Node runtime, not an Edge runtime. `@paykit/js` no longer installs the API server. Replace the old `@paykit/js/mock` import with `@paykit/testing`.

## Run locally

```powershell
. ./scripts/activate.ps1
npm run sdk:build
npm run server:demo
# another terminal
npm run demo
```

The separate Vite store uses an in-browser simulation unless `VITE_PAYKIT_API_URL` is set. This does not prove a real blockchain write. `@paykit/testing` is suitable for UI development and deterministic tests, never actual payments.

For real configured contracts, copy `packages/server/.env.example` to `.env`, configure the contract addresses, deployment start block, relay/signer/admin keys and allowed SIWE domains, then run `npm run server`. Configure the merchant publishable key in the frontend too. Existing JSON snapshots can be imported explicitly; use a new SQLite path and retain the original backup.

The default operator store is a single-process SQLite WAL transaction containing the SDK's state, jobs and outbox. Signed raw transactions and their hashes are saved before broadcasting. A store lock prevents competing API writers. Persistence callbacks are injectable; distributed operation still requires shared transactions and locks. A Postgres implementation and multi-instance operation are not included. Back up the database consistently, including its WAL, or use SQLite's backup tools.

Submitted-but-unknown outcomes remain submitted and are retried. Confirmed receipts are checked against canonical block hashes before finality promotion. The finalized observer scans all configured deployments, including transactions submitted outside this API. Set `DEPLOYMENT_BLOCK` to the deployment's first block. Restoring a settlement ledger cannot restore private invoice detail without a backup.

Refill runs separately from checkout and is disabled by default. Enable `REFILL_ENABLED=1` only after configuring the treasury and setting `MEASURED_PAYMENT_COST_WBT` from actual measurements. The worker checks batch and daily limits, price floor, slippage, execution/L1 fee estimates and a maximum 10% gas/output ratio. Unknown outcomes stay recoverable. The SDK's existence is not evidence that a real swap was executed.

## Verify and package locally

```powershell
npm run sdk:typecheck
npm run sdk:build
npm run sdk:test
npm run build -w demo-store
npm run build -w paykit-next-store
```

`npm pack --pack-destination <local-directory> -w <package>` creates local tarballs without publishing. Install core/JS/React/Node/Next tarballs together in a clean consumer. `npm run sdk:consumer` performs that check. Tests exercise simulated money movements; the live test reads only network state. Deployed-contract write/signature compatibility remains an operator gate.

Reconstruct an independently pinned finalized range after building:

```powershell
node packages/observer/dist/cli.js --rpc <rpc> --router <router> --registry <registry> --treasury <treasury> --from <deploymentBlock> --to <finalizedBlock> --out ledger.jsonl
```

It writes ordered public events and prints a deterministic ledger hash. Compare the same chain/range/deployments when comparing hashes.
