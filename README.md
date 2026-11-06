# PayKit

USDT commerce SDK for Whitechain. Merchants keep their existing website and order system. Customers authorize payments without buying WBT for gas; the PayKit service submits transactions.

## Live

| What | URL |
|---|---|
| Landing page (`frontend/`) | https://paykit-landing-one.vercel.app |
| App and SDK gallery (`web/`) | https://paykit-app.vercel.app |
| PayKit server (`paykit-server/`, Whitechain testnet) | https://paykit-server.vercel.app/health |

Invoices and plans created on the server link to the app's hosted pages: `#pay/<invoiceId>` pays real
test USDT with one wallet signature, `#pay/subscribe/<planId>` starts a plan. The rest of the app runs
against the same server: `paykit-server` also hosts the SDK API (`packages/server`, bundled by
`npm run bundle-sdk` in `paykit-server`), with demo shops and simulated settlement for the preview
wallets, its state kept in Neon.

Redeploy (Vercel CLI, logged in): `paykit-server` with `npm run bundle-sdk && vercel deploy --prod`; the two sites are built
locally and shipped prebuilt:

```sh
# app
cd web && VITE_PAYKIT_API_URL=https://paykit-server.vercel.app VITE_PAYKIT_SITE_URL=https://paykit-landing-one.vercel.app npm run build
node -e "const f=require('fs');f.rmSync('.vercel/output',{recursive:true,force:true});f.cpSync('dist','.vercel/output/static',{recursive:true});f.writeFileSync('.vercel/output/config.json','{\"version\":3}')"
vercel deploy --prebuilt --prod
# landing
cd frontend && VITE_PAYKIT_APP_URL=https://paykit-app.vercel.app npm run build && node scripts/vercel-output.mjs && vercel deploy --prebuilt --prod
```

## Start here

- [Merchant integration and customization](packages/README.md)
- [Existing-store Next.js example](examples/next-store/README.md)
- [Canonical specification](plan.md)
- [Implementation status and validation boundaries](research/SDK-IMPLEMENTATION-STATUS.md)

Use Node 24 and npm:

```sh
npm ci
npm run sdk:build
npm run sdk:typecheck
npm run sdk:test
npm run demo
```

## Run the whole thing

| Command | Port | What |
|---|---|---|
| `npm run server:demo` | 8787 | PayKit API on a simulated chain, with demo shops |
| `npm run dev` | 5174 | App: SDK components, Shops, Invoice, Payments, Merchant (`web/`) |
| `npm run frontend` | 5176 | Landing page (`frontend/`) |

The landing page's calls to action open the app. The app proxies `/v1` to the API and shows **Live API** when it answers, or uses an in-browser mock when it doesn't. Both share one design: pixel-dithered sky, Da Vinci italic headings, Geist text. See [web/README.md](web/README.md) for configuration, and the integration guide for merchant keys, verified webhooks and real-service configuration.

`backend/`, `contracts/` and `compose.yaml` are the generic local toolchain starter (FastAPI, Hardhat/Foundry, Postgres, Redis). `scripts/verify.ps1` checks it; see [SETUP_STATUS.md](SETUP_STATUS.md).

## Contracts, loyalty points and MCP

- The PayKit contracts are in [contracts/paykit](contracts/paykit/README.md). [Integration review](research/CONTRACTS-INTEGRATION.md): what was fixed, what is still missing (the `libraries/` and `interfaces/` files), and the go-live checklist.
- `npm run contracts:check` compares the SDK with a deployment (read-only).
- Universal loyalty points (PaymentRouterV2 + PayKitPoints): earn at any shop, spend as discounts at any other. Demo: Mumbai Chai Co. gives 10 PKP per USDT.
- `npm run mcp` starts the [PayKit MCP server](packages/mcp/README.md) for AI agents.

## Merchant integration

Create a session on your backend with `@paykit/node`, render `PayKitProvider` and `CheckoutButton` from `@paykit/react`, and fulfill orders from verified `payment.finalized` webhooks. Server-derived prices, order references and stable operation keys keep retries tied to the same order.

React components are optional. Headless APIs and hooks support custom UI. Styles are opt-in and can be themed with CSS variables. The Components tab has live previews, source/style copy buttons, prop references and install instructions. Run `npm run ui:add -- checkout --cwd "../your-store"` to install local SDK packages and copy a complete customizable component. [Copy-and-paste guide](packages/react/registry/README.md).

## Scope and validation

The current operator service uses a single-process transactional SQLite store, durable relay jobs, signed webhooks and finalized event reconciliation. The standalone observer reconstructs public event ledgers. Fee refills are opt-in and require actual gas measurements.

Contracts are maintained separately by their owner and are not part of this SDK change. Deployed ABI/signature compatibility and real payment, refund, installment and refill writes require testnet validation with that deployment. No audit or verified mainnet compatibility is claimed.

The landing page is in `frontend/`, the app and SDK showcase in `web/`, and separate store examples in `examples/`.
