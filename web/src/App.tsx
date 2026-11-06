import {
  ApiKeys,
  ConnectWallet,
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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ComponentsPage from './docs/Components'
import { privateKeyToAccount } from 'viem/accounts'
import { Mark, PixelSky, PixelWipe } from './theme/pixels'
import { useBackend, type Backend } from './theme/backend'

// Public test keys. Never fund them. The merchant key owns the demo shop on the mock and on `npm run server:demo`.
const MERCHANT_KEY = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'
const CUSTOMER_KEY = '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e'
const SITE_URL = (import.meta.env.VITE_PAYKIT_SITE_URL as string | undefined) ?? 'http://127.0.0.1:5176'
const REPO_URL = 'https://github.com/Jethin10/PayKit'

type WalletChoice = 'customer' | 'merchant' | 'browser' | 'none'
type Page = 'components' | 'shops' | 'invoice' | 'me' | 'merchant'

const PAGES: Array<{ key: Page; label: string; eyebrow: string; title: string; lead: string }> = [
  { key: 'components', label: 'SDK', eyebrow: '@paykit/react', title: 'Components you own', lead: 'Copy the view, keep the payment logic in the SDK. Every preview runs a real checkout flow on simulated funds.' },
  { key: 'shops', label: 'Shops', eyebrow: 'Directory', title: 'Shops that take USDT', lead: 'Every shop here proved it owns its domain. Pay with one signature; you never need gas.' },
  { key: 'invoice', label: 'Invoice', eyebrow: 'Payment links', title: 'Invoices, paid in parts', lead: 'Switch to the merchant wallet to create an invoice with a 30% deposit, then back to the customer to pay it in two parts.' },
  { key: 'me', label: 'Payments', eyebrow: 'Your wallet', title: 'Everything you paid', lead: "What you've paid with this wallet, what's coming up, and refunds you've received." },
  { key: 'merchant', label: 'Merchant', eyebrow: 'Dashboard', title: 'Your shop, in one place', lead: 'Use the merchant wallet to see Mumbai Chai Co., or any other wallet to try sign-up.' },
]

// The landing page (frontend/) links here as /#components, /#shops, /#invoice, /#me or /#merchant.
const pageFromHash = (): Page => PAGES.find((p) => `#${p.key}` === window.location.hash.split('/')[0])?.key ?? 'components'

export default function App() {
  const backend = useBackend()
  const [choice, setChoice] = useState<WalletChoice>('customer')
  const [page, setPage] = useState<Page>(pageFromHash)
  useEffect(() => { const follow = () => setPage(pageFromHash()); window.addEventListener('hashchange', follow); return () => window.removeEventListener('hashchange', follow) }, [])
  useEffect(() => { window.scrollTo({ top: 0 }) }, [page])
  const wallet = useMemo<WalletSigner | null>(() => {
    if (choice === 'customer') return fromLocalAccount(privateKeyToAccount(CUSTOMER_KEY), 1874)
    if (choice === 'merchant') return fromLocalAccount(privateKeyToAccount(MERCHANT_KEY), 1874)
    if (choice === 'browser') {
      const eth = (window as { ethereum?: Parameters<typeof fromEip1193>[0] }).ethereum
      return eth ? fromEip1193(eth) : null
    }
    return null
  }, [choice])
  const meta = PAGES.find((p) => p.key === page)!

  return (
    <PayKitProvider key={backend.source} client={backend.client} wallet={wallet} theme="light" onConnectRequest={() => setChoice('customer')} onDisconnectRequest={() => setChoice('none')}>
      <PixelWipe trigger={page} />
      <div className="app">
        <TopBar page={page} backend={backend} />
        <header className={page === 'components' ? 'hero hero--short' : 'hero'}>
          <PixelSky seed={PAGES.indexOf(meta)} />
          <div className="hero__copy" key={page}>
            <p className="eyebrow"><span className="eyebrow__dot" />{meta.eyebrow}</p>
            <h1>{meta.title}</h1>
            <p className="hero__lead">{meta.lead}</p>
          </div>
        </header>
        {page !== 'components' && (
          <div className="dock" role="group" aria-label="Preview wallet">
            <div className="dock__label">
              <span className="pixel">Wallet</span>
              <span>{backend.source === 'live' ? 'Signs real requests to your PayKit API, settled on a simulated chain.' : 'Simulated in your browser. Nothing touches a chain.'}</span>
            </div>
            <div className="dock__chips" role="radiogroup" aria-label="Choose wallet">
              {([['customer', 'Customer'], ['merchant', 'Merchant'], ['browser', 'Browser'], ['none', 'Off']] as const).map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={choice === value} className="chip" onClick={() => setChoice(value)}>{label}</button>
              ))}
            </div>
            <ConnectWallet />
          </div>
        )}
        <main className="app__main" key={`${page}:${backend.source}`}>
          {page === 'components' && <ComponentsPage />}
          {page === 'shops' && <ShopsPage />}
          {page === 'invoice' && <InvoicePage backend={backend} />}
          {page === 'me' && <MyPage />}
          {page === 'merchant' && <MerchantPage />}
        </main>
        <Footer />
      </div>
    </PayKitProvider>
  )
}

