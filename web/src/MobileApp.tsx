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
import { useEffect, useMemo, useState } from 'react'
import ComponentsPage from './docs/Components'
import { InstallCta } from './docs/InstallCta'
import { privateKeyToAccount } from 'viem/accounts'
import { Mark, PixelSky } from './theme/pixels'
import { useBackend } from './theme/backend'
import { PayPage, SubscribePage } from './live/PayPage'
import { Home } from './mobile/Home'
import { Shops } from './mobile/Shops'
import { Icon } from './mobile/icons'
import './live/customer.css'
import './mobile/app.css'
import { MerchantLive } from './live/Onboarding'
import { MobileChrome } from './mobile/Mobile'

// Public test keys. Never fund them. The merchant key owns the demo shop on the mock and on `npm run server:demo`.
const MERCHANT_KEY = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'
const CUSTOMER_KEY = '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e'

type Page = 'components' | 'shops' | 'wallet' | 'merchant' | 'pay'

const PAGES: Array<{ key: Page; label: string; eyebrow: string; title: string; lead: string }> = [
  { key: 'components', label: 'SDK', eyebrow: '@paykit/react', title: 'Components you own', lead: 'Copy the view, keep the payment logic in the SDK. Every preview runs a real checkout flow on simulated funds.' },
  { key: 'shops', label: 'Shops', eyebrow: 'Directory', title: 'Shops that take USDT', lead: 'Companies with ChainCred at checkout. Pay with one signature, never need gas, and earn points you can spend at any of them.' },
  { key: 'wallet', label: 'Wallet', eyebrow: 'Your invoices', title: 'One wallet, every shop', lead: 'Invoices, receipts and points from every company that takes ChainCred. Real test USDT on Whitechain.' },
  { key: 'merchant', label: 'Merchant', eyebrow: 'For businesses', title: 'Get paid in USDT, your way', lead: 'Sign up in two minutes, brand your checkout, join the points network, and start sending invoices.' },
]

// The landing page (frontend/) links here as /#components, /#shops, /#invoice, /#me or /#merchant;
// #invoice and #me now open the wallet (where customers find their invoices).
// Pay links from the live ChainCred server open #pay/<invoiceId>; plan links open #pay/subscribe/<planId>.
const PAY_META = { key: 'pay' as const, label: 'Pay', eyebrow: 'Checkout · Whitechain testnet', title: 'Pay with USDT', lead: 'Real test USDT, settled onchain. Sign once in your wallet; ChainCred pays the gas.' }
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
  // Pixel theme for everything the phone app shows, including sheets rendered outside this tree.
  useEffect(() => { document.body.classList.add('m-app'); return () => document.body.classList.remove('m-app') }, [])
  const wallet = useMemo<WalletSigner>(() => fromLocalAccount(privateKeyToAccount(hash.startsWith('#merchant/demo') ? MERCHANT_KEY : CUSTOMER_KEY), 1874), [hash])
  const meta = page === 'pay' ? PAY_META : PAGES.find((p) => p.key === page)!
  const target = page === 'pay' ? payTarget() : null

  const title = page === 'wallet' ? 'ChainCred' : page === 'merchant' ? 'Business' : page === 'pay' ? (target?.kind === 'plan' ? 'Subscribe' : 'Pay') : meta.label

  return (
    <PayKitProvider client={backend.client} wallet={wallet} theme="light">
      <div className={`app app--${page} m-app`}>
        <AppBar title={title} back={page === 'pay' || page === 'components'} />
        {backend.testMode && page === 'components' && <TestModeNotice />}
        {page === 'components' && <header className="hero hero--short">
          <PixelSky seed={0} />
          <div className="hero__copy" key={page}>
            <p className="eyebrow"><span className="eyebrow__dot" />{meta.eyebrow}</p>
            <h1>{meta.title}</h1>
            <p className="hero__lead">{meta.lead}</p>
            <InstallCta />
          </div>
        </header>}
        <main className="m-main" key={`${page}:${target?.id ?? ''}`}>
          {page === 'components' && <ComponentsPage liveClient={backend.source === 'live' ? backend.client : null} />}
          {page === 'shops' && <Shops />}
          {page === 'wallet' && <Home />}
          {page === 'merchant' && <MerchantPage />}
          {target?.kind === 'invoice' && <PayPage invoiceId={target.id} />}
          {target?.kind === 'plan' && <SubscribePage planId={target.id} />}
        </main>
        <MobileChrome page={page} />
      </div>
    </PayKitProvider>
  )
}

function AppBar({ title, back }: { title: string; back: boolean }) {
  return (
    <header className="m-bar">
      <div className="m-bar__pill">
        {back
          ? <a className="m-bar__back" href="#wallet" aria-label="Back to home"><Icon name="chevron" size={18} /></a>
          : <a className="m-bar__mark" href="#wallet" aria-label="ChainCred home"><Mark /></a>}
        <h1>{title}</h1>
      </div>
      <span className="m-bar__net"><i />Whitechain</span>
    </header>
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

function MerchantPage() {
  const demo = window.location.hash.startsWith('#merchant/demo')
  return (
    <section className="m-business">
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
