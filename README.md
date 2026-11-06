# PayKit

Gasless USDT checkout and loyalty for shops on Whitechain. A merchant drops PayKit into an existing
store in about 20 lines. The customer pays in USDT with one MetaMask signature and never needs WBT for
gas. The sale settles on Whitechain straight into the merchant's own wallet. After the first payment,
PayKit handles refunds, subscriptions and instalments, signed webhooks, an accountant's CSV export, and
loyalty points the customer can spend at any PayKit shop.

**Live:** [website](https://paykit-landing-one.vercel.app) · [app (PWA)](https://paykit-landing-one.vercel.app/app/) ·
demo shops [Kettle & Leaf](https://kettle-and-leaf-five.vercel.app) and [Paper Lantern Books](https://paper-lantern-books.vercel.app) ·
npm [`usepaykit`](https://www.npmjs.com/package/usepaykit)

## Why this needs onchain stablecoin settlement on Whitechain

**A card or bank rail can't give a shop final, self-custodied payment from any customer in the world,
for a 2 USDT order, in seconds, with a receipt and a refund that anyone can check without trusting us.
USDT settling on Whitechain can.**

- **Final and self-custodied.** The router pays the merchant's registered payout wallet in the same
  transaction as the customer's payment. There is no acquirer, no payout delay, no rolling reserve and no chargeback window.
- **Small and cross-border.** Whitechain is an L2, so fees are tiny. PayKit takes 1% (0.05 USDT minimum),
  so a 2.50 USDT sale is worth taking, and any customer with USDT can pay without card networks or currency conversion.
- **Enforced by the contract, not by us.** `PaymentRouterV2` checks the merchant's signed quote, the amount,
  the fee cap and the payer's EIP-3009 signature. It can only send a refund back to the original payment's
  refund address, and never more than was paid. Receipts are read straight from the chain.
- **One signature, no gas.** USDT on Whitechain supports EIP-3009 (`receiveWithAuthorization`). The customer
  signs, and the PayKit relayer submits and pays the WBT. The fee treasury swaps USDT fees to WBT to refill the relayer.
- **Loyalty that travels.** Points earned at one shop are spendable as a discount at another. The router
  applies the discount in the same settlement, so no shop has to trust another's private ledger.

## Proof on Whitechain (testnet, chain 1874)

Payments in the main flow use Whitechain's test USDT, [`0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`](https://explorer.testnet.whitechain.io/address/0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7).

| What | Explorer |
|---|---|
| **Shop checkout, main flow**: a Kettle & Leaf order paid in the store's in-page PayKit checkout, through `PaymentRouterV2`. The customer pays 2.50 USDT: 2.45 USDT to the shop, 0.05 USDT fee, +25 loyalty points. | [`0xa16314b1…6fb20a`](https://explorer.testnet.whitechain.io/tx/0xa16314b1bbb6c38715a766399743ef172ac9db84c9d4de7fffa4c18d956fb20a) |
| First payment through the original router (2 USDT) | [`0x4550d2f8…681635`](https://explorer.testnet.whitechain.io/tx/0x4550d2f892ed5c41c9a278431b516d677583e126251d2600f1b6770d9f681635) |
| Refund of that payment, back to the payer's refund address | [`0xe47ba3db…28c049`](https://explorer.testnet.whitechain.io/tx/0xe47ba3dbd8b132fe3389e1e2f294bea8edfbb654336f1d81fad5ad673a28c049) |

All contracts are deployed and verified on the Whitechain explorer:

| Contract | Address |
|---|---|
| `PaymentRouterV2`: payments, discounts, refunds, plans (used by the live flow) | [`0xb3BA57B6FEDb83030244e1fe6DB832dfC77B1c57`](https://explorer.testnet.whitechain.io/address/0xb3BA57B6FEDb83030244e1fe6DB832dfC77B1c57) |
| `PayKitPoints`: non-transferable loyalty points (PKP) | [`0x97d59a00FdfBea72C9D95d2C43AdAa1938608d5f`](https://explorer.testnet.whitechain.io/address/0x97d59a00FdfBea72C9D95d2C43AdAa1938608d5f) |
| `MerchantRegistry`: merchants, payout wallets, quote signers | [`0xF6B60D212abd955a6d4937535f89B5B7b6426C47`](https://explorer.testnet.whitechain.io/address/0xF6B60D212abd955a6d4937535f89B5B7b6426C47) |
| `FeeTreasury`: protocol fees, USDT→WBT refills for the relayer | [`0xeb52e2394ECFbAbFD53F9cF9e50F8c4bC35d84e2`](https://explorer.testnet.whitechain.io/address/0xeb52e2394ECFbAbFD53F9cF9e50F8c4bC35d84e2) |
| `PaymentRouter` (first version, kept for older payments) | [`0xef2f926CF5D57098Ff3e57f65492b74Ac0E2b489`](https://explorer.testnet.whitechain.io/address/0xef2f926CF5D57098Ff3e57f65492b74Ac0E2b489) |

Sources: [`paykit-contracts/contracts`](paykit-contracts/contracts). Addresses and constructor arguments: [`paykit-contracts/deployments/1874.json`](paykit-contracts/deployments/1874.json).

## Architecture

```
 Shop website (any stack)                    PayKit                                   Whitechain (1874)
 ─────────────────────────                   ──────                                   ─────────────────
 server: usepaykit ── POST /v1/invoices ──▶  paykit-server (Vercel, Express)           MerchantRegistry
 browser: openCheckout({ invoiceId }) ──────▶  · prices nothing; reads the invoice      PaymentRouterV2 ── USDT ──▶ merchant payout wallet
   1. MetaMask signs EIP-3009 (no gas)        · signs the quote with the merchant's    PayKitPoints (earn / redeem)
   2. ── signature ─────────────────────────▶   signer key                             FeeTreasury (fees → WBT refill)
                                              · relayer submits pay() and pays WBT ──▶
 webhook endpoint ◀── signed invoice.paid ──  · observer reads PaymentSettled ◀──────
                                              · Postgres (Neon): invoices, quotes,
 PayKit app / PWA (customer + merchant)        payments, refunds, plans, points
   wallet: receipts, points, refunds ◀──────  · public receipts are re-checked
   merchant console: invoices, campaigns,       against the chain
   API keys, wallet sign-in
```

| Part | Folder | What it does |
|---|---|---|
| Contracts | [`paykit-contracts/`](paykit-contracts/README.md) | Solidity (Hardhat): registry, routers, points, fee treasury. Deploy and verify scripts. |
| Payment server | [`paykit-server/`](paykit-server/README.md) | Express on Vercel, Postgres (Neon), ethers v6. Merchant API (`pk_test_` keys or wallet sign-in sessions), public checkout API, quote signing, relayer, chain observer, signed webhooks with retries, CSV export, points campaigns and rewards. Loyalty can also be mirrored to [Arkiv](paykit-server/ARKIV.md) (`POINTS_BACKEND=arkiv`). |
| SDK on npm | [`packages/paykit/`](packages/paykit/README.md) | `usepaykit`: server client, `verifyWebhook`, in-page checkout (`usepaykit/checkout`), CLI, MCP server, and one-command setup for coding agents. |
| In-page checkout | [`packages/embed/`](packages/embed/) | The MetaMask checkout dialog shops open on their own page. No framework, no dependencies. |
| App and PWA | [`web/`](web/README.md) | Customer wallet (receipts, points, invoices), shops directory, merchant sign-up and console, hosted pay pages, React component gallery. Installable PWA with QR scan and device unlock. |
| Demo shops | [`stores/`](stores/) | Two separate storefronts that create invoices server-side and take payment in place: the "separate demo app" integration. |
| Website | [`frontend/`](frontend/) | Landing page; ships the app at `/app/`. |
| React SDK packages | [`packages/`](packages/README.md) | `@paykit/react` components and hooks, plus core/js/node/next libraries (local workspace packages). |

### Payment flow

1. The shop's server creates an invoice with its merchant key. The price comes from the shop's own order data.
2. The shop's page calls `openCheckout({ invoiceId })`. The customer connects MetaMask, which switches to Whitechain, and picks a points reward if they have one.
3. PayKit returns a quote signed by the merchant's signer key, and EIP-3009 typed data for the exact USDT amount.
4. The customer signs once in MetaMask. The relayer submits `PaymentRouterV2.pay`, and the router moves USDT to the merchant's payout wallet, takes the fee, applies the discount and records points.
5. The observer reads `PaymentSettled`. PayKit marks the invoice paid and sends a signed `invoice.paid` webhook. The customer's receipt shows the explorer link.
6. Later: the merchant refunds, which goes back to the payer onchain. Plans collect instalments with a permit. Accountants download `exports/payments.csv`.

## Setup

Node 24 and npm. Test tokens come from the Whitechain faucet: WBT for deploying, USDT for paying.

```sh
npm ci                                   # whole monorepo
# Payment server (needs a Postgres URL; without one it runs on an in-memory store)
cd paykit-server && npm install
cp .env.example .env                     # Windows: copy .env.example .env
npm run gen-secrets                      # paste ADMIN_TOKEN and MASTER_KEY into .env, add RPC and keys
npm start                                # http://localhost:8787/health
# App (another terminal, repo root)
VITE_PAYKIT_API_URL=http://localhost:8787 npm run dev     # http://localhost:5174
# Website
npm run frontend                                          # http://localhost:5176
```

- **Contracts:** `cd paykit-contracts && npm install`, then `npx hardhat run scripts/deploy.js --network whitechainTestnet`, `scripts/deployV2.js` (router V2 + points) and `scripts/verify.js` ([details](paykit-contracts/README.md)). `npm run contracts:check` compares the SDK with a deployment.
- **A demo shop:** `node stores/build.mjs kettle-leaf`. It needs a merchant API key as `STORE_API_KEY`; create a merchant in the app under **Merchant**.
- **SDK packages:** `npm run sdk:build && npm run sdk:test`.
- **Offline demo:** `npm run server:demo` starts the SDK API on a simulated chain (no funds, port 8787).

## The SDK

PayKit's SDK is what a merchant adds to their own app. The main package is **[`usepaykit`](https://www.npmjs.com/package/usepaykit)** on npm (source in [`packages/paykit`](packages/paykit/README.md)). It has no dependencies, ships TypeScript types, and runs on Node 18+, Bun, Deno and edge runtimes.

| Import | Runs in | What it gives you |
|---|---|---|
| `usepaykit` | your server | `PayKit` client for invoices, payments, refunds, plans, points and merchant settings; `verifyWebhook` |
| `usepaykit/checkout` | the browser | `openCheckout({ invoiceId })`: the in-page MetaMask checkout. It opens on the shop's own page, with no redirect. |
| `npx usepaykit` | your terminal | CLI: project setup, `doctor`, invoices, webhooks, and an MCP server for coding agents |
| `@paykit/react` | React apps | Copyable components and hooks (local workspace package, see [below](#react-components)) |

### Set up with one command

```sh
npx usepaykit@latest init
```

This command:

- Installs the [`usepaykit`](packages/paykit/README.md) npm package.
- Finds your coding agents: Claude Code, Cursor, VS Code/Copilot, Codex, Windsurf, Gemini CLI.
- Installs a PayKit skill or rule for each agent.
- Registers the PayKit MCP server.
- Adds `PAYKIT_*` placeholders to `.env.example`.

Then ask your agent: *"Add PayKit checkout to this app."* The agent guide is [`packages/paykit/AGENTS.md`](packages/paykit/AGENTS.md): drag it into any chat, or run `npx usepaykit agents`.

### Use it in about 20 lines

The demo shops in [`stores/`](stores/) are separate apps that integrate PayKit exactly like this.

```js
// server: create the invoice from your own order (never trust a price from the browser)
import { PayKit, verifyWebhook } from "usepaykit";
const paykit = new PayKit();                       // PAYKIT_API_KEY from env
app.post("/api/checkout", async (req, res) => {
  const order = await createOrder(req.body);       // your code
  const invoice = await paykit.invoices.create({ amount: order.total, reference: order.id });
  res.json({ invoiceId: invoice.id });
});
// server: fulfil from the signed webhook
app.post("/api/paykit/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const event = await verifyWebhook(req.body, req.get("paykit-signature"), process.env.PAYKIT_WEBHOOK_SECRET);
  if (event.type === "invoice.paid") await markPaid(event.data.invoice.reference);
  res.sendStatus(200);
});

// browser: pay on your own page, no redirect
import { openCheckout } from "usepaykit/checkout";
const { invoiceId } = await (await fetch("/api/checkout", { method: "POST", body: JSON.stringify(cart) })).json();
const result = await openCheckout({ invoiceId });   // MetaMask → one signature → settled on Whitechain
```

Merchants get their `PAYKIT_API_KEY` and webhook secret by signing up in the app under **Merchant** (one wallet signature, no gas).
React apps can use the [components](#react-components) instead.

### Server API

```js
import { PayKit } from "usepaykit";
const paykit = new PayKit({ apiKey: process.env.PAYKIT_API_KEY }); // serverUrl defaults to the live server
```

| Namespace | Methods |
|---|---|
| `paykit.invoices` | `create({ amount, reference, description, successUrl, dueDate, metadata })`, `get`, `list`, `getPublic`, `waitForPaid` |
| `paykit.payments` | `list`, `get`, `receipt(paymentId)` (cross-checked against the chain) |
| `paykit.refunds` | `create(paymentId, { amount })` returns typed data for the payout wallet to sign; `authorize(refundId, signature)` |
| `paykit.plans` / `paykit.subscriptions` | create and list subscription or instalment plans; `cancel` |
| `paykit.points` | `createCampaign({ pointsPerUsdt })`, `createReward({ name, pointsCost, type, value })`, `summary`, `customer(wallet)` |
| `paykit.merchant` | `get`, `update({ webhookUrl, profile })` |
| `paykit.webhooks` | `test`, `events`, `redeliver`, `verify` |

Amounts are USDT decimal strings, such as `"12.50"`. Every failure throws a `PayKitError` with `status`, `code` and `message`.

### In-page checkout

```js
import { openCheckout } from "usepaykit/checkout";
const result = await openCheckout({ invoiceId, accent: "#1f3d2b" });
if (result.status === "paid") showThankYou(result.paymentId, result.txUrl);
```

The checkout does the rest:

1. It connects MetaMask (EIP-6963) and switches it to Whitechain.
2. It shows the shop's points rewards.
3. It asks for one gasless USDT signature.
4. It waits until the router has settled the payment onchain.

The invoice and receipt stay on PayKit, so the customer also sees them in the PayKit wallet. Options: `invoiceId`, `server`, `accent`, `walletUrl`, `onPaid`. You can also skip the code entirely and send the customer to the invoice's hosted `payUrl`.

### Webhooks

Each delivery is a `POST` with a `PayKit-Signature: t=<unix>,v1=<hex>` header: HMAC-SHA256 over `${t}.${rawBody}`, with a 5-minute tolerance. `verifyWebhook(rawBody, header, secret)` checks the signature and returns the event. Failed deliveries are retried, and the merchant can redeliver any event.

Events:

- `invoice.paid`
- `payment.settled`
- `refund.settled`
- `subscription.activated`, `subscription.charged`, `subscription.charge_failed`, `subscription.past_due`, `subscription.cancelled`, `subscription.completed`
- `test.ping`

### CLI

```
npx usepaykit init                      set up the package, agent guide, skills and MCP server
npx usepaykit doctor                    check the server and your API key
npx usepaykit whoami                    show the merchant account
npx usepaykit invoice create 5 --reference ORDER-1
npx usepaykit invoice get <id> | list | wait <id>
npx usepaykit webhook set <url> | test
npx usepaykit agents                    print the agent guide
npx usepaykit mcp                       run the MCP server (stdio)
```

The CLI reads `PAYKIT_API_KEY` from the environment, `.env` or `.env.local`. Add `--json` for machine-readable output.

### For AI coding agents

`npx usepaykit init` installs PayKit for whichever agents a project uses:

- **Agents covered:** Claude Code, Cursor, VS Code/Copilot, Codex, Windsurf and Gemini CLI.
- **Instructions:** it writes [`AGENTS.md`](packages/paykit/AGENTS.md) as `PAYKIT.md`, plus a skill or rule per agent.
- **MCP server:** it registers PayKit's MCP server, which gives the agent these tools:
  - `paykit_guide` and `paykit_doctor`
  - `paykit_get_merchant`
  - `paykit_create_invoice`, `paykit_get_invoice` and `paykit_list_invoices`
  - `paykit_list_payments`
  - `paykit_set_webhook` and `paykit_send_test_webhook`

Then ask the agent: *"Add PayKit checkout to this app."* The API key always stays in `.env`; it is never written into config files.

### React components

[`packages/react`](packages/README.md) (`@paykit/react`) has components you copy into your app and style however you like. The payment logic stays in hooks:

- **Components:** `CheckoutButton`, `InvoiceView`, `PaymentStatus`, `ReceiptView`, `ProductGrid`, `Cart`, `DepositPicker`, `InstallmentPlanPicker`, plus merchant dashboards.
- **Hooks:** `useCheckout`, `usePayment`, `useCart`, `usePlanCheckout`, `useRefund`.

The [component gallery](https://paykit-landing-one.vercel.app/app/#components) previews them live in test mode. `npm run ui:add -- checkout --cwd ../your-store` copies a component and its stylesheet into your project.

## Mobile app (PWA)

**Android installer:** download **PayKit-Android.apk** from
[GitHub Releases](https://github.com/Jethin10/PayKit/releases/latest), open it
on your phone, allow installation from that download source when Android asks,
then tap **Install**. It adds PayKit to your home screen and runs the live PWA.

The PayKit mobile app is in [`web/`](web/), with a home-screen app manifest,
offline app shell, fingerprint/face/device-PIN unlock, and a QR scanner.
It shares the website's pixel artwork and typography.

You can also install directly from the [PayKit app](https://paykit-landing-one.vercel.app/app/#settings):

| Device | Install PayKit |
|---|---|
| Android | Open the app in Chrome, then **Settings → Install PayKit**, or use Chrome's **Install app** menu. |
| iPhone / iPad | Open the app in Safari, tap **Share → Add to Home Screen**. |
| Desktop | Open the app in Chrome or Edge and choose **Install app** in the browser menu. |

In the installed app, use **Settings → Enable device unlock** for fingerprint,
face, or device-PIN unlock. Tap **Scan** to scan a payment QR, upload a QR image,
or paste an invoice link. You review the invoice before approving payment.

The Android APK is a launcher for the hosted PWA, using Android's browser engine.
Camera access and device unlock need a supported device and a secure origin.
[Mobile setup](web/MOBILE.md) · [Android installer source and build](android/README.md).

### Run the app locally

Use Node 24 and run these commands from the repository root:

```sh
npm ci
npm run build -w web
npm run preview -w web -- --host 127.0.0.1 --port 4174
```

Open **http://localhost:4174/#wallet**. The production build includes the service
worker; the development server does not register it. Use `localhost` for device
unlock rather than a numeric IP address.

## Live sites and deployment

| What | URL |
|---|---|
| Website: landing page (`frontend/`) | https://paykit-landing-one.vercel.app |
| Same website: app and SDK gallery (`web/`) | https://paykit-landing-one.vercel.app/app/ |
| PayKit server (`paykit-server/`, Whitechain testnet) | https://paykit-server.vercel.app/health |
| Demo company: Kettle & Leaf (`stores/`) | https://kettle-and-leaf-five.vercel.app |
| Demo company: Paper Lantern Books (`stores/`) | https://paper-lantern-books.vercel.app |

Invoices and plans created on the server link to the app's hosted pages: `#pay/<invoiceId>` pays real
test USDT with one wallet signature, `#pay/subscribe/<planId>` starts a plan. The rest of the app runs
against the same server: `paykit-server` also hosts the SDK API (`packages/server`, bundled by
`npm run bundle-sdk` in `paykit-server`), with demo shops and simulated settlement for the preview
wallets, its state kept in Neon.

The two demo companies are their own websites: checkout creates a PayKit invoice with the store's
merchant key (server-side), and the customer pays it in PayKit's checkout dialog on the store's own
page with MetaMask. Points earned at one store can be spent at the other; the Wallet page on the PayKit
site lists every invoice, receipt and point across stores. Build one with
`node stores/build.mjs <kettle-leaf|paper-lantern> [other store url]`, then `vercel deploy --prebuilt --prod`
from `stores/out/<slug>` (the project needs `STORE` and `STORE_API_KEY`).

The landing page and the app are one website: the app is built to live under `/app/` and ships inside
the landing deployment. The old `paykit-app.vercel.app` permanently redirects to `/app/` and keeps the
`#fragment`, so earlier pay links (`#pay/<invoiceId>`) still work.

Redeploy (Vercel CLI, logged in; in Git Bash set `MSYS_NO_PATHCONV=1` so `/app/` isn't turned into a Windows path):
`paykit-server` with `npm run bundle-sdk && vercel deploy --prod`, then:

```sh
# 1. the app, built for /app/
cd web && VITE_BASE=/app/ VITE_PAYKIT_API_URL=https://paykit-server.vercel.app VITE_PAYKIT_SERVER_URL=https://paykit-server.vercel.app VITE_PAYKIT_SITE_URL=/ npx vite build --outDir dist-app --emptyOutDir
# 2. the landing page, which packages web/dist-app at /app/
cd ../frontend && VITE_PAYKIT_APP_URL=/app npm run build && node scripts/vercel-output.mjs && vercel deploy --prebuilt --prod
# 3. (only if the redirect ever needs changing) the old app domain
cd .. && node scripts/redirect-old-app.mjs && cd web && vercel deploy --prebuilt --prod
```

## More docs

- [Whitechain feedback](WHITECHAIN_FEEDBACK.md): what worked, where we got stuck, and what the docs were missing
- [Merchant integration and customization](packages/README.md) · [Existing-store Next.js example](examples/next-store/README.md)
- [Specification](plan.md) · [SDK implementation status](research/SDK-IMPLEMENTATION-STATUS.md) · [Contracts integration review](research/CONTRACTS-INTEGRATION.md)
- [Payment server](paykit-server/README.md) · [Arkiv loyalty backend](paykit-server/ARKIV.md) · [MCP server for AI agents](packages/mcp/README.md)
- [Mobile app](web/MOBILE.md) · [Android installer](android/README.md) · [App configuration](web/README.md)

`backend/`, `contracts/` and `compose.yaml` are a generic local toolchain starter (FastAPI, Hardhat/Foundry, Postgres, Redis), not part of the payment flow. See [SETUP_STATUS.md](SETUP_STATUS.md).
