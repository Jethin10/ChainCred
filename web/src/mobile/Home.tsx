import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { api, connectWallet, errorText, hasWallet, isMobileWallet, knownAccount, short, type Activity, type MarketReward, type PointsWallet } from '../live/server'
import { BrandMark } from '../live/BrandMark'
import { ArkivPoints } from '../live/ArkivPoints'
import { PixelSky } from '../theme/pixels'
import { Icon, type IconName } from './icons'
import { Sheet } from './Sheet'
import { useMobile } from './context'
import { paymentTarget } from './payment-link'

const money = (v: string | number) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const validAddress = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v.trim())
const ADDRESS_KEY = 'paykit:wallet-view'
const savedAddress = () => { try { const v = localStorage.getItem(ADDRESS_KEY); return v && validAddress(v) ? v : null } catch { return null } }

const SAMPLE: Activity[] = ([
  ['Kettle & Leaf', 'Assam Breakfast', '2.50', 0], ['Paper Lantern Books', 'The art of being here', '8.00', 1],
  ['Kettle & Leaf', 'Darjeeling First Flush', '4.50', 4], ['Paper Lantern Books', 'Small hours', '6.00', 9],
] as const).map(([name, description, amount, days], i) => ({
  id: `sample_${i}`, merchant: { id: name, name }, invoice: null, reference: description, gross: amount, fee: '0', discount: '0',
  pointsEarned: Number(amount) * 10, pointsRedeemed: 0, refunded: '0', kind: 'one_time', txUrl: null,
  settledAt: new Date(Date.now() - days * 86_400_000).toISOString(),
}))

function dayLabel(iso?: string | null) {
  if (!iso) return 'Earlier'
  const d = new Date(iso), today = new Date()
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000)
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

/** Counts up to the value with an ease-out, so a new balance lands instead of jumping. */
function useCountUp(target: number) {
  const [value, setValue] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const start = from.current
    if (start === target || matchMedia('(prefers-reduced-motion: reduce)').matches) { from.current = target; queueMicrotask(() => setValue(target)); return }
    const anim = { raf: 0 }
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 900), e = 1 - Math.pow(1 - p, 3)
      const v = Math.round(start + (target - start) * e)
      from.current = v; setValue(v)
      if (p < 1) anim.raf = requestAnimationFrame(tick)
    }
    anim.raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(anim.raf)
  }, [target])
  return value
}