function TopBar({ page, backend }: { page: Page; backend: Backend }) {
  const nav = useRef<HTMLElement>(null)
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const place = () => {
      const on = nav.current?.querySelector<HTMLElement>('[aria-current="page"]')
      if (on) setPill({ left: on.offsetLeft, width: on.offsetWidth })
    }
    place()
    window.addEventListener('resize', place)
    void document.fonts?.ready.then(place)
    return () => window.removeEventListener('resize', place)
  }, [page])
  const live = backend.source === 'live'
  return (
    <div className="topbar">
      <nav className="navpill" ref={nav} aria-label="Pages">
        <a className="navpill__brand" href={SITE_URL} aria-label="PayKit home"><Mark /><span>PayKit</span></a>
        {pill && <span className="navpill__glide" style={{ transform: `translateX(${pill.left}px)`, width: pill.width }} aria-hidden="true" />}
        {PAGES.map((p) => (
          <a key={p.key} href={`#${p.key}`} className="navpill__link" aria-current={page === p.key ? 'page' : undefined}>{p.label}</a>
        ))}
      </nav>
      <div className="topbar__end">
        <button
          type="button"
          className={live ? 'source source--live' : 'source'}
          onClick={() => backend.setSource(live ? 'mock' : 'live')}
          disabled={!live && !backend.reachable}
          title={backend.reachable ? `PayKit API at ${backend.apiUrl}` : 'Start the API with npm run server:demo to go live'}
        >
          <span className="source__dot" aria-hidden="true" />
          <span className="pixel">{live ? 'Live API' : backend.reachable === null ? 'Checking' : 'Simulated'}</span>
          <span className="source__hint">{live ? 'use mock' : backend.reachable ? 'go live' : 'API offline'}</span>
        </button>
        <a className="cta" href={SITE_URL}>Home</a>
        <a className="cta cta--round" href={REPO_URL} target="_blank" rel="noreferrer" aria-label="Repository on GitHub">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11 11 5M6 5h5v5" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
        </a>
      </div>
    </div>
  )
}

function Footer() {
  const words = ['USDT on Whitechain', 'one signature', 'no gas for customers', 'verified shops', 'installments', 'refunds', 'signed webhooks']
  return (
    <footer className="foot">
      <div className="foot__marquee" aria-hidden="true">
        <div>{[...words, ...words].map((w, i) => <span key={i}>{w}<i>✦</i></span>)}</div>
      </div>
      <div className="foot__row">
        <span className="pixel">PayKit, gasless checkout</span>
        <nav aria-label="Footer">
          <a href={SITE_URL}>Landing</a>
          <a href="#components">SDK</a>
          <a href="#shops">Shops</a>
          <a href="#merchant">Merchant</a>
          <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </div>
    </footer>
  )
}

function ShopsPage() {
  return (
    <section className="page">
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
      <p className="eyebrow eyebrow--ink">Installments</p>
      <h2>Spread a bigger order over time</h2>
      <p className="page__lead">{box.name} from Mumbai Chai Co., paid in installments. Use the customer wallet.</p>
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

function InvoicePage({ backend }: { backend: Backend }) {
  const [selected, setSelected] = useState<string | null>(null)
  const invoices = backend.mock ? backend.mock.db.invoices : []
  const id = selected ?? new URLSearchParams(location.search).get('invoice') ?? invoices[0]?.id ?? null
  return (
    <section className="page">
      <div className="split">
        <div className="narrow">
          {id ? (
            <InvoiceView invoiceId={id} />
          ) : (
            <div className="pk-state pk-state--info">
              <p className="pk-state__title">No invoice open.</p>
              <div className="pk-state__body">
                Create one on the <a href="#merchant">Merchant</a> page with the merchant wallet, then open its link{backend.source === 'live' ? ' (it adds ?invoice=… to this page)' : ''}.
              </div>
            </div>
          )}
        </div>
        {invoices.length > 1 && (
          <label className="field">
            <span className="pixel">Show invoice</span>
            <select value={id ?? ''} onChange={(e) => setSelected(e.target.value)}>
              {invoices.map((i) => <option key={i.id} value={i.id}>{i.number}</option>)}
            </select>
          </label>
        )}
      </div>
    </section>
  )
}

function MyPage() {
  return (
    <section className="page">
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
      <p className="eyebrow eyebrow--ink">Settings</p>
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
