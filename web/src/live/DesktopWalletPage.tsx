import { useCallback, useEffect, useState } from 'react'
import { ArkivPoints } from './ArkivPoints'
import { api, connectWallet, errorText, hasWallet, isMobileWallet, knownAccount, short, type Activity, type PointsWallet } from './server'
import { spendingOverview, type ActivityRange } from './overview'
import { paymentTarget } from '../mobile/payment-link'
import { useMobile } from '../mobile/context'
import { Icon } from '../mobile/icons'
import '../docs/components.css'
import './desktop-shops.css'

type Section = 'overview' | 'activity' | 'points'
const SECTIONS: Array<{ key: Section; label: string; title: string; lead: string }> = [
  { key: 'overview', label: 'Overview', title: 'Your wallet', lead: 'What you spent, what you earned, and where. Every ChainCred purchase in one place, on Whitechain testnet.' },
  { key: 'activity', label: 'Invoices & receipts', title: 'Invoices & receipts', lead: 'Every payment from this wallet, with its invoice, onchain transaction and the points it earned.' },
  { key: 'points', label: 'Points', title: 'ChainCred points', lead: 'One balance that works at every ChainCred shop. Earn on each purchase, spend them for a discount anywhere.' },
]
const sectionFromHash = (): Section => SECTIONS.find((s) => s.key === location.hash.split('/')[1])?.key ?? 'overview'
const money = (v: string | number) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim())

