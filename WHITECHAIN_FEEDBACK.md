# Whitechain feedback

Hey Whitechain team. We're the PayKit folks from ETHGlobal Mumbai. We built a USDT checkout on Whitechain Sepolia:
an SDK, a payment server, a merchant app, and two little demo shops (a tea house and a bookshop). The customer signs
once and never needs WBT. Our relayer pays the gas.

We promised honest feedback, so here's how the weekend actually went, the annoying parts included. Some of the pain
was our own fault, and we've called that out too so you can tell the difference.

Quick reality check first. We deployed five contracts and verified them on your explorer. We pushed a real 2 USDT
payment and a 1 USDT partial refund through the sponsor USDT, both relayed, with the customer holding zero WBT
([payment](https://explorer.testnet.whitechain.io/tx/0x4550d2f892ed5c41c9a278431b516d677583e126251d2600f1b6770d9f681635),
[refund](https://explorer.testnet.whitechain.io/tx/0xe47ba3dbd8b132fe3389e1e2f294bea8edfbb654336f1d81fad5ad673a28c049)).
After that we paid invoices through our hosted pay page with MetaMask. That's a handful of payments, all from our
own wallets, so take this as one team's experience and not some kind of stress test.

## The good stuff

Honestly, the sponsor USDT carried the whole project. `0xcedf…55a7` is TetherTokenV2 with both `permit` and
EIP-3009 `receiveWithAuthorization` on it. That means the customer signs one message, nobody has to `approve`
anything, and our relayer submits it. Refunds are the same call going the other way, signed by the merchant. If that
token didn't have 3009 we'd have needed a bundler, and as you'll see below, we couldn't find one.

Your explorer API was a lifesaver. Hitting `/api/v2/smart-contracts/` on the USDT proxy gave us the implementation
address plus its verified source and ABI. So we never had to guess the `permit` overloads or the EIP-712 domain. We
read them, checked them against the live `DOMAIN_SEPARATOR`, and only then started signing things. Verifying our
own contracts worked first try too.

It really is just OP Stack, which is a compliment. Hardhat, ethers and viem all worked without any changes. WWBT is
plain WETH98, and the YetiTrade pool and quoter behave like Uniswap, so planning the "turn USDT fees back into WBT
for the relayer" part was easy. One small gotcha: WWBT's `withdraw` uses `transfer`, so whatever contract unwraps it
needs a cheap `receive()`.

Your fees page and finality page are better than what most L2s ship. The fees page gives you the GasPriceOracle
address, the 5 gwei floor and an actual worked example. The finality page separates soft, safe and finalized
instead of pretending everything is final the moment it's included, and the RPC actually returns three different
heads for those. Oh, and `llms.txt` plus the Markdown versions of the docs meant our coding agents read your real
docs instead of making stuff up. Please keep those.

## Where we got stuck on your side

**There are two USDTs and the token list points at the wrong one.** This one's the big one. The track requires
`0xcedf…55a7`, which isn't in your official token list at all. The list's "USDT" is `0xaa79…8f46`, and that contract
literally calls itself `USDT.e`, the bridged one. Then the Portal page says bridged USDT "keeps its symbol and
arrives as USDT", while YetiTrade's docs say it arrives as USDT.e and "is not the verified USDT". We caught it during
research so it didn't cost us a failed payment. But imagine a merchant or a wallet loading the token list. They'd
get a different contract with a different EIP-712 domain, and every signature would fail with a revert that tells
them nothing. Putting the real one in the list and calling the bridged one USDT.e everywhere would fix it.

**Getting test USDT is a little side quest.** There's a faucet for WBT but not for the USDT you actually want us to
use. The way the docs point you is to swap test WBT for it on YetiTrade, and the bridge gives you the other USDT.
For a payments track, a USDT faucet (or even one line on the faucet page saying "for USDT, swap on YetiTrade") would
save every team their first hour.

**Small gasless payments lose money at the 5 gwei floor.** These are real numbers from our own transactions, at
5.001 gwei and the testnet YetiTrade price of roughly 1 USDT to 0.01345 WBT, before the L1 data fee:

- A payment on our v1 router used 374,046 gas. That's 0.00187 WBT, or about 0.14 USDT.
- A partial refund used 183,140 gas. That's about 0.07 USDT, and refunds earn us no fee.
- Swapping 0.01 USDT of fees into WBT costs about 0.00042 WBT in gas for the pool swap alone, and returns only
  0.000135 WBT.

So with our 1% fee, a payment needs to be around 14 USDT before it pays for its own gas. On a 2.5 USDT cup of tea,
the relayer burns about 5.6% of the order. And swapping fees back one at a time costs around three times what you
get back, so you have to batch. To be fair, part of this is us: 374k gas is chunky and we can slim the contract
down. But Operate is literally about small, gasless shop payments, and that's exactly where the floor hurts most. It
would really help to know whether 5 gwei stays on mainnet, whether there's any rebate or sponsorship for payment
relayers, and to see a worked "what does a gasless 2 USDT payment cost" example next to the fees page.

**We couldn't find any working account abstraction.** EntryPoint v0.6, v0.7 and v0.8 bytecode is sitting on 1874.
But the public RPC rejects `eth_supportedEntryPoints` as "not whitelisted". Pimlico and Alchemy don't list
Whitechain, thirdweb says check the dashboard, and we couldn't confirm Gelato at all. We burned a good chunk of
research time just to learn "no, not today". A short page saying which EntryPoints, bundlers and paymasters actually
work would let the next team decide in five minutes.

**We couldn't pay without MetaMask.** Your own Reown guide says embedded email and social wallets don't support
Whitechain: you can log in, but signing fails. That left MetaMask as the only thing we trusted. So our "gasless"
customer still installs a wallet, adds network 1874, connects and signs. The Scale track asks for zero visible crypto
steps, and with the wallets your docs cover we just couldn't say that with a straight face. We didn't get time to try
Privy, which claims any EVM chain works. A tested walletless signer guide would matter more to real shops than
pretty much any SDK feature we could add.

**The RPC is slow from Asia, and we don't know which methods it allows.** From Vercel in Singapore, a single chain
read took about half a second even on a warm connection, while our database answered in 0.2 s. A payment needs
several reads (quote, nonce, simulate, send, then wait for the receipt), so the RPC was the slowest part of
checkout. We only found out methods are allowlisted because one got rejected. An Asian endpoint and a published list
of allowed methods and rate limits would both help.

**Finality is explained, but nobody tells merchants what to wait for.** In one check, safe was 333 blocks behind
latest and finalized was 2,083 behind, which is about 35 minutes. Nobody selling tea waits 35 minutes. Even a rough
rule of thumb would help, something like "digital stuff: soft, small physical orders: safe, big orders: finalized".

## Where we got stuck on our own

We don't want the stuff above to read like everything was your fault, so here's ours.

We got signatures wrong three times. The SDK had the last three `PlanTermsV2` fields in the wrong order, merchant
registration left `metadataURI` out of what it signed, and we hard-coded version "1" when the v2 router signs under
"2". Any of those would have reverted every call of that kind. We caught the first two in review and the field order
only when a script compared our typehashes with the live contracts, so no money moved. Still, a signature that's
slightly off just reverts with no reason on any EVM chain, and that was the most expensive kind of bug to chase all
weekend.

Our relayer tripped over itself. Vercel ran several copies of our server, they all shared one relayer wallet, and
each one tracked its own nonce. Sometimes two used the same nonce and a payment failed for no obvious reason. Now we
read the nonce from the chain right before sending. A proper single queue would be better.

We picked the worst possible hosting setup at first: server in US-East, database in Singapore, us in Mumbai. Every
request took around a second and a cold start took over two. Moving it all to Singapore got that down to 0.2 s and
0.75 s.

The first real payment died on MetaMask error 4100. Our hand-rolled wallet code lost MetaMask's per-site, per-chain
permission somewhere between Connect and Sign. We fixed it by picking MetaMask explicitly through EIP-6963, asking
for the account and chain 1874 together, and putting a timeout on every wallet call. Separately, we once fired a
sign-in request the moment the page loaded, and MetaMask quietly parked it in its queue for minutes. Now we only ask
after a click.

One thing you should know up front: the two demo shops aren't moving real USDT right now. They have a flag that's on
by default, which connects your wallet and finishes checkout without asking for a USDT signature. We added it so we
could demo on stage without draining our test wallets. Real USDT only moves on the hosted pay links
(`#pay/<invoiceId>`), and turning the flag off puts the shops back on the real flow.

Some things also didn't get finished. There are no invoice due-date reminders yet. The fee-to-WBT refill worker is
built, but we never saw it do a real swap with real fee balances. Loyalty points live on Whitechain by default. A
teammate also added an optional Arkiv backend, since Arkiv does expiry and per-shop ownership out of the box, but
it's switched off in production.

## If we could ask for a few doc pages

- Which USDT to use: one address per network, its EIP-712 domain, and how to get test tokens.
- Gasless payments end to end: EIP-3009 with the real USDT, who pays the gas, what it costs at the floor, and how to
  refill a relayer from fees (with the "batch it" warning).
- Where account abstraction stands today.
- Which wallets can actually sign on Whitechain, tested, not just "any EVM wallet".
- Public RPC limits: allowed methods, rate limits, `eth_getLogs` ranges, and regions.
- Which confirmation level to use for commerce.

So overall, the chain did its job. The USDT's 3009 support made a real gasless checkout doable in a weekend, and
normal tooling just worked. Most of our lost time was around the chain instead: figuring out which USDT was real and
how to get some, learning that AA and embedded wallets aren't there yet, and doing the gas math on small payments.
Sort out the USDT naming and write that gasless payments page, and the next team saves most of a day.

Thanks for the testnet and the docs.

The PayKit team
