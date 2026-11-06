# Arkiv schema

PayKit keeps one thing on Arkiv: the **cross-shop loyalty points ledger**, plus the campaigns and rewards that decide how points are earned and spent. Payments, invoices, refunds and merchant data stay on Whitechain and in Postgres ([why](why-arkiv.md)).

- Network: Arkiv **Rabdi testnet**, chain `7794095`, RPC `https://rpc.rabdi.db-chain.testnet.arkiv.network`, explorer https://rabdi.explorer.arkiv.network
- Code: [`paykit-server/src/arkiv.js`](../paykit-server/src/arkiv.js) (schemas, SDK wrapper), [`paykit-server/src/services/arkivSync.js`](../paykit-server/src/services/arkivSync.js) (writes), [`paykit-server/src/services/points.js`](../paykit-server/src/services/points.js) (reads)
- SDK: `@arkiv-network/sdk` 1.0.1, typed schemas through `@arkiv-network/sdk/schema`

## Who writes

Every shop writes its own entities with its **hosted quote-signer key**. That address is also registered as the shop's signer in PayKit's `MerchantRegistry` on Whitechain, so anyone can tie an Arkiv owner to a real shop. PayKit's funder wallet only sends test gas (tGLM) to shop accounts; it owns no entities.

| Account | Role |
|---|---|
| `0x1661f882554304e6E1ECE61780595D99e45d1fb6` | Shop "Tee Shop": owns its campaign and the points lots it issued |
| `0xB1128c8f5E25c5E5e5206Cd782de8365C29b6fD0` | Shop "Jeans Co": owns its rewards and the spends it accepted |
| `0x80FB0aa1FEAa89A0EBE4fb9E48B7514f57173d23` | PayKit funder: tops shop accounts up with tGLM, writes nothing |

New shops get an Arkiv account the moment they register: their signer key is created at sign-up and funded on first write.

## Entities

All four are public, and **every read checks `$owner`** against the shop's registered signer. Anyone can write an entity under our schema names, so an entity from any other address is ignored.

### `paykit.lot`: points one payment earned

| Field | Type | Filtered on | Meaning |
|---|---|---|---|
| `holder` | addr | yes | customer wallet that owns the points |
| `issuer` | str | yes | PayKit merchant id of the shop that gave them |
| `points` | i32 | yes | points left in this lot (lowered by refunds) |
| `originalPoints` | i32 | | points first earned |
| `paymentId` | str | yes | Whitechain payment that earned them |
| `txHash` | str | | Whitechain transaction |
| `campaign` | str | | campaign that set the rate |
| `earnedAt`, `expiresAt` | u64 | yes | unix seconds |
| `ref` | str | yes | `lot_<payment id>`, makes writes idempotent |

- **Owner:** the issuing shop.
- **Expires:** when the points expire, `POINT_VALIDITY_DAYS` after earning (default 180 days, inside Arkiv's limit of about 182.5 days). Arkiv deletes the lot on its own.

### `paykit.spend`: points used from one lot in one payment

| Field | Type | Filtered on | Meaning |
|---|---|---|---|
| `holder` | addr | yes | customer wallet |
| `redeemer` | str | yes | shop that accepted the points |
| `lot` | key | yes | the `paykit.lot` entity the points came from |
| `lotIssuer` | str | yes | shop that issued that lot |
| `points` | i32 | | points used |
| `paymentId` | str | yes | Whitechain payment where the discount was applied |
| `reward` | str | yes | reward that was redeemed |
| `spentAt` | u64 | yes | unix seconds |

- **Owner:** the redeeming shop.
- **Expires:** together with the lot it draws from.

### `paykit.campaign`: "earn N points per USDT"

Fields: `ref`, `merchantId`, `shop`, `title`, `pointsPerUsdt` (dec, filtered), `minSpend`, `maxPointsPerOrder`, `budget`, `firstPurchaseOnly`, `appliesTo` (filtered), `startsAt`, `endsAt`, `active` (filtered), `updatedAt` (filtered).

- **Owner:** the earning shop.
- **Expires:** at `endsAt`. Open-ended campaigns are extended before Arkiv's maximum lifetime runs out.

### `paykit.reward`: "P points for X off"

Fields: `ref`, `merchantId`, `shop`, `title`, `pointsCost` (i32, filtered), `kind` (`percent_off` or `fixed_off`, filtered), `value`, `maxDiscount`, `minSpend` (filtered), `perWalletLimit`, `totalLimit`, `startsAt`, `endsAt`, `active` (filtered), `updatedAt` (filtered).

- **Owner:** the redeeming shop.
- **Expires:** at `endsAt`. Open-ended rewards are extended the same way.

## The queries the app runs

| Feature | Query |
|---|---|
| A customer's points (wallet page) | `arkiv.schema = str('paykit.lot') AND holder = addr(0x…)` plus `arkiv.schema = str('paykit.spend') AND holder = addr(0x…)` |
| Rewards marketplace (Shops, Home) | `arkiv.schema = str('paykit.reward') AND active = true` |
| Rewards a balance can afford | `… AND pointsCost <= i32(100)` |
| Spends against one lot (refunds) | `arkiv.schema = str('paykit.spend') AND lot = key(0x…)` |
