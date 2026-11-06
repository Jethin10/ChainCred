# PayKit server

One Node process (Express + ethers v6) that turns the PayKit contracts into an API a merchant can plug in:
payment links/invoices, gasless checkout, onchain receipts, webhooks, refunds and a CSV export.

```
merchant backend ──API key──▶ ┌──────────────── paykit-server ────────────────┐
checkout page ───public────▶  │ API ─▶ relayer queue ─▶ PaymentRouter (1874)  │
                              │ observer ◀── PaymentSettled / RefundSettled   │
merchant webhook ◀── signed ─ │ webhooks outbox     refill loop ─▶ FeeTreasury │
                              └──────────── Postgres (Neon) / in-memory ──────┘
```

| Part | File | What it does |
|---|---|---|
| API | `src/api.js` | REST endpoints below |
| Relayer | `src/relayer.js` | One wallet, one queue: simulate → send → record, so nonces never clash; the relayer pays all gas |
| Observer | `src/observer.js` | Reads router events from `DEPLOY_BLOCK`, `CONFIRMATIONS` behind head; only an event marks a payment as settled |
| Webhooks | `src/services/webhooks.js` | Stored first, then delivered with exponential retries; HMAC-signed |
| Refill | `src/refill.js` | Every `REFILL_INTERVAL_MIN`, converts treasury USDT → WBT for the relayer only if it pays ≥ `REFILL_PROFIT_MULTIPLE`× its gas |
| Store | `src/store/*` | Postgres when `DATABASE_URL` is set (tables created automatically), otherwise in-memory |

## Setup

Needs `paykit-contracts` next to this folder, compiled (`npx hardhat compile`), because the server loads the
ABIs and the shared EIP-712 types (`scripts/lib/typedData.js`) from there.

```bash
cd paykit-server
npm install
copy .env.example .env          # macOS/Linux: cp .env.example .env
npm run gen-secrets             # paste ADMIN_TOKEN and MASTER_KEY into .env
# set PLATFORM_ADMIN_KEY (same pool wallet as paykit-contracts), optionally DATABASE_URL (Neon)
npm start
```

End-to-end demo (three terminals):

```bash
npm start                  # 1. the server
npm run webhook-receiver   # 2. the merchant's backend, prints verified webhooks
npm run demo               # 3. onboard merchant -> invoice -> customer pays -> refund -> CSV
npm run demo:subscription  # 4. plan -> subscribe (first charge) -> automatic charge -> customer cancels
npm run demo:points        # 5. earn points at shop A -> offers list at shop B -> pay with a reward
```

## Who signs what

| Action | Signs | Pays gas |
|---|---|---|
| Register merchant | platform wallet (owner) | relayer |
| Payment quote / refund terms | merchant's hosted signer key (generated per merchant, AES-GCM encrypted with `MASTER_KEY`) | – |
| Pay | customer: one-time USDT `ReceiveWithAuthorization` (EIP-3009) | relayer |
| Refund | merchant payout wallet: one-time USDT `ReceiveWithAuthorization` | relayer |

Customers and merchants never need WBT. No `approve` is ever needed for pay or refund.

## API

Auth: `Authorization: Bearer <ADMIN_TOKEN>` for admin, `Bearer pk_test_…` (merchant API key) for merchant routes.
Amounts are decimal strings in USDT (`"12.50"`).

**Admin**
- `POST /v1/merchants` `{name, payoutAddress, webhookUrl?}` → `{merchant, apiKey, webhookSecret}` (shown once)
- `POST /v1/admin/refill/evaluate` → RUN/SKIP decision with numbers
- `POST /v1/admin/refill/run` `{force?}` · `GET /v1/admin/refill/runs`

**Merchant**
- `GET|PATCH /v1/merchants/me` `{webhookUrl}`
- `POST /v1/invoices` `{amount, reference?, description?, dueDate?, allowPartial?, payerAddress?, metadata?, successUrl?}` → invoice with `payUrl`
- `GET /v1/invoices` · `GET /v1/invoices/:id`
- `GET /v1/payments` · `GET /v1/payments/:paymentId` (includes refunds)
- `POST /v1/payments/:paymentId/refunds` `{amount?, reason?, funder?}` → `{refund, typedData}` for the payout wallet to sign
- `POST /v1/refunds/:id/authorize` `{signature}`
- `GET /v1/exports/payments.csv` — payments and refunds, one row each, with explorer links
- `GET /v1/webhooks/events` · `POST /v1/webhooks/test` · `POST /v1/webhooks/events/:id/redeliver`

