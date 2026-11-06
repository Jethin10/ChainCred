import {
  ApiKeys,
  ConnectWallet,
  DomainSettings,
  fromEip1193,
  fromLocalAccount,
  InstallmentPlanPicker,
  InvoiceCreator,
  LoyaltySettings,
  MerchantGate,
  MerchantGrid,
  PaymentsTable,
  PayKitProvider,
  PayoutSettings,
  PlansTable,
  ProductManager,
  RefundsTable,
  SalesSummary,
  SignerSettings,
  SplitSettings,
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
import { PayPage, SubscribePage } from './live/PayPage'
import { Companies, WalletPage } from './live/WalletPage'

// Public test keys. Never fund them. The merchant key owns the demo shop on the mock and on `npm run server:demo`.
const MERCHANT_KEY = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'
const CUSTOMER_KEY = '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e'
const SITE_URL = (import.meta.env.VITE_PAYKIT_SITE_URL as string | undefined) ?? 'http://127.0.0.1:5176'
const REPO_URL = 'https://github.com/Jethin10/PayKit'

type WalletChoice = 'customer' | 'merchant' | 'browser' | 'none'
type Page = 'components' | 'shops' | 'wallet' | 'merchant' | 'pay'

const PAGES: Array<{ key: Page; label: string; eyebrow: string; title: string; lead: string }> = [
  { key: 'components', label: 'SDK', eyebrow: '@paykit/react', title: 'Components you own', lead: 'Copy the view, keep the payment logic in the SDK. Every preview runs a real checkout flow on simulated funds.' },
  { key: 'shops', label: 'Shops', eyebrow: 'Directory', title: 'Shops that take USDT', lead: 'Companies with PayKit at checkout. Pay with one signature, never need gas, and earn points you can spend at any of them.' },
  { key: 'wallet', label: 'Wallet', eyebrow: 'Your invoices', title: 'One wallet, every shop', lead: 'Invoices, receipts and points from every company that takes PayKit. Real test USDT on Whitechain.' },
  { key: 'merchant', label: 'Merchant', eyebrow: 'Dashboard', title: 'Your shop, in one place', lead: 'Use the merchant wallet to see Mumbai Chai Co., or any other wallet to try sign-up.' },
]

// The landing page (frontend/) links here as /#components, /#shops, /#invoice, /#me or /#merchant;
// #invoice and #me now open the wallet (where customers find their invoices).
// Pay links from the live PayKit server open #pay/<invoiceId>; plan links open #pay/subscribe/<planId>.
const PAY_META = { key: 'pay' as const, label: 'Pay', eyebrow: 'Checkout · Whitechain testnet', title: 'Pay with USDT', lead: 'Real test USDT, settled onchain. Sign once in your wallet; PayKit pays the gas.' }
const pageFromHash = (): Page => {
  const head = window.location.hash.split('/')[0]
  if (head === '#pay') return 'pay'
  if (head === '#invoice' || head === '#me') return 'wallet'
  return PAGES.find((p) => `#${p.key}` === head)?.key ?? 'components'
}
const payTarget = () => {
  const parts = window.location.hash.slice(1).split('/').slice(1).map(decodeURIComponent)
  return parts[0] === 'subscribe' ? { kind: 'plan' as const, id: parts[1] ?? '' } : { kind: 'invoice' as const, id: parts[0] ?? '' }
}

export default function App() {
  const backend = useBackend()
  const [choice, setChoice] = useState<WalletChoice>('customer')
  const [page, setPage] = useState<Page>(pageFromHash)
  const [, setHash] = useState(window.location.hash)
  useEffect(() => { const follow = () => { setPage(pageFromHash()); setHash(window.location.hash) }; window.addEventListener('hashchange', follow); return () => window.removeEventListener('hashchange', follow) }, [])
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
  const meta = page === 'pay' ? PAY_META : PAGES.find((p) => p.key === page)!
  const target = page === 'pay' ? payTarget() : null

  return (
    <PayKitProvider key={backend.source} client={backend.client} wallet={wallet} theme="light" onConnectRequest={() => setChoice('customer')} onDisconnectRequest={() => setChoice('none')}>
      <PixelWipe trigger={page} />
      <div className="app">
        <TopBar page={page} backend={backend} />
        {backend.testMode && page !== 'pay' && <TestModeNotice />}
        <header className={page === 'components' ? 'hero hero--short' : 'hero'}>
          <PixelSky seed={page === 'pay' ? 7 : PAGES.findIndex((p) => p.key === page)} />
          <div className="hero__copy" key={page}>
            <p className="eyebrow"><span className="eyebrow__dot" />{meta.eyebrow}</p>
            <h1>{meta.title}</h1>
            <p className="hero__lead">{meta.lead}</p>
          </div>
        </header>
        {(page === 'shops' || page === 'merchant') && (
          <div className="dock" role="group" aria-label="Preview wallet">
            <div className="dock__label">
              <span className="pixel">Wallet</span>
              <span>{backend.source === 'live' ? 'Real requests to the live PayKit API, in test mode: orders here never move real funds.' : 'Simulated in your browser. Nothing touches a chain.'}</span>
              {backend.testMode && <span className="testmode" title="Orders here are simulated. Real USDT only moves on hosted pay links.">Test mode · no real funds</span>}
            </div>
            <div className="dock__chips" role="radiogroup" aria-label="Choose wallet">
              {([['customer', 'Customer'], ['merchant', 'Merchant'], ['browser', 'Browser'], ['none', 'Off']] as const).map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={choice === value} className="chip" onClick={() => setChoice(value)}>{label}</button>
              ))}
            </div>
            <ConnectWallet />
          </div>
        )}
        <main className="app__main" key={`${page}:${backend.source}:${target?.id ?? ''}`}>
          {page === 'components' && <ComponentsPage liveClient={backend.source === 'live' ? backend.client : null} />}
          {page === 'shops' && <ShopsPage />}
          {page === 'wallet' && <WalletPage />}
          {page === 'merchant' && <MerchantPage />}
          {target?.kind === 'invoice' && <PayPage invoiceId={target.id} />}
          {target?.kind === 'plan' && <SubscribePage planId={target.id} />}
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
          <span className="pixel">{live ? (backend.testMode ? 'Live · test mode' : 'Live API') : backend.reachable === null ? 'Checking' : 'Simulated'}</span>
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

// Shown once: payments in the SDK section run end to end, but in test mode, so no funds move.
const NOTICE_KEY = 'paykit:test-mode-notice'
function TestModeNotice() {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(NOTICE_KEY) !== 'seen' } catch { return true } })
  const close = () => { setOpen(false); try { localStorage.setItem(NOTICE_KEY, 'seen') } catch { /* private mode */ } }
  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(close, 9000)
    return () => window.clearTimeout(id)
  }, [open])
  if (!open) return null
  return (
    <div className="testnotice" role="status">
      <span className="testnotice__dot" aria-hidden="true" />
      <p><strong>Test mode.</strong> Orders here go through the full payment flow, but responses are simulated: no USDT or WBT leaves your wallet. Real payments only happen on pay links.</p>
      <button type="button" className="testnotice__close" onClick={close} aria-label="Dismiss">Got it</button>
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
      <Companies />
      <section className="page__section">
        <p className="eyebrow eyebrow--ink">SDK test shops</p>
        <h2>Try the SDK without spending anything</h2>
        <p className="page__lead">These demo shops run on the PayKit SDK in test mode: the full checkout, simulated settlement, no real funds.</p>
        <MerchantGrid />
      </section>
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
      <LoyaltySettings />
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
