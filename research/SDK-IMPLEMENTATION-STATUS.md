# PayKit implementation status

The SDK implementation follows `plan.md` only. Contracts were not changed. No push, deployment or package publication was performed.

## Merchant integration

The supported existing-store path is:

1. Your backend calls `paykit.checkout.createSession({ externalOrderId, lineItems })` using server-derived prices.
2. Your React page mounts `PayKitProvider` and `CheckoutButton input={{ sessionId }} amount={displayedTotal}`.
3. Your backend verifies `payment.finalized` webhooks and fulfills the existing order transactionally once.

The same hooks support fully custom UI. Styles are optional; the provider accepts themes, class names and typed CSS variables. Local copyable checkout/payment-status templates and shadcn-compatible registry JSON are included. Merchant catalogue, cart and dashboards are optional helpers.

See [the integration guide](../packages/README.md) and [the Next.js example](../examples/next-store/README.md).

## Fixes from the audit

- Real domain proof is fetched from the claimed host. Supplied-file bypasses are restricted to simulation. Domain challenges are merchant-scoped, proofs are rechecked, and revocations are queued durably.
- Browser keys are checked for validity, revocation, merchant scope and allowed origins. Arbitrary authorization headers cannot replace authentication. Peer budgets also cover rotating bogus credentials.
- Existing order references and bounded metadata survive invoices, checkout and payment webhooks. Displayed checkout and installment terms are checked before signing.
- Stable operation keys deduplicate retries, including locally signed checkout after time advances. Invoice attempts, refund caps and concurrent authorizations are guarded. Raw API secret keys are excluded from persisted response caches.
- SQLite WAL snapshots persist financial jobs and the outbox synchronously. A lock prevents concurrent server writers. Signed transaction bytes and hashes are persisted before broadcast.
- Unknown outcomes remain recoverable. The relay coordinates nonces, bounds fees/gas/daily spending and replaces stuck transactions with the same nonce/calldata. Receipt lookup checks all replacement hashes and accepts the canonical mined winner.
- Payments and refunds resume from persisted state. Canonical receipt checks undo orphaned invoice projections. Plan schedules advance only after canonical finality; down payments and installments enter normal payment records and fulfillment events.
- A finalized event observer reconciles externally submitted settlements from a durable cursor. The standalone observer CLI reconstructs a pinned public event ledger and deterministic hash.
- Guarded outbound HTTPS resolves and pins public addresses, rejects private destinations and redirects, and bounds request time and response size. HTTP request bodies and sponsorship admission are bounded.
- Webhooks retain stable IDs across endpoints and retries. Exhausted deliveries can be retried through the SDK and merchant UI.
- React polling survives payment-ID changes; wallet changes clear the client session; Next.js client boundaries use named exports; proxy key-management options work.
- Browser SDK production dependencies no longer include the API server. Simulations live in `@paykit/testing`.
- An opt-in refill worker implements batch/daily limits, quote and independent floor checks, execution/L1 cost estimates, economic SKIP/RUN/PAUSE decisions, and persistent submitted runs. It requires operator configuration and actual gas measurements.

## Verification

- All eight SDK packages passed typechecking and ESM builds. The full regression suite passed 118 tests with zero failures.
- Vite store build, website lint/build and Next.js App Router example build.
- Clean Next.js consumer installed from local SDK tarballs outside the workspace. It compiles the copyable UI sources and confirms production installation excludes `@paykit/server` and `@paykit/testing`.
- Normal demo-service smoke through HTTP: existing-order checkout, stable retry, customer authorization, signed finality webhook, funded refund and process restart with persisted results.
- Local JSON-RPC fixture verifies persistence before broadcasting, same-nonce replacements, recovery of a mined original and reorg reset.
- Public HTTPS transport smoke returned HTTP 200. The live Whitechain test reads finality, permit nonce and relay balance only.

## Boundaries that remain

- Deployed-contract ABI/signature compatibility and actual nonzero payment, refund, installment and refill writes still need validation against the contract owner's configuration. These checks were not replaced with simulated claims.
- This release uses a single-process SQLite store and ESM packages. A Postgres/Redis scale-out deployment, multiple API writers, CJS distribution, audits and verified mainnet support are not included.
- Copyable UI registry files are local assets. No registry or npm package has been published.
- Finalized event reconstruction restores public settlement facts. Private order and invoice detail still requires a consistent backup.

Useful local checks: `npm run sdk:typecheck`, `npm run sdk:build`, `npm run sdk:test`, `npm run sdk:consumer`, and `node scripts/smoke-sdk.mjs`.
