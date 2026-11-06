# PayKit contracts (reference copy)

These are the PayKit contracts as delivered by their owner, copied unchanged. They are not built by
this workspace: Hardhat and Foundry compile `contracts/contracts/` only.

| File | What it does |
|---|---|
| `MerchantRegistry.sol` | Merchants, payout wallets (delayed changes), quote signers, split profiles, metadata, domain attestations, status. Gasless `*WithSig` versions of every owner action. |
| `PaymentRouter.sol` | v1: pay now, pay in parts, installment plans, refunds, splits. EIP-712 domain `PayKit Router` version `1`. |
| `PaymentRouterV2.sol` | v1 plus universal loyalty points and merchant-funded discounts inside the signed quote. Domain version `2`. |
| `PayKitPoints.sol` | Non-transferable points (PKP, 0 decimals). Only the router mints and burns. Refunds reverse points proportionally. |
| `FeeTreasury.sol` | Holds protocol fees and swaps them to WBT for the relayer, within per-run and per-day limits. |

## Missing to compile and to finish wiring

The contracts import files that were not provided:

- `libraries/PayKitTypes.sol`: structs `PaymentQuote`, `PayerAuth`, `RefundTerms`, `FunderAuth`,
  `PayerConsent`, `PermitData`, `CancelPlan`, `PlanTerms`, enum `PaymentKind`, the EIP-712
  typehashes, and the tags `PAY_NONCE_TAG`, `REFUND_NONCE_TAG`, `ONE_TIME_TAG`, `PLAN_TAG`,
  `INSTALLMENT_TAG`.
- `libraries/PayKitTypesV2.sol`: `PaymentQuoteV2`, `PlanTermsV2` and their typehashes.
- `interfaces/IMerchantRegistry.sol`, `IUSDT3009.sol`, `IPayKitPoints.sol`, `ISwapRouter02.sol`.

The SDK follows plan.md §9.2 for these and appends the V2 fields in the router's `Settlement`
order. Once deployed, `npm run contracts:check` compares the SDK's digests with the router's
`quoteDigest`, `planDigest` and `refundDigest` views and reports any difference. The server reads
canonical IDs from the router's `paymentKeyOf`, `planKeyOf` and `installmentPaymentId`, so it
does not depend on the tag values.

See `research/CONTRACTS-INTEGRATION.md` for the full analysis.
