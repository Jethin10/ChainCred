import { useCallback, useEffect, useRef, useState } from 'react'
import { api, connectWallet, errorText, hasWallet, isMobileWallet, knownAccount, short, type Activity, type PointsWallet } from './server'
import { BrandMark } from './BrandMark'
import { SpendingChart } from './SpendingChart'
import { Icon } from '../mobile/icons'
import { Sheet } from '../mobile/Sheet'
import { useMobile } from '../mobile/context'
import { Mark } from '../theme/pixels'
import { paymentTarget } from '../mobile/payment-link'

const money = (value: string | number) => Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const validAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value.trim())
const ADDRESS_KEY = 'paykit:wallet-view'
function savedAddress() { try { const value = localStorage.getItem(ADDRESS_KEY); return value && validAddress(value) ? value : null } catch { return null } }
const sampleActivity: Activity[] = [
  ['Kettle & Leaf', 'Assam Breakfast', '2.50', 1], ['Paper Lantern Books', 'The art of being here', '8.00', 3],
  ['Kettle & Leaf', 'Darjeeling First Flush', '4.50', 6], ['Paper Lantern Books', 'Small hours', '6.00', 11],
  ['Kettle & Leaf', 'Masala Chai Blend', '3.00', 16], ['Paper Lantern Books', 'Notes on a quiet life', '9.00', 23],
].map(([name, description, amount, days], index) => ({
  id: `sample_${index}`, merchant: { id: String(name), name: String(name) }, invoice: null, reference: String(description),
  gross: String(amount), fee: '0', discount: '0', pointsEarned: Number(amount) * 10, pointsRedeemed: 0, refunded: '0', kind: 'one_time', txUrl: null,
  settledAt: new Date(Date.now() - Number(days) * 86_400_000).toISOString(),
}))

