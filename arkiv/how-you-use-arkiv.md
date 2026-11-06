# How PayKit uses Arkiv

PayKit is gasless USDT checkout for shops on Whitechain. Its loyalty programme is the part that lives on Arkiv: a customer earns points at one shop and spends them as a discount at another. Full field list: [schema.md](schema.md).

## Do the filters, owners and expiry fit the app?

| Arkiv feature | How PayKit uses it | What the user sees |
|---|---|---|
| **Indexed, typed attributes** | `holder` (addr) to find a wallet's lots and spends. `active` and `pointsCost` (i32) to list rewards a balance can afford. `lot` (key) to find spends against a lot when a payment is refunded. | The wallet page's "On Arkiv" panel lists your points lot by lot, from any shop. The rewards on **Shops** and **Home** are read from Arkiv. |
| **Owner per entity** | Each shop writes with its own signer key. A lot is owned by the shop that issued it; a spend by the shop that accepted it. Reads drop any entity whose `$owner` isn't that shop's registered signer. | Each lot links to the owning shop's Arkiv account, so a customer can see which shop vouches for which points. A shop can't edit another shop's points. |
| **Expiration** | Points expire after `POINT_VALIDITY_DAYS` (180 days by default). Each lot gets that lifetime, and spends expire with their lot. Campaigns and rewards expire at their end date. | "Arkiv deletes these on 6 May 2027" next to every lot. Expired points disappear without any job of ours running. |
| **Patch, extend, delete** | A partial refund patches the lot's `points`. A full refund deletes the spends. Open-ended campaigns and rewards are extended before Arkiv's maximum lifetime. | The balance drops right after a refund, and the old reward disappears when a shop ends it. |

Every feature in the table changes something a customer or shop sees. We don't keep anything on Arkiv as a log that nothing reads.

## Where the app reads Arkiv

1. **Wallet → Points**, desktop and mobile ([`web/src/live/ArkivPoints.tsx`](../web/src/live/ArkivPoints.tsx)) calls `GET /v1/public/points/<wallet>?verify=1`. The server queries Arkiv for the wallet's `paykit.lot` and `paykit.spend` entities, keeps only genuine owners, and computes the balance from Arkiv. The panel shows:
   - that balance, and whether it matches PayKit's copy
   - each lot with its Arkiv expiry, its Arkiv transaction and its owner
   - the exact query, with a copy button
2. **Rewards marketplace** (Shops page and the mobile Home "Spend points" row) calls `GET /v1/public/rewards?source=arkiv`, which reads `paykit.reward` entities straight from Arkiv (`active = true`), checking each owner.

## Writes

1. A payment settles on Whitechain.
2. PayKit records the lot, and any spend, in Postgres at once, so checkout never waits on Arkiv.
3. A retrying outbox ([`arkivSync.js`](../paykit-server/src/services/arkivSync.js)) creates, patches or deletes the Arkiv entities as the owning shop.
4. Shops write in parallel, while each shop's own writes run in order, so nonces never collide.

## Numbers

Measured from the server machine against Rabdi with `npm run bench:arkiv` (no access key, public endpoint):

| Call | Median | Max |
|---|---|---|
| Query with no results (one wallet's lots) | 284 ms | 293 ms |
| Same query, 5 at once | 330 ms | 338 ms (all 5 done in 339 ms) |
| Query returning rows (live rewards) | 361 ms | 672 ms |
| Account balance | 296 ms | 310 ms |
| One write, until the receipt | about 6 s (a few 2 s blocks) | |

On the testnet now:
- **Entities:** 1 campaign, 3 rewards, 2 lots and 1 spend, written by 2 shop accounts.
- **Expiry:** an earlier test lot with a 1-minute lifetime was gone about 72 seconds later.

## Run it yourself

The customer's points, with owner, expiry and fields. No SDK and no key needed:

```sh
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["arkiv.schema = str('"'"'paykit.lot'"'"') AND holder = addr(0x80dB22273dE4B41a1B23ea3047bAA7c12725A248)",{"select":{"key":true,"owner":true,"expiresAt":true,"attributes":true}}]}'
```

The same query runs from the repo with `npm run test:arkiv` (12 checks against the testnet) and `npm run bench:arkiv` (latency).
