# PayKit SDK readiness review

Historical pre-fix audit. The implementation now follows `plan.md` only. See [implementation status](SDK-IMPLEMENTATION-STATUS.md) for fixes and current verification.

Reviewed 6 November 2026. Scope: the current SDK, payment service, merchant example, `plan.md`, and relevant product decisions in `plan.other.md`. This is a snapshot review because the workspace has no Git repository. No contracts or implementation source were changed. Builds regenerated local build output.

## Verdict

PayKit already has a real SDK foundation. Shared types and signing code, a headless browser client, wallet adapters, a merchant server client, React components, Next.js handlers, and a separate demo store exist. This is more than a pay-button mockup.

It is not ready to freeze as a reliable merchant SDK. Most remaining work concerns correct payment outcomes, merchant order integration, service recovery, security boundaries, and proving the package in an independent consumer. Adding more dashboard components should wait.

The intended product makes sense: a merchant opens an account, configures their payout and domain, obtains keys, adds checkout to their existing site, and fulfills their existing orders from verified server events. PayKit operates or supplies the payment service. The merchant should not need to understand relay nonces, token authorization formats, treasury swaps, or chain finality implementation to accept a payment.

## What is already useful

- `@paykit/core` centralizes amount math, schemas, routes, typed signing messages, identifiers and errors.
- `@paykit/js` separates wallet signing from API transport and accepts wallet adapters. It checks returned session consistency before requesting signatures and rejects secret keys in the browser constructor.
- `@paykit/node` supports secret-key API access, invoice creation, local signing, refund funding and webhook verification.
- `@paykit/next` verifies raw webhook bodies and requires an explicit authorization callback for merchant-data proxies.
- `@paykit/react` provides checkout hooks, presentation components, carts and dashboards with CSS theming.
- `examples/demo-store` consumes the SDK separately from the platform website.
- The mock runs the same API implementation with a simulated chain. That is useful for developer onboarding, although it also means mock tests can share the same implementation mistakes.

## Findings that block a stable release

Severity reflects merchant consequences. These are SDK/service findings; none requires editing contracts during this work.

### 1. Critical: a merchant can verify a domain they do not control

Evidence: `packages/server/src/api.ts:710`, especially lines 712-713, and the check endpoint at line 1157.

`checkDomain` accepts a caller-supplied `file` string before considering real fetch mode. The merchant can sign their own challenge and submit it directly instead of serving it from the claimed domain. The platform then attests that domain.

Reproduced with `domainCheck: "fetch"`: an unrelated example domain became verified, and the injected network fetch was called zero times.

Required change: real verification must fetch the claimed host itself, validate the response schema, and fail closed on empty or invalid content. Submitted-file shortcuts belong only in an explicitly isolated mock. Add bounded fetches, destination validation, expiry and domain rechecks before treating a badge as current evidence.

### 2. High: an unknown payment outcome becomes a false failure

Evidence: `packages/server/src/api.ts:473`, `packages/server/src/chain/viem.ts:110`, and `packages/server/src/api.ts:1348`.

Receipt/RPC errors cause the payment to become `failed`, remove its pending authorization and emit `payment.failed`. The adapter has a 120-second receipt timeout. A broadcast transaction can still settle after that timeout. Failed records are not resumed, leaving invoice progress and merchant fulfillment inconsistent with the chain.

Required change: preserve submitted transactions in a recoverable state until their outcome is known. Reconcile by transaction hash and payment identifier. A timeout is not evidence of a reverted payment. Cover the crash window between broadcasting and persisting the transaction hash.

### 3. High: refunds cannot reliably recover after a restart

Evidence: `packages/server/src/api.ts:684` and `packages/server/src/api.ts:1348`.

Refund submission runs asynchronously, but restart recovery only resumes payments. Queued refund authorizations are not stored as durable jobs. Submitted refunds can remain stuck in the database even after settling onchain.

Required change: persist signed refund jobs before submission, recover submitted transaction hashes, and project the same refund result once after restart. Update invoice refund totals as well as payment refund totals.

### 4. High: idempotency headers do not make operations idempotent

