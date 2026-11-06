# PayKit contracts: integration review

Reviewed 6 November 2026 against `contracts/paykit/` (MerchantRegistry, PaymentRouter v1,
PaymentRouterV2, PayKitPoints, FeeTreasury). The contracts were not modified.

## Blocker: files missing from the delivery

The contracts import five files that were not provided, so they do not compile and their exact
signing formats cannot be read:

| Missing file | What depends on it |
|---|---|
| `libraries/PayKitTypes.sol` | Field order of `PaymentQuote`, `PlanTerms`, `PayerAuth`, `RefundTerms`, `FunderAuth`, `PayerConsent`, `PermitData`, `CancelPlan`; their EIP-712 typehashes; `PaymentKind` order; the tags `PAY_NONCE_TAG`, `REFUND_NONCE_TAG`, `ONE_TIME_TAG`, `PLAN_TAG`, `INSTALLMENT_TAG` |
| `libraries/PayKitTypesV2.sol` | `PaymentQuoteV2`, `PlanTermsV2` layouts and typehashes (points and discount fields) |
| `interfaces/IMerchantRegistry.sol`, `IUSDT3009.sol`, `IPayKitPoints.sol`, `ISwapRouter02.sol` | Compilation |

**Ask the contract owner for these files.** Until then the SDK follows plan.md §9.2 and appends the
V2 fields in the order of the router's `Settlement` struct. After deployment,
`npm run contracts:check` compares the SDK's digests with the router's own `quoteDigest`,
`planDigest` and `refundDigest` views and reports any mismatch before money moves.

## Mismatches found and fixed in the SDK

| # | Contract reality | SDK before | Fixed |
|---|---|---|---|
| 1 | `RegisterMerchant` typehash includes `string metadataURI` | Omitted it: every registration signature would fail | Added; the server fixes the URI in the draft before the owner signs |
| 2 | `registerWithSig(RegisterMerchant m, bytes sig)`, URI inside the struct | URI passed as a separate argument | ABI and call corrected |
| 3 | `setSplitProfileWithSig(SetSplitRequest{…recipients, bps…}, sig)` | Sent `splitHash` plus separate arrays | ABI and call corrected (contract recomputes the hash) |
| 4 | Registry has `getMerchant`, not `merchants()`; plus `setMetadataWithSig`, `executePayoutChange`, ownership transfer, `predictMerchantId`, views | Missing or wrong | Full exact ABI, plus `SetMetadata` signing type |
| 5 | Router V2 domain is `PayKit Router` **version "2"** | Hard-coded "1" | Version per deployment (`ROUTER_VERSION`, served in `/v1/config`) |
| 6 | `createPlan(..., PayerConsent consent, ...)` struct | Bare `bytes` signature | Struct `{deadline, signature}` (field order assumed; see blocker) |
| 7 | Router stores payments under `paymentKeyOf(merchantId, localId)` and plans under `planKeyOf(...)`, with tags | Server used local IDs: refunds would revert `UnknownPayment`, collect/cancel would revert `PlanNotActive`, observed payments would duplicate | Server reads canonical IDs from the router's pure functions (`ChainAdapter.keys`), so it does not depend on the tag values |
| 8 | `FeeTreasury.Refill(uint256 indexed runId, …, address indexed recipient, …)` | `bytes32` runId, recipient not indexed: event never decoded | Corrected |
| 9 | `payments()` V2 getter returns `discount`; new `plans()`, `allowedToken`, `protocolFee`, `DiscountApplied`, `AllowedTokenSet`, custom errors | Missing | Added (revert reasons now decode by name) |
| 10 | Router calls USDT `permit(…, v, r, s)` | ABI listed a `bytes` permit | Corrected to the v/r/s form |
| 11 | `PayKitPoints` | No ABI | Exact ABI; observer decodes `PointsEarned`/`Redeemed`/`Reversed` |

Exact checks in `packages/core/test/contracts.test.ts`: all five registry typehash strings match the
contract byte for byte, and the treasury, router and points event selectors match.

## Loyalty points (new, end to end)