**Subscriptions & installments (merchant)**
- `POST /v1/plans` `{name, amount, interval, cycles, kind?, deposit?, firstChargeNow?, graceSeconds?, description?}`
  - `interval`: `minute|hour|day|week|month|year` or seconds (>= 60). `cycles`: total number of charges.
  - `kind: "subscription"` (default) charges the first cycle at sign-up; `kind: "installments"` with an optional
    `deposit` charges the deposit now and every installment on schedule.
  - Returns the plan with a `subscribeUrl`.
- `GET /v1/plans` · `GET /v1/plans/:id` · `PATCH /v1/plans/:id` `{active}`
- `GET /v1/subscriptions?status=active|past_due|cancelled|completed` · `GET /v1/subscriptions/:id` (schedule + payments)
- `POST /v1/subscriptions/:id/cancel` — merchant cancels (hosted signer signs, relayer pays gas)

**Subscriptions (public)**
- `GET /v1/public/plans/:id`
- `POST /v1/public/plans/:id/subscribe` `{payer}` → `{subscriptionId, summary, schedule, typedData: {permit, consent}}`
- `POST /v1/public/subscriptions/:id/authorize` `{permitSignature, consentSignature}` → relayer calls `createPlan`
- `GET /v1/public/subscriptions/:id`
- `POST /v1/public/subscriptions/:id/cancel-request` → `typedData` (CancelPlan) · `POST /v1/public/subscriptions/:id/cancel` `{signature}`

How it works: the customer signs a USDT **permit** capped at the plan total (plus what they already owe on other
plans) and a **PlanConsent** bound to the merchant-signed terms. Neither is a transaction. The scheduler
(every `SCHEDULER_POLL_MS`) calls `collectInstallment` when a charge falls due, if the balance and allowance cover it.
If they don't, it sends `subscription.charge_failed`, retries after `CHARGE_RETRY_SEC`, and after the grace period
calls `markDelinquent` (`subscription.past_due`). A later successful charge makes it `active` again.
Either side can cancel at any time, and the contract then refuses further pulls.

**Admin:** `POST /v1/admin/scheduler/tick` runs the scheduler once, now.

**Universal points (merchant, no-code: what the dashboard calls)** — needs PaymentRouterV2 + PayKitPoints
- Issuer side, campaigns: `POST /v1/points/campaigns` `{name, pointsPerUsdt, minSpend?, maxPointsPerOrder?, budget?, firstPurchaseOnly?, appliesTo?: "all"|"payments"|"subscriptions", startsAt?, endsAt?}`
  · `GET /v1/points/campaigns` · `GET /v1/points/campaigns/:id` (issued, customers, budget left) · `PATCH /v1/points/campaigns/:id` (edit, `status: active|paused|archived`)
- Redeemer side, rewards: `POST /v1/points/rewards` `{name, pointsCost, type: "percent_off"|"fixed_off", value, maxDiscount?, minSpend?, perWalletLimit?, totalLimit?, startsAt?, endsAt?}`
  · `GET /v1/points/rewards` · `GET /v1/points/rewards/:id` (redemptions, discount given) · `PATCH /v1/points/rewards/:id`
- `GET /v1/points/summary`: points issued, redeemed at your shop, discount given, **new customers brought in by points**, and where your customers spent the points you issued
- `GET /v1/points/ledger?wallet=&type=earn|redeem|reversal` · `GET /v1/points/customers/:wallet`
- Admin: `PATCH /v1/admin/points/limits` `{maxPointsPerUsdt}` (the onchain platform cap) · public `GET /v1/points/limits`

