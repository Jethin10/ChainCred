import {
  ApiKeys,
  DomainSettings,
  fromLocalAccount,
  InvoiceCreator,
  LoyaltySettings,
  MerchantGate,
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
  WebhookSettings,
  type WalletSigner,
} from '@paykit/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ComponentsPage from './docs/Components'
import { privateKeyToAccount } from 'viem/accounts'
import { Mark, PixelSky, PixelWipe } from './theme/pixels'
import { useBackend } from './theme/backend'
import { PayPage, SubscribePage } from './live/PayPage'
import { WalletPage } from './live/WalletPage'
import { ShopsPage } from './live/ShopsPage'
import { useMobile } from './mobile/context'
import { Icon } from './mobile/icons'
import './live/customer.css'
import { MerchantLive } from './live/Onboarding'
import { MobileChrome } from './mobile/Mobile'

// Public test keys. Never fund them. The merchant key owns the demo shop on the mock and on `npm run server:demo`.
const MERCHANT_KEY = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'
const CUSTOMER_KEY = '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e'
const SITE_URL = (import.meta.env.VITE_PAYKIT_SITE_URL as string | undefined) ?? 'http://127.0.0.1:5176'
const REPO_URL = 'https://github.com/Jethin10/PayKit'

type Page = 'components' | 'shops' | 'wallet' | 'merchant' | 'pay'

const PAGES: Array<{ key: Page; label: string; eyebrow: string; title: string; lead: string }> = [
  { key: 'components', label: 'SDK', eyebrow: '@paykit/react', title: 'Components you own', lead: 'Copy the view, keep the payment logic in the SDK. Every preview runs a real checkout flow on simulated funds.' },
  { key: 'shops', label: 'Shops', eyebrow: 'Directory', title: 'Shops that take USDT', lead: 'Companies with PayKit at checkout. Pay with one signature, never need gas, and earn points you can spend at any of them.' },
  { key: 'wallet', label: 'Wallet', eyebrow: 'Your invoices', title: 'One wallet, every shop', lead: 'Invoices, receipts and points from every company that takes PayKit. Real test USDT on Whitechain.' },
  { key: 'merchant', label: 'Merchant', eyebrow: 'For businesses', title: 'Get paid in USDT, your way', lead: 'Sign up in two minutes, brand your checkout, join the points network, and start sending invoices.' },
]

// The landing page (frontend/) links here as /#components, /#shops, /#invoice, /#me or /#merchant;
// #invoice and #me now open the wallet (where customers find their invoices).
// Pay links from the live PayKit server open #pay/<invoiceId>; plan links open #pay/subscribe/<planId>.
const PAY_META = { key: 'pay' as const, label: 'Pay', eyebrow: 'Checkout · Whitechain testnet', title: 'Pay with USDT', lead: 'Real test USDT, settled onchain. Sign once in your wallet; PayKit pays the gas.' }
const pageFromHash = (): Page => {
  const head = window.location.hash.split('/')[0]
  if (head === '#pay') return 'pay'
  if (head === '#invoice' || head === '#me') return 'wallet'
  if (head === '#scan' || head === '#settings') return 'wallet'
  return PAGES.find((p) => `#${p.key}` === head)?.key ?? 'wallet'
}
const payTarget = () => {
  const parts = window.location.hash.slice(1).split('/').slice(1).map(decodeURIComponent)
  return parts[0] === 'subscribe' ? { kind: 'plan' as const, id: parts[1] ?? '' } : { kind: 'invoice' as const, id: parts[0] ?? '' }
}

export default function MobileApp() {
  const backend = useBackend()
  const [page, setPage] = useState<Page>(pageFromHash)
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => { const follow = () => { setPage(pageFromHash()); setHash(window.location.hash) }; window.addEventListener('hashchange', follow); return () => window.removeEventListener('hashchange', follow) }, [])
  useEffect(() => { window.scrollTo({ top: 0 }) }, [page])
  const wallet = useMemo<WalletSigner>(() => fromLocalAccount(privateKeyToAccount(hash.startsWith('#merchant/demo') ? MERCHANT_KEY : CUSTOMER_KEY), 1874), [hash])
  const meta = page === 'pay' ? PAY_META : PAGES.find((p) => p.key === page)!
  const target = page === 'pay' ? payTarget() : null

  return (
    <PayKitProvider client={backend.client} wallet={wallet} theme="light">
      {page === 'components' && <PixelWipe trigger={page} />}
      <div className={`app app--${page}`}>
        <TopBar page={page} />
        {backend.testMode && page === 'components' && <TestModeNotice />}
        {page === 'components' && <header className="hero hero--short">
          <PixelSky seed={0} />
          <div className="hero__copy" key={page}>
            <p className="eyebrow"><span className="eyebrow__dot" />{meta.eyebrow}</p>
            <h1>{meta.title}</h1>
            <p className="hero__lead">{meta.lead}</p>
          </div>
        </header>}
        <main className="app__main" key={`${page}:${target?.id ?? ''}`}>
          {page === 'components' && <ComponentsPage liveClient={backend.source === 'live' ? backend.client : null} />}
          {page === 'shops' && <ShopsPage />}
          {page === 'wallet' && <WalletPage />}
          {page === 'merchant' && <MerchantPage />}
          {target?.kind === 'invoice' && <><div className="checkout-heading"><a href="#wallet">Your wallet</a><Icon name="chevron" size={12} /><span>Invoice checkout</span></div><PayPage invoiceId={target.id} /></>}
          {target?.kind === 'plan' && <SubscribePage planId={target.id} />}
        </main>
        <Footer />
        <MobileChrome page={page} />
      </div>
    </PayKitProvider>
  )
}

function TopBar({ page }: { page: Page }) {
  const nav = useRef<HTMLElement>(null)
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const place = () => {
      const on = nav.current?.querySelector<HTMLElement>('[aria-current="page"]')
      if (on) setPill({ left: on.offsetLeft, width: on.offsetWidth })
      else setPill(null)
    }
    place()
    window.addEventListener('resize', place)
    void document.fonts?.ready.then(place)
    return () => window.removeEventListener('resize', place)
  }, [page])
  const mobile = useMobile()
  return (
    <div className="topbar">
      <nav className="navpill" ref={nav} aria-label="Pages">
        <a className="navpill__brand" href="#wallet" aria-label="PayKit home"><Mark /><span>PayKit</span></a>
        {pill && <span className="navpill__glide" style={{ transform: `translateX(${pill.left}px)`, width: pill.width }} aria-hidden="true" />}
        {[PAGES[2], PAGES[1], PAGES[3], PAGES[0]].map((p) => (
          <a key={p.key} href={`#${p.key}`} className="navpill__link" aria-current={page === p.key ? 'page' : undefined}>{p.label}</a>
        ))}
      </nav>
      <div className="topbar__end">
        <span className="network-label"><i />Whitechain</span>
        <button className="account-button" onClick={mobile.settings} aria-label="Open app settings"><Icon name="fingerprint" size={22} /></button>
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
  return <footer className="customer-footer"><span><Mark /> PayKit</span><p>Your wallet. In good company.</p><nav aria-label="Footer"><a href={SITE_URL}>About PayKit</a><a href="#components">Developers</a><a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a></nav></footer>
}

function MerchantPage() {
  const demo = window.location.hash.startsWith('#merchant/demo')
  return (
    <section className="page">
      <header className="customer-heading"><div><p className="customer-greeting">For the businesses we love.</p><h1>Good business starts here.</h1></div></header>
      {demo ? (
        <MerchantGate>
          <MerchantDashboard />
        </MerchantGate>
      ) : (
        <MerchantLive />
      )}
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
