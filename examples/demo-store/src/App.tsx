import { Cart, createPayKitClient, ExportButton, fromLocalAccount, MerchantGate, PaymentHistory, PaymentsTable, PayKitProvider, ProductGrid, type PayKitClient, type WalletSigner } from '@paykit/react'
import '@paykit/react/styles.css'
import { createMockApi, MOCK_TEST_KEYS } from '@paykit/testing'
import { useState } from 'react'
import { privateKeyToAccount } from 'viem/accounts'

// Real: set VITE_PAYKIT_API_URL (+ VITE_PAYKIT_PK) and pay with MetaMask.
// Otherwise: an in-browser mock with test wallets.
const apiUrl = import.meta.env.VITE_PAYKIT_API_URL as string | undefined
const shop = (import.meta.env.VITE_PAYKIT_SHOP as string | undefined) ?? 'chai-co'
let client: PayKitClient
let wallets: Record<'shop' | 'owner', WalletSigner | undefined> = { shop: undefined, owner: undefined }
if (apiUrl) {
  client = createPayKitClient({ baseUrl: apiUrl, publishableKey: import.meta.env.VITE_PAYKIT_PK as string | undefined })
} else {
  const mock = createMockApi()
  client = createPayKitClient({ baseUrl: mock.baseUrl, fetch: mock.fetch, siwe: mock.siwe })
  wallets = { shop: fromLocalAccount(privateKeyToAccount(MOCK_TEST_KEYS.customer), 1874), owner: fromLocalAccount(privateKeyToAccount(MOCK_TEST_KEYS.merchant), 1874) }
}

export default function App() {
  const [view, setView] = useState<'shop' | 'owner'>('shop')
  return (
    <PayKitProvider client={client} wallet={wallets[view]}>
      <main>
        <header>
          <h1>Mumbai Chai Co.</h1>
          <nav>
            <button aria-pressed={view === 'shop'} onClick={() => setView('shop')}>Shop</button>
            <button aria-pressed={view === 'owner'} onClick={() => setView('owner')}>Owner</button>
          </nav>
        </header>
        {view === 'shop' ? (
          <div className="shop">
            <ProductGrid merchant={shop} />
            <Cart merchant={shop} />
            <PaymentHistory />
          </div>
        ) : (
          <MerchantGate>
            <PaymentsTable />
            <ExportButton />
          </MerchantGate>
        )}
      </main>
    </PayKitProvider>
  )
}