- **Server:** quotes carry `pointsEarned`; a reward adds `discount`, `pointsRedeemed`, `rewardId`.
  Plans carry `pointsPerCharge` / `downPaymentPoints`. A ledger mirrors `PayKitPoints` (earn cap,
  burn before earn, proportional refund reversal with shortfall). Balances come from the contract
  when `POINTS_ADDRESS` is set. Invoices count discounts toward `paid`, as the router does.
- **API:** `GET /v1/merchants/:slug/loyalty`, `POST /v1/checkout/sessions/:id/reward`,
  `GET /v1/points/:address`, `GET /v1/me/points`, `GET|PATCH /v1/portal/merchant/loyalty`.
- **Client safety:** the payer's client refuses any quote that burns points without the reward the
  checkout shows, or whose `gross + discount` exceeds what is due.
- **UI:** reward coupons in the checkout component, a points card on the Payments page, loyalty
  settings in the merchant dashboard, and points and discount lines on receipts.
- Tests: `packages/server/test/loyalty.test.ts`.

## MCP server (new)

`packages/mcp`: 9 tools for AI agents (browse, quote, rewards, points, pay, status) plus 2
merchant tools. Payment requires `PAYKIT_AGENT_KEY`, a `maxAmount` the user approved, and a
hard per-payment cap. Tested in-process and as the real stdio binary against a real HTTP API.
See `packages/mcp/README.md`.

## Contract features now driven by the website/API

| Feature | Status |
|---|---|
| `executePayoutChange` after the delay | Server executes due changes; dashboard shows the pending change and when it applies |
| Owner removes a domain → `revokeDomain` | New API route and dashboard button; also fixed: queued revocations were never relayed in "trust" mode |
| Merchant cancels a plan (`cancelPlan` by merchant signer) | Cancel button in the plans table |
| `markDelinquent` | Recorded onchain when an installment misses its grace period |

Tests: `packages/server/test/contract-gaps.test.ts`.

## Still not in the website (and why)

| Contract feature | Gap | Suggested next step |
|---|---|---|
| `setMetadataWithSig` | No profile editor; name/website changes are never re-attested onchain | Add a `set_metadata` registry action (type already in the SDK) and a profile form |
| `setMaxFeeBps`, `transferMerchantOwnership`, `acceptMerchantOwnership` | Owner-only calls with no `*WithSig` version, so they cannot be gasless | Ask for `WithSig` variants, or send them from the owner's wallet (wagmi is installed) |
| `campaignId` (points by campaign) | Always zero | Campaigns in the loyalty settings, if needed |
| `PointsReversed.shortfall` | Recorded but not shown | Show on refunds in the merchant dashboard |
| Platform admin: `pause`, `setFeeSchedule`, `setAllowedToken`, `setStatus` (suspend), `setAttestor`, `setPayoutChangeDelay`, `setMaxPointsPerUsdt`, treasury `setLimits` / `setRelayer` / `withdraw` / `setReservedUsdt` | No operator console | Use cast/scripts for the hackathon, or add an admin page behind the registry owner wallet |
| Treasury state (`availableFees`, limits, runs) | Refills run automatically but have no dashboard | Operator page |
| Onchain invoice proof (`invoices(key)`) | Receipts don't show the onchain invoice state | Optional "verify onchain" link on receipts |

## Before going live

1. Get the missing library files; regenerate `packages/core/src/abi.ts` from build artifacts.
2. Deploy: registry, points, treasury, router V2 → `points.setRouter(router)`,
   `router.setAllowedToken(USDT, true)`, `router.setFeeSchedule(...)`, `registry.setAttestor(...)`,
   `treasury.setRelayer(...)`, `treasury.setLimits(...)`, `points.setMaxPointsPerUsdt(...)`.
3. Run `npm run contracts:check` with the addresses (plus `RELAYER_ADDRESS`, `ADMIN_ADDRESS`).
   It must report all checks passed.
4. Configure the API: `ROUTER_ADDRESS`, `REGISTRY_ADDRESS`, `TREASURY_ADDRESS`, `POINTS_ADDRESS`,
   `ROUTER_VERSION=2`.