export function Home() {
  const mobile = useMobile()
  const [address, setAddress] = useState<string | null>(savedAddress)
  const [activity, setActivity] = useState<Activity[] | null>(null)
  const [points, setPoints] = useState<PointsWallet | null>(null)
  const [rewards, setRewards] = useState<MarketReward[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sample, setSample] = useState(false)
  const [sheet, setSheet] = useState<'wallet' | 'link' | null>(null)
  const version = useRef(0)

  useEffect(() => {
    const life = new AbortController()
    void knownAccount().then((a) => { if (!life.signal.aborted && a) setAddress((cur) => cur || a) })
    void api<{ data: MarketReward[] }>('/v1/public/rewards?source=arkiv', { signal: life.signal }).then((r) => setRewards(r.data), () => {})
    return () => life.abort()
  }, [])
  const load = useCallback(async (account: string, signal?: AbortSignal) => {
    const run = ++version.current
    setLoading(true); setError('')
    try {
      const [pay, pts] = await Promise.all([api<{ data: Activity[] }>(`/v1/public/wallets/${account}/activity`, { signal }), api<PointsWallet>(`/v1/public/points/${account}`, { signal })])
      if (run !== version.current || signal?.aborted) return
      setActivity(pay.data); setPoints(pts)
    } catch (e) { if (run === version.current && !signal?.aborted) setError(errorText(e)) }
    finally { if (run === version.current && !signal?.aborted) setLoading(false) }
  }, [])
  useEffect(() => {
    if (!address) return
    const life = new AbortController()
    try { localStorage.setItem(ADDRESS_KEY, address) } catch { /* storage restricted */ }
    queueMicrotask(() => { if (!life.signal.aborted) void load(address, life.signal) })
    return () => life.abort()
  }, [address, load])

  const choose = (a: string) => { if (a === address) void load(a); else { setActivity(null); setPoints(null); setAddress(a) } setSample(false); setSheet(null) }
  const forget = () => { version.current++; setAddress(null); setActivity(null); setPoints(null); setSample(false); setLoading(false); try { localStorage.removeItem(ADDRESS_KEY) } catch { /* storage restricted */ } }

  const rows = useMemo(() => (sample ? SAMPLE : activity ?? []), [sample, activity])
  const live = !!address || sample
  const balance = sample ? 210 : points?.balance ?? null
  const [today] = useState(() => ({ date: new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }), hello: greeting() }))
  const shown = useCountUp(live ? balance ?? 0 : 0)
  const [monthStart] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime() })
  const month = useMemo(() => {
    const inMonth = rows.filter((p) => p.settledAt && new Date(p.settledAt).getTime() >= monthStart)
    return { total: inMonth.reduce((t, p) => t + Math.max(0, Number(p.gross) - Number(p.refunded)), 0), count: inMonth.length }
  }, [rows, monthStart])
  const groups = useMemo(() => {
    const out: Array<[string, Activity[]]> = []
    for (const p of rows.slice(0, 20)) { const k = dayLabel(p.settledAt); const g = out.find(([l]) => l === k); if (g) g[1].push(p); else out.push([k, [p]]) }
    return out
  }, [rows])

  const actions: Array<{ icon: IconName; label: string; run: () => void }> = [
    { icon: 'scan', label: 'Scan', run: mobile.scan },
    { icon: 'receipt', label: 'Pay link', run: () => { setError(''); setSheet('link') } },
    { icon: 'shops', label: 'Shops', run: () => { location.hash = 'shops' } },
    { icon: 'wallet', label: live ? 'Account' : 'Connect', run: () => { setError(''); setSheet('wallet') } },
  ]

  return <div className="m-home m-rise">
    <header className="m-hello">
      <p className="m-label">{today.date}</p>
      <h2>{today.hello}<em>.</em></h2>
    </header>

    <section className="m-sky" aria-label="Points and spending">
      <PixelSky seed={3} cell={14} clearCenter={false} />
      <div className="m-ticket">
        <div className="m-ticket__top">
          <span className="m-label">PayKit points</span>
          <button className="m-chip" onClick={() => setSheet('wallet')}><i data-on={live} />{sample ? 'Sample wallet' : address ? short(address) : 'Not connected'}</button>
        </div>
        <p className="m-ticket__balance" aria-label={`${live ? balance ?? 0 : 0} points`}>{live && balance === null ? '—' : shown.toLocaleString()}<small>PKP</small></p>
        {live
          ? <p className="m-ticket__sub"><b>{money(month.total)} USDT</b> spent this month · {month.count} {month.count === 1 ? 'payment' : 'payments'}</p>
          : <div className="m-ticket__cta"><button className="m-cta" onClick={() => setSheet('wallet')}><Icon name="wallet" size={18} />Connect MetaMask</button><button className="m-textlink" onClick={() => setSample(true)}>See a sample</button></div>}
      </div>
    </section>

    <nav className="m-actions" aria-label="Quick actions">
      {actions.map((a) => <button key={a.label} onClick={a.run}><span><Icon name={a.icon} size={22} /></span>{a.label}</button>)}
    </nav>

    {address && !sample && <ArkivPoints wallet={address} compact />}

    {sample && <p className="m-banner">Sample wallet. <button onClick={() => setSample(false)}>Exit</button></p>}
    {error && !sheet && <p className="m-banner m-banner--bad" role="alert">{error}{address && <button onClick={() => void load(address)}>Retry</button>}</p>}

    {rewards.length > 0 && <section className="m-section" aria-label="Spend your points">
      <header className="m-section__head"><div><p className="m-label">Rewards</p><h2>Spend points</h2></div><a href="#shops">All shops <Icon name="arrow" size={15} /></a></header>
      <div className="m-rewards">{rewards.slice(0, 4).map((r) => {
        const have = live ? balance ?? 0 : 0
        const pct = Math.min(100, Math.round((have / r.pointsCost) * 100))
        return <a key={r.id} className="m-reward" href="#shops"><span className="m-reward__head"><BrandMark name={r.merchant.name} /><small>{r.pointsCost} pts</small></span><b>{r.name}</b><span>{r.merchant.name}</span><div className="m-blocks" role="img" aria-label={`${pct}% of the points needed`}>{Array.from({ length: 10 }, (_, k) => <i key={k} data-on={k < Math.round(pct / 10)} style={{ '--k': k } as CSSProperties} />)}</div><small>{have >= r.pointsCost ? 'Ready to use' : `${Math.max(0, r.pointsCost - have)} pts to go`}</small></a>
      })}</div>
    </section>}

    <section className="m-section" aria-label="Payments">
      <header className="m-section__head"><div><p className="m-label">Activity</p><h2>Payments</h2></div>{address && !sample && <button aria-label="Refresh" disabled={loading} onClick={() => void load(address)}><Icon name="refresh" size={17} /></button>}</header>
      {groups.length ? groups.map(([day, list]) => <div key={day} className="m-day">
        <p className="m-day__label m-label">{day}</p>
        <ul className="m-list">{list.map((p) => {
          const href = p.invoice ? `#pay/${encodeURIComponent(p.invoice.id)}` : p.txUrl
          const body = <><BrandMark name={p.merchant.name || 'Merchant'} /><span className="m-row__main"><b>{p.merchant.name || 'Merchant'}</b><span>{p.invoice?.description || p.reference || 'Payment'}</span></span><span className="m-row__amt"><b>−{money(p.gross)}</b>{Number(p.refunded) > 0 ? <small className="m-muted">Refunded {money(p.refunded)}</small> : p.pointsEarned > 0 && <small>+{p.pointsEarned} pts</small>}</span></>
          return <li key={p.id}>{href ? <a className="m-row" href={href} {...(p.txUrl && !p.invoice ? { target: '_blank', rel: 'noreferrer' } : {})}>{body}</a> : <div className="m-row">{body}</div>}</li>
        })}</ul>
      </div>) : <div className="m-empty"><Icon name="receipt" size={24} /><p>{loading ? 'Loading payments…' : live ? 'No payments yet.' : 'Connect a wallet to see your payments.'}</p>{!loading && <a href="#shops">Browse shops</a>}</div>}
    </section>

    {sheet === 'wallet' && <WalletSheet address={address} sample={sample} onPick={choose} onForget={() => { forget(); setSheet(null) }} onClose={() => setSheet(null)} />}
    {sheet === 'link' && <LinkSheet onClose={() => setSheet(null)} />}
  </div>
}

