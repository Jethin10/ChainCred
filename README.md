# PayKit

USDT commerce SDK for Whitechain. Merchants keep their existing website and order system. Customers authorize payments without buying WBT for gas; the PayKit service submits transactions.

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

The demo uses simulated payments until configured with a real API. `npm run dev` opens the SDK showcase. `npm run server:demo` starts the local simulated payment service. See the integration guide for merchant keys, verified webhooks and real-service configuration.

## Merchant integration

Create a session on your backend with `@paykit/node`, render `PayKitProvider` and `CheckoutButton` from `@paykit/react`, and fulfill orders from verified `payment.finalized` webhooks. Server-derived prices, order references and stable operation keys keep retries tied to the same order.

React components are optional. Headless APIs and hooks support custom UI. Styles are opt-in and can be themed with CSS variables. Copyable UI templates are under `packages/react/registry`.

## Scope and validation

The current operator service uses a single-process transactional SQLite store, durable relay jobs, signed webhooks and finalized event reconciliation. The standalone observer reconstructs public event ledgers. Fee refills are opt-in and require actual gas measurements.

Contracts are maintained separately by their owner and are not part of this SDK change. Deployed ABI/signature compatibility and real payment, refund, installment and refill writes require testnet validation with that deployment. No audit or verified mainnet compatibility is claimed.

The existing `frontend/` landing page is preserved. The SDK showcase and separate store examples are under `web/` and `examples/`.