Evidence: `packages/core/src/http.ts:71`, `packages/server/src/api.ts:375`, and the API request handler.

The client sends an `idempotency-key`, but the server never consumes it. Retrying invoice, cart-session or refund creation can create a different object. The existing-payment check occurs before awaited signature recovery, allowing concurrent authorization requests to pass the check before either inserts a payment. An in-memory relay lock does not prevent duplicate records.

Required change: durable operation keys scoped to merchant and operation, request-body conflict detection, unique financial identifiers, and transactional job/outbox insertion. Expose stable idempotency keys on high-level merchant creation methods, so merchants can retry by their own order reference.

### 5. High: browser keys do not enforce merchant scope

Evidence: public routes at `packages/server/src/api.ts:803`; key records at line 1271; CORS configuration at line 188.

Public checkout routes do not validate `x-paykit-key`. Missing, invented, revoked and cross-merchant browser keys are not distinguished. Allowed origins are stored but not enforced. Consumer history is filtered by wallet rather than the publishable key's merchant scope promised in the plan.

Required change: validate browser keys, revocation and merchant scope on the relevant routes; enforce configured browser origins; distinguish platform directory access from merchant-site access. Origin checks supplement authentication and do not prevent direct HTTP callers.

### 6. High: current finality tracking cannot establish canonical settlement

Evidence: `packages/server/src/chain/viem.ts:116` and `packages/server/src/api.ts:486`.

Finality uses only a saved block number and current safe/finalized heights. A transaction removed by a reorg can still be promoted because its old block height is below a finalized head. No receipt block hash or canonical log reconciliation exists. Tracking also stops after six hours without a durable retry path.

Required change: persist block hashes and logs, reconcile canonical receipts/events, roll back projections after reorgs, and resume reconciliation from a durable checkpoint. This is necessary for trustworthy fulfillment, even if the standalone observer CLI is deferred.

### 7. High: relayer spending and concurrent submissions are insufficiently bounded

Evidence: `packages/server/src/chain/viem.ts:63`, `packages/server/src/node.ts:42`, and plan section 12.3.

Simulation and a minimum relay balance check exist. Explicit nonce coordination, stuck-transaction replacement, gas/fee caps, reservations, request limits and payer/merchant failure budgets do not. The HTTP listener buffers request bodies without a size limit.

Required change: serialize nonce allocation per relay wallet, cap sponsorship costs, enforce quotas and body limits, and persist jobs and spending reservations. The 250 ms debounced JSON save is not a durable financial queue and cannot support multiple server writers.

### 8. High: installment payments do not follow the complete payment lifecycle

Evidence: `packages/server/src/api.ts:572`, line 643 onward, and `packages/react/src/hooks.ts:235`.

Plan creation does not create a payment record or invoice paid projection for an actual down payment. Collected installments are recorded as included but do not enter normal finality tracking or emit the corresponding payment finality events. A merchant using the documented `payment.finalized` handler therefore misses installment fulfillment. Plan-session creation also lacks the normal invoice void/expiry/remaining checks.

Required change: every actual transfer must enter one common payment projection, receipt, refund, journal and webhook path. Persist and recover plan creation, collection and cancellation jobs. Until then, mark automatic installments experimental or keep them outside the first supported release.

### 9. High: the signed checkout amount is not bound to the amount the UI displayed

Evidence: `packages/react/src/checkout.tsx:9`, `packages/react/src/hooks.ts:151`, `packages/js/src/client.ts:236`, and `packages/js/src/verify.ts:40`.

`CheckoutButton.amount` is a display prop. The hook obtains a new session and signs its quote without comparing it to that displayed total or retaining the caller's expected invoice/cart as an independent check. Session verification checks internal consistency, not the original business expectation.

Reproduced with the mock: a product displayed at 2.5 USDT was updated to 5 USDT before checkout, and the client signed and queued 5 USDT without an SDK confirmation of the changed amount. The wallet can display the authorization value, but the checkout page should agree with it.

Required change: support an expected amount and invoice/session identity, validate them before signing, or explicitly present the refreshed quote for approval. Check requested merchant and invoice identity against the returned session.

