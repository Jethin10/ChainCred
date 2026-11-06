import { useCallback, useEffect, useState } from 'react'
import {
  api, COMPANIES, connectWallet, errorText, hasWallet, isMobileWallet, knownAccount, short,
  type Activity, type MarketReward, type PointsWallet,
} from './server'
import { WalletQuickActions } from '../mobile/DesktopWalletActions'
import { paymentTarget } from '../mobile/payment-link'

const money = (v: string | number) => `${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim())

/**
 * The customer's side of PayKit: every invoice and receipt from every shop that uses PayKit, and
 * the universal points they earned. Reads the live server; real USDT on Whitechain testnet.
 */
export function WalletPage() {
  const [address, setAddress] = useState<string | null>(null)
  const [lookup, setLookup] = useState('')
  const [activity, setActivity] = useState<Activity[] | null>(null)
  const [points, setPoints] = useState<PointsWallet | null>(null)
  const [rewards, setRewards] = useState<MarketReward[]>([])
  const [invoiceId, setInvoiceId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { void knownAccount().then((a) => a && setAddress(a)) }, [])
  useEffect(() => { void api<{ data: MarketReward[] }>('/v1/public/rewards').then((r) => setRewards(r.data), () => setRewards([])) }, [])

  const load = useCallback(async (a: string) => {
    setLoading(true)
    setError(null)
    try {
      const [act, pts] = await Promise.all([
        api<{ data: Activity[] }>(`/v1/public/wallets/${a}/activity`),
        api<PointsWallet>(`/v1/public/points/${a}`),
      ])
      setActivity(act.data)
      setPoints(pts)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { if (address) void load(address) }, [address, load])

  const connect = async () => {
    setError(null)
    try { setAddress(await connectWallet()) } catch (e) { setError(errorText(e)) }
  }
  const openInvoice = (e: React.FormEvent) => {
    e.preventDefault()
    try { location.hash = paymentTarget(invoiceId); setError(null) } catch (e) { setError(errorText(e)) }
  }

  const paidTotal = (activity ?? []).reduce((n, a) => n + Number(a.gross), 0)
  const shops = new Set((activity ?? []).map((a) => a.merchant.name ?? a.merchant.id)).size

  return (
    <section className="page wallet">
      <WalletQuickActions />
      {!address ? (
        <div className="wallet__connect pk-panel">
          <div>
            <h2 className="pk-panel__title">Your invoices, from every shop</h2>
            <p className="pk-muted">Connect the wallet you pay with. You'll see each invoice and receipt from every company that uses PayKit, and the points you can spend anywhere.</p>
          </div>
          <div className="wallet__connect-actions">
            <button type="button" className="pk-button pk-button--primary" onClick={connect}>{hasWallet() ? 'Connect MetaMask' : isMobileWallet() ? 'Open MetaMask' : 'Install MetaMask'}</button>
            <form className="wallet__lookup" onSubmit={(e) => { e.preventDefault(); if (isAddress(lookup)) setAddress(lookup.trim()) }}>
              <input aria-label="Look up a wallet address" placeholder="…or paste a wallet address (0x…)" value={lookup} onChange={(e) => setLookup(e.target.value)} />
              <button type="submit" className="pk-button pk-button--secondary" disabled={!isAddress(lookup)}>Look up</button>
            </form>
          </div>
        </div>
      ) : (
        <>
          <div className="wallet__summary">
            <div className="wallet__stat wallet__stat--points">
              <span className="eyebrow eyebrow--ink">PayKit points</span>
              <b className="wallet__big">{points ? points.balance.toLocaleString() : '…'} <small>PKP</small></b>
              <span className="pk-muted">Earned {points?.lifetimeEarned ?? 0} · spent {points?.lifetimeRedeemed ?? 0}. Spend them at any PayKit shop.</span>
            </div>
            <div className="wallet__stat">
              <span className="eyebrow eyebrow--ink">Paid with PayKit</span>
              <b className="wallet__big">{money(paidTotal)}</b>
              <span className="pk-muted">{activity?.length ?? 0} payments across {shops} {shops === 1 ? 'shop' : 'shops'}</span>
            </div>
            <div className="wallet__stat">
              <span className="eyebrow eyebrow--ink">Wallet</span>
              <b className="wallet__addr" title={address}>{short(address)}</b>
              <span className="wallet__row-actions">
                <button type="button" className="pk-link" onClick={() => void load(address)} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
                <button type="button" className="pk-link" onClick={() => { setAddress(null); setActivity(null); setPoints(null) }}>Switch</button>
              </span>
            </div>
          </div>

          <section className="pk-panel">
            <div className="wallet__head">
              <h2 className="pk-panel__title">Invoices and receipts</h2>
              <form className="wallet__lookup" onSubmit={openInvoice}>
                <input aria-label="Open an invoice by id or link" placeholder="Open an invoice (id or link)" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} />
                <button type="submit" className="pk-button pk-button--secondary" disabled={!invoiceId.trim()}>Open</button>
              </form>
            </div>
            {activity === null ? (
              <p className="pk-muted">{loading ? 'Loading…' : ''}</p>
            ) : activity.length === 0 ? (
              <div className="pk-state pk-state--info"><p className="pk-state__title">Nothing paid from this wallet yet.</p><div className="pk-state__body">Buy something at one of the shops below and pay with PayKit. The invoice and receipt show up here.</div></div>
            ) : (
              <ul className="receipts">
                {activity.map((a) => (
                  <li key={a.id} className="receipt">
                    <div className="receipt__main">
                      <b className="receipt__shop">{a.merchant.name ?? short(a.merchant.id)}</b>
                      <span className="receipt__desc">{a.invoice?.description ?? (a.kind === 'one_time' ? 'Payment' : a.kind.replace('_', ' '))}</span>
                      <span className="receipt__meta">{[a.invoice?.reference ?? a.reference, when(a.settledAt)].filter(Boolean).join(' · ')}</span>
                    </div>
                    <div className="receipt__side">
                      <b className="receipt__amount">{money(a.gross)}</b>
                      <span className="receipt__chips">
                        <span className="pk-tag pk-tag--good">Paid</span>
                        {a.pointsEarned > 0 && <span className="pk-tag">+{a.pointsEarned} PKP</span>}
                        {a.pointsRedeemed > 0 && <span className="pk-tag">−{a.pointsRedeemed} PKP · {money(a.discount)} off</span>}
                        {Number(a.refunded) > 0 && <span className="pk-tag pk-tag--bad">Refunded {money(a.refunded)}</span>}
                      </span>
                      <span className="receipt__links">
                        {a.invoice && <a className="pk-link" href={`#pay/${a.invoice.id}`}>Invoice</a>}
                        {a.txUrl && <a className="pk-link" href={a.txUrl} target="_blank" rel="noreferrer">Transaction</a>}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {points && points.history.length > 0 && (
            <section className="pk-panel">
              <h2 className="pk-panel__title">Points history</h2>
              <ul className="receipts receipts--compact">
                {points.history.map((h, i) => (
                  <li key={i} className="receipt">
                    <div className="receipt__main"><b>{h.type === 'earn' ? 'Earned' : h.type === 'redeem' ? 'Spent' : 'Reversed'}</b><span className="receipt__meta">{[h.merchantName, when(h.at)].filter(Boolean).join(' · ')}</span></div>
                    <div className="receipt__side"><b className={h.type === 'earn' ? 'pk-good' : undefined}>{h.type === 'earn' ? '+' : '−'}{h.amount} PKP</b>{h.txUrl && <a className="pk-link" href={h.txUrl} target="_blank" rel="noreferrer">Transaction</a>}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {error && <div className="pk-state pk-state--error" role="alert"><p className="pk-state__title">Couldn't load your wallet</p><div className="pk-state__body">{error}</div></div>}

      <section className="page__section">
        <p className="eyebrow eyebrow--ink">Shop with PayKit</p>
        <h2>Companies that take PayKit</h2>
        <p className="page__lead">Their own websites, with PayKit at checkout. Points you earn at one, you can spend at the other.</p>
        <Companies rewards={rewards} />
      </section>
    </section>
  )
}

/** The demo companies, as cards that open their websites. */
export function Companies({ rewards = [] }: { rewards?: MarketReward[] }) {
  return (
    <div className="companies">
      {COMPANIES.map((c) => {
        const live = rewards.find((r) => r.merchant.name === c.name)
        return (
          <a key={c.name} className={`company company--${c.tone}`} href={c.url} target="_blank" rel="noreferrer">
            <span className="company__art" aria-hidden="true">{c.tone === 'tea' ? <TeaMark /> : <LanternMark />}</span>
            <span className="company__body">
              <span className="company__kind">{c.kind}</span>
              <b className="company__name">{c.name}</b>
              <span className="company__blurb">{c.blurb}</span>
              <span className="company__foot">
                <span className="pk-tag">{live ? live.label : c.reward}</span>
                <span className="company__go">Visit store →</span>
              </span>
            </span>
          </a>
        )
      })}
    </div>
  )
}

/** Kettle & Leaf: a teacup with one leaf rising like steam. */
function TeaMark() {
  return (
    <svg viewBox="0 0 48 48" className="company__icon">
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 23h21v5.5a8.5 8.5 0 0 1-8.5 8.5h-4A8.5 8.5 0 0 1 11 28.5V23Z" />
        <path d="M32 25h2.5a3.75 3.75 0 0 1 0 7.5H31" />
        <path d="M9 41h26" />
        <path d="M21.5 19c0-6 3.5-10.5 10-11.5 0 6.5-3.5 11-10 11.5Z" className="company__accent" />
        <path d="M21.5 19c2.5-3.5 4.5-6 7.5-8.5" className="company__accent" />
      </g>
    </svg>
  )
}

/** Paper Lantern Books: a paper lantern with a warm flame. */
function LanternMark() {
  return (
    <svg viewBox="0 0 48 48" className="company__icon">
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M24 4.5v4" />
        <path d="M18.5 11.5 20 8.5h8l1.5 3" />
        <rect x="14.5" y="11.5" width="19" height="25" rx="6" />
        <path d="M14.5 18h19M14.5 30h19" opacity=".45" />
        <path d="M19 36.5v3h10v-3" />
      </g>
      <path d="M24 19.5c2.6 2.9 3.6 4.7 3.6 6.4a3.6 3.6 0 0 1-7.2 0c0-1.7 1-3.5 3.6-6.4Z" className="company__flame" />
    </svg>
  )
}
