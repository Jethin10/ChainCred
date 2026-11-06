import {
  ApiKeys,
  ConnectWallet,
  createPayKitClient,
  DomainSettings,
  fromEip1193,
  fromLocalAccount,
  InstallmentPlanPicker,
  InvoiceCreator,
  InvoiceView,
  MerchantGate,
  MerchantGrid,
  PaymentHistory,
  PaymentsTable,
  PayKitProvider,
  PayoutSettings,
  PlanList,
  PlansTable,
  ProductManager,
  RefundList,
  RefundsTable,
  SalesSummary,
  SignerSettings,
  SplitSettings,
  UpcomingPayments,
  useMerchantInvoices,
  useProducts,
  WebhookSettings,
  type WalletSigner,
} from '@paykit/react'
import { createMockApi } from '@paykit/testing'
import { useMemo, useState } from 'react'
import { privateKeyToAccount } from 'viem/accounts'

// Preview only: a fake API and two public test keys. Never fund these keys.
// Real API when VITE_PAYKIT_API_URL is set (e.g. http://localhost:8787); otherwise an in-browser mock.
const apiUrl = import.meta.env.VITE_PAYKIT_API_URL as string | undefined
const mock = apiUrl ? null : createMockApi()
const client = mock
  ? createPayKitClient({ baseUrl: mock.baseUrl, fetch: mock.fetch, siwe: mock.siwe })
  : createPayKitClient({ baseUrl: apiUrl!, publishableKey: import.meta.env.VITE_PAYKIT_PK as string | undefined })
const MERCHANT_KEY = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'
const CUSTOMER_KEY = '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e'

type WalletChoice = 'customer' | 'merchant' | 'browser' | 'none'
type Page = 'shops' | 'invoice' | 'me' | 'merchant'

const PAGES: Array<{ key: Page; label: string }> = [
  { key: 'shops', label: 'Shops' },
  { key: 'invoice', label: 'Invoice link' },
  { key: 'me', label: 'My payments' },
  { key: 'merchant', label: 'Merchant' },
]

// The landing page (frontend/) links here as /#shops, /#invoice, /#me or /#merchant.
const pageFromHash = (): Page => PAGES.find((p) => `#${p.key}` === window.location.hash)?.key ?? 'shops'

export default function App() {
  const [choice, setChoice] = useState<WalletChoice>(mock ? 'customer' : 'browser')
  const [page, setPage] = useState<Page>(pageFromHash)
  const wallet = useMemo<WalletSigner | null>(() => {
    if (choice === 'customer') return fromLocalAccount(privateKeyToAccount(CUSTOMER_KEY), 1874)
    if (choice === 'merchant') return fromLocalAccount(privateKeyToAccount(MERCHANT_KEY), 1874)
    if (choice === 'browser') {
      const eth = (window as { ethereum?: Parameters<typeof fromEip1193>[0] }).ethereum
      return eth ? fromEip1193(eth) : null
    }
    return null
  }, [choice])

  return (
    <PayKitProvider client={client} wallet={wallet} onConnectRequest={() => setChoice('customer')}>
      <div className="app">
        <header className="app__bar">
          <div className="app__brand">
            <span className="app__mark" aria-hidden="true" />
            PayKit
          </div>
          <nav className="app__nav" aria-label="Pages">
            {PAGES.map((p) => (
              <button key={p.key} type="button" className={page === p.key ? 'app__navlink app__navlink--on' : 'app__navlink'} onClick={() => setPage(p.key)}>
                {p.label}
              </button>
            ))}
          </nav>
          <div className="app__wallet">
            <label className="app__select">
              <span>Preview wallet</span>
              <select value={choice} onChange={(e) => setChoice(e.target.value as WalletChoice)}>
                <option value="customer">Test customer</option>
                <option value="merchant">Test merchant (Mumbai Chai Co.)</option>
                <option value="browser">My browser wallet</option>
                <option value="none">Disconnected</option>
              </select>
            </label>
            <ConnectWallet />
          </div>
        </header>
        <p className="app__note">{mock ? 'Preview with a mock API. Payments here are simulated and nothing touches a chain.' : `Live: ${apiUrl} on Whitechain Sepolia.`}</p>
        <main className="app__main">
          {page === 'shops' && <ShopsPage />}
          {page === 'invoice' && <InvoicePage />}
          {page === 'me' && <MyPage />}
          {page === 'merchant' && <MerchantPage />}
        </main>
      </div>
    </PayKitProvider>
  )
}