export function WalletPage() {
  const mobile = useMobile()
  const [address, setAddress] = useState<string | null>(savedAddress)
  const [lookup, setLookup] = useState('')
  const [activity, setActivity] = useState<Activity[] | null>(null)
  const [points, setPoints] = useState<PointsWallet | null>(null)
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [connectOpen, setConnectOpen] = useState(false)
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [invoiceId, setInvoiceId] = useState('')
  const [preview, setPreview] = useState(false)
  const [filter, setFilter] = useState('All payments')
  const [showAll, setShowAll] = useState(false)
  const [hour] = useState(() => new Date().getHours())
  const version = useRef(0)
  useEffect(() => { const lifecycle = new AbortController(); void knownAccount().then((account) => { if (!lifecycle.signal.aborted && account) setAddress((current) => current || account) }); return () => lifecycle.abort() }, [])
  const load = useCallback(async (account: string, signal?: AbortSignal) => {
    const request = ++version.current
    setLoading(true); setError('')
    try {
      const [payments, rewards] = await Promise.all([api<{ data: Activity[] }>(`/v1/public/wallets/${account}/activity`, { signal }), api<PointsWallet>(`/v1/public/points/${account}`, { signal })])
      if (version.current !== request || signal?.aborted) return
      setActivity(payments.data); setPoints(rewards)
    } catch (e) { if (version.current === request && !signal?.aborted) setError(errorText(e)) }
    finally { if (version.current === request && !signal?.aborted) setLoading(false) }
  }, [])
  useEffect(() => {
    const lifecycle = new AbortController()
    if (address) { try { localStorage.setItem(ADDRESS_KEY, address) } catch { /* storage restricted */ }; queueMicrotask(() => { if (!lifecycle.signal.aborted) void load(address, lifecycle.signal) }) }
    return () => lifecycle.abort()
  }, [address, load])
  const selectAddress = (account: string) => {
    if (account === address) void load(account)
    else { setActivity(null); setPoints(null); setAddress(account) }
    setPreview(false); setConnectOpen(false)
  }
  const connect = async () => {
    setConnecting(true); setError('')
    try { selectAddress(await connectWallet()) } catch (e) { setError(errorText(e)) }
    finally { setConnecting(false) }
  }
  const disconnect = () => { version.current++; setAddress(null); setPreview(false); setActivity(null); setPoints(null); setError(''); setLoading(false); try { localStorage.removeItem(ADDRESS_KEY) } catch { /* storage restricted */ } }
  const rows = preview ? sampleActivity : activity ?? []
  const connected = !!address || preview
  const pointBalance = preview ? 330 : points?.balance
  const paidTotal = rows.reduce((total, payment) => total + Math.max(0, Number(payment.gross) - Number(payment.refunded)), 0)
  const shops = new Set(rows.map((payment) => payment.merchant.id)).size
  const filtered = rows.filter((payment) => filter === 'All payments' || (filter === 'With rewards' ? payment.pointsEarned > 0 || payment.pointsRedeemed > 0 : Number(payment.refunded) > 0))
  const visible = showAll ? filtered : filtered.slice(0, 5)
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  return <section className="wallet-dashboard">
    <header className="customer-heading"><div><p className="customer-greeting">{greeting}. Make yourself at home.</p><h1>Your wallet, in good company.</h1></div><button className={`wallet-account ${!connected ? 'wallet-account--connect' : ''}`} onClick={() => setConnectOpen(true)}><span className={connected ? 'account-dot account-dot--on' : 'account-dot'} /><span>{preview ? 'Sample wallet' : address ? short(address) : 'Connect wallet'}</span><Icon name="chevron" size={14} /></button></header>
    {preview && <div className="sample-notice"><span>You’re exploring a sample wallet. These are illustrative payments.</span><button onClick={() => setPreview(false)}>Exit preview <Icon name="close" size={14} /></button></div>}
    <div className="overview-grid">
      <section className="rewards-card"><div className="rewards-card__brand"><span><Mark />PayKit</span><span className="rewards-card__tag">Rewards</span></div><div className="rewards-card__balance"><span>Your points balance</span><strong>{connected ? pointBalance?.toLocaleString() ?? '—' : '—'}<small>PKP</small></strong><p>{connected ? 'Little purchases. More possibilities.' : 'Good things add up.'}</p></div><span className="rewards-card__pixels" aria-hidden="true" /><div className="rewards-card__bottom"><span><Icon name="spark" size={15} /> Across every PayKit shop</span><a href="#shops" aria-label="Use your PayKit points"><Icon name="arrow" size={19} /></a></div></section>
      <SpendingChart activity={rows} connected={connected} loading={loading} />
    </div>
    <div className="wallet-actionbar"><button onClick={mobile.scan}><span><Icon name="scan" size={22} /></span><b>Scan & pay</b><small>A QR. A signature. Done.</small><Icon name="arrow" size={18} /></button><button onClick={() => { setError(''); setInvoiceOpen(true) }}><span><Icon name="receipt" size={22} /></span><b>Open an invoice</b><small>Your next checkout, right here.</small><Icon name="arrow" size={18} /></button><a href="#shops"><span><Icon name="shops" size={22} /></span><b>Find your favourites</b><small>Discover shops. Earn more.</small><Icon name="arrow" size={18} /></a></div>
    {!connected && <section className="connect-banner"><span className="connect-banner__icon"><Icon name="wallet" size={26} /></span><div><h2>One connection. Everything together.</h2><p>Your receipts, points, and spending, in one quiet corner of the internet.</p></div><div><button className="mobile-primary" onClick={() => setConnectOpen(true)}>Connect wallet <Icon name="arrow" size={17} /></button><button className="mobile-text-button" onClick={() => setPreview(true)}>Take a look around</button></div></section>}
    {error && !connectOpen && !invoiceOpen && <div className="wallet-error" role="alert"><span>{error}</span>{address && <button onClick={() => void load(address)}>Try again</button>}</div>}
    <section className="activity-card"><header className="section-heading"><div><span className="section-kicker">All in one place</span><h2>Recent payments</h2></div>{address && !preview && <button className="quiet-icon" aria-label="Refresh wallet activity" disabled={loading} onClick={() => void load(address)}><Icon name="refresh" size={18} /></button>}</header><div className="activity-filters" role="group" aria-label="Filter payments">{['All payments', 'With rewards', 'Refunded'].map((value) => <button key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setShowAll(false) }}>{value}</button>)}</div>
      {visible.length ? <ul className="payment-list">{visible.map((payment) => <li className="payment-row" key={payment.id}><BrandMark name={payment.merchant.name || 'Merchant'} /><div className="payment-row__main"><b>{payment.merchant.name || 'Merchant'}</b><span>{payment.invoice?.description || payment.reference || 'Payment'}</span><small>{payment.settledAt ? new Date(payment.settledAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'Settled'}<i />{Number(payment.refunded) > 0 ? `Refunded ${money(payment.refunded)} USDT` : 'Completed'}</small></div><div className="payment-row__amount"><b>{money(payment.gross)} <small>USDT</small></b>{payment.pointsEarned > 0 && <span>+{payment.pointsEarned} points</span>}{payment.invoice && <a href={`#pay/${encodeURIComponent(payment.invoice.id)}`}>View invoice <Icon name="chevron" size={11} /></a>}{!payment.invoice && payment.txUrl && <a href={payment.txUrl} target="_blank" rel="noreferrer">Receipt <Icon name="external" size={11} /></a>}</div></li>)}</ul> : <div className="payments-empty"><span><Icon name={filter === 'Refunded' ? 'refresh' : 'receipt'} size={27} /></span><h3>{loading ? 'Gathering your receipts…' : filter !== 'All payments' ? `No ${filter === 'Refunded' ? 'refunds' : 'reward payments'} here yet` : 'A fresh start looks good on you.'}</h3><p>{filter !== 'All payments' ? 'You can always find every purchase under All payments.' : connected ? 'Your next PayKit purchase will land right here.' : 'Connect your wallet to bring your payments together.'}</p>{filter !== 'All payments' ? <button className="mobile-text-button" onClick={() => setFilter('All payments')}>View all payments <Icon name="arrow" size={16} /></button> : <a href="#shops">Discover the shops <Icon name="arrow" size={16} /></a>}</div>}
      {filtered.length > 5 && <button className="show-payments" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer payments' : `View all ${filtered.length} payments`}<Icon name="chevron" size={15} /></button>}
    </section>
    {connected && <div className="wallet-facts"><div><span>Net spent</span><b>{money(paidTotal)} <small>USDT</small></b></div><div><span>Shops supported</span><b>{shops.toString().padStart(2, '0')}</b></div><div><span>Points earned</span><b>{preview ? '330' : points?.lifetimeEarned.toLocaleString() ?? '—'}</b></div></div>}
    <div className="wallet-assurance"><Icon name="shield" size={15} /><span>Your wallet stays yours. PayKit never holds your funds.</span></div>
    {connectOpen && <Sheet title={connected ? 'Your wallet' : 'A place for everything'} onClose={() => setConnectOpen(false)}><p className="mobile-sheet__lead">Connect with MetaMask to see your receipts and rewards. Your wallet remains in your control.</p>{connected && <div className="connected-wallet"><Icon name="wallet" size={23} /><span>{preview ? 'Sample wallet' : address}</span><button onClick={() => { disconnect(); setConnectOpen(false) }}>Clear wallet view</button></div>}<button className="mobile-primary connect-wallet-button" disabled={connecting} onClick={() => void connect()}><Icon name="wallet" size={20} />{connecting ? 'Waiting for your wallet…' : hasWallet() ? 'Connect MetaMask' : isMobileWallet() ? 'Open MetaMask' : 'Install MetaMask'}</button><div className="scan-divider"><span>or view an address</span></div><form className="address-form" onSubmit={(event) => { event.preventDefault(); if (validAddress(lookup)) { selectAddress(lookup.trim()) } }}><label htmlFor="wallet-address">Wallet address</label><input id="wallet-address" placeholder="0x…" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={lookup} onChange={(event) => setLookup(event.target.value)} /><p>Read-only. No connection or signature needed.</p><button className="mobile-secondary" disabled={!validAddress(lookup)}>View wallet <Icon name="arrow" size={17} /></button></form>{error && <p className="mobile-error" role="alert">{error}</p>}</Sheet>}
    {invoiceOpen && <Sheet title="Open an invoice" onClose={() => setInvoiceOpen(false)}><p className="mobile-sheet__lead">Paste the payment link or invoice ID from your shop.</p><form className="address-form" onSubmit={(event) => { event.preventDefault(); try { const target = paymentTarget(invoiceId); setError(''); setInvoiceOpen(false); location.hash = target } catch (e) { setError(errorText(e)) } }}><label htmlFor="wallet-invoice">Invoice link or ID</label><input id="wallet-invoice" value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)} placeholder="https://… or inv_…" autoCapitalize="none" autoCorrect="off" spellCheck={false} /><button className="mobile-primary" disabled={!invoiceId.trim()}>Review invoice <Icon name="arrow" size={18} /></button></form>{error && <p className="mobile-error" role="alert">{error}</p>}</Sheet>}
  </section>
}
