# How ChainCred uses Arkiv (current state)

ChainCred uses [Arkiv](https://arkiv.network) for one job: **the cross-shop loyalty points ledger**, together with the
campaigns and rewards that define how points are earned and spent. Everything else stays where it was.

Network: Arkiv Rabdi testnet, chain `7794095`, explorer https://rabdi.explorer.arkiv.network.
Switch: `POINTS_BACKEND=arkiv` enables Arkiv. The default is `POINTS_BACKEND=chain`, which uses the on-chain
`PayKitPoints` token; nothing else changes.

## What is on Arkiv, and what is not

| Data | Where it lives | Why |
|---|---|---|
| Loyalty points earned (`paykit.lot`) | Arkiv (copy) + Postgres (working copy) | Points should expire on their own, and a shop must not be able to edit another shop's points. |
| Points spent (`paykit.spend`) | Arkiv (copy) + Postgres | Same. A spend expires together with the lot it draws from. |
| Campaigns, "earn N points per USDT" (`paykit.campaign`) | Arkiv (copy) + Postgres | Public, owned by the shop that created it. |
| Rewards, "P points for X off" (`paykit.reward`) | Arkiv (copy) + Postgres | Public marketplace of what points can buy at which shop. |
| Invoices, payments, refunds, subscriptions, merchant data | Postgres and Whitechain only | Sensitive business data. A public, expiring database is the wrong place for it. |
| The USDT payment and the discount itself | Whitechain (`PaymentRouterV2`) | Real money settles on-chain. The router applies the discount; no points token is minted or burned. |

## The four schemas

All are public entities. Anyone can write an entity under any schema name, so **every read checks `$owner`** against the
shop's registered signer address. A fake entity under our schema name is ignored.

- `paykit.campaign`: `ref`, `merchantId`, `shop`, `title`, `pointsPerUsdt`, `minSpend`, `maxPointsPerOrder`, `budget`,
  `firstPurchaseOnly`, `appliesTo`, `startsAt`, `endsAt`, `active`, `updatedAt`. Owner: the earning shop.
- `paykit.reward`: `ref`, `merchantId`, `shop`, `title`, `pointsCost`, `kind`, `value`, `maxDiscount`, `minSpend`,
  `perWalletLimit`, `totalLimit`, `startsAt`, `endsAt`, `active`, `updatedAt`. Owner: the redeeming shop.
- `paykit.lot`: `ref`, `holder` (customer wallet), `issuer` (shop id), `points` (current), `originalPoints`,
  `paymentId`, `txHash`, `campaign`, `earnedAt`, `expiresAt`. Points earned by one payment. Owner: the issuing shop.
- `paykit.spend`: `ref`, `holder`, `redeemer`, `lot` (key of the lot), `lotIssuer`, `points`, `paymentId`, `reward`,
  `spentAt`. Points used from one lot by one payment. Owner: the redeeming shop.

A customer's balance is the sum of their live lots minus the spends against them. Spends use the soonest-expiring lots first.

## Which Arkiv features we use

- **Automatic expiry.** Every lot is written with a lifetime of `POINT_VALIDITY_DAYS` (default 180, Arkiv's maximum is about
  182.5 days). Spends expire with their lot. Campaigns and rewards without an end date are extended before the maximum
  lifetime runs out. Verified on the real testnet: a 1-minute lot was gone about 72 s later, and an expired entity can no
  longer be edited.
- **Ownership.** Each shop writes with its own hosted signer key, the same address registered as signer in
  `MerchantRegistry`. Only the owner can edit or delete an entity; the chain rejected a non-owner patch in our test.
- **Indexed, typed attributes** for the queries we need: lots by holder, spends by lot, rewards by points cost
  (`pointsCost <= N`).
- **Patch, extend, delete.** A partial refund patches the lot's `points`, a full refund deletes spends.

## How it works at runtime

1. A customer pays through ChainCred. The payment settles on Whitechain (`PaymentSettled`).
2. The server records the points in Postgres right away: a lot for the issuing shop, and spends for any redeeming shop.
3. A background queue (`arkiv_outbox`) copies those records to Arkiv: create, patch or delete. It is retried with backoff
   and is idempotent, so an Arkiv outage never blocks or loses a payment.
4. A funder wallet tops up each shop's Arkiv account with test gas (tGLM) when it runs low.
5. Each Arkiv write costs about 6 seconds (a few 2 s blocks). Shops write in parallel; one shop's writes run in order.

**Postgres is the working copy.** Balances at checkout come from Postgres and are fast. Arkiv is the public, expiring copy.

## What reads from Arkiv

- `GET /v1/public/points/:wallet?verify=1` asks Arkiv itself for the customer's lots and spends and compares the total with
  Postgres (limited to 8 s, with a visible error if Arkiv is slow).
- `GET /v1/public/rewards?source=arkiv` reads the rewards marketplace straight from Arkiv.
- Anyone can run the same query without our server, for example for one wallet's points:

```
arkiv.schema = str('paykit.lot') AND holder = addr(0x<customer wallet>)
```

Every campaign, reward, lot and spend also stores its explorer links in Postgres: the transaction that created it
(`createTxUrl`), the latest change (`lastTxUrl`), the shop's account page (`ownerUrl`) and its expiry. The frontend shows
those links without querying Arkiv. A single-entity page link (`url`) appears only when `ARKIV_ENTITY_URL` is set.

## Known limits

- The server stops counting a lot at its expiry date and Arkiv removes the entity on its own, so expiry is enforced twice.
- Arkiv queries stall now and then (seen on 2026-11-06 around 20:32 IST: plain RPC calls and balances were fine, queries
  hung for about two minutes, then recovered by themselves). Queries time out after `ARKIV_QUERY_TIMEOUT_MS` (6 s) and
  the server falls back to Postgres.
- Old PKP balances on Whitechain do not carry over.
- When a refund restores points to a lot that has already expired, the points are lost (a fresh lot would be the alternative).
- The Arkiv SDK reports expiry as a block number; the server converts it to unix seconds.

## Related files

`src/arkiv.js` (SDK wrapper, schemas, memory backend for tests), `src/services/arkivSync.js` (queue and sync),
`src/services/points.js` (earn, spend, refund, balances), `scripts/test-arkiv.js` (12-step test), `scripts/bench-arkiv.js`
(latency), `scripts/demo-points.js` (end-to-end demo).
