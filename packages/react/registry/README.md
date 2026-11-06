# Copyable PayKit components

These are complete presentation files backed by the same hooks as the SDK components. Own and edit the JSX and CSS. Keep signing, amount checks, API requests, retries and finality in the SDK.

## Preview and copy

From the repository, run `npm ci`, `npm run sdk:build` and `npm run dev`. Open the Components tab. Every component has an interactive simulated preview, editable theme, source/styles/usage tabs, real copy buttons and installation instructions.

The preview is isolated from any configured payment API. It uses public test wallets and a simulated chain. It never submits a real transaction.

## Add to an existing app

Use Node 24. From the PayKit repository:

```sh
npm run ui:add -- checkout --cwd "../your-store"
npm run ui:add -- wallet-button receipt --cwd "../your-store"
```

The installer packs core, JS and React SDKs locally if the target does not have them installed, saves the tarballs under the target's `.paykit/packages`, and installs them with npm. Keep those tarballs with the app while packages are unpublished. No secret or environment value is generated or copied.

Components go to `src/components/paykit` when the app has a `src` directory, otherwise `components/paykit`. The shared `paykit-ui.css` goes beside them. Import the copied component normally:

```tsx
"use client";
import { PayKitProvider } from '@paykit/react';
import '@paykit/react/styles.css';
import { CustomCheckout } from './components/paykit/checkout';

export function OrderCheckout({ sessionId, amount }: { sessionId: string; amount: string }) {
  return <PayKitProvider publishableKey="pk_your_publishable_key" apiUrl="https://your-paykit-api">
    <CustomCheckout sessionId={sessionId} amount={amount} />
  </PayKitProvider>;
}
```

Create the session from your authenticated merchant backend using server-derived order prices. The amount prop is a base-unit integer string, so `10000000` means 10 USDT. Use verified settlement webhooks for fulfillment. See [the full merchant guide](../../README.md) and [the Next.js example](../../../examples/next-store/README.md).

## Components

| File | Export | SDK hook |
|---|---|---|
| `checkout.tsx` | `CustomCheckout` | `useCheckout` |
| `payment-status.tsx` | `CustomPaymentStatus` | `usePayment` |
| `wallet-button.tsx` | `WalletButton` | `useWallet` |
| `product-card.tsx` | `CustomProductCard` | `useCart` |
| `receipt.tsx` | `PaymentReceipt` | `usePayment` |
| `installment-plan.tsx` | `CustomInstallmentPlan` | `usePlanCheckout` |

For controlled wallet adapters, pass `onConnectRequest` and `onDisconnectRequest` to `PayKitProvider` to update your connector state. The injected-wallet default needs neither callback.

## Installer options

```sh
npm run ui:add -- --list
npm run ui:add -- --all --cwd "../your-store"
npm run ui:add -- checkout --cwd "../your-store" --dry-run
npm run ui:add -- checkout --cwd "../your-store" --no-install
npm run ui:add -- checkout --cwd "../your-store" --dir "src/ui/payments"
```

The installer refuses to overwrite customized component files. It preserves an existing customized shared stylesheet when adding another component. `--force` explicitly replaces requested files. Output directories must stay inside the target project.

After installing the React SDK tarball, its packaged binary is also available as `npm exec paykit-ui -- checkout` in the target app. It can copy the packaged templates without the original source checkout.

## Registry

`npm run sdk:registry` generates six shadcn-compatible JSON items under `web/public/r`, each containing both source and styles. A single catalog drives the gallery, installer and registry. Set `PAYKIT_REGISTRY_ORIGIN` when generating for an explicitly configured host.

The registry does not publish npm packages or host itself. Before npm publication, use the local installer above rather than expecting shadcn to download unpublished SDK dependencies. Schema reference: [shadcn registry-item.json](https://ui.shadcn.com/docs/registry/registry-item-json).
