# Arkiv friction log

Things that got in our way while building PayKit's loyalty ledger on Arkiv (Rabdi testnet, `@arkiv-network/sdk` 1.0.1), roughly in the order we hit them. Each has what we expected, what happened, and how to reproduce it.

## 1. Queries sometimes stall for minutes

- **Expected:** a query takes around 300 ms, as our benchmark shows most of the time.
- **Happened:** on 2026-11-06, around 20:32 IST, `arkiv_query` calls hung for about two minutes. Plain RPC calls (`eth_blockNumber`, balances) still answered quickly, then queries recovered on their own.
- **Workaround:** every query races a 6-second timeout (`ARKIV_QUERY_TIMEOUT_MS`), and the server falls back to its Postgres copy.
- **Ask:** a status page or a health method for the query layer, and a server-side query timeout that returns an error instead of hanging.
- **Reproduce:** `npm run bench:arkiv` in `paykit-server/` in a loop; step 2 is the query.

## 2. The `arkiv_query` options aren't documented

- **Expected:** a documented way to get owner, expiry and attributes back from a raw JSON-RPC query.
- **Happened:** by default `arkiv_query` returns only keys. We found the `select` option by sending wrong values and reading the errors. The second param accepts `atBlock`, `select`, `limit`, `offset` and `cursor`, and `select` is an object of booleans: `key`, `owner`, `creator`, `createdAt`, `updatedAt`, `expiresAt`, `creationFlags`, `attributeSchema`, `attributes`, `count`.
- **Ask:** document the JSON-RPC surface with one example per option. It's the easiest way for a judge, or any other app, to read our data without the SDK.
- **Reproduce:** send `{"select":{"zzz":true}}` as the second param. The error lists the valid fields.

## 3. Expiry comes back as a block number

- **Expected:** an expiry in unix time, since we set lifetimes in seconds.
- **Happened:** `$expiresAt` / `expiresAt` is a block number (e.g. `0x3fc5a0`). To show "expires on 6 May 2027" we convert it with `getBlockTiming()` and the 2-second block time, and cache the timing.
- **Ask:** return a timestamp next to the block number, or document the conversion.

## 4. The maximum entity lifetime isn't stated clearly

- **Expected:** a documented maximum.
- **Happened:** we worked out about 182.5 days (7,884,000 blocks × 2 s) from errors and testing. Our points last 180 days, and campaigns or rewards without an end date have to be extended before that.
- **Ask:** state the maximum in the docs and the SDK types. Even better, offer auto-renew for entities the owner keeps alive.

## 5. The public endpoint is rate-limited, and you only find out at runtime

- **Happened:** the SDK prints "no access key, so requests go to the public endpoint, which is heavily rate limited" on first use.
- **Ask:** mention the access key in the quick-start. A faucet or access-key API usable from a script would also help: our funder wallet had to be filled by hand in the browser.

## 6. Anyone can write under any schema name

- **Expected:** a way to reserve a schema name, or a registry of schema owners.
- **Happened:** any account can create `paykit.lot` entities. Every read has to filter by `$owner` against our own list of shop signers, or fake points would count.
- **Ask:** an optional schema registry (schema name → allowed owners), or an owner set in the query (`$owner IN (…)`).

## 7. Writes take about 6 seconds

- **Happened:** a write waits a few 2-second blocks for its receipt. We couldn't put Arkiv on the checkout path, so we write through a retrying outbox after the payment, with Postgres as the fast copy.
- **Ask:** a "submitted" acknowledgement we could show right away, and batch writes, so one payment's lot and spends go in one transaction.

## 8. Small SDK papercuts

- Typed values (`u64`, `u256`) come back as `bigint`, which `JSON.stringify` can't serialize. Our in-memory test backend hit "Do not know how to serialize a BigInt" until values were converted.
- No single-entity page on the explorer that we could link per lot. We link the transaction and the owner's account instead.

## What worked well

- Typed schemas with indexed fields made the queries we needed (by holder, by cost, by lot) one line each.
- Owner-only edits held: a patch from a non-owner was rejected in our test.
- Expiry is real: a 1-minute test lot was gone about 72 seconds later, and an expired entity could no longer be edited.