/** The customer's wallet: invoices, receipts and points from every ChainCred shop. Reads the live ChainCred server. */
export function WalletPage() {
  const mobile = useMobile()
  const [section, setSection] = useState(sectionFromHash)
  const [address, setAddress] = useState<string | null>(null)
  const [activity, setActivity] = useState<Activity[] | null>(null)
  const [points, setPoints] = useState<PointsWallet | null>(null)
  const [invoiceId, setInvoiceId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { const follow = () => setSection(sectionFromHash()); window.addEventListener('hashchange', follow); return () => window.removeEventListener('hashchange', follow) }, [])
  useEffect(() => { void knownAccount().then((a) => a && setAddress(a)) }, [])
  const load = useCallback(async (a: string) => {
    setLoading(true); setError(null)
    try {
      const [act, pts] = await Promise.all([api<{ data: Activity[] }>(`/v1/public/wallets/${a}/activity`), api<PointsWallet>(`/v1/public/points/${a}`)])
      setActivity(act.data); setPoints(pts)
    } catch (e) { setError(errorText(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { if (address) void load(address) }, [address, load])

  const connect = async () => { setError(null); try { setAddress(await connectWallet()) } catch (e) { setError(errorText(e)) } }
  const disconnect = () => { setAddress(null); setActivity(null); setPoints(null) }
  const openInvoice = (e: React.FormEvent) => { e.preventDefault(); try { location.hash = paymentTarget(invoiceId); setError(null) } catch (err) { setError(errorText(err)) } }
  const meta = SECTIONS.find((s) => s.key === section)!

  return <div className="docs-shell">
    <aside className="docs-sidebar" aria-label="Wallet">
      <a className="docs-home" href="#wallet">Wallet <span>{activity?.length ?? 0}</span></a>
      <div className="wallet-who">
        <span><i data-on={!!address} />{address ? 'Connected' : 'Not connected'}</span>
        <b title={address ?? undefined}>{address ? short(address) : 'No wallet yet'}</b>
        {address && <div><button type="button" onClick={() => void load(address)} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button><button type="button" onClick={disconnect}>Switch</button></div>}
      </div>
      <div className="docs-group">
        <p>Your money</p>
        {SECTIONS.map((s) => <a key={s.key} href={`#wallet/${s.key}`} aria-current={section === s.key ? 'page' : undefined}>{s.label}</a>)}
      </div>
      <div className="wallet-tools">
        <p>Pay</p>
        <button type="button" onClick={mobile.scan}><Icon name="scan" size={17} /> Scan a payment QR</button>
        <button type="button" onClick={mobile.settings}><Icon name={mobile.installed ? 'fingerprint' : 'download'} size={17} /> App & device</button>
        <button type="button" onClick={() => { location.hash = '#shops' }}><Icon name="shops" size={17} /> Browse shops</button>
      </div>
      <div className="docs-sidebar__note">Your keys stay in your wallet.<br />ChainCred only reads public receipts.</div>
    </aside>

    <section className="docs-content" aria-label={meta.title}>
      <header className="docs-heading"><p className="docs-breadcrumb">Wallet / {meta.label}</p><h1>{meta.title}</h1><p>{meta.lead}</p><span className="docs-hook">Real test USDT · Whitechain</span></header>
      <div className="docs-toolbar">
        <div className="docs-tabs" role="tablist" aria-label="Wallet view">{SECTIONS.map((s) => <a role="tab" key={s.key} href={`#wallet/${s.key}`} aria-selected={section === s.key}>{s.label}</a>)}</div>
        <form className="wallet-form" onSubmit={openInvoice}><input aria-label="Open an invoice by id or link" placeholder="Open an invoice (id or link)" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} /><button type="submit" className="wallet-btn wallet-btn--ghost" disabled={!invoiceId.trim()}>Open</button></form>
      </div>

      {!address ? <ConnectPanel onConnect={connect} onLookup={setAddress} /> : <>
        {section === 'overview' && <Overview activity={activity} points={points} loading={loading} />}
        {section === 'activity' && <div className="docs-panel"><div className="docs-demo-bar"><span><i /> {activity?.length ?? 0} payments</span><button type="button" onClick={() => void load(address)}>Refresh</button></div><ActivityList activity={activity} loading={loading} /></div>}
        {section === 'points' && <PointsView points={points} wallet={address} />}
      </>}
      {error && <div className="wallet-error" role="alert"><b>Couldn’t load your wallet.</b> {error}</div>}
    </section>
  </div>
}

function ConnectPanel({ onConnect, onLookup }: { onConnect: () => void; onLookup: (a: string) => void }) {
  const [lookup, setLookup] = useState('')
  return <div className="docs-panel">
    <div className="docs-demo-bar"><span><i /> Read-only until you pay</span><span>Whitechain testnet</span></div>
    <div className="docs-stage">
      <div className="wallet-connect">
        <h2>Bring your receipts together</h2>
        <p>Connect the wallet you pay with to see every invoice, receipt and point from every ChainCred shop.</p>
        <button type="button" className="wallet-btn wallet-btn--block" onClick={onConnect}>{hasWallet() ? 'Connect MetaMask' : isMobileWallet() ? 'Open MetaMask' : 'Install MetaMask'}</button>
        <span className="wallet-connect__or">or look one up</span>
        <form className="wallet-form" onSubmit={(e) => { e.preventDefault(); if (isAddress(lookup)) onLookup(lookup.trim()) }}>
          <input aria-label="Look up a wallet address" placeholder="0x… wallet address" value={lookup} onChange={(e) => setLookup(e.target.value)} />
          <button type="submit" className="wallet-btn wallet-btn--ghost" disabled={!isAddress(lookup)}>Look up</button>
        </form>
      </div>
    </div>
  </div>
}

function Overview({ activity, points, loading }: { activity: Activity[] | null; points: PointsWallet | null; loading: boolean }) {
  const [range, setRange] = useState<ActivityRange>('30d')
  const [picked, setPicked] = useState<number | null>(null)
  const list = activity ?? []
  const overview = spendingOverview(list, range)
  const max = Math.max(...overview.buckets.map((b) => b.value), 1)
  const paid = list.reduce((n, a) => n + Number(a.gross), 0)
  const shops = new Set(list.map((a) => a.merchant.name ?? a.merchant.id)).size
  const chosen = picked === null ? null : overview.buckets[picked]
  return <>
    <div className="docs-panel">
      <div className="wallet-stats">
        <div className="wallet-stat"><span>Paid with ChainCred</span><b>{money(paid)}<small>USDT</small></b><em>{list.length} payments across {shops} {shops === 1 ? 'shop' : 'shops'}</em></div>
        <div className="wallet-stat"><span>Points balance</span><b>{points ? points.balance.toLocaleString() : '…'}<small>PKP</small></b><em>Spend them at any ChainCred shop</em></div>
        <div className="wallet-stat"><span>Lifetime</span><b>+{points?.lifetimeEarned ?? 0}<small>earned</small></b><em>{points?.lifetimeRedeemed ?? 0} PKP spent on discounts</em></div>
      </div>
      <div className="docs-demo-bar"><span><i /> Spending · after refunds</span>
        <div className="wallet-range" role="group" aria-label="Period">{([['7d', '7 days'], ['30d', '30 days'], ['6m', '6 months']] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={range === v} onClick={() => { setRange(v); setPicked(null) }}>{l}</button>)}</div>
      </div>
      <div className="wallet-chart">
        <div className="wallet-chart__bars" role="group" aria-label="Spending by date">
          {overview.buckets.map((b, i) => <button key={b.label} type="button" aria-pressed={picked === i} aria-label={`${b.label}: ${b.value.toFixed(2)} USDT`} onClick={() => setPicked(picked === i ? null : i)}>
            <span style={{ height: b.value ? `${Math.max(4, (b.value / max) * 100)}%` : '3px' }} /><small>{b.label}</small>
          </button>)}
        </div>
        <div className="wallet-chart__caption" aria-live="polite">{chosen ? <><span>{chosen.label}</span><b>{money(chosen.value)} USDT · {chosen.count} payments</b></> : <><span>{loading ? 'Refreshing…' : `${overview.count} payments in this period`}</span><b>{money(overview.total)} USDT</b></>}</div>
      </div>
    </div>
    <div className="docs-panel wallet-section-gap">
      <div className="docs-demo-bar"><span><i /> Recent</span><a className="docs-link-button" href="#wallet/activity">See all</a></div>
      <ActivityList activity={activity ? activity.slice(0, 4) : null} loading={loading} />
    </div>
  </>
}

function ActivityList({ activity, loading }: { activity: Activity[] | null; loading: boolean }) {
  if (activity === null) return <div className="wallet-empty" role="status">{loading ? 'Loading your payments…' : ''}</div>
  if (!activity.length) return <div className="wallet-empty"><Icon name="receipt" size={26} /><b>Nothing paid from this wallet yet</b><span>Shop at any store in <a href="#shops">Shops</a> and pay with ChainCred. The invoice shows up here.</span></div>
  return <ul className="wallet-list">
    {activity.map((a) => <li key={a.id} className="wallet-row">
      <span className="wallet-row__icon"><Icon name="receipt" size={19} /></span>
      <div className="wallet-row__main"><b>{a.merchant.name ?? short(a.merchant.id)}</b><span>{[a.invoice?.description ?? (a.kind === 'one_time' ? 'Payment' : a.kind.replace('_', ' ')), a.invoice?.reference ?? a.reference, when(a.settledAt)].filter(Boolean).join(' · ')}</span></div>
      <div className="wallet-row__side"><b>{money(a.gross)} USDT</b>
        <span className="wallet-row__tags">
          {Number(a.refunded) > 0 ? <span className="wallet-tag wallet-tag--bad">Refunded {money(a.refunded)}</span> : <span className="wallet-tag wallet-tag--good">Paid</span>}
          {a.pointsEarned > 0 && <span className="wallet-tag">+{a.pointsEarned} PKP</span>}
          {a.pointsRedeemed > 0 && <span className="wallet-tag">−{a.pointsRedeemed} PKP</span>}
          {a.invoice && <a href={`#pay/${a.invoice.id}`}>Invoice</a>}
          {a.txUrl && <a href={a.txUrl} target="_blank" rel="noreferrer">Tx</a>}
        </span>
      </div>
    </li>)}
  </ul>
}

function PointsView({ points, wallet }: { points: PointsWallet | null; wallet: string }) {
  return <>
    <ArkivPoints wallet={wallet} />
    <div className="docs-panel">
      <div className="wallet-stats">
        <div className="wallet-stat"><span>Balance</span><b>{points ? points.balance.toLocaleString() : '…'}<small>PKP</small></b><em>Usable at every ChainCred shop</em></div>
        <div className="wallet-stat"><span>Earned</span><b>{points?.lifetimeEarned ?? 0}<small>PKP</small></b><em>From your purchases</em></div>
        <div className="wallet-stat"><span>Spent</span><b>{points?.lifetimeRedeemed ?? 0}<small>PKP</small></b><em>On discounts at checkout</em></div>
      </div>
      {!points?.history.length ? <div className="wallet-empty"><Icon name="spark" size={26} /><b>No points yet</b><span>Every ChainCred purchase earns points. <a href="#shops">Find a shop</a>.</span></div>
        : <ul className="wallet-list">{points.history.map((h, i) => <li key={i} className="wallet-row">
          <span className="wallet-row__icon"><Icon name="spark" size={18} /></span>
          <div className="wallet-row__main"><b>{h.type === 'earn' ? 'Earned' : h.type === 'redeem' ? 'Spent' : 'Reversed'}</b><span>{[h.merchantName, when(h.at)].filter(Boolean).join(' · ')}</span></div>
          <div className="wallet-row__side"><b className={h.type === 'earn' ? 'wallet-pos' : undefined}>{h.type === 'earn' ? '+' : '−'}{h.amount} PKP</b>{h.txUrl && <span className="wallet-row__tags"><a href={h.txUrl} target="_blank" rel="noreferrer">Tx</a></span>}</div>
        </li>)}</ul>}
    </div>
  </>
}