function ShopsPage() {
  return (
    <section className="page">
      <div className="page__intro">
        <h1>Shops that take USDT</h1>
        <p>Every shop here proved it owns its domain. Pay with one signature; you never need gas.</p>
      </div>
      <MerchantGrid />
      <PlanDemo />
    </section>
  )
}

function PlanDemo() {
  const products = useProducts('chai-co')
  const box = products.data?.find((p) => p.name.includes('subscription'))
  if (!box) return null
  return (
    <section className="page__section">
      <h2>Spread a bigger order over time</h2>
      <p className="page__lead">
        {box.name} from Mumbai Chai Co., paid in installments. Use the test customer wallet.
      </p>
      <div className="narrow">
        <InstallmentPlanPicker
          input={{ merchant: 'chai-co', items: [{ productId: box.id, quantity: 1 }] }}
          total={box.price}
          options={[
            { count: 3, periodSeconds: 30 * 86_400 },
            { count: 3, periodSeconds: 120, downPaymentPercent: 10 },
          ]}
        />
      </div>
    </section>
  )
}

function InvoicePage() {
  return (
    <section className="page">
      <div className="page__intro">
        <h1>Invoice links</h1>
        <p>Switch to the test merchant wallet to create an invoice with a 30% deposit, then switch back to the customer to pay it in two parts.</p>
      </div>
      <InvoicePicker />
    </section>
  )
}

function InvoicePicker() {
  const [selected, setSelected] = useState<string | null>(null)
  const invoices = mock ? mock.db.invoices : []
  const id = selected ?? new URLSearchParams(location.search).get('invoice') ?? invoices[0]?.id ?? null
  return (
    <div className="split">
      <div className="narrow">
        {id ? (
          <InvoiceView invoiceId={id} />
        ) : (
          <div className="pk-state pk-state--info">
            <p className="pk-state__title">No invoices yet.</p>
            <div className="pk-state__body">Create one in the Merchant page with the test merchant wallet.</div>
          </div>
        )}
      </div>
      {invoices.length > 1 && (
        <label className="app__select">
          <span>Show invoice</span>
          <select value={id ?? ''} onChange={(e) => setSelected(e.target.value)}>
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

function MyPage() {
  return (
    <section className="page">
      <div className="page__intro">
        <h1>Your payments</h1>
        <p>Everything you've paid with this wallet, what's coming up, and refunds you've received.</p>
      </div>
      <div className="columns">
        <section className="pk-panel">
          <h2 className="pk-panel__title">Coming up</h2>
          <UpcomingPayments />
        </section>
        <section className="pk-panel">
          <h2 className="pk-panel__title">Installment plans</h2>
          <PlanList />
        </section>
      </div>
      <section className="pk-panel">
        <h2 className="pk-panel__title">History</h2>
        <PaymentHistory />
      </section>
      <section className="pk-panel">
        <h2 className="pk-panel__title">Refunds</h2>
        <RefundList />
      </section>
    </section>
  )
}

function MerchantPage() {
  return (
    <section className="page">
      <div className="page__intro">
        <h1>Your shop</h1>
        <p>Use the test merchant wallet to see Mumbai Chai Co., or any other wallet to try sign-up.</p>
      </div>
      <MerchantGate>
        <MerchantDashboard />
      </MerchantGate>
    </section>
  )
}

function MerchantDashboard() {
  useMerchantInvoices()
  return (
    <div className="stack">
      <SalesSummary />
      <PaymentsTable />
      <div className="columns">
        <InvoiceCreator />
        <ProductManager />
      </div>
      <div className="columns">
        <PlansTable />
        <RefundsTable />
      </div>
      <h2 className="page__h2">Settings</h2>
      <div className="columns">
        <PayoutSettings />
        <DomainSettings />
        <SplitSettings />
        <SignerSettings />
        <ApiKeys />
        <WebhookSettings />
      </div>
    </div>
  )
}