### 10. High: existing-store order correlation is incomplete

Evidence: `packages/node/src/paykit.ts:77` exposes invoice metadata, while `packages/server/src/api.ts:1041` drops it and the invoice schema does not retain it.

An existing merchant needs to connect their own order to the PayKit invoice and webhook. Currently they must implement and persist their own mapping, despite the server input appearing to accept metadata. Checkout primarily assumes PayKit-managed products or invoices.

Required change: support a server-created payment session for an existing merchant order, with a durable merchant order reference, validated amount, metadata and an idempotency key. Return those references in verified fulfillment events. Catalogue and dashboard components should remain optional.

### 11. High integration gap: the advertised Next.js example does not match the package

Evidence: `packages/react/src/index.ts:1`, `packages/react/src/context.tsx:1`, and `plan.md:1019`.

The React package has no `"use client"` boundary. Direct imports of its hook/context components from an App Router server page need a client wrapper; the plan shows direct imports without that wrapper. The plan also uses an absent `thirdwebAdapter`, `chain` instead of `network`, a `Cart` without its required merchant, a `CheckoutButton` without its required input, and a server constructor without its required `baseUrl`. Invoice line-item and schedule shapes in that example also differ from the implementation.

Required change: ship explicit client boundaries, replace illustrative snippets with compiling examples, and build a real Next.js App Router consumer using packed artifacts. Current Vite and render tests do not establish RSC compatibility.

### 12. High: webhook and verification fetches need destination restrictions and deadlines

Evidence: `packages/server/src/api.ts:279`, line 715 and line 1287.

Merchant-controlled webhook URLs can target internal HTTP services. Webhook fetches follow redirects and have no explicit timeout. Serial awaited deliveries can stall later delivery work; scheduled ticks can overlap because the interval does not await earlier ticks.

Required change: restrict schemes, ports and resolved destinations, validate redirects, bound response sizes and timeouts, and use bounded independent jobs. Persist delivery leases and an explicit exhausted/replayable state. Keep event IDs independent of endpoint identity if deduplication must work across endpoints or migration.

## Additional corrections before freezing APIs

- `packages/react/src/hooks.ts:189`: `usePayment` never resets its terminal `done` state when `paymentId` changes. Reproduced a finalized A followed by queued B: B fetched once and never polled again.
- `packages/core/src/amounts.ts:13`: numeric USDT input is rounded with `toFixed(6)` before validation. `parseUsdt(1.0000001)` returns `1000000n`, whereas the string form is rejected. Prefer decimal strings and bigint; never silently round excessive precision.
- `packages/next/src/index.ts:63`: `allowApiKeyManagement: true` cannot enable key creation or deletion because the underlying allowlist has no corresponding POST/DELETE routes. Either implement the option completely or remove it.
- `packages/server/src/api.ts:343` and line 532: checkout/plan quotes hardcode split profile zero even though split settings exist. Make supported profile selection explicit and validated.
- `packages/server/src/api.ts:1041`: enforce request schemas for positive integer quantities, nonnegative/positive money fields as appropriate, finite dates, and positive schedules summing to the invoice total. Validate before creating records or signing terms.
- `packages/react/src/shop.tsx:49`: hostname checking defaults off and badge status does not evaluate attestation expiry. Define where merchant-host checks apply, including the different rules for a platform-hosted directory.
- `packages/js/package.json`: the browser SDK depends on the server package for its mock export. Separate mock tooling if install footprint matters. This is an installation dependency issue, not proof that the real browser entry bundles server code.
- The plan promises CJS, changesets, copy-paste UI registries and an observer package. Current packages use ESM/TypeScript builds. Choose supported formats deliberately; these tooling choices matter less than financial correctness.
- The root README still describes the original starter. Make package entrypoints, runtime requirements, supported wallets, testnet limitations and platform setup discoverable from the root.

## Does the plan hold up?

The core intent holds up. A small merchant integration is possible because PayKit can own the complex service behind it. A few frontend lines alone cannot provide reliable order fulfillment; count the server route, webhook and environment configuration honestly.

