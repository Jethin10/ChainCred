# PayKit — Whitechain USDT Commerce SDK: Master Plan

> **Working name:** PayKit. This is a codename. Check npm, GitHub and trademark availability before publishing a package or a domain under it.
> **Written:** 6 November 2026, during ETHGlobal Mumbai (5–7 November 2026).
> **Status:** plan only. Nothing here is deployed, audited or measured unless the text says so.
> **Research basis:** `research/whitechain/BEST-FLOW.md` (current decision), `ARCHITECTURE.md`, `FINAL-CLAUDE-REVIEW.md`, `CLAUDE-SUMMARY.md`, `technical-and-challenge-notes.md`, `yeti-*.md`, `whitechain-network-fees.md`, `token-list.md`, `refill-live-snapshot.json`, `usdt-implementation.json`, and `winners/WHITECHAIN-WINNERS.md`.

---

## Table of contents

1. [One-paragraph pitch](#1-one-paragraph-pitch)
2. [What we are building (the four products)](#2-what-we-are-building-the-four-products)
3. [Verified facts we are building on](#3-verified-facts-we-are-building-on)
4. [Design principles and non-negotiables](#4-design-principles-and-non-negotiables)
5. [Roles](#5-roles)
6. [Payment types](#6-payment-types)
7. [State machines](#7-state-machines)
8. [Smart contracts: exact specification](#8-smart-contracts-exact-specification)
9. [Signatures and EIP-712 types](#9-signatures-and-eip-712-types)
10. [Fee model and gas economics](#10-fee-model-and-gas-economics)
11. [Treasury refill node (USDT fees → WBT)](#11-treasury-refill-node-usdt-fees--wbt)
12. [Backend server](#12-backend-server)
13. [Database schema](#13-database-schema)
14. [REST API](#14-rest-api)
15. [Webhooks](#15-webhooks)
16. [SDK packages (npm)](#16-sdk-packages-npm)
17. [Wallet connection (MetaMask, any wallet, thirdweb)](#17-wallet-connection-metamask-any-wallet-thirdweb)
18. [Merchant sign-up and verification](#18-merchant-sign-up-and-verification)
19. [Website pages](#19-website-pages)
20. [Observer, reconciliation and recovery](#20-observer-reconciliation-and-recovery)
21. [Security model and threat table](#21-security-model-and-threat-table)
22. [Testing strategy](#22-testing-strategy)
23. [Repository layout](#23-repository-layout)
24. [Configuration and environment](#24-configuration-and-environment)
25. [Build order, priorities and cut lines](#25-build-order-priorities-and-cut-lines)
26. [Demo script (3 minutes)](#26-demo-script-3-minutes)
27. [Sponsor tracks and submission checklist](#27-sponsor-tracks-and-submission-checklist)
28. [Claims we must not make](#28-claims-we-must-not-make)
29. [Open questions and gates](#29-open-questions-and-gates)
30. [Glossary](#30-glossary)

---

## 1. One-paragraph pitch

PayKit is an npm SDK and a self-hostable payment service that lets any developer build a shop, invoice flow or installment plan on Whitechain in a few lines of React or Next.js. Customers pay in USDT and never need WBT for gas: they sign, and our relayer submits. Merchants receive USDT directly to a payout wallet that is verified against their domain. Contracts handle four payment types (pay now, pay in parts, installments and refunds, each with optional percentage splits) and enforce the invoice terms onchain. A small USDT service fee funds the operation. The relay node that pays the gas periodically converts accumulated fees into WBT through YetiTrade, but only when the swap is worth more than it costs. A public registry and a shops page let customers find verified merchants and pay them. Every payment and refund can be rebuilt by anyone from public chain events.

**The memorable proof is operational, not cosmetic:** a duplicate charge is refused, a tampered payout is reverted, a partial refund respects its cap, an uneconomical refill is skipped, and a second observer rebuilds the same settlement ledger after the first one is killed.

---

## 2. What we are building (the four products)

| # | Product | Who uses it | What it does |
|---|---|---|---|
| 1 | **SDK** (`@paykit/*` npm packages) | Merchants (whoever builds their site) | React components, hooks, a browser client, a Node server client and Next.js helpers for products, carts, invoices, checkout, installment plans, refunds and payment status |
| 2 | **Payment server** (PayKit API + workers) | SDK, merchants, our operators | Invoices, quotes, relaying (gas sponsorship), observer, webhooks, installment scheduler, domain verification and treasury refill |
| 3 | **Smart contracts** | Everyone (onchain) | `MerchantRegistry`, `PaymentRouter` (one-time, partial, split, installments, refunds) and `FeeTreasury` (fee custody and bounded YetiTrade refills) |
| 4 | **PayKit website** (§19) | Everyone | Landing, shops (merchants open in a modal), user dashboard, merchant dashboard (with sign-up) and React Bits–style docs. **Built only from our own SDK components** |

Products 1–3 are the core. The website is built from the same components developers get, so it doubles as the proof that the SDK works. A tiny separate demo store shows the components running on a site that isn't ours.

---

## 3. Verified facts we are building on

These were checked during research on 5 November 2026. Recheck anything marked *gate* before relying on it.

### Network

| Item | Testnet (build target) | Mainnet (later) |
|---|---|---|
| Name | Whitechain Sepolia | Whitechain Mainnet (L2, migrated 26 Oct 2026) |
| Chain ID | `1874` | `1875` |
| RPC | `https://rpc.testnet.whitechain.io` | `https://rpc.whitechain.io` |
| Explorer | `https://explorer.testnet.whitechain.io` (Blockscout API at `/api/v2`) | `https://explorer.whitechain.io` |
| Stack | OP Stack L2, EIP-1559, 1-second blocks | Same |
| Gas token | Native **WBT** (18 decimals) | Native WBT |
| Fee | L2 execution (base fee floor **5 gwei**) + L1 data fee | Same, L1 fee higher |
| Finality | RPC exposes distinct `latest`, `safe`, `finalized` heads | Same |

### Tokens (testnet)

| Token | Address | Decimals | Notes |
|---|---|---|---|
| **USDT (sponsor/hackathon)** | `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` | 6 | Proxy → verified `TetherTokenV2` impl `0x26425662D126412128967ECf0a02EC48573026F7`. Supports `permit`, `transferWithAuthorization`, `receiveWithAuthorization`, `cancelAuthorization`, `isBlocked`. EIP-712 domain: name `Tether USD`, version `1`, chainId 1874. **This is the token we use.** |
| USDT.e (bridged, token list) | `0xaa7962d073935D387e8d442DA1D7149C81388f46` | 6 | Different token. **Do not use** for the submission. |
| WWBT | `0x4200000000000000000000000000000000000006` | 18 | Wrapped WBT, 1:1 |
| USDC.e | `0x5Eb541ba8A2DD841aF7864c3389162a23ddA8401` | 6 | Optional future token |

Mainnet USDT (`0xF956…`) runs the older Tether v1 with **`permit` only and no EIP-3009**. Production support therefore needs a permit path as well as the authorization path. Our installment design already uses permit, so the permit code doubles as the mainnet compatibility path.

USDT functions we call (from the saved ABI):

```solidity
function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s);
function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature);
function cancelAuthorization(address authorizer, bytes32 nonce, bytes signature);
function authorizationState(address authorizer, bytes32 nonce) view returns (bool);
function permit(address owner_, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s);
function nonces(address owner) view returns (uint256);
function isBlocked(address) view returns (bool);
function transferFrom(address _sender, address _recipient, uint256 _amount);
```

`receiveWithAuthorization` requires `msg.sender == to`. That is exactly why our router is the `to`. A front-runner cannot steal the authorization and make a plain transfer that skips our invoice logic.

### YetiTrade (Uniswap V3 1:1 fork, testnet)

| Contract | Address |
|---|---|
| UniswapV3Factory | `0x94aFa2aB80E44163362D2952bdf1E95b81900738` |
| SwapRouter02 | `0xe208cC685cD95D56E8ec6DEC9816476567fc6962` |
| QuoterV2 | `0x90f28c3a6233713d6Df00E5fa92a3f13EFe36191` |
| Universal Router | `0xbCB198083504E31293bC3765b3c791cF2B2202d8` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| **USDT/WWBT pool, fee 3000 (0.30%)** | `0x5645101Ca8d2F7BaBC27b10359555767a1BdF999` (only tier with a pool at block 12,299,832) |

Live quote snapshot at block 12,299,832 (read-only; testnet prices with no monetary value):

| USDT in | WWBT out | Internal swap gas cost (83,240 gas × 5.001 gwei) |
|---:|---:|---:|
| 0.01 | 0.0001345 | 0.000416 WBT, **3.1× the output** |
| 0.1 | 0.0013455 | 0.000416 WBT |
| 1 | 0.0134548 | 0.000416 WBT |
| 10 | 0.1345456 | 0.000416 WBT |

**Implied testnet price:** about 0.01345 WBT per USDT, or about 74 USDT per WBT. Break-even on the internal swap gas alone is about 0.03 USDT. Router, unwrap and L1 data costs move it higher. **Refills must therefore be batched.**

### Wallet-provider facts

- Whitechain's Reown guide documents that **embedded email/social wallets fail to sign** on Whitechain, while core external wallets work. Do not assume that any embedded wallet works.
- Privy documents custom-chain embedded wallets. That makes it the documented fallback candidate, but it remains unverified on 1874.
- Hosted-bundler lists for Pimlico and Alchemy do not include Whitechain. Hosted gas sponsorship from thirdweb on 1874 is not established. **We run our own relayer.**
- ERC-4337 EntryPoint v0.6/v0.7/v0.8, Safe 1.4.1, Permit2 and Multicall3 bytecode is present on testnet. We do not depend on any of them for the MVP.

### Competition (what already exists)

- **WhitePay (hackathon repo, AmrendraTheCoder):** gasless USDT checkout, signed orders, refunds and an accountant export. This is our closest comparison, and it also has a PWA/QR flow.
- **Merchant Capital+:** checkout, invoice financing and fee conversion through YetiTrade. Its README is still a skeleton.
- **Inferit x402 facilitator:** gas-sponsored x402 with its own ITC token.
- Many contracts with methods such as `payOrder`, `refund`, `settle` and `relay` appeared on the hackathon USDT on 4–5 November.
- **Whitepay.com:** custodial gateway.
- No past Whitechain winner was a payment SDK. The four DEGEN HACK 2024 recipients are unrelated.

**Consequence:** a gasless checkout plus a CSV is not differentiated. Our differentiation must be (a) an SDK that a third-party developer really uses, (b) installments, splits and refunds enforced onchain, (c) payouts verified against domains through a registry, (d) cost-gated self-funding of gas, and (e) a reconstructable ledger.

---

## 4. Design principles and non-negotiables

1. **Payer never needs WBT.** The payer only signs EIP-712 messages; a relayer submits them.
2. **Funds go where the registry says, not where the frontend says.** Payout addresses and split recipients come from onchain merchant configuration set by the merchant owner. A quote can only reference them, never introduce new ones.
3. **Every financial transfer and its record are atomic.** No "receipt without money" or "money without a receipt".
4. **The router holds zero balance after every transaction.** Fees go to `FeeTreasury`, and net amounts go to merchants in the same transaction.
5. **Onchain replay protection is authoritative.** Server-side locks only save gas.
6. **Refunds, cancellations and withdrawals work while the contracts are paused.** Pausing only stops new money from coming in.
7. **No custody of user keys.** The server never sees customer or merchant-owner private keys. Merchant *quote signers* are delegated, scoped keys.
8. **A payment never depends on a swap.** Refills are a separate, cost-gated background process.
9. **Integer base units everywhere.** USDT has 6 decimals and WBT has 18. No floats in contracts, the DB or the SDK. Amounts are strings in JSON.
10. **Honest finality.** Status moves through `pending → confirmed(latest) → safe → finalized`, and the label always says it is an RPC observation.
11. **Non-upgradeable contracts, versioned deployments.** A new version deploys alongside the old one, and the observer indexes both. This is simpler and safer for a hackathon than proxies.
12. **Wallet-agnostic SDK core.** The core accepts any EIP-1193 provider or viem `WalletClient`. thirdweb and wagmi are adapters, not requirements.

---

## 5. Roles

There are **four roles**. Anyone can also read the chain and rebuild the ledger (§20), but that needs no permission, so it is not a role.

| Role | Who | Keys it holds | Can do | Cannot do |
|---|---|---|---|---|
| **Consumer** | The person paying | Any EVM wallet (MetaMask, thirdweb, WalletConnect) holding USDT. **No WBT needed** | Sign payments, installment plans and plan cancellations; view receipts and refunds | Nothing beyond what they sign |
| **Merchant** | The business, plus whoever builds its site using the SDK | 1. **Owner wallet**: registers the business, sets payout and splits, approves refunds. 2. **Server signing key** (optional): lets the merchant's backend sign payment terms automatically. Our hosted signer can replace it | List products, create invoices, accept payments, issue refunds, create installment plans, get API keys and webhooks | Cannot pull money from a consumer without a signed payment or plan; cannot go below our fee floor or above its own fee cap |
| **Platform (us)** | The team that deploys and runs PayKit | **Admin key** (deployer; a Safe if time allows) | Deploy contracts; set fees and refill limits; mark domains verified; pause new payments; withdraw fee revenue; run the API and the website | Cannot touch merchant money (the router never holds a balance); cannot block refunds or cancellations, even while paused |
| **Relay node** | Our backend service that pays gas | **Relayer wallet(s)** funded with WBT | Submit every signed transaction and pay its WBT gas; collect installments when due; swap USDT fees into WBT for itself through `FeeTreasury.refill()` | Cannot change any amount, recipient or term (signatures bind them); refill is capped and pays out only to itself |

The merchant's server key is just a convenience. It can sign payment terms but **cannot change where money goes**: payout and splits come only from the owner wallet's onchain settings. If it leaks, the owner disables it.

### 5.1 Onchain permissions (all three contracts)

| Permission | Holder | Used for |
|---|---|---|
| `owner` (OpenZeppelin `Ownable2Step`) | Platform admin key | Fee schedule, allowed token, refill limits, domain verification, pause, relay-node list, revenue withdrawal |
| `isRelayer[address]` | Relay node wallet(s) | `FeeTreasury.refill()` only. **Payment functions are permissionless**, because the signatures carry the authority. Our relay node is simply the one that submits |
| Per-merchant `owner` + `signers` in `MerchantRegistry` | Merchant | Merchant settings and signing payment terms |

No other roles. No separate keeper, attestor or pauser keys.

### 5.2 Offchain access (website and API)

| Credential | Belongs to | Allows |
|---|---|---|
| Wallet login (SIWE) | Merchant owner | The merchant dashboard (`/merchant`) |
| Wallet login (SIWE) | Consumer | The user dashboard (`/me`) |
| `pk_test_…` publishable key | Merchant (used in its website) | Browser SDK: read products, start checkout, submit consumer signatures |
| `sk_test_…` secret key | Merchant (used in its backend) | Server SDK: invoices, refunds, plans, exports |
| `whsec_…` webhook secret | Merchant | Verifying webhooks |
| Platform admin login | Platform | Platform console (relay balance, refills, pause) |

---

## 6. Payment types

There are **four payment types**. Splits are an option on any payment, not a separate type.

| # | Type | Consumer signs | Merchant signs | Contract call | Priority |
|---|---|---|---|---|---|
| **1** | **Pay now:** pay the full amount from a cart or an invoice link (QR codes come later) | One USDT `ReceiveWithAuthorization` (gasless) | `PaymentQuote` (its server key or our hosted signer does this automatically) | `PaymentRouter.pay()` | **P0** |
| **2** | **Pay in parts:** a deposit percentage now and the rest later (e.g. 30% / 70%) | One authorization per part | One quote per part, all for the same invoice | `PaymentRouter.pay()`; the contract stops the total exceeding the invoice | **P0** |
| **3** | **Installments:** N automatic payments, one per period, with an optional down payment. A bounded subscription is the same thing | Plan consent + USDT `permit`, once | `PlanTerms` | `createPlan()`; the relay node calls `collectInstallment()` when each is due. Either side can `cancelPlan()`; a missed payment can be marked with `markDelinquent()` | **P1** |
| **4** | **Refund:** partial or full, for any payment above | — | `RefundTerms` + a USDT authorization from the wallet funding the refund | `PaymentRouter.refund()`; total refunds never exceed the original payment | **P0** |

**Split option (percentages):** any of types 1–3 can share the merchant's net amount among several wallets (e.g. seller 90%, platform 8%, affiliate 2%). The merchant owner saves the split once onchain, and payments reference it by number. The default split is 100% to the payout wallet.

### 6.1 Non-payment transactions

These keep the system running. They are not payment types, and the consumer never sees them.

| Transaction | Who | Contract call | Priority |
|---|---|---|---|
| Merchant registration and settings (payout, server key, splits) | Merchant owner signs; the relay node submits (gasless) | `MerchantRegistry.registerWithSig()` and the other `*WithSig()` functions | **P0** |
| Domain verification | Platform | `MerchantRegistry.attestDomain()` / `revokeDomain()` | **P0** |
| Fee refill (USDT fees → WBT) | Relay node | `FeeTreasury.refill()` | **P0** (one real run) |
| Admin: pause, fees, revenue withdrawal | Platform | `pause()`, `setFeeSchedule()`, `withdraw()` | P0 (pause tested) |

### 6.2 Not supported (deliberately)

- **Plain USDT transfers to a merchant address.** They cannot be matched to an invoice, they need consumer WBT, and they bypass refunds and splits.
- **Overpayment.** It reverts. A late payment is blocked by the quote's expiry.
- **Credit / buy now, pay later.** Installments are paid from the consumer's own balance. If the consumer misses a payment, the plan is marked delinquent, and nobody advances money.
- **Escrow, x402, agent mandates.** Later, if ever.
- **Fiat on/off-ramps, KYC, tax.**

---

## 7. State machines

### 7.1 Invoice (offchain authoritative status, onchain-enforced amounts)

```
draft ──issue──▶ open ──first part paid──▶ partially_paid ──remaining paid──▶ paid
  │               │                           │                               │
  └──delete       ├──validUntil passed──▶ expired   (can be reissued as a new invoice)
                  └──void (merchant)──▶ void       (only if nothing paid yet)

paid / partially_paid ──refund──▶ partially_refunded ──refund to cap──▶ refunded
```

Onchain mirror: `invoices[key] = { total, paid, refunded }`, where `key = keccak256(merchantId, invoiceId)`.

### 7.2 Payment attempt (offchain job)

```
created → awaiting_signature → signed → validated → queued → submitted
   → included(latest) → safe → finalized
failure branches: rejected_policy | simulation_failed | reverted | dropped | replaced(→ submitted) | expired | cancelled_by_payer
```

### 7.3 Installment plan (onchain status)

```
Active ──collect i < count──▶ Active
Active ──collect last──▶ Completed
Active ──now > due(i)+grace and not collected──▶ Delinquent ──late collect──▶ Active (catch-up allowed)
Active | Delinquent ──cancel(payer or merchant)──▶ Cancelled
```

### 7.4 Refund

```
requested → approved (merchant owner or server key) → funder_signed → queued → submitted → settled(latest→finalized)
                                                     └→ failed (insufficient funder balance / expired)
```

### 7.5 Merchant

```
pending (registered onchain) → domain_verified (attested) → listed (shops page opt-in)
any → suspended (admin, e.g. abuse) → pending/verified
attestation expires after N days unless re-checked → pending
```

---

## 8. Smart contracts: exact specification

Solidity `0.8.34` (already installed). Use OpenZeppelin `Ownable2Step` (owner = platform admin key), `Pausable`, `ReentrancyGuard`, `EIP712`, `SignatureChecker` (ECDSA + ERC-1271 for Safe merchants) and `SafeERC20`. Build and test with Foundry. Hardhat Ignition handles deployment if preferred. Three core contracts plus interfaces.

```
contracts/src/
  interfaces/IUSDT3009.sol        // receiveWithAuthorization, permit, cancelAuthorization, isBlocked
  interfaces/ISwapRouter02.sol    // exactInputSingle, multicall(deadline,bytes[]), unwrapWETH9(uint256,address)
  interfaces/IQuoterV2.sol        // offchain only (types)
  MerchantRegistry.sol
  PaymentRouter.sol
  FeeTreasury.sol
  libraries/PayKitTypes.sol       // structs, typehashes, enums
  libraries/SplitMath.sol
```

### 8.1 `MerchantRegistry`

**Purpose:** the source of truth for who a merchant is, where its money goes, who may sign for it and whether its domain is verified.

```solidity
struct Merchant {
    address owner;            // EOA or Safe; ultimate authority
    address payout;           // receives net USDT (default split profile)
    uint16  maxFeeBps;        // merchant's consent cap for fees, e.g. 300 = 3%
    uint8   status;           // 0 none, 1 active, 2 suspended
    uint64  createdAt;
    bytes32 metadataHash;     // keccak of canonical metadata JSON (name, logo, category, site)
    string  metadataURI;      // https://api.paykit.../merchants/{id}/metadata.json or ipfs://
}

struct SignerInfo { uint64 expiresAt; bool enabled; }

struct SplitProfile {           // percentages of NET amount
    address[] recipients;       // max 5
    uint16[]  bps;              // sums to 10_000
    bool      active;
}

struct DomainAttestation {
    bytes32 domainHash;         // keccak256(lowercase punycode domain)
    uint64  verifiedAt;
    uint64  expiresAt;
    address attestor;
}

struct PendingPayout { address newPayout; uint64 executableAt; }

mapping(bytes32 => Merchant) public merchants;
mapping(bytes32 => mapping(address => SignerInfo)) public signers;
mapping(bytes32 => mapping(uint32 => SplitProfile)) internal splitProfiles; // profile 0 = 100% payout (implicit)
mapping(bytes32 => DomainAttestation[]) public domains;                      // a merchant may verify several domains
mapping(bytes32 => PendingPayout) public pendingPayout;
mapping(address => uint256) public ownerNonces;                              // for *WithSig
uint64 public payoutChangeDelay;                                             // e.g. 0 on testnet demo, 24h in prod
```

**Merchant ID:** `merchantId = keccak256(abi.encode(block.chainid, owner, ownerNonce))`. This is deterministic, so the SDK can predict it before inclusion. A human-readable slug lives offchain.

**Functions**

| Function | Auth | Notes |
|---|---|---|
| `register(address payout, uint16 maxFeeBps, bytes32 metadataHash, string uri) returns (bytes32)` | `msg.sender` = owner | Direct path for owners with WBT |
| `registerWithSig(RegisterMerchant calldata m, bytes sig) returns (bytes32)` | Owner EIP-712 sig (ECDSA or 1271) | Gasless, relayed. `deadline` and `ownerNonces` prevent replay |
| `setSigner(bytes32 id, address signer, uint64 expiresAt, bool enabled)` / `...WithSig` | Owner | Delegated quote signers |
| `queuePayoutChange(bytes32 id, address newPayout)` / `...WithSig` | Owner | Starts the delay |
| `executePayoutChange(bytes32 id)` | Anyone after the delay | |
| `setSplitProfile(bytes32 id, uint32 profileId, address[] r, uint16[] bps)` / `...WithSig` | Owner | `profileId ≠ 0`; ≤ 5 recipients; bps sum = 10 000; recipients ≠ 0 |
| `setMetadata(bytes32 id, bytes32 hash, string uri)` / `...WithSig` | Owner | |
| `setMaxFeeBps(bytes32 id, uint16 bps)` | Owner | Merchant consent cap |
| `transferOwnership(bytes32 id, address newOwner)` | Owner | Two-step (`accept`) |
| `attestDomain(bytes32 id, bytes32 domainHash, uint64 expiresAt)` | Platform (`onlyOwner`) | After an offchain DNS/`.well-known` check |
| `revokeDomain(bytes32 id, bytes32 domainHash)` | Platform or merchant owner | |
| `setStatus(bytes32 id, uint8 status)` | Admin | Suspend for abuse; suspension blocks *new* payments only |
| **Views** | | |
| `isActive(bytes32 id) → bool` | | |
| `isSigner(bytes32 id, address s) → bool` | | `enabled && (expiresAt == 0 \|\| expiresAt > now)` |
| `getSplit(bytes32 id, uint32 profileId) → (address[] r, uint16[] bps)` | | Profile 0 returns `[payout], [10000]` |
| `isDomainVerified(bytes32 id, bytes32 domainHash) → bool` | | Checks expiry |

**Events**

```solidity
event MerchantRegistered(bytes32 indexed merchantId, address indexed owner, address payout, uint16 maxFeeBps, bytes32 metadataHash, string metadataURI);
event SignerSet(bytes32 indexed merchantId, address indexed signer, uint64 expiresAt, bool enabled);
event PayoutChangeQueued(bytes32 indexed merchantId, address newPayout, uint64 executableAt);
event PayoutChanged(bytes32 indexed merchantId, address oldPayout, address newPayout);
event SplitProfileSet(bytes32 indexed merchantId, uint32 indexed profileId, address[] recipients, uint16[] bps);
event MetadataUpdated(bytes32 indexed merchantId, bytes32 metadataHash, string metadataURI);
event DomainAttested(bytes32 indexed merchantId, bytes32 indexed domainHash, uint64 expiresAt, address attestor);
event DomainRevoked(bytes32 indexed merchantId, bytes32 indexed domainHash);
event MerchantStatusChanged(bytes32 indexed merchantId, uint8 status);
event OwnershipTransferStarted(bytes32 indexed merchantId, address newOwner);
event OwnershipTransferred(bytes32 indexed merchantId, address oldOwner, address newOwner);
```

**Domain verification is not required to receive payments.** It is required for the verified badge and directory listing. The SDK warns customers when the merchant is unverified or when the page hostname does not match an attested domain.

### 8.2 `PaymentRouter`

**Purpose:** all customer money flows through here. It handles all four payment types. It never retains a balance.

**Immutable / config**

```solidity
IMerchantRegistry public immutable registry;
address public immutable treasury;               // FeeTreasury
mapping(address => bool) public allowedToken;    // USDT 0xcedf… only in MVP

// Fee schedule (protocol floor). Merchants consent via maxFeeBps; quotes carry the exact fee.
struct FeeSchedule { uint16 bps; uint96 minFee; uint96 maxFee; } // per token, base units
mapping(address => FeeSchedule) public feeSchedule;              // e.g. USDT: 100 bps, min 0.05, max 25 USDT
```

**Storage**

```solidity
struct InvoiceState { uint128 total; uint128 paid; uint128 refunded; }        // per (merchantId, invoiceId)
struct Payment {
    bytes32 merchantId;
    bytes32 invoiceKey;       // keccak(merchantId, invoiceId); 0 for installments (plan-scoped)
    bytes32 planId;           // 0 for one-time
    address payer;
    address refundTo;
    address token;
    uint128 gross;
    uint128 fee;
    uint128 refunded;
    uint32  splitProfileId;
    uint64  settledAt;
}
mapping(bytes32 => InvoiceState) public invoices;      // invoiceKey => state
mapping(bytes32 => Payment)      public payments;      // paymentId => payment (existence = used)
mapping(bytes32 => bool)         public usedRefundIds;

struct Plan {
    bytes32 merchantId;
    address payer;
    address token;
    uint128 installmentAmount;
    uint128 feePerInstallment;
    uint64  firstDue;
    uint32  period;            // seconds
    uint32  grace;             // seconds
    uint16  count;             // total installments (excl. down payment)
    uint16  collected;         // installments collected
    uint32  splitProfileId;
    uint8   status;            // 1 Active, 2 Delinquent, 3 Cancelled, 4 Completed
    bytes32 termsHash;
}
mapping(bytes32 => Plan) public plans;
mapping(address => mapping(address => uint256)) public committed; // payer => token => outstanding plan total
```

#### Function: `pay` (types 1 and 2, with optional split)

```solidity
function pay(
    PaymentQuote calldata q,
    bytes calldata merchantSig,
    PayerAuth calldata a          // {from, refundTo, salt, validAfter, validBefore, signature}
) external nonReentrant whenNotPaused returns (bytes32 paymentId);
```

Checks and effects, in order:

1. `allowedToken[q.token]`; `registry.isActive(q.merchantId)`.
2. `block.timestamp <= q.validUntil`.
3. `q.payer == address(0) || q.payer == a.from` (optional payer binding).
4. `quoteHash = _hashTypedDataV4(hash(q))`; signer = `SignatureChecker`-recovered; `registry.isSigner(q.merchantId, signer)` **or** signer == merchant owner.
5. `payments[q.paymentId].settledAt == 0` → else `revert PaymentAlreadySettled()`.
6. Invoice: `key = keccak256(abi.encode(q.merchantId, q.invoiceId))`. If `invoices[key].total == 0`, set it to `q.invoiceTotal`. Otherwise require `q.invoiceTotal == total`. Require `paid + q.gross <= total`.
7. Fee: `q.fee <= q.gross`; `q.fee >= protocolFee(q.token, q.gross)` (floor); `q.fee * 10_000 <= q.gross * merchant.maxFeeBps` **unless** the floor itself exceeds the cap. In that case the quote is rejected with `FeeAboveMerchantCap`, and merchants must not sell below the min ticket.
8. `refundTo = a.refundTo == 0 ? a.from : a.refundTo`.
9. **Nonce commitment:** `nonce = keccak256(abi.encode(PAY_NONCE_TAG, quoteHash, refundTo, a.salt))`.
10. `USDT.receiveWithAuthorization(a.from, address(this), q.gross, a.validAfter, a.validBefore, nonce, a.signature)`. This pulls the gross amount and reverts if the signature does not match the nonce. **This is the line that makes tampering impossible:** change any quote field, the refund address or the salt, and the nonce no longer matches what the payer signed.
11. Effects: `invoices[key].paid += gross`; write `payments[paymentId]`.
12. Interactions: `net = gross - fee`. Pay the split from `registry.getSplit(merchantId, q.splitProfileId)` with `amount_i = net * bps_i / 10_000`; the **last recipient gets the remainder** (no dust). `safeTransfer(treasury, fee)`.
13. Emit `PaymentSettled` and one `SplitPaid` per recipient.
14. Invariant: `USDT.balanceOf(address(this))` is unchanged across the call (asserted in tests; optionally `assert` in code for the MVP).

**Blocked addresses:** USDT's `isBlocked` reverts transfers involving blocked addresses. The relayer pre-checks `isBlocked(payer)`, `isBlocked(recipient_i)` and `isBlocked(treasury)` and refuses early to save gas.

#### Function: `refund` (type 4)

```solidity
function refund(
    RefundTerms calldata t,       // {paymentId, refundId, amount, fee, funder, validUntil}
    bytes calldata merchantSig,   // signer or owner of payment.merchantId
    FunderAuth calldata f         // {validAfter, validBefore, signature}  (3009 by t.funder)
) external nonReentrant returns (uint128 cumulativeRefunded);   // NOT gated by whenNotPaused
```

1. `p = payments[t.paymentId]`; it must exist. `!usedRefundIds[t.refundId]`; `now <= t.validUntil`.
2. Merchant signature valid for `p.merchantId`.
3. `p.refunded + t.amount <= p.gross` → else `RefundExceedsPayment`.
4. `nonce = keccak256(abi.encode(REFUND_NONCE_TAG, refundTermsHash))`.
5. `USDT.receiveWithAuthorization(t.funder, address(this), t.amount + t.fee, f.validAfter, f.validBefore, nonce, f.signature)`.
6. Effects: `p.refunded += amount`; `invoices[p.invoiceKey].refunded += amount` (if one-time); `usedRefundIds[refundId] = true`.
7. `safeTransfer(p.refundTo, amount)`; `safeTransfer(treasury, t.fee)` if `fee > 0` (default 0).
8. Emit `RefundSettled`.

**Fee policy (default, disclosed):** the original service fee is **not refunded**. It is booked as a merchant expense. A full gross refund therefore needs the funder to contribute the original fee from its own balance. The demo uses a partial refund.

#### Functions: installments (type 3)

```solidity
function createPlan(
    PlanTerms calldata t,          // merchant-signed
    bytes calldata merchantSig,
    bytes calldata payerConsentSig,// payer signs PlanConsent{termsHash, payer, deadline}
    PermitData calldata permit     // {value, deadline, v, r, s} USDT permit(payer -> router)
) external nonReentrant whenNotPaused returns (bytes32 planId);

function collectInstallment(bytes32 planId) external nonReentrant whenNotPaused returns (bytes32 paymentId);
function markDelinquent(bytes32 planId) external;
function cancelPlan(CancelPlan calldata c, bytes calldata sig) external; // payer OR merchant signer; not pause-gated
```

`createPlan`:

1. Verify the merchant signature over `PlanTerms` and the payer signature over `PlanConsent{ termsHash, payer, deadline }`.
2. `planId = t.planId`; it must be unused.
3. `total = t.downPayment + t.installmentAmount * t.count`.
4. Call `USDT.permit(payer, address(this), permit.value, permit.deadline, v, r, s)` inside `try/catch`. If it reverts, accept the plan only if the existing allowance already suffices. This defends against permit front-running griefing.
5. Require `allowance(payer, router) >= committed[payer][token] + total`. **Permit overwrites the allowance**, so the SDK must request `permit.value = committed + total`, reading `committed` from the router first.
6. `committed[payer][token] += total`.
7. If `downPayment > 0`, `transferFrom(payer, router, downPayment)`, settle it like a payment (`paymentId = keccak(planId, 0xFFFF)`), and set `committed -= downPayment`.
8. Store the plan and emit `PlanCreated`.

`collectInstallment` (permissionless; our scheduler calls it):

1. Plan is `Active` or `Delinquent`; `collected < count`.
2. `due = firstDue + collected * period`; `block.timestamp >= due`.
3. `transferFrom(payer, router, installmentAmount)`; this reverts if the payer lacks balance or allowance. The scheduler simulates first and does not submit failing calls.
4. `paymentId = keccak256(abi.encode(planId, collected))`. Record the `Payment` (refundable via `refund`), split the net amount, and send the fee to the treasury.
5. `collected++`; `committed -= installmentAmount`; status → `Active` (clears Delinquent), or `Completed` if this was the last installment.
6. Emit `InstallmentCollected`; on the last one, also `PlanCompleted`.

`markDelinquent`: requires `now > firstDue + collected*period + grace`. Sets status 2 and emits `InstallmentMissed(planId, collected)`. The merchant decides offchain what to do (pause the service, cancel, wait).

`cancelPlan`: the signature is by the payer **or** a merchant signer/owner. Status → `Cancelled`; `committed -= remaining`; emit `PlanCancelled(planId, by)`. Past installments stay refundable through `refund`. **Cancellation by the payer is always possible.** That is a customer-protection guarantee.

#### Custom errors

```solidity
error TokenNotAllowed(); error MerchantInactive(); error QuoteExpired(); error PayerMismatch();
error InvalidMerchantSignature(); error PaymentAlreadySettled(); error InvoiceTotalMismatch();
error InvoiceOverpaid(); error FeeBelowProtocolFloor(); error FeeAboveMerchantCap(); error FeeExceedsGross();
error UnknownPayment(); error RefundIdUsed(); error RefundExceedsPayment(); error RefundExpired();
error PlanExists(); error PlanNotActive(); error InstallmentNotDue(); error PlanComplete();
error InsufficientAllowance(); error NotDelinquentYet(); error InvalidCancelSigner(); error InvalidSplit();
```

#### Events (the observer's entire input)

```solidity
enum PaymentKind { OneTime, Installment, DownPayment }

event PaymentSettled(
    bytes32 indexed paymentId, bytes32 indexed merchantId, bytes32 indexed invoiceKey,
    bytes32 planId, address payer, address refundTo, address token,
    uint256 gross, uint256 fee, uint256 net, uint32 splitProfileId, bytes32 quoteHash, PaymentKind kind
);
event SplitPaid(bytes32 indexed paymentId, address indexed recipient, uint256 amount);
event InvoiceProgress(bytes32 indexed invoiceKey, uint256 total, uint256 paid, uint256 refunded);
event RefundSettled(bytes32 indexed refundId, bytes32 indexed paymentId, address to, uint256 amount, uint256 fee, uint256 cumulativeRefunded, address funder);
event PlanCreated(bytes32 indexed planId, bytes32 indexed merchantId, address indexed payer, address token, uint256 installmentAmount, uint16 count, uint32 period, uint64 firstDue, uint32 grace, bytes32 termsHash);
event InstallmentCollected(bytes32 indexed planId, uint16 index, bytes32 paymentId, uint256 amount, uint256 fee);
event InstallmentMissed(bytes32 indexed planId, uint16 index);
event PlanCancelled(bytes32 indexed planId, address by);
event PlanCompleted(bytes32 indexed planId);
event FeeScheduleSet(address indexed token, uint16 bps, uint96 minFee, uint96 maxFee);
```

### 8.3 `FeeTreasury`

**Purpose:** holds protocol USDT fees and converts them into native WBT for the relayers in **bounded** runs.

```solidity
IERC20 public immutable usdt;           // 0xcedf…
address public immutable wwbt;          // 0x4200…0006
ISwapRouter02 public immutable router;  // 0xe208… SwapRouter02
uint24 public immutable poolFee;        // 3000

struct RefillLimits {
    uint128 maxUsdtPerRun;       // e.g. 20 USDT
    uint128 maxUsdtPerDay;       // e.g. 100 USDT
    uint128 minWbtPerUsdt;       // price floor (1e18-scaled WBT per 1 USDT), set by admin from a reference
    uint32  maxDeadlineWindow;   // e.g. 120 s
}
RefillLimits public limits;
mapping(address => bool) public isRelayer;        // relay node wallets: the only callers, and the only WBT recipients
uint256 public spentToday; uint64 public dayStart;
uint256 public reservedUsdt;                      // amount admin can never withdraw (operating reserve)
```

```solidity
function refill(uint256 usdtIn, uint256 minWbtOut, uint256 deadline)
    external nonReentrant returns (uint256 wbtOut);           // require(isRelayer[msg.sender]); WBT goes to msg.sender
function withdraw(address to, uint256 amount) external onlyOwner; // amount <= balance - reservedUsdt
function setLimits(RefillLimits calldata) external onlyOwner;
function setRelayer(address, bool) external onlyOwner;
```

`refill` logic:

1. `isRelayer[msg.sender]` (recipient = `msg.sender`); `usdtIn <= maxUsdtPerRun`; daily window `spentToday + usdtIn <= maxUsdtPerDay`; `deadline <= now + maxDeadlineWindow`.
2. **Independent price floor:** `minWbtOut >= usdtIn * minWbtPerUsdt / 1e6`. The relay node's quote cannot undercut the admin-set floor, so a manipulated pool cannot drain the treasury below that price.
3. `usdt.forceApprove(router, usdtIn)`.
4. `router.multicall(deadline, [ exactInputSingle({tokenIn: usdt, tokenOut: wwbt, fee: 3000, recipient: ADDRESS_THIS (=address(2)), amountIn: usdtIn, amountOutMinimum: minWbtOut, sqrtPriceLimitX96: 0}), unwrapWETH9(minWbtOut, msg.sender) ])`. Native WBT lands **directly in the calling relay node wallet**, so the treasury needs no payable `receive()`.
   - *Gate:* confirm the deployed SwapRouter02 exposes `unwrapWETH9(uint256,address)` and `ADDRESS_THIS = address(2)`. **Fallback:** swap with `recipient = address(this)`, call `IWETH(wwbt).withdraw(out)` and `recipient.call{value: out}("")`. This needs a `receive()` that only accepts from `wwbt`.
5. Reset the approval to 0. Record `spentToday`. Emit `Refill(runId, usdtIn, wbtOut, recipient, minWbtOut, block.timestamp)`.

---

## 9. Signatures and EIP-712 types

### 9.1 Domains

| Signed for | Domain |
|---|---|
| USDT 3009 / permit / cancel | `{ name: "Tether USD", version: "1", chainId: 1874, verifyingContract: 0xcedf… }` (verified DOMAIN_SEPARATOR `0xcdcfacb6…2a25`) |
| PaymentRouter types | `{ name: "PayKit Router", version: "1", chainId: 1874, verifyingContract: <router> }` |
| MerchantRegistry types | `{ name: "PayKit Registry", version: "1", chainId: 1874, verifyingContract: <registry> }` |

### 9.2 Types

```ts
// Merchant signer signs (server side, via @paykit/node)
PaymentQuote {
  bytes32 merchantId; bytes32 invoiceId; bytes32 invoiceDigest; bytes32 paymentId;
  address token; uint256 invoiceTotal; uint256 gross; uint256 fee;
  address payer;            // 0x0 = any payer
  uint32  splitProfileId;
  uint64  validUntil;
}

// Customer signs (USDT domain) — the standard 3009 type, nothing custom:
ReceiveWithAuthorization {
  address from; address to /* = router */; uint256 value /* = gross */;
  uint256 validAfter; uint256 validBefore; bytes32 nonce;
}
// where nonce = keccak256(abi.encode(PAY_NONCE_TAG, quoteHash, refundTo, salt))
//   PAY_NONCE_TAG = keccak256("PayKit.pay.v1"), salt = random 32 bytes per part

RefundTerms { bytes32 paymentId; bytes32 refundId; uint256 amount; uint256 fee; address funder; uint64 validUntil; }
// funder signs ReceiveWithAuthorization with nonce = keccak256(abi.encode(REFUND_NONCE_TAG, refundTermsHash))

PlanTerms {
  bytes32 merchantId; bytes32 planId; bytes32 invoiceDigest; address payer; address token;
  uint256 downPayment; uint256 installmentAmount; uint256 feePerInstallment; uint256 downPaymentFee;
  uint16 count; uint32 period; uint64 firstDue; uint32 grace; uint32 splitProfileId; uint8 kind; uint64 validUntil;
}
PlanConsent { bytes32 termsHash; address payer; uint64 deadline; }       // customer
Permit { address owner; address spender; uint256 value; uint256 nonce; uint256 deadline; } // customer, USDT domain
CancelPlan { bytes32 planId; address signer; uint64 deadline; }

RegisterMerchant { address owner; address payout; uint16 maxFeeBps; bytes32 metadataHash; uint256 nonce; uint64 deadline; }
SetSigner { bytes32 merchantId; address signer; uint64 expiresAt; bool enabled; uint256 nonce; uint64 deadline; }
QueuePayout { bytes32 merchantId; address newPayout; uint256 nonce; uint64 deadline; }
SetSplitProfile { bytes32 merchantId; uint32 profileId; bytes32 splitHash; uint256 nonce; uint64 deadline; }
```

### 9.3 What the customer sees and signs

- **One-time payment:** one wallet popup showing "Tether USD — ReceiveWithAuthorization — value 10.000000 — to PayKit Router". Our checkout UI shows *above* it, in plain words: merchant name, verified domain, amount, fee paid by the merchant, and "no gas needed".
- **Installment plan:** two popups, first the **plan consent** (readable plan fields) and then the **USDT permit** for `committed + total`. The UI explains that "this lets the plan collect up to X USDT on schedule. You can cancel any time."
- **Optional `payer`-bound quotes** let a merchant pre-assign an invoice to a specific wallet (B2B invoices).

### 9.4 IDs

| ID | Construction |
|---|---|
| `invoiceId` | `keccak256(utf8(invoice UUID))`. The private UUID stays in the DB |
| `invoiceDigest` | `keccak256(canonical JSON of invoice line items, totals, currency, merchant, issue date)` (RFC 8785 JSON canonicalization) |
| `paymentId` | `keccak256(abi.encode(invoiceId, partIndex, randomSalt))` for one-time; `keccak256(abi.encode(planId, index))` for installments |
| `refundId` | `keccak256(utf8(refund UUID))` |
| `planId` | `keccak256(utf8(plan UUID))` |

---

## 10. Fee model and gas economics

### 10.1 Who pays what

| Cost | Paid by | In |
|---|---|---|
| Payment gas (WBT) | Operator relayer (fronted) | WBT |
| Service fee | **Merchant** (deducted from gross; the customer pays only the sticker price) | USDT |
| Refund gas | Operator | WBT (optionally recovered via `RefundTerms.fee`) |
| Registration / config gas | Operator (rate-limited, 1 registration per wallet per day) | WBT |
| Refill gas | Relay node (funded by refills) | WBT |
| Optional customer surcharge mode | Customer, disclosed in the checkout line | USDT (P2) |

### 10.2 Default fee schedule (configurable; to be justified by measured gas)

```
fee = clamp( gross * 100 / 10_000 , minFee = 0.05 USDT , maxFee = 25 USDT )     // 1%, min 5 cents
```

- **Minimum ticket:** `minFee / merchant.maxFeeBps`. With the defaults (0.05 USDT floor, 3% cap) that is about **1.67 USDT**. Below it, the floor fee would exceed the merchant's consent cap, so the server refuses with `amount_too_small` (and the contract would revert with `FeeAboveMerchantCap`). A merchant who wants smaller tickets raises its cap, e.g. 10% allows 0.50 USDT.
- **Why 0.05 USDT minimum:** unmeasured estimate. A `pay()` with a 3009 pull, 2–4 transfers and storage writes is plausibly 120k–180k gas, which at 5 gwei is 0.0006–0.0009 WBT plus a tiny testnet L1 fee. At the snapshot price of about 74 USDT/WBT, that is **about 0.045–0.07 USDT of gas per payment**. **Gate G3 measures the real number** and the fee floor is set from it. We will not claim the fee "exactly covers gas".
- The merchant's `maxFeeBps` (e.g. 300) is their onchain consent ceiling, so we cannot silently raise fees above it.
- Fee changes emit `FeeScheduleSet`. Quotes carry the exact fee, so in-flight quotes are unaffected.

### 10.3 Unit economics shown in the demo (from the measured gas in G3)

```
per payment:  fee_usdt − gas_wbt × price_usdt_per_wbt = operator margin
per refill:   wbt_out − refill_gas_wbt  must be ≥ 10× refill_gas_wbt (cost ≤ 10% of output)
runway:       relayer_available_wbt / avg_gas_per_payment = payments of runway
```

---

## 11. Treasury refill node (USDT fees → WBT)

You asked for a node that "every 30 minutes or after a threshold" converts USDT fees into WBT. This design keeps that cadence and adds the economic gate the research showed is mandatory. Tiny swaps lose money (0.01 USDT → 3× the gas cost).

### 11.1 Triggers

- **Timer:** every `REFILL_INTERVAL = 30 min` (configurable).
- **Event:** immediately when a relayer's *available* balance falls below `LOW_WATERMARK`.
- **Never** per payment. A payment never waits for a swap.

### 11.2 Balances it reasons about

```
relayer_balance      = eth_getBalance(relayer)
inflight_reserved    = Σ gas reservations of submitted-but-unmined jobs (max fee × gas limit)
protected_reserve    = RESERVE_WBT (never spent on sponsorship: keeps the refill tx and emergency txs alive)
available            = relayer_balance − inflight_reserved − protected_reserve
target               = TARGET_RUNWAY_PAYMENTS × measured_avg_gas_per_payment   (e.g. 500 payments)
deficit              = max(0, target − available)
treasury_fees        = USDT.balanceOf(FeeTreasury) − reservedUsdt
```

### 11.3 Decision algorithm (each tick)

```text
1. if available ≥ HIGH_WATERMARK                → log SKIP(reason="runway ok");   return
2. usdt_needed = deficit / spot_price × (1 + slippage_buffer)
   usdt_in     = min(treasury_fees, usdt_needed, maxUsdtPerRun, remaining_daily_cap)
3. if usdt_in < MIN_BATCH_USDT                  → SKIP("batch too small")
4. quote_out   = QuoterV2.quoteExactInputSingle(USDT→WWBT, fee 3000, usdt_in)   // eth_call
   gas_est     = eth_estimateGas(FeeTreasury.refill(...)) from the relay node
   l1_fee      = GasPriceOracle(0x420…000F).getL1Fee(rawTx)                     // OP Stack predeploy — gate
   refill_cost = gas_est × maxFeePerGas + l1_fee
5. min_out     = max(quote_out × (1 − MAX_SLIPPAGE), usdt_in × minWbtPerUsdt)
6. if min_out − refill_cost < refill_cost × 9   → SKIP("uneconomical: cost > 10% of output")  ← demo moment
7. if relayer_balance < refill_cost × 2          → PAUSE_SPONSORSHIP + alert ("manual top-up needed")
8. submit FeeTreasury.refill(usdt_in, min_out, relayer, now + 120s)
9. record refill_runs row: inputs, quote, min_out, actual out (from receipt), gas, l1 fee, tx hash, new runway
10. on revert (slippage/deadline): record FAILED with cost; exponential backoff; max 3 retries/hour
```

### 11.4 Admission control (ties the refill to payments)

Before asking a customer to sign, the API checks `available − reservation_for_this_payment ≥ protected_reserve`. If not, checkout shows "Payments are temporarily paused" instead of collecting a signature that cannot be relayed. Sponsorship pauses automatically **before** the relayer runs dry.

### 11.5 Default parameters (testnet)

| Param | Value |
|---|---|
| `REFILL_INTERVAL` | 30 min |
| `LOW_WATERMARK` / `HIGH_WATERMARK` | 100 / 500 payments of runway |
| `RESERVE_WBT` | 0.02 WBT |
| `MIN_BATCH_USDT` | 1 USDT |
| `MAX_SLIPPAGE` | 1% |
| `maxUsdtPerRun` / `maxUsdtPerDay` | 20 / 100 USDT |
| `minWbtPerUsdt` | 80% of the observed price (admin-updated) |

### 11.6 Honest wording

- The operator's WBT float is **permanent working capital**. Refills *replenish* it and never eliminate it.
- The demo refill uses **pre-accumulated, disclosed test fees** at testnet prices.
- Keep the gas sponsorship balance separate from merchant sales principal. The treasury only ever holds fees.

---

## 12. Backend server

### 12.1 Stack decision

**TypeScript on Node 24**, in the same monorepo as the SDK. EIP-712 hashing, IDs and types are shared code from `@paykit/core`, which removes the main class of signature-mismatch bugs. The existing FastAPI scaffold only has `/health`, so there is little to lose. *Alternative:* keep Python for the observer only. It is not needed.

| Concern | Choice |
|---|---|
| HTTP | **Hono** (fast, typed; runs on Node) with Zod validation and an OpenAPI generator |
| DB | **PostgreSQL 17** (already in `compose.yaml`) via **Drizzle ORM** + migrations |
| Jobs | **pg-boss** (Postgres-backed queue, so Postgres stays the authority for dedupe) |
| Cache / rate limits | **Redis 7** (already running): sliding-window limits, short locks, quote cache |
| Chain | **viem** (public + wallet clients, `simulateContract`, `estimateGas`, log watching) |
| Auth | SIWE (EIP-4361) for merchant and consumer dashboard sessions; API keys (hashed, argon2id) for the SDK |
| Secrets | `.env` locally; signer keys never logged; hosted merchant signer keys encrypted at rest (libsodium sealed box, master key from env) |

### 12.2 Processes (one codebase, separate entry points)

```
apps/server/
  src/api/            → HTTP API (public + dashboard)
  src/workers/
    relayer.ts        → consumes settlement jobs; nonce manager; simulate → send → track → replace
    observer.ts       → scans router/registry/treasury logs; finality tracker; reorg handling; projections
    webhooks.ts       → outbox delivery with HMAC + retries
    scheduler.ts      → installment collector (due plans), delinquency marker, quote/invoice expiry sweeper
    refill.ts         → treasury node (§11)
    verifier.ts       → DNS / .well-known domain checks; attest/revoke; daily recheck
```

### 12.3 Relayer policy (gas sponsorship rules)

Before submitting any job:

1. **Allowlisted targets only:** `PaymentRouter`, `MerchantRegistry`, `FeeTreasury.refill`. Nothing else is ever signed.
2. **Signature pre-verification** offchain (exactly the contract's checks) and `authorizationState(from, nonce) == false`.
3. **Balance pre-check:** `USDT.balanceOf(from) ≥ gross`, `isBlocked` checks.
4. **Simulation:** `simulateContract` with the exact calldata at `latest`.
5. **Gas cap:** `gasLimit ≤ 400k`, `maxFeePerGas ≤ MAX_GWEI` (e.g. 50 gwei). Refuse above.
6. **Reservation:** reserve `gasLimit × maxFee` in `gas_reservations` before sending; release on receipt.
7. **Rate limits / failure budgets** (Redis):
   - per payer: 10 payment attempts / 10 min; 3 *failed on-chain* / day → 24 h block
   - per merchant: configurable TPS; failed on-chain cost budget per day (e.g. 0.01 WBT) → auto-suspend sponsorship
   - per IP / API key on the HTTP layer
8. **Dedup:** unique DB constraint on `(paymentId)`; job key = paymentId. A second identical request returns the existing attempt (HTTP 200, same object).
9. **Nonce manager:** single writer per relayer EOA (row lock on `relayer_nonces`). It replaces stuck transactions with +12.5% fees, keeping the *same* calldata so one financial operation stays one operation.
10. **Multiple relayers:** N EOAs round-robin. Each is a refill recipient.

**Griefing note:** a payer can drain its balance or `cancelAuthorization` between our simulation and inclusion, which burns our gas. Failure budgets bound this. On 1-second blocks the window is small, but it is not zero.

### 12.4 Observer

- Scans `PaymentRouter`, `MerchantRegistry` and `FeeTreasury` logs from a durable checkpoint, in chunks of 2,000 blocks. Live mode polls every 1 s.
- Stores raw `chain_events (chainId, blockNumber, blockHash, txHash, logIndex, address, topic0, data, decoded jsonb)`.
- **Reorg handling:** keep the last 64 block hashes. On a parent-hash mismatch, roll back events above the fork point and re-project. Derived records carry `canonical` flags.
- **Finality tracker:** each tick, read the `safe` and `finalized` heads and promote events. Webhooks fire per level (the merchant chooses its fulfillment threshold).
- **Projection** (same DB transaction as the event insert): payments, invoice progress, refunds, plans, merchants, directory and journal entries, plus outbox rows.
- **Standalone mode:** `npx @paykit/observer --rpc … --from <block> --to <finalizedBlock> --out ledger.jsonl` with no DB needed. It prints the canonical ledger hash. This powers the recovery demo.

---

## 13. Database schema

Amounts are `numeric(78,0)` in base units. Times are `timestamptz`. All IDs are UUIDv7 offchain, with the `bytes32` onchain hashes stored alongside.

```sql
-- identity & access
merchants(id, merchant_id_onchain bytea unique, slug unique, owner_wallet, payout_wallet,
          name, category, description, logo_url, website, country, status, listed bool,
          max_fee_bps, metadata_hash, created_at, updated_at)
merchant_signers(merchant_id, address, kind /*self|hosted*/, encrypted_key null, expires_at, enabled, onchain_tx)
merchant_domains(merchant_id, domain, method /*dns|wellknown*/, token, status, verified_at, expires_at, attest_tx, last_checked_at)
split_profiles(merchant_id, profile_id int, recipients jsonb, bps jsonb, onchain_tx)
api_keys(id, merchant_id, kind /*publishable|secret*/, allowed_origins text[], prefix, hash, last_used_at, revoked_at)

-- catalog & commerce
products(id, merchant_id, sku, name, description, image_url, price numeric, token, active, metadata jsonb)
carts(id, merchant_id, customer_ref, items jsonb, expires_at)
invoices(id, merchant_id, invoice_id_onchain bytea unique, number, customer_email null, customer_wallet null,
         line_items jsonb, total numeric, token, status, digest bytea, due_at, valid_until,
         schedule jsonb /* deposit/parts plan */, metadata jsonb, created_at)
payment_quotes(id, invoice_id, payment_id_onchain bytea unique, part_index, gross, fee, net,
               split_profile_id, payer null, valid_until, quote_hash, merchant_sig, created_at)
payment_attempts(id, quote_id, payer, refund_to, salt, auth_sig, status, relayer, tx_nonce,
                 tx_hashes text[], error, created_at, updated_at)
payments(payment_id_onchain pk, merchant_id, invoice_key, plan_id null, payer, refund_to, token,
         gross, fee, net, refunded, kind, tx_hash, block_number, finality /*latest|safe|finalized*/, settled_at)
refunds(id, refund_id_onchain unique, payment_id_onchain, amount, fee, funder, status,
        requested_by, approved_by, terms_sig, funder_sig, tx_hash, finality, created_at)
plans(id, plan_id_onchain unique, merchant_id, payer, token, down_payment, installment_amount,
      fee_per_installment, count, period_s, first_due, grace_s, collected, status, terms_hash, created_at)
installments(plan_id, index, due_at, status /*scheduled|collected|missed*/, payment_id_onchain, tx_hash)

-- chain & ops
chain_events(chain_id, block_number, block_hash, tx_hash, log_index, address, name, decoded jsonb,
             finality, canonical bool, primary key(chain_id, tx_hash, log_index))
checkpoints(stream, chain_id, block_number, block_hash, updated_at)
gas_reservations(id, relayer, job_id, max_cost_wei, status, created_at, released_at)
relayer_nonces(relayer pk, next_nonce)
refill_runs(id, decided_at, decision /*skip|run|failed|paused*/, reason, available_wbt, deficit,
            usdt_in, quote_out, min_out, actual_out, gas_used, l1_fee, tx_hash, runway_after)

-- accounting & delivery
journal_entries(id, source_event_key, mapping_version, account, asset, debit numeric, credit numeric,
                merchant_id, created_at)
webhook_endpoints(id, app_id, url, secret_hash, events text[], active)
webhook_outbox(event_id uuid pk /*stable*/, endpoint_id, type, payload jsonb, attempts, next_attempt_at,
               last_status, delivered_at)
audit_log(id, actor, action, target, data jsonb, created_at)
```

Unique constraints are the dedupe authority: `payment_quotes.payment_id_onchain`, `refunds.refund_id_onchain`, `webhook_outbox.event_id`, and `chain_events (tx_hash, log_index)`.

---

## 14. REST API

Base: `/v1`. JSON. Amounts are decimal strings in base units. Every `POST` accepts an `Idempotency-Key` header.

### 14.1 Public (publishable key `pk_…`, browser SDK)

| Method | Path | Purpose |
|---|---|---|
| GET | `/merchants/:slug` | Public profile + onchain verification status |
| GET | `/merchants/:slug/products` | Catalog |
| POST | `/checkout/sessions` | Create a session from a cart or invoice → returns invoice, quote(s), typed data to sign |
| GET | `/checkout/sessions/:id` | Session status |
| POST | `/checkout/sessions/:id/authorize` | Submit customer signature `{payer, refundTo, salt, validAfter, validBefore, signature}` → queues relay |
| GET | `/payments/:paymentId` | Status: `pending / included / safe / finalized / failed` + tx hash |
| POST | `/plans/sessions` | Installment session → plan terms + consent and permit typed data |
| POST | `/plans/sessions/:id/authorize` | Submit consent + permit signatures |
| POST | `/plans/:planId/cancel` | Payer-signed cancel |
| GET | `/directory` | Verified, listed merchants for the shops page (filter: category, q, token) |
| GET | `/me/payments`, `/me/plans`, `/me/refunds` | Consumer dashboard data (wallet login session) |
| GET | `/status` | Sponsorship available? (admission control) |

### 14.2 Server (secret key `sk_…`, `@paykit/node`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/invoices` | Create invoice `{lineItems, total?, token, validUntil, schedule?: {depositPercent} \| {parts:[…]}, customer?}` |
| GET / PATCH | `/invoices/:id` | Read / void |
| POST | `/invoices/:id/quotes` | Create the next part quote (hosted signer) or return typed data for self-signing |
| POST | `/invoices/:id/quotes/:qid/signature` | Attach a self-signed merchant quote signature |
| POST / GET / PATCH | `/products` | Catalog CRUD |
| POST | `/refunds` | Request a refund `{paymentId, amount, reason}` → returns RefundTerms + funder typed data |
| POST | `/refunds/:id/signatures` | Attach merchant + funder signatures → queue |
| POST | `/plans` | Create plan terms (merchant side) |
| GET | `/payments?status=&invoice=&from=&to=` | List (pending, settled, all). Merchant components call this through the merchant's backend route or a wallet session |
| GET | `/exports/journal.csv?from=&to=&mappingVersion=` | Accounting export |
| POST | `/webhook-endpoints` | Register endpoint |

### 14.3 Dashboards (SIWE session)

`/auth/siwe/nonce`, `/auth/siwe/verify`, `/portal/merchants` (register → typed data), `/portal/merchants/:id/domains` (start/check), `/portal/merchants/:id/signers`, `/portal/merchants/:id/splits`, `/portal/merchants/:id/keys`, `/portal/ops/treasury` (refill runs, runway).

### 14.4 Error codes

`amount_too_small`, `quote_expired`, `invoice_overpaid`, `merchant_inactive`, `merchant_unverified` (warning), `sponsorship_paused`, `rate_limited`, `insufficient_usdt`, `address_blocked`, `signature_invalid`, `already_settled`, `refund_exceeds_payment`, `allowance_insufficient`.

---

## 15. Webhooks

- Header: `PayKit-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`. Reject if more than 5 minutes old.
- `event.id` is **stable** (UUIDv5 of `chainId:txHash:logIndex:finality`). Consumers dedupe on it.
- At-least-once delivery. Retries at 10 s, 1 min, 5 min, 30 min, 2 h, 6 h, then `failed`, with a manual "resend" in the merchant dashboard. (The research advised one retry path; that is satisfied by a single outbox worker with this schedule.)

| Event | Fired when |
|---|---|
| `invoice.created`, `invoice.expired`, `invoice.voided` | Offchain |
| `payment.pending` | Signature accepted and queued |
| `payment.confirmed` | Included at `latest` |
| `payment.safe`, `payment.finalized` | Finality promotion |
| `payment.failed` | Reverted / expired / policy-rejected |
| `invoice.partially_paid`, `invoice.paid` | Projection after payment |
| `refund.pending`, `refund.succeeded`, `refund.failed` | |
| `plan.created`, `plan.installment_collected`, `plan.installment_missed`, `plan.cancelled`, `plan.completed` | |
| `merchant.domain_verified`, `merchant.domain_revoked` | |

`@paykit/node` exports `verifyWebhook(rawBody, header, secret)`, and `@paykit/next` exports `createWebhookHandler({ secret, on: { 'payment.finalized': fn } })`.

---

## 16. SDK packages (npm)

### 16.1 Packages

| Package | Runs in | Contents |
|---|---|---|
| `@paykit/core` | Anywhere | Chain configs (1874/1875), token metadata, ABIs, contract addresses per version, EIP-712 type builders, ID/nonce derivation, amount utils (`parseUsdt('10.5') → 10500000n`), Zod schemas, error types |
| `@paykit/js` | Browser | `PayKitClient` (publishable key): checkout sessions, signing flows given any EIP-1193 provider or viem `WalletClient`, chain switching, status polling or SSE |
| `@paykit/react` | React 18/19 | Provider, components, hooks, theming. Wallet adapters: `thirdwebAdapter`, `wagmiAdapter`, `eip1193Adapter` |
| `@paykit/node` | Node server | `PayKit` (secret key): invoices, quotes, refunds, plans, products, exports, `verifyWebhook`, **local quote signing** with the merchant signer key |
| `@paykit/next` | Next.js 15 App Router | Route handlers (`webhooks`, `checkout` proxy), server actions, `<PayKitProvider>` with RSC-safe config |
| `@paykit/contracts` | Anywhere | ABIs, typed addresses, deployment JSON |
| `@paykit/observer` | CLI | Standalone ledger rebuild (§20) |

Build: `tsup` (ESM + CJS + d.ts) with `changesets` for versions. No publishing during the hackathon unless the team explicitly decides to.

### 16.2 Component library (logic in npm, UI copy-paste)

**Rule: logic in npm, UI copy-paste.** Everything that touches money lives in the npm packages as **hooks**, so a bug fix ships as a version bump: signing, IDs, nonces, API calls and status tracking. The visual components are thin layers over those hooks. Developers either import them from `@paykit/react` or copy their source into their own project and restyle them freely, the way React Bits and shadcn/ui work:

```bash
npx shadcn@latest add https://<our-site>/r/checkout.json   # copies UI source; installs @paykit/react for the hooks
```

**Dogfooding rule:** every page on our own website (§19) is built only from these components. If our site needs something, it becomes a component first. That makes the website itself the proof that the library works.

#### Consumer components (safe in the browser with the publishable key)

| Component | Hook | Used on |
|---|---|---|
| `<PayKitProvider publishableKey chain wallet theme>` | `usePayKit()` | Every page |
| `<ConnectWallet />` | `useWallet()` | Every page |
| `<MerchantGrid />`, `<MerchantCard />` | `useMerchants(filter)` | Shops page |
| `<MerchantModal merchantId />` (profile, verified domain, products, pay) | `useMerchant(id)` | Shops page |
| `<MerchantBadge merchant />` (verified domain + payout; warns on hostname mismatch) | `useMerchant(id)` | Shops modal, checkout |
| `<ProductGrid merchant />`, `<ProductCard />` | `useProducts(merchant)` | Shops modal, merchant sites |
| `<Cart />` | `useCart()` | Shops modal, merchant sites |
| `<CheckoutButton cart \| invoiceId />`, `<Checkout />` | `useCheckout()` | Shops modal, invoice page |
| `<DepositPicker total percentOptions />` | `useCheckout()` | Pay in parts (type 2) |
| `<InstallmentPlanPicker total options />` | `usePlanCheckout()` | Installments (type 3) |
| `<InvoiceView invoiceId />` (paid / remaining, pay next part) | `useInvoice(id)` | Invoice page |
| `<PaymentStatus paymentId />` | `usePayment(id)` | Checkout, dashboards |
| `<ReceiptView paymentId />` | `usePayment(id)` | User dashboard |
| `<PaymentHistory />`, `<UpcomingPayments />`, `<PlanList />` (with cancel), `<RefundList />` | `useMyPayments()`, `useMyPlans()` | User dashboard |

#### Merchant components (private data: need proof of the merchant wallet)

| Component | Hook | Used on |
|---|---|---|
| `<MerchantSignup />` (business details, payout proof, gasless registration, domain check) | `useMerchantSignup()` | Merchant dashboard |
| `<SalesSummary />` (gross / fee / net / refunds) | `useMerchantStats()` | Merchant dashboard |
| `<PaymentsTable status="pending\|settled\|all" />` | `useMerchantPayments()` | Merchant dashboard |
| `<RefundButton paymentId />`, `<RefundsTable />` | `useRefund()` | Merchant dashboard |
| `<PlansTable />` (active, delinquent, upcoming collections) | `useMerchantPlans()` | Merchant dashboard |
| `<InvoiceCreator />` (incl. deposit %) | `useCreateInvoice()` | Merchant dashboard |
| `<ProductManager />` | `useProductAdmin()` | Merchant dashboard |
| `<ApiKeys />`, `<WebhookSettings />`, `<DomainSettings />`, `<PayoutSettings />` | matching hooks | Merchant dashboard |

**How merchant components fetch data.** They look the merchant up by its **wallet address**, and the wallet must **prove** it owns that address before private data loads. A bare address in a request is never enough, because anyone can type any address.

- **On our website:** the merchant connects its wallet and signs a one-time login message (SIWE). The server checks the signature, confirms that address is the merchant's owner wallet in `MerchantRegistry`, and issues a session cookie. Every merchant component then fetches with that session.
- **On a developer's own website:** the same components get data through the developer's backend, using a small route from `@paykit/next` that holds the secret key: `<PayKitProvider merchantDataUrl="/api/paykit">`. The secret key never reaches the browser.
- **Consumer components** work the same way for private details: payments are found by the consumer's wallet address, and line items need a wallet login. Bare amounts are public onchain anyway.
- **Scope:** on our website, `useMyPayments()` returns the user's payments to **all** merchants. On a merchant's own site, the publishable key limits it to **that merchant**.

### 16.3 The integration a merchant's site needs

`packages/README.md` contains the maintained, runnable API examples. `examples/next-store` compiles an App Router integration against the built packages. A merchant keeps their own catalogue and order system:

1. Its backend calls `paykit.checkout.createSession({ externalOrderId, lineItems })` with server-derived prices. The same order reference gives safe retries.
2. Its frontend mounts `PayKitProvider` with the publishable key and API URL, then `CheckoutButton input={{ sessionId }} amount={displayedBaseUnitTotal}`.
3. Its webhook route uses `createWebhookHandler` and fulfills orders transactionally from verified `payment.finalized` events, deduplicating event/payment identifiers.

Custom UI uses the same hooks without importing the default stylesheet. Actual wallet adapters are `fromEip1193`, `fromWalletClient` and `fromSignerLike`; the provider prop is `network`.

A typical integration is about 20–30 lines around existing order and fulfillment logic. Count the webhook handler, environment settings and one-time merchant configuration honestly. Running the payment service is an operator responsibility.

Implementation note: v0.1 currently ships ESM packages and a single-process transactional SQLite store. Postgres scale-out and CJS distribution require separate validation before they are advertised. This does not change the payment rules or onchain specification above.

---

## 17. Wallet connection (MetaMask, any wallet, thirdweb)

### 17.1 Decision

- **Primary UI: thirdweb v5 `ConnectButton`** with a custom chain:
  ```ts
  import { defineChain } from 'thirdweb/chains';
  export const whitechainTestnet = defineChain({
    id: 1874, name: 'Whitechain Sepolia', rpc: 'https://rpc.testnet.whitechain.io',
    nativeCurrency: { name: 'WhiteBIT Coin', symbol: 'WBT', decimals: 18 },
    blockExplorers: [{ name: 'Whitechain Explorer', url: 'https://explorer.testnet.whitechain.io' }],
    testnet: true,
  });
  ```
  Wallets: `io.metamask`, `com.coinbase.wallet`, `io.rabby`, `walletConnect()`, plus `inAppWallet({ auth: { options: ['email','passkey','google'] } })` **only if gate G1 passes**.
- **SDK core stays wallet-agnostic.** It needs only `signTypedData`, `getAddress` and `switchChain`. Adapters exist for thirdweb (`Account`), wagmi (`WalletClient`; already installed with RainbowKit) and raw EIP-1193.
- **Fallback embedded signer:** Privy (documented custom-chain support), if the thirdweb in-app wallet fails G1.

### 17.2 Practical details

- MetaMask's `eth_signTypedData_v4` requires the wallet's active chain to equal the domain's `chainId`. The SDK calls `wallet_switchEthereumChain(0x752)` and falls back to `wallet_addEthereumChain` with the params above before requesting a signature. (1874 = `0x752`; 1875 = `0x753`.)
- Signing is gasless for every wallet, so the customer never needs WBT. With an external wallet the user still *sees* a network switch and a typed-data popup. That is acceptable for the Operate track but does not meet Scale's "zero visible crypto steps". **Scale requires the embedded path (G1).**
- **Never** use a server-held key pretending to be the user's wallet.
- First-time USDT funding (faucet/swap) is outside our flow. The demo uses pre-funded test wallets, and the docs point to YetiTrade for getting testnet USDT.

---

## 18. Merchant sign-up and verification

### 18.1 Sign-up flow (first screen of `/merchant` for an unregistered wallet)

1. **Sign in with wallet** (SIWE) using the owner wallet: MetaMask, thirdweb or a Safe through WalletConnect.
2. **Business details:** name, slug, category, description, logo, website domain, country (display only), support email.
3. **Payout wallet:** defaults to the owner. If different, the payout wallet must **sign a proof-of-control message** (EIP-191: `PayKit payout verification: merchant <slug>, payout <addr>, nonce <n>`). This prevents typos and stops anyone from claiming another party's address.
4. **Fee consent:** shows the current fee schedule; the merchant sets `maxFeeBps` (default 300).
5. **Register onchain (gasless):** the owner signs `RegisterMerchant` typed data and our relayer submits `registerWithSig`. The UI shows the tx and the merchantId.
6. **Quote signer setup.** Choose one:
   - **Self-hosted signer (recommended):** the dashboard generates nothing. The merchant runs `npx @paykit/node keygen` on its server, pastes the *address*, and the owner signs `SetSigner`.
   - **Hosted signer (fast start):** we generate a key and encrypt it at rest, and the owner signs `SetSigner` with an expiry (e.g. 90 days). Disclosure: "PayKit can create quotes for you. Funds still go only to your registered payout and split profiles."
7. **Domain verification.** Choose a method:
   - **DNS TXT:** `_paykit.<domain>  TXT  "paykit-verify=<merchantIdHex>:<token>"`
   - **Well-known file:** `https://<domain>/.well-known/paykit.json`
     ```json
     { "merchantId": "0x…", "payout": "0x…", "signers": ["0x…"], "token": "<random>", "ownerSignature": "0x…" }
     ```
     `ownerSignature` signs the JSON (minus itself) with the owner key, so the file cannot be forged by a CDN mistake alone.
   - The verifier checks over HTTPS (no redirects to other hosts) and DNS over HTTPS from two resolvers. On success it calls `attestDomain(merchantId, keccak(domain), now + 30d)`. A daily recheck auto-renews or revokes.
8. **Split profiles (optional):** add recipients and percentages; the owner signs `SetSplitProfile`.
9. **Shops listing:** opt in to appear on the shops page (requires a verified domain).

### 18.2 Integration setup (inside the merchant dashboard)

- **API keys** (`pk_test_…` shown always, `sk_test_…` shown once) → **allowed origins** for `pk` → **webhook endpoints** + "send test event" → **quickstart** page with copy-paste snippets prefilled with keys → **logs** (requests, webhook deliveries, relays).

### 18.3 Merchant dashboard sections

Overview (gross/net/fees/refunds today, sponsorship status) · Products · Invoices (create, deposit/parts, share link) · Payments (filters, explorer links, finality) · Refunds (request → approve → sign) · Plans (active/delinquent/cancelled, upcoming collections) · Payouts & splits · Domains · Server key · API keys · Webhooks · Exports (journal CSV, mapping version) · Settings.

### 18.4 Platform console (internal)

Relayer balances and runway gauges · gas reservations · refill runs (SKIP/RUN/FAILED with reasons) · failure budgets per merchant/payer · fee schedule · pause switch · domain verification queue.

---

## 19. Website pages

One Next.js app (`apps/web`) built **only** from our own components (§16.2). Every page is also a live example in the docs.

| Page | Route | Who | What it shows | Built from |
|---|---|---|---|---|
| **Home / landing** | `/` | Everyone | What PayKit is, the "no gas needed" pitch, a live working checkout demo, and links to shops, docs and merchant sign-up | `<CheckoutButton>` live demo |
| **Shops** | `/shops` | Everyone | Grid of verified merchants (search, category). **Clicking a shop opens a modal** (no separate shop page) with profile, verified domain + payout, products, cart and pay | `<MerchantGrid>`, `<MerchantModal>`, `<MerchantBadge>`, `<ProductGrid>`, `<Cart>`, `<CheckoutButton>` |
| **User dashboard** | `/me` | Consumer (wallet login) | Past payments, pending payments, upcoming installments (with cancel), refunds received, receipts | `<PaymentHistory>`, `<UpcomingPayments>`, `<PlanList>`, `<RefundList>`, `<ReceiptView>` |
| **Merchant dashboard** | `/merchant` | Merchant (owner-wallet login) | **Sign-up first** if the wallet isn't registered yet. Then: sales summary, pending and past payments, refunds, installment plans, invoices, products, API keys, webhooks, domain and payout settings | `<MerchantSignup>`, `<SalesSummary>`, `<PaymentsTable>`, `<RefundButton>`, `<PlansTable>`, `<InvoiceCreator>`, `<ProductManager>`, settings components |
| **Docs** | `/docs` | Developers | React Bits–style: one page per component with a **live preview**, a **copy code** tab, the install command (npm or shadcn CLI), setup steps, a props table and a "needs" note (publishable key, or backend route for merchant components). Plus quickstart, API reference and webhooks | Every component |
| **Invoice payment** | `/pay/:invoiceId` | Consumer | An invoice sent as a link (needed for pay-in-parts and installments) | `<InvoiceView>`, `<Checkout>`, `<PaymentStatus>` |
| Platform console | `/admin` (hidden) | Platform | Relay node balance, runway, refill runs, pause switch, domain-verification queue | Internal |

**Docs page layout (per component):**

1. Title + one-line description
2. Live preview (connected to testnet with a demo merchant)
3. Tabs: **Preview · Code · Props**
4. Install: `npm i @paykit/react` **or** `npx shadcn@latest add <url>`
5. Setup: required provider props and env vars
6. "Needs": publishable key only, or merchant backend route / wallet login
7. Variants and theming examples

### 19.1 Later (not in this build)

- **QR payments:** scan-to-pay, static merchant QR codes, a QR renderer component and an installable mobile app (PWA). The `/pay/:invoiceId` link is designed so a QR code can simply encode it later.

---

## 20. Observer, reconciliation and recovery

### 20.1 Journal mapping v1 (versioned; published in the docs)

Per `PaymentSettled` (merchant books):

| Account | Debit | Credit |
|---|---|---|
| `merchant:usdt_wallet` | net | |
| `merchant:fees_expense` | fee | |
| `merchant:sales_clearing` (invoice) | | gross |

Per `RefundSettled`: Dr `merchant:refunds` (amount) / Cr `merchant:usdt_wallet` (amount + fee); Dr `merchant:fees_expense` (fee).

Operator books: `PaymentSettled` → Dr `op:treasury_usdt` / Cr `op:fee_revenue` (fee). Each relayed tx → Dr `op:gas_expense` / Cr `op:relayer_wbt` (`gasUsed × effectiveGasPrice + l1Fee`, read from the receipt). `Refill` → Dr `op:relayer_wbt` / Cr `op:treasury_usdt` (at execution price).

Revenue recognition and tax are merchant-specific. They are **not** encoded.

### 20.2 Deterministic ledger hash

`ledgerHash = keccak256(concat(sorted by (blockNumber, logIndex) of canonical JSON lines))` over a **pinned finalized block range** and **mapping version**. Two independent observers (our server and the standalone CLI) must output the same hash.

### 20.3 What recovery can and cannot restore

- **Can:** every payment, refund, plan, split and fee: IDs, amounts, parties and quote commitments.
- **Cannot:** customer names, line items or invoice PDFs (only digests are onchain), webhook secrets or API keys. These come from the encrypted DB backup. The demo **shows the join explicitly**: "settlement from chain + invoice detail from backup".

---

## 21. Security model and threat table

| Threat | Mitigation |
|---|---|
| Relayer or front-runner changes payout/amount | Payout and splits come from the registry. The amount and every quote field are hashed into the 3009 nonce the payer signed. `receiveWithAuthorization` requires `msg.sender == router` |
| Replay of a payment | `paymentId` single-use onchain; 3009 nonce single-use in USDT |
| Overpaying an invoice | `paid + gross ≤ total` onchain; total frozen on first payment |
| Compromised merchant quote signer | Cannot change payout/splits; signer has an expiry; owner revokes; fee ≤ `maxFeeBps`. Worst case: creates bogus invoices that customers would still have to sign |
| Compromised merchant frontend (phishing) | SDK `MerchantBadge` checks the attested domain vs `location.hostname`; the shops page and modal show verified status; the payer sees the merchant name and amount |
| Fake merchant impersonating a brand | Domain attestation required for the badge and listing; manual review for directory listing; admin suspension |
| Malicious payer griefing relayer gas | Simulation, balance checks, per-payer/merchant failure budgets, rate limits |
| Permit front-running (installments) | `try/catch` around permit + allowance check |
| Allowance overwrite across plans | `committed[payer]` accounting; SDK requests permit for `committed + total` |
| Refund to the wrong address | Refund goes only to `payment.refundTo`, committed in the payer's nonce |
| Refunds exceeding payment | Cumulative cap per payment |
| Treasury drained via a manipulated pool | Admin price floor `minWbtPerUsdt`, per-run and daily caps, relay-node-only caller and recipient, short deadline |
| Reentrancy | `nonReentrant`; USDT is a known non-hook token; checks-effects-interactions |
| USDT blocklist | Pre-checks; a blocked recipient makes `pay` revert (no partial state) |
| Admin abuse | Cannot touch merchant funds (router balance 0); fee changes evented; merchant cap; pause cannot block refunds or cancels |
| Lost observer DB | Standalone rebuild from finalized events + encrypted backup |
| Key leakage | Keys only in env/KMS; never logged; hosted signer keys encrypted; no customer keys anywhere |
| Chain reorg | Observer rollback; finality-based fulfillment; webhook per finality level |
| Server says "paid" falsely | Merchants can verify against chain (`payments(paymentId)` view or the observer CLI) |

**No audit.** The submission must say so.

---

## 22. Testing strategy

### 22.1 Contracts (Foundry)

- **Unit:** every function's happy path and every custom error.
- **Mock USDT:** a local `MockUSDT3009` that implements EIP-3009 + permit + blocklist exactly like TetherTokenV2 (verify the typehashes against the saved ABI constants).
- **Fuzz:** amounts, split bps, partial-payment sequences, refund sequences.
- **Invariants (stateful):**
  - `router USDT balance == 0` after every call
  - for each invoice, `paid ≤ total` and `refunded ≤ paid`
  - for each payment, `refunded ≤ gross`
  - `Σ split amounts + fee == gross` per payment
  - `committed[payer] == Σ remaining(active plans of payer)`
  - treasury `spentToday ≤ maxUsdtPerDay`
- **Fork tests** against `https://rpc.testnet.whitechain.io` (`forge test --fork-url`) using the **real USDT** with real 3009 signatures from a test key, plus a real SwapRouter02 multicall with unwrap. This retires gates G2 and G4 before broadcasting anything.
- **Gas report** (`forge test --gas-report`) feeds the fee floor (§10).

### 22.2 Cross-language signature vectors

A JSON file of fixed inputs → expected `quoteHash`, `nonce`, digest. Tested in Foundry (`vm.readFile`) **and** in `@paykit/core` (Vitest). This guarantees that the SDK and the contract hash identically.

### 22.3 Server

Vitest + Testcontainers (Postgres/Redis) or the existing compose services. Covers: idempotency (the same request twice gives one attempt), relayer nonce replacement, observer reorg simulation on Anvil (`anvil_reorg`), webhook signature and retry, refill decision table (SKIP/RUN/PAUSE cases with fixed quotes).

### 22.4 End-to-end

Playwright on the website and the demo store: connect a MetaMask test wallet (or a thirdweb in-app wallet) → buy → see `payment.finalized` webhook → refund. Also run a manual real-user pass on the testnet before recording.

---

## 23. Repository layout

The current base is `web/` (Vite), `contracts/` (Hardhat + Foundry) and `backend/` (FastAPI) with npm workspaces. The target layout:

```
C:\EthGlobal_Mumbai\
  plan.md                         ← this file
  package.json                    ← npm workspaces: packages/*, apps/*, contracts
  contracts/                      ← Foundry-first (foundry.toml exists), Hardhat kept for Ignition deploys
    src/ MerchantRegistry.sol PaymentRouter.sol FeeTreasury.sol libraries/ interfaces/
    test/ unit/ invariant/ fork/ vectors.json
    script/ Deploy.s.sol Configure.s.sol
    deployments/1874.json
  packages/
    core/  js/  react/  node/  next/  contracts-abi/  observer/
  apps/
    server/                       ← Hono API + workers (§12)
    web/                          ← Next.js: landing, shops, /me, /merchant, /docs, /pay/:id, /admin (§19), built only from @paykit/react
    demo-store/                   ← tiny separate shop using @paykit/* (proves the SDK outside our site)
  registry/                       ← shadcn-style JSON for copy-paste components (served at /r/*.json)
  docs/
    sdk.md  api.md  contracts.md  webhooks.md  journal-mapping-v1.md  WHITECHAIN_FEEDBACK.md
  research/                       ← unchanged
  backend/                        ← existing FastAPI scaffold; retire or keep for scripts
```

---

## 24. Configuration and environment

```dotenv
# chain
CHAIN_ID=1874
RPC_URL=https://rpc.testnet.whitechain.io
EXPLORER_API=https://explorer.testnet.whitechain.io/api/v2
USDT_ADDRESS=0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7
WWBT_ADDRESS=0x4200000000000000000000000000000000000006
SWAP_ROUTER02=0xe208cC685cD95D56E8ec6DEC9816476567fc6962
QUOTER_V2=0x90f28c3a6233713d6Df00E5fa92a3f13EFe36191
POOL_FEE=3000
REGISTRY_ADDRESS=            # after deploy
ROUTER_ADDRESS=              # after deploy
TREASURY_ADDRESS=            # after deploy
DEPLOY_BLOCK=                # observer start

# server
DATABASE_URL=postgres://hackathon@127.0.0.1:5432/hackathon
REDIS_URL=redis://127.0.0.1:6379
MASTER_KEY=                  # encrypts hosted signer keys (never commit)
RELAYER_KEYS=                # relay node wallet(s), testnet only (never commit)
PLATFORM_ADMIN_KEY=          # owner of the contracts; also signs domain verifications
REFILL_INTERVAL_MIN=30
RESERVE_WBT=0.02
MIN_BATCH_USDT=1

# frontend (public)
NEXT_PUBLIC_THIRDWEB_CLIENT_ID=
NEXT_PUBLIC_PAYKIT_PK=
```

Use separate testnet-only keys. Nothing is committed. `.env.example` lists names only.

---

## 25. Build order, priorities and cut lines

The event ends 7 November. Time is the binding constraint. Build in this order, and **do not start a later block until the gate before it passes.** P0 alone is a complete, demoable submission.

### Phase 0 — Gates first (≈2 h)

| Gate | Test | If it fails |
|---|---|---|
| **G1** Embedded signing | thirdweb in-app wallet signs USDT `ReceiveWithAuthorization` typed data on 1874, and the signature verifies against the real `DOMAIN_SEPARATOR` | Try Privy. If that fails too, external wallets only and claim **Operate only** |
| **G2** Real 3009 settlement | Fork test: router pulls real USDT via `receiveWithAuthorization` with a committed nonce | Stop and fix before anything else |
| **G3** Gas measurement | Forge gas report + one testnet tx for `pay` | Sets the fee floor |
| **G4** Swap + unwrap | Fork test of `multicall(exactInputSingle → unwrapWETH9 to EOA)` | Use the fallback treasury withdraw path |

### Phase 1 — P0 core (≈10–12 h)

1. Contracts: `MerchantRegistry` (register/withSig, signers, payout, domain attest, split profiles), `PaymentRouter.pay` + `refund` + pause, `FeeTreasury.refill` + limits. Tests and invariants. **Deploy and verify on 1874.**
2. `@paykit/core` (types, hashing, vectors) → `@paykit/node` (invoices, quotes, refunds, webhook verify) → `@paykit/js` → `@paykit/react` (`Provider`, `ProductGrid`, `Cart`, `CheckoutButton`, `Checkout`, `PaymentStatus`, `MerchantBadge`, `DepositPicker`).
3. Server: invoices, quotes, checkout sessions, relayer (policy + nonce manager), observer (events, finality, projections), webhooks outbox, verifier (`.well-known` + DNS), refill worker.
4. Website from the components: landing, shops + modal, merchant dashboard (sign-up, domain verify, hosted signer, products, invoices, pending/past payments, refunds, API keys, webhooks), docs for the P0 components, platform console.
5. Tiny demo store using only the SDK.
6. Real testnet run: nonzero payment, partial payment, split, partial refund, one SKIP and one real refill. Save tx hashes.

### Phase 2 — P1 (≈5–6 h, in this order)

1. Installments: `createPlan` / `collectInstallment` / `markDelinquent` / `cancelPlan`, scheduler worker, `<InstallmentPlanPicker>`, a plans page. (Demo with `period = 2 min`.)
2. User dashboard: past, pending and upcoming payments, refunds, receipts, plan cancel.
3. Standalone observer CLI + ledger hash + journal CSV export.
4. Docs pages for the remaining components + shadcn registry.

### Phase 3 — P2 / stretch (only if time remains)

QR payments and PWA, customer surcharge mode, Safe merchant (ERC-1271) test, multi-relayer failover, escrow module, x402 adapter, wagmi adapter polish.

### Cut line if behind schedule

Cut in this order: docs polish (keep preview + code for the main components) → user dashboard (keep payment history only) → installments (keep the contract code; demo types 1, 2 and 4). **Never cut:** the real testnet payment, refund cap, duplicate rejection, refill SKIP/RUN, and the honest feedback file.

### Team split (if 3–4 people)

| Person | Owns |
|---|---|
| A | Contracts, fork tests, deployment, verification |
| B | Server: relayer, observer, refill, verifier |
| C | SDK packages + demo store |
| D | Website pages + docs + video |

---

## 26. Demo script (3 minutes)

Pre-record the transactions. For finality, use an earlier finalized payment, since finality can take longer than the video.

1. **0:00–0:25 — Merchant integration:** show the ~20-line Next.js integration (provider + `CheckoutButton` + webhook handler). Show the merchant registered with a **verified domain** and payout.
2. **0:25–0:55 — Customer:** a wallet with **0 WBT** buys from the demo store. One signature. The status goes pending → confirmed. The merchant dashboard shows gross / fee / net and the split (90/10) with the explorer link.
3. **0:55–1:20 — Robustness:** replay the same request and get no second charge. A tampered relay (payout changed) reverts onchain. A 30% deposit invoice is paid, then the remaining 70%. An overpay attempt reverts.
4. **1:20–1:40 — Refund:** partial refund. The cumulative cap updates. A second refund beyond the cap is rejected.
5. **1:40–2:00 — Installments (if P1 done):** a 3 × 2-minute plan. The first installment is collected by the scheduler. The customer cancels from the user dashboard.
6. **2:00–2:30 — Treasury node:** a 0.01 USDT batch is shown as **SKIP — cost 3× output**. Then, at threshold, a **real swap + unwrap**: relayer WBT before and after, and the runway gauge.
7. **2:30–2:50 — Recovery:** kill the observer DB. The standalone CLI rebuilds the ledger over a pinned finalized range and produces the **same ledger hash**. Invoice details rejoin from the backup.
8. **2:50–3:00 — Website:** open the docs, copy a component, and point out that every page on our site is built from it. Close with the limitations slide.

---

## 27. Sponsor tracks and submission checklist

**What the prize page actually asks (checked 6 Nov 2026, ethglobal.com/events/mumbai/prizes/whitechain):**

- **Operate: Stablecoin Payments for Business ($5,000, our main track).** "A drop-in piece (widget, SDK, API, or plugin) that a separate demo app can add in about 20 lines, plus merchant and customer views." Extra credit: "flows that go beyond the first payment, such as refunds, renewals, or accountant exports." Won't place: plain-transfer pay buttons, tipping jars, bill splitters, or *standalone* payroll, escrow or revenue splits. Our splits are only an option on top of checkout, so they're fine.
- **Scale: Payments Nobody Notices ($3,000, second track).** Payers "whether people or AI agents" pay "with no visible crypto steps, no WBT for gas, and no seed phrase". The entry must explain "how the business pays gas, how the relayer gets WBT, and what stops someone draining it". Won't place: the payer signing a gas-costing transaction.
- **All tracks:** verified contracts on 1874, a real payment in USDT `0xcedf…55a7` with the explorer link, a README line on why onchain stablecoin settlement is needed, steady public commits, a 2–4 min video showing each party, and `WHITECHAIN_FEEDBACK.md`.
- Tokenize and Continuity are out of scope.

How the SDK answers each line is in `packages/README.md` ("How this maps to the Whitechain tracks").

| Track | Fit | Requirement for us |
|---|---|---|
| **Whitechain — Operate** | **Primary.** Reconciliation, refunds and business payment ops are the sponsor's named gap | Complete merchant lifecycle in an app that integrates the SDK |
| **Whitechain — Scale** | Secondary, **only if G1 passes** | Zero visible crypto steps for the payer (embedded wallet, no network switch, no gas), plus visible sponsorship economics and abuse controls |
| Uniswap (YetiTrade V3 integration) | Unverified. Ask at the booth first | Substantive SwapRouter02/QuoterV2 integration in `FeeTreasury`; required feedback |
| thirdweb | Only if they have a prize and the in-app wallet works on 1874 | Real usage of the Connect SDK |

**Submission must include:**

- [ ] Verified contracts on 1874 (registry, router, treasury) with addresses in the README
- [ ] A real nonzero payment in USDT `0xcedf…55a7`, with the explorer link
- [ ] Partial payment, split, refund and refill transaction links
- [ ] Demo video (≤ 3 min) and live demo URL (only when the team decides to deploy)
- [ ] `docs/WHITECHAIN_FEEDBACK.md` (honest developer experience: Reown limitation, two USDT tokens, missing bundlers, etc.)
- [ ] Limitations section (no audit, testnet prices, permanent WBT float, trust in our domain verification, hosted signer trust)
- [ ] Disclosure of reused boilerplate (Vite/Hardhat starters) per ETHGlobal rules
- [ ] Clean git history showing progress during the event

---

## 28. Claims we must not make

- ❌ "First / only / unique gasless checkout on Whitechain." WhitePay, Inferit and others exist.
- ❌ "Self-funding" or "zero operator cost." The WBT float is permanent working capital.
- ❌ "The fee exactly covers gas." It is a bounded quote; actual cost is measured and recorded.
- ❌ "Rebuilds the full books from chain." Correct: rebuilds the **settlement ledger**; invoice detail comes from backup.
- ❌ "Instant finality." Status is RPC-observed and labeled.
- ❌ "Trustless domain verification." The platform verifies domains as a trusted party, and we disclose it.
- ❌ "Works with any embedded wallet." It works with only those verified in G1.
- ❌ "Compatible with mainnet USDT" before the permit path is tested against v1 Tether.
- ❌ "Audited."

---

## 29. Open questions and gates

| # | Question | How we resolve it |
|---|---|---|
| Q1 | Does the thirdweb in-app wallet sign valid EIP-712 on 1874? | Gate G1 |
| Q2 | Exact gas of `pay`, `refund`, `collectInstallment`, `refill` | Gate G3 |
| Q3 | Does deployed SwapRouter02 support `unwrapWETH9(uint256,address)` and `ADDRESS_THIS`? | Gate G4 (fork test) |
| Q4 | Is the OP `GasPriceOracle` predeploy at `0x420…000F` live for L1 fee estimates? | `eth_getCode` + call |
| Q5 | Does the Uniswap prize accept a YetiTrade fork integration? | Ask at the booth |
| Q6 | Does the sponsor want agents (Scale) or merchants (Operate) emphasized? | Ask at the booth |
| Q7 | Fee floor final value | From Q2 + current pool price |
| Q8 | Project name and domain | Team decision; check npm/GitHub |
| Q9 | Should a Safe hold protocol admin on testnet? | If time allows; otherwise disclose the EOA |
| Q10 | Mainnet path: v1 USDT permit-only | Post-hackathon: `payWithPermit` entry point (permit + `transferFrom` + signed payer consent) |

---

## 30. Glossary

- **EIP-3009** — token standard for signed transfers (`transferWithAuthorization`, `receiveWithAuthorization`). The signer authorizes a one-time transfer with a random nonce; anyone (here, only the `to` contract) submits it.
- **EIP-2612 permit** — signed approval. It sets an allowance without a transaction from the owner.
- **EIP-712** — typed structured-data signing; what the wallet popup shows.
- **ERC-1271** — signature validation for smart-contract wallets (e.g. Safe).
- **Relayer** — our server key that submits signed transactions and pays WBT gas.
- **Quote** — the merchant-signed terms of one payment (amount, fee, invoice, split profile, expiry).
- **Split profile** — onchain percentage distribution of a merchant's net proceeds.
- **Attestation** — onchain record by our verifier that a merchant controls a domain.
- **Runway** — how many payments the relayer can still sponsor at the measured average gas.
- **Finality levels** — `latest` (included), `safe`, `finalized`, as reported by the Whitechain RPC.
- **WWBT** — ERC-20 wrapped WBT used by YetiTrade pools; unwrapped to native WBT for gas.