**Universal points (public, checkout + customer)**
- `GET /v1/public/invoices/:id/offers?payer=0x…` → `{balance, willEarn, offers[]}`: every live reward of this shop.
  Each offer has `available`, plus `discount` and `payAfter` when available, or `reason` and `message` when not
  (`not_enough_points`, `min_spend`, `limit_reached`, `sold_out`, `not_started`, `order_too_small`), so the UI can grey it out.
- `POST /v1/public/invoices/:id/quote` `{payer, rewardId?}` → adds `discount`, `points.earned`, `points.redeemed`
- `GET /v1/public/points/:wallet`: balance (onchain, plus a DB copy and an `inSync` flag) and history
- `GET /v1/public/rewards`: every live reward across all shops ("where can I spend my points?")

How points work: the shop's best campaign (no stacking) and the reward the customer tapped go into the merchant-signed
quote. The customer's single USDT signature commits to that quote, so in **one transaction** PaymentRouterV2 takes
the discounted payment, burns the redeemed points and mints the earned ones in PayKitPoints. The redeeming shop
funds the discount (it receives less USDT), and the invoice counts payment + discount as paid. Refunds reverse
points proportionally. The observer mirrors every points event into `points_ledger` and `points_wallets`.
Subscriptions created on v2 earn points on every charge.

**Public (checkout, no auth)**
- `GET /v1/public/invoices/:id`
- `POST /v1/public/invoices/:id/quote` `{payer, amount?, refundTo?}` → `{quoteId, gross, fee, net, typedData}`
- `POST /v1/public/quotes/:id/authorize` `{signature}` → relayed, returns `txUrl`
- `GET /v1/public/quotes/:id` — `awaiting_signature → submitted → mined → confirmed` (or `failed`/`expired`)
- `GET /v1/public/receipts/:paymentId` — receipt cross-checked against the router's storage

`typedData` is `{domain, types, primaryType, message}`. ethers: `wallet.signTypedData(domain, types, message)`.
MetaMask (`eth_signTypedData_v4`): add the `EIP712Domain` type to `types` first.

## Webhooks

`POST` to the merchant's `webhookUrl` with JSON `{id, type, createdAt, data}`.
Points need `ROUTER_V2_ADDRESS`, `POINTS_ADDRESS` and `DEPLOY_BLOCK_V2` (from `npm run deploy:v2`). Without them the server runs on v1 only.
New invoices and subscriptions use v2. Older ones keep using the router they started on, for refunds, charges and cancels.

Events: `payment.settled`, `invoice.paid`, `refund.settled`, `subscription.activated`, `subscription.charged`,
`subscription.charge_failed`, `subscription.past_due`, `subscription.cancelled`, `subscription.completed`, `test.ping`.
Header `PayKit-Signature: t=<unix>,v1=<hex>` where `v1 = HMAC-SHA256(webhookSecret, "<t>.<raw body>")`.
See `scripts/webhook-receiver.js` for verification. Non-2xx responses are retried (5s, 10s, 20s … up to `WEBHOOK_MAX_ATTEMPTS`).

## Current limitations

- Merchants are platform-hosted: the platform wallet is the onchain owner. Self-custodial onboarding
  (`registerWithSig` from the merchant's own wallet) is supported by the contract but not wired into the API yet.
- The scheduler runs inside the server process; if the server is down, due charges are collected when it comes back.
- Splits exist in the contract but have no API yet (payments go 100% to the payout wallet).
- No due-date reminders yet (invoices show `overdue` once past `dueDate`).
- Observer waits `CONFIRMATIONS` blocks but does not roll back on deeper reorgs.
- In-memory store loses everything on restart; set `DATABASE_URL` for anything real.
- Pricing: at 5 gwei, relaying a payment (~0.0019 WBT) costs more than the 0.05 USDT minimum fee. See TODO.

## TODO

- [ ] Raise `MIN_FEE` to ~0.25 USDT and the merchant fee cap (`router.setFeeSchedule`, owner only, no redeploy)
- [ ] Self-custodial merchant onboarding via `registerWithSig` / `setSignerWithSig`
- [x] Subscription / installment API + scheduler
- [ ] Split profiles in the API
- [ ] Invoice due-date reminders (email/webhook)