function WalletSheet({ address, sample, onPick, onForget, onClose }: { address: string | null; sample: boolean; onPick: (a: string) => void; onForget: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lookup, setLookup] = useState('')
  const connect = async () => { setBusy(true); setError(''); try { onPick(await connectWallet()) } catch (e) { setError(errorText(e)) } finally { setBusy(false) } }
  return <Sheet title="Wallet" onClose={onClose}>
    {(address || sample) && <div className="m-acct"><Icon name="wallet" size={20} /><code>{sample ? 'Sample wallet' : address}</code><button onClick={onForget}>Disconnect</button></div>}
    <button className="mobile-primary" disabled={busy} onClick={() => void connect()}><Icon name="wallet" size={19} />{busy ? 'Check MetaMask…' : hasWallet() ? (address ? 'Switch account' : 'Connect MetaMask') : isMobileWallet() ? 'Open in MetaMask' : 'Install MetaMask'}</button>
    <form className="m-form" onSubmit={(e) => { e.preventDefault(); if (validAddress(lookup)) onPick(lookup.trim()) }}>
      <label htmlFor="m-address">Or view any address (read-only)</label>
      <div><input id="m-address" placeholder="0x…" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={lookup} onChange={(e) => setLookup(e.target.value)} /><button disabled={!validAddress(lookup)} aria-label="View address"><Icon name="arrow" size={18} /></button></div>
    </form>
    {error && <p className="mobile-error" role="alert">{error}</p>}
  </Sheet>
}

function LinkSheet({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  return <Sheet title="Pay a link" onClose={onClose}>
    <form className="m-form" onSubmit={(e) => { e.preventDefault(); try { const t = paymentTarget(value); onClose(); location.hash = t } catch (err) { setError(errorText(err)) } }}>
      <label htmlFor="m-link">Payment link or invoice ID</label>
      <div><input id="m-link" autoFocus placeholder="https://… or inv_…" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} /><button disabled={!value.trim()} aria-label="Open"><Icon name="arrow" size={18} /></button></div>
    </form>
    {error && <p className="mobile-error" role="alert">{error}</p>}
  </Sheet>
}