The two plans are materially inconsistent. `plan.md` selects a Node backend, automatic permit-backed installments and percentage splits. `plan.other.md` selects FastAPI, fresh customer signatures for installments, and defers automatic debit and splits. The implementation mostly follows `plan.md`. Mark one canonical and archive the other with an explicit superseded notice after the team agrees on scope. Do not silently treat both as simultaneous requirements.

For the first stable SDK, support one-time payments, deposit/balance invoices, refunds, verified fulfillment and reliable recovery. Keep wallet adapters, headless APIs and the React checkout components. Treat directory polish, the UI registry, extra dashboards and automatic installments as later work unless the team explicitly needs them for the demo.

Fee refill and independent ledger reconstruction remain unimplemented service capabilities acknowledged in `packages/README.md`. They matter to the planned demonstration, but merchants should not have to implement them. Contract addresses and deployment settings do not fix these SDK/service gaps.

## Recommended merchant integration contract

1. One-time onboarding: register payout, verify domain, obtain a publishable key, secret key and webhook secret. Configure the PayKit service URL. Self-hosting the service is an operator path, not a requirement for every merchant.
2. Merchant backend: authenticate the customer's order, derive prices from the merchant's database, and create a PayKit invoice/session using the merchant's stable order reference as an idempotency key.
3. Merchant frontend: mount the provider and checkout for that session. Existing sites keep their own catalogue, cart, authentication and styling. PayKit can supply optional UI helpers.
4. Merchant webhook: verify the raw signed body, deduplicate on event ID, check merchant/order/amount, and transactionally fulfill at the chosen settlement threshold. A frontend success callback is for UX, not proof to ship goods.
5. Refund: initiate by payment/order reference, obtain funding consent where required, then track the same durable outcome lifecycle.

## Remaining work in implementation order

1. Fix domain proof bypass, publishable-key scope and outbound-request restrictions. Add negative-path regressions for each.
2. Introduce durable transactions, jobs and outbox records. Implement stable idempotency and unique operation identifiers. Persist jobs before submission.
3. Correct unknown-outcome handling, nonce coordination and recovery for payments, refunds and plan operations. Add spending caps and admission limits.
4. Implement canonical event reconciliation and reorg handling. Generate fulfillment events from reconciled payment facts.
5. Add existing-order sessions and retain merchant order references/metadata through the whole lifecycle. Bind displayed intent to signed terms.
6. Fix React polling, client boundaries and proxy inconsistencies. Freeze a small public API and compile every documentation snippet.
7. Prove installation from local tarballs in independent React and Next.js apps with no source export condition or workspace aliases. Include webhook-driven fulfillment and retry/restart scenarios.
8. With the contract owner supplying deployment/interface information, verify SDK write flows on the configured chain, shared signing vectors, deposits, splits if supported, refunds and replays. No contract modifications are part of this review.
9. Complete installment accounting/recovery before advertising automatic collection. Finish refill and standalone reconstruction separately if retained in the demonstration scope.

## Verification performed

- `npm run sdk:typecheck`: passed all six packages.
- `npm run sdk:build`: passed all six packages.
- `npm run sdk:test`: 96 tests passed, zero failed. Counts: core 17, JS 18, Node 9, Next 6, server 4, React 42.
- The server suite's live test read Whitechain finality heads, permit nonce and relay balance successfully. It did not submit payments, refunds, registrations or plans.
- `npm run build -w demo-store`: passed. Vite reported a chunk above 500 kB; this build includes the demo/mock path.
- Compiled default exports imported successfully for core, JS, Node, Next and React without the source condition.
- `npm pack --dry-run --json -w @paykit/react`: passed; declared JS, declarations and stylesheet are present in the packing list. This is not an independent installed-consumer test.
- Additional read-only reproductions confirmed the domain bypass, stale displayed checkout amount, stopped polling after payment-ID changes, ineffective proxy key-management option and numeric amount rounding.

The existing checks validate useful happy paths. They do not establish crash recovery, concurrent request safety, reorg correctness, real write compatibility, or a clean Next.js installation. Those are the release gates that remain.
