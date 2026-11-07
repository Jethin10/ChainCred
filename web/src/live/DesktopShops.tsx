import { useEffect, useState } from 'react'
import { api, knownAccount, short, type Activity, type MarketReward } from './server'
import { useShops, shopPhoto, type Shop } from './useShops'
import { ShopEmblem } from './ShopEmblem'
import { Icon } from '../mobile/icons'
import '../docs/components.css'
import './desktop-shops.css'

type Tab = 'overview' | 'invoices' | 'details'
const TABS: Array<[Tab, string]> = [['overview', 'Overview'], ['invoices', 'Your invoices'], ['details', 'Details']]

const shopId = (s: Shop) => s.id
const hashPart = (i: number) => decodeURIComponent(location.hash.split('/')[i] ?? '')
const tabFromHash = (): Tab => TABS.find(([t]) => t === hashPart(2))?.[0] ?? 'overview'
const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')
const money = (v: string | number) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

/**
 * The shop directory: every shop that takes ChainCred, its rewards, and the invoices you paid there.
 * Nothing is paid here. Customers pay on each shop's own website; the invoice then shows up here and in the wallet.
 */
export function ShopsDirectory() {
  const { shops, loading, error, retry } = useShops()
  const [query, setQuery] = useState('')
  const [id, setId] = useState(() => hashPart(1))
  const [tab, setTab] = useState(tabFromHash)
  const [rewards, setRewards] = useState<MarketReward[]>([])
  const [address, setAddress] = useState<string | null>(null)
  const [activity, setActivity] = useState<Activity[] | null>(null)

  useEffect(() => {
    const follow = () => { setId(hashPart(1)); setTab(tabFromHash()) }
    window.addEventListener('hashchange', follow)
    return () => window.removeEventListener('hashchange', follow)
  }, [])
  useEffect(() => {
    const life = new AbortController()
    void api<{ data: MarketReward[] }>('/v1/public/rewards?source=arkiv', { signal: life.signal }).then((r) => setRewards(r.data), () => {})
    void knownAccount().then((a) => {
      if (!a || life.signal.aborted) return
      setAddress(a)
      return api<{ data: Activity[] }>(`/v1/public/wallets/${a}/activity`, { signal: life.signal }).then((r) => setActivity(r.data))
    }).catch(() => {})
    return () => life.abort()
  }, [])

  const visible = shops.filter((s) => `${s.name} ${s.kind} ${s.blurb}`.toLowerCase().includes(query.trim().toLowerCase()))
  const shop = shops.find((s) => shopId(s) === id || s.name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-') === id) ?? null
  const rewardOf = (s: Shop) => rewards.find((r) => r.merchant.id === s.id)?.label ?? s.reward
  const invoicesOf = (s: Shop) => (activity ?? []).filter((a) => a.merchant.id === s.id)

  return <div className="docs-shell">
    <aside className="docs-sidebar" aria-label="Shop directory">
      <a className="docs-home" href="#shops">Shop directory <span>{shops.length}</span></a>
      <label className="docs-search"><span className="docs-sr">Search shops</span><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search shops…" /></label>
      <div className="docs-group"><p>Browse</p><a href="#shops" aria-current={!shop ? 'page' : undefined}>All shops</a></div>
      {[...new Set(visible.map((s) => s.kind))].map((kind) => <div className="docs-group" key={kind}>
        <p>{kind}</p>
        {visible.filter((s) => s.kind === kind).map((s) => <a key={s.id} href={`#shops/${shopId(s)}`} aria-current={s === shop ? 'page' : undefined}>{s.name}</a>)}
      </div>)}
      {!loading && !error && !visible.length && <p className="docs-empty">{query ? `No shops match “${query}”.` : 'No shops registered yet.'}</p>}
      <div className="docs-sidebar__note">You pay on each shop’s own site.<br />Your invoices collect here.</div>
    </aside>

    <section className="docs-content" aria-label={shop?.name ?? 'All shops'}>
      {error && <div className="shop-alert" role="alert">Could not refresh shops. {error} <button onClick={retry}>Try again</button></div>}
      {loading ? <p role="status">Loading shops…</p> : shop ? <ShopDetail shop={shop} tab={tab} reward={rewardOf(shop)} invoices={invoicesOf(shop)} address={address} loaded={activity !== null} />
        : (!error || shops.length > 0) && <AllShops shops={visible} rewardOf={rewardOf} invoicesOf={invoicesOf} />}
      <footer className="docs-footer"><p>Your shop belongs here. Sign up in two minutes, brand your checkout and join the points network.</p><a href="#merchant">List your business</a></footer>
    </section>
  </div>
}

function AllShops({ shops, rewardOf, invoicesOf }: { shops: Shop[]; rewardOf: (s: Shop) => string; invoicesOf: (s: Shop) => Activity[] }) {
  return <>
    <header className="docs-heading"><p className="docs-breadcrumb">Shops / All shops</p><h1>Meet the shops</h1><p>Independent shops with ChainCred at checkout. Shop on their websites, pay in USDT with one signature, and every invoice lands back here.</p><span className="docs-hook">One points balance, every shop</span></header>
    <div className="shop-cards">
      {shops.map((s) => {
        const count = invoicesOf(s).length
        return <a key={s.id} className="shop-card" href={`#shops/${shopId(s)}`}>
          <span className="shop-card__shot">{shopPhoto(s) ? <img src={shopPhoto(s)!} alt={`Inside ${s.name}`} loading="lazy" /> : <ShopEmblem name={s.name} />}<span className="shop-card__kind">{s.kind}</span></span>
          <span className="shop-card__body">
            <span className="shop-card__title"><ShopEmblem name={s.name} /><b>{s.name}</b></span>
            <span className="shop-card__blurb">{s.blurb}</span>
            <span className="shop-card__foot"><span><Icon name="spark" size={14} />{rewardOf(s)}</span><b>{count ? `${count} ${count === 1 ? 'invoice' : 'invoices'}` : 'View shop'} <Icon name="arrow" size={15} /></b></span>
          </span>
        </a>
      })}
    </div>
    {!shops.length && <div className="wallet-empty"><Icon name="search" size={26} /><b>No shops found</b><span>Search another name or list your business.</span></div>}
  </>
}

function ShopDetail({ shop, tab, reward, invoices, address, loaded }: { shop: Shop; tab: Tab; reward: string; invoices: Activity[]; address: string | null; loaded: boolean }) {
  const host = shop.url ? hostOf(shop.url) : 'Website not added yet'
  const base = `#shops/${shopId(shop)}`
  return <>
    <header className="docs-heading shop-heading">
      <div><p className="docs-breadcrumb">Shops / {shop.kind}</p><h1>{shop.name}</h1><p>{shop.blurb}</p><span className="docs-hook">{reward}</span></div>
      <ShopEmblem name={shop.name} />
    </header>
    <div className="docs-toolbar">
      <div className="docs-tabs" role="tablist" aria-label="Shop view">
        {TABS.map(([t, label]) => <a role="tab" key={t} href={`${base}/${t}`} aria-selected={tab === t}>{label}{t === 'invoices' && invoices.length > 0 && <span className="shop-count">{invoices.length}</span>}</a>)}
      </div>
      {shop.url && <a className="shop-visit" href={shop.url} target="_blank" rel="noreferrer">Visit store <Icon name="external" size={14} /></a>}
    </div>

    {tab === 'overview' && <div className="docs-panel" role="tabpanel">
      <div className="docs-demo-bar"><span><i /> ChainCred merchant</span><span>{host}</span></div>
      <div className="docs-stage shop-shot-stage">
        {shop.url ? <a className="partner-window" href={shop.url} target="_blank" rel="noreferrer" aria-label={`Open ${shop.name}`}>
          {shopPhoto(shop) ? <img src={shopPhoto(shop)!} alt={`Inside ${shop.name}`} /> : <ShopEmblem name={shop.name} />}
        </a> : <div className="wallet-empty"><ShopEmblem name={shop.name} /><b>{shop.name}</b><span>This business has not added a website yet.</span></div>}
      </div>
      <ol className="partner-steps">
        <li><b>Shop on their site</b><span>Fill your cart like any online store.</span></li>
        <li><b>Pay with ChainCred</b><span>One signature in USDT. No gas needed.</span></li>
        <li><b>Invoice lands here</b><span>With the receipt and the points you earned.</span></li>
      </ol>
    </div>}

    {tab === 'invoices' && <div className="docs-panel" role="tabpanel">
      <div className="docs-demo-bar"><span><i /> {address ? `Paid from ${short(address)}` : 'No wallet connected'}</span><a className="docs-link-button" href="#wallet/activity">All invoices</a></div>
      {!address ? <div className="wallet-empty"><Icon name="wallet" size={26} /><b>Connect your wallet to see your invoices</b><span>Open your <a href="#wallet">Wallet</a> and connect the account you pay with.</span></div>
        : !loaded ? <div className="wallet-empty" role="status">Loading your invoices…</div>
          : !invoices.length ? <div className="wallet-empty"><Icon name="receipt" size={26} /><b>No invoices from {shop.name} yet</b><span>Pay this shop with ChainCred. The invoice shows up here.</span></div>
            : <ul className="wallet-list">{invoices.map((a) => <li key={a.id} className="wallet-row">
              <span className="wallet-row__icon"><Icon name="receipt" size={19} /></span>
              <div className="wallet-row__main"><b>{a.invoice?.description ?? 'Payment'}</b><span>{[a.invoice?.reference ?? a.reference, when(a.settledAt)].filter(Boolean).join(' · ')}</span></div>
              <div className="wallet-row__side"><b>{money(a.gross)} USDT</b>
                <span className="wallet-row__tags">
                  {Number(a.refunded) > 0 ? <span className="wallet-tag wallet-tag--bad">Refunded {money(a.refunded)}</span> : <span className="wallet-tag wallet-tag--good">Paid</span>}
                  {a.pointsEarned > 0 && <span className="wallet-tag">+{a.pointsEarned} PKP</span>}
                  {a.invoice && <a href={`#pay/${a.invoice.id}`}>Invoice</a>}
                  {a.txUrl && <a href={a.txUrl} target="_blank" rel="noreferrer">Tx</a>}
                </span>
              </div>
            </li>)}</ul>}
    </div>}

    {tab === 'details' && <section className="docs-props"><div className="docs-props__scroll"><table><tbody>
      <tr><th scope="row">Website</th><td>{shop.url ? <a href={shop.url} target="_blank" rel="noreferrer">{host}</a> : host}</td></tr>
      <tr><th scope="row">Category</th><td>{shop.kind}</td></tr>
      <tr><th scope="row">Reward</th><td>{reward}</td></tr>
      <tr><th scope="row">Points</th><td>Rewards depend on this shop’s active campaigns.</td></tr>
      <tr><th scope="row">Checkout</th><td>USDT on Whitechain testnet. One signature, no gas for customers.</td></tr>
    </tbody></table></div></section>}
  </>
}
