# PayKit: instructions for coding agents

Use this file to add PayKit payments to an existing app: USDT on Whitechain, paid in MetaMask with one gasless signature, with PayKit loyalty points. Follow these steps in order. Do not invent other endpoints, packages or options.

Package: `usepaykit` on npm. It has no dependencies, needs Node 18+, and also runs on edge runtimes.
Server: `https://paykit-server.vercel.app`. This is a testnet: Whitechain Testnet, chain 1874, test USDT.

## 0. What the human must provide

- **`PAYKIT_API_KEY`** (`pk_test_...`) and **`PAYKIT_WEBHOOK_SECRET`** (`whsec_...`).
  - They come from merchant onboarding at https://paykit-app.vercel.app/#merchant. It takes about 2 minutes: shop name, connect MetaMask (the payout wallet), sign once.
  - You cannot create these yourself. If they are missing, ask the human for them, add empty placeholders to `.env.example`, and continue writing code.
- Put the keys in server environment variables only. Never in client code, never committed, never logged.

## 1. Install

```sh
npx usepaykit@latest init   # installs paykit, adds this guide, skills/rules and the PayKit MCP server
npx usepaykit doctor        # checks the server and, if PAYKIT_API_KEY is set, the key
```

(`npm install usepaykit` on its own also works.)

If the `paykit` MCP server is connected, you can test with its tools: `paykit_doctor`, `paykit_create_invoice`, `paykit_get_invoice` and `paykit_set_webhook`. Use them for testing only. App code uses the package.

## 2. Server: create an invoice for an order

The price must come from your server's own order data, never from the browser.

```js
import { PayKit } from "usepaykit";
const paykit = new PayKit(); // reads PAYKIT_API_KEY (and optional PAYKIT_SERVER_URL)

// inside your existing authenticated "place order" handler:
const invoice = await paykit.invoices.create({
  amount: order.totalUsdt,        // decimal string, e.g. "12.50". Minimum is about 1.67 USDT
  reference: order.id,            // your order id; it comes back in webhooks
  description: "2× Assam tea",    // optional, shown to the customer
  successUrl: `${origin}/orders/${order.id}`, // optional, used by the hosted page
  metadata: { orderId: order.id },// optional
});
// Save invoice.id on the order. Return { invoiceId: invoice.id } to the browser.
```

Next.js route handler example (`app/api/checkout/route.ts`):

```ts
import { PayKit } from "usepaykit";
const paykit = new PayKit();
export async function POST(req: Request) {
  const order = await createOrderFromCart(await req.json()); // your code: prices from your DB
  const invoice = await paykit.invoices.create({ amount: order.total, reference: order.id });
  await saveInvoiceId(order.id, invoice.id);                 // your code
  return Response.json({ invoiceId: invoice.id });
}
```

## 3. Browser: pay on your own page (no redirect)

```js
import { openCheckout } from "usepaykit/checkout";

const { invoiceId } = await (await fetch("/api/checkout", { method: "POST", body: JSON.stringify(cart) })).json();
const result = await openCheckout({ invoiceId });   // modal: MetaMask → Whitechain → sign → settled
if (result.status === "paid") showThankYou(result.paymentId, result.txUrl);
// result.status === "closed" means the customer closed the dialog without paying.
```

- The dialog connects MetaMask, switches it to Whitechain and offers points discounts. It asks for one `eth_signTypedData_v4` signature, then waits until the payment settles onchain. PayKit pays the gas.
- Options: `accent` (hex colour), `server`, `walletUrl`, `onPaid(result)`.
- Browser only. In React or Next, call it from an event handler (it touches `window`). Never at module top level during SSR.
- Plain HTML, no bundler: `<script type="module">import { openCheckout } from "https://esm.sh/usepaykit/checkout";</script>`
- No-code alternative: redirect the customer to `invoice.payUrl` (PayKit's hosted page).

The browser result is for UI only. **Fulfil orders from the webhook (step 4) or a server-side check, never from the browser callback.**

## 4. Server: webhook = source of truth

Set your endpoint once:

```sh
npx usepaykit webhook set https://yourshop.com/api/paykit/webhook
```

or `await paykit.merchant.update({ webhookUrl })`.

Every delivery is a `POST` with the header `PayKit-Signature: t=<unix>,v1=<hex hmac-sha256>`. Verify it against the **raw** body:

```ts
import { verifyWebhook } from "usepaykit";

export async function POST(req: Request) {             // Next.js app router
  const raw = await req.text();                        // raw body, before JSON.parse
  let event;
  try { event = await verifyWebhook(raw, req.headers.get("paykit-signature"), process.env.PAYKIT_WEBHOOK_SECRET!); }
  catch { return new Response("bad signature", { status: 400 }); }

  if (await alreadyHandled(event.id)) return new Response("ok"); // deliveries can repeat: dedupe on event.id
  if (event.type === "invoice.paid") {
    const inv = event.data.invoice;                    // { id, reference, amount, amountPaid, status, ... }
    await markOrderPaid(inv.reference, inv.id);        // your code; check the amount matches your order
  }
  return new Response("ok");                           // any 2xx; otherwise PayKit retries
}
```

Express: use `express.raw({ type: "application/json" })` on that route, then call `verifyWebhook(req.body, req.get("paykit-signature"), secret)`.

Event types:
- `payment.settled`: `data.payment`, `data.invoice`.
- `invoice.paid`: `data.invoice`.
- `refund.settled`.
- `subscription.activated`, `subscription.charged`, `subscription.charge_failed`, `subscription.past_due`, `subscription.cancelled`, `subscription.completed`.

Test the endpoint with `npx usepaykit webhook test`.

No webhook endpoint? Poll on the server instead: `await paykit.invoices.waitForPaid(invoiceId)`, or `paykit.invoices.get(id)` and check `status === "paid"`.

## 5. Optional

- **Points.** Customers earn PayKit points and spend them at any PayKit shop:
  - `paykit.points.createCampaign({ pointsPerUsdt: 10 })` (platform maximum 100)
  - `paykit.points.createReward({ name: "1 USDT off", pointsCost: 100, type: "fixed_off", value: "1" })`
- **Subscriptions and installments.** `paykit.plans.create({...})`. Customers subscribe at `https://paykit-app.vercel.app/#pay/subscribe/<planId>`.
- **Refunds.** `paykit.refunds.create(paymentId, { amount })` returns typed data that the payout wallet signs. Then call `paykit.refunds.authorize(refundId, signature)`.
- **Receipts.** `paykit.payments.receipt(paymentId)`. `onchain.verified` is checked against the chain.

## 6. Errors

Every call throws a `PayKitError` with `status`, `code` and `message`. Common cases:
- `401 unauthorized`: wrong or missing `PAYKIT_API_KEY`.
- `400 invalid_amount` or a fee-floor error: the amount is below about 1.67 USDT.
- `code: "network"`: the server could not be reached.

Show `message` to developers, not customers.

## 7. Checklist before you finish

- [ ] `usepaykit` is in dependencies. `PAYKIT_API_KEY` and `PAYKIT_WEBHOOK_SECRET` are in `.env.example` (empty) and in the real environment.
- [ ] Invoices are created on the server, priced from server data. The API key never reaches the browser bundle.
- [ ] Checkout calls `openCheckout({ invoiceId })` from a click handler.
- [ ] The webhook verifies the signature on the raw body, dedupes `event.id`, and fulfils on `invoice.paid`.
- [ ] `npx usepaykit doctor` passes.

CLI reference: `npx usepaykit help`.
