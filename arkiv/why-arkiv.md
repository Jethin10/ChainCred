# Why Arkiv

PayKit's loyalty points are universal: earn them at one shop, spend them at another. That only works if every shop can trust a ledger no single shop or company controls, and if points go away on schedule without anyone cleaning up. Arkiv gives us both. Postgres doesn't.

## If we swapped Arkiv for Postgres, users would lose:

- **A ledger no one shop can rewrite.** On Arkiv, each lot is owned by the shop that issued it, and only that shop's key can change it. In Postgres, PayKit's database admin could edit any shop's points, and every partner shop would have to trust us. With Arkiv, a shop that accepts a competitor's points can check the competitor really issued them, by owner, against the signer registered on Whitechain.
- **Points that expire on their own.** Each lot carries its expiry date, and Arkiv deletes it then. A customer sees the exact date next to every lot, and no cron job or admin can quietly extend or cut it. With Postgres, expiry is a script we promise to run.
- **A balance anyone can check without us.** A customer, a shop or a judge can run `arkiv.schema = str('paykit.lot') AND holder = addr(0x…)` against the public RPC and get the same balance PayKit shows. The wallet page does this live and says whether it matches.
- **An open rewards marketplace.** `paykit.reward` entities are public and owner-checked. Any app, not only PayKit's, can list "what can 100 points buy, and where" with one query. Postgres would make that a private API we'd have to expose and keep running.

## What we kept off Arkiv, and why

| Data | Where | Why not Arkiv |
|---|---|---|
| USDT payments, fees and the discount itself | Whitechain (`PaymentRouterV2`) | Real money settles onchain. The router applies the points discount in the same transaction. |
| Invoices, quotes, order references, customer notes | Postgres | Private business data. A public, expiring database is the wrong place for a customer's name and address. |
| Merchant accounts, API keys, webhook secrets | Postgres (secrets encrypted) | Secrets, and they must never expire. |
| Refunds and subscriptions | Whitechain + Postgres | They move money, so the contract is the source of truth. |
| A working copy of the points | Postgres | Checkout needs a balance in a few milliseconds and must not wait for a 2-second block. Arkiv is the public, authoritative copy; Postgres is the fast cache. The wallet page shows when they differ. |
