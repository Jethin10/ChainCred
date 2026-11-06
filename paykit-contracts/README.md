# PayKit contracts

Hardhat 2 + ethers v6. Target: Whitechain Sepolia (chain 1874), testnet USDT `0xcedf…55a7`.

| Contract | What it does |
|---|---|
| `MerchantRegistry` | Merchants, payout wallet (with optional delay), quote signers, split profiles, domain attestations. Every owner action also has a gasless `…WithSig` version |
| `PaymentRouter` | `pay` (pay now / pay in parts), `refund`, `createPlan` / `collectInstallment` / `markDelinquent` / `cancelPlan`. Keeps zero balance; reverts if it ever doesn't |
| `FeeTreasury` | Holds USDT fees; `refill` swaps a capped amount to native WBT for a whitelisted relayer, above an admin price floor |
| `mocks/*` | `MockUSDT3009` (permit + EIP-3009 + blocklist, same EIP-712 domain as Tether), `MockWWBT`, `MockSwapRouter02` — local tests only |

`scripts/lib/typedData.js` holds every EIP-712 type and ID helper. The server and SDK should import it instead of redefining the types.

## Setup

```bash
cd paykit-contracts
npm install
cp .env.example .env        # Windows: copy .env.example .env
npx hardhat compile
npx hardhat test
```

For a gas report: `REPORT_GAS=1 npx hardhat test` (PowerShell: `$env:REPORT_GAS=1; npx hardhat test`).

## Deploy to Whitechain Sepolia

1. Put a **new, testnet-only** private key in `PLATFORM_ADMIN_KEY` and fund it with a little WBT.
2. `npm run preflight` — read-only: checks chain id, deployer balance, the real USDT's name/decimals/`DOMAIN_SEPARATOR`, that WWBT / SwapRouter02 / QuoterV2 / the pool have code, and compares your price floor to a live quote.
3. `npm run deploy:testnet` — deploys Registry → Treasury → Router, allows USDT, sets the fee schedule and refill limits, whitelists relayers. Writes `deployments/1874.json` and prints the addresses for the server `.env`.
4. `npm run verify:testnet` — verifies all three on Blockscout.

Local dry run (deploys mocks too): `npm run deploy:local`.

## Differences from plan.md (deliberate)

- **Onchain ids are scoped by merchant.** The quote's `paymentId` and the plan's `planId` are merchant-local. The router stores `paymentKeyOf(merchantId, paymentId)` and `planKeyOf(merchantId, planId)`, and installments use `installmentPaymentId(planKey, index)`, all with distinct tags. Without this, one merchant could reuse another merchant's ids and block its payments. `refund` and `cancelPlan` take the **onchain** key.
- **Refill unwraps WWBT itself** (`WWBT.withdraw` then sends native WBT to the relayer) instead of relying on SwapRouter02's `unwrapWETH9`/`ADDRESS_THIS`. That removes gate G4.
- **Separate domain attestor role** (`setAttestor`), so the verifier worker never needs the admin key.
- `RegisterMerchant` and `SetMetadata` also sign `metadataURI`, so a relayer cannot swap it.
- Solidity 0.8.28 with `viaIR` (the plan said 0.8.34; 0.8.28 matches your existing Hardhat setup and is safe with Hardhat 2.22).

## Not audited

Testnet only. Not audited.
