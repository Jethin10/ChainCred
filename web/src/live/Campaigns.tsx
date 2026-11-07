import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, errorText, type AppliesTo, type Campaign, type ItemStatus, type PointsSummary, type Reward } from './server'

// The merchant's loyalty programme: several earn campaigns and spend offers can run at once.
//
//   Earn   "X points for every Y USDT"            → pointsPerUsdt = X / Y
//          "N bonus points on orders of M+ USDT"  → pointsPerUsdt = N / M, minSpend = M, maxPointsPerOrder = N
//          At checkout the server applies the single best eligible earn campaign (no stacking).
//   Spend  "P points for X USDT off" / "P points for X% off" (the customer picks one per order)

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v))
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 })
const usdt = (v: string | number) => `${fmt(Number(v))} USDT`
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '')
const fromDateInput = (v: string, endOfDay = false) => (v ? new Date(`${v}T${endOfDay ? '23:59:59' : '00:00:00'}`).toISOString() : null)

/** A flat bonus is stored as a capped rate: rate × minSpend = cap. */
export function bonusOf(c: Pick<Campaign, 'pointsPerUsdt' | 'minSpend' | 'maxPointsPerOrder'>): { points: number; minSpend: number } | null {
  const min = num(c.minSpend)
  if (!min || !c.maxPointsPerOrder) return null
  return Math.abs(c.pointsPerUsdt * min - c.maxPointsPerOrder) < 1e-6 ? { points: c.maxPointsPerOrder, minSpend: min } : null
}

/** "10 points for every 100 USDT" from a rate, picking a readable "every" amount. */
function rateParts(rate: number): { points: number; per: number } {
  for (const per of [1, 10, 100, 1000]) {
    const pts = rate * per
    if (Math.abs(pts - Math.round(pts)) < 1e-6 && Math.round(pts) >= 1) return { points: Math.round(pts), per }
  }
  return { points: Number((rate * 100).toFixed(4)), per: 100 }
}

export function campaignHeadline(c: Campaign): string {
  const b = bonusOf(c)
  if (b) return `+${fmt(b.points)} bonus points on orders of ${usdt(b.minSpend)} or more`
  const { points, per } = rateParts(c.pointsPerUsdt)
  return `${fmt(points)} points for every ${per === 1 ? '1 USDT' : usdt(per)} spent`
}

function campaignDetails(c: Campaign): string[] {
  const b = bonusOf(c)
  const out: string[] = []
  if (!b && c.minSpend) out.push(`min order ${usdt(c.minSpend)}`)
  if (!b && c.maxPointsPerOrder) out.push(`max ${fmt(c.maxPointsPerOrder)} per order`)
  if (c.firstPurchaseOnly) out.push('first purchase only')
  if (c.appliesTo !== 'all') out.push(c.appliesTo === 'payments' ? 'one-off payments only' : 'subscriptions only')
  if (c.budget) out.push(`${fmt(c.remainingBudget ?? 0)} of ${fmt(c.budget)} points left`)
  if (c.startsAt || c.endsAt) out.push([c.startsAt && `from ${day(c.startsAt)}`, c.endsAt && `until ${day(c.endsAt)}`].filter(Boolean).join(' '))
  return out
}

function rewardDetails(r: Reward): string[] {
  const out: string[] = []
  if (r.minSpend) out.push(`min order ${usdt(r.minSpend)}`)
  if (r.perWalletLimit) out.push(`${r.perWalletLimit} per customer`)
  if (r.totalLimit) out.push(`${fmt(r.remaining ?? 0)} of ${fmt(r.totalLimit)} left`)
  if (r.startsAt || r.endsAt) out.push([r.startsAt && `from ${day(r.startsAt)}`, r.endsAt && `until ${day(r.endsAt)}`].filter(Boolean).join(' '))
  return out
}

type Badge = { label: string; tone: 'good' | 'progress' | 'off' }
function badgeFor(x: { status: ItemStatus; startsAt: string | null; endsAt: string | null }, soldOut: boolean): Badge {
  const t = Date.now()
  if (x.status === 'archived') return { label: 'archived', tone: 'off' }
  if (x.status === 'paused') return { label: 'paused', tone: 'off' }
  if (x.endsAt && new Date(x.endsAt).getTime() <= t) return { label: 'ended', tone: 'off' }
  if (soldOut) return { label: 'used up', tone: 'off' }
  if (x.startsAt && new Date(x.startsAt).getTime() > t) return { label: 'scheduled', tone: 'progress' }
  return { label: 'live', tone: 'good' }
}

// ───────────────────────── panel ─────────────────────────

export function Campaigns({ token, onAuthError }: { token: string; onAuthError: (e: unknown) => boolean }) {
  const [tab, setTab] = useState<'earn' | 'spend'>('earn')
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [rewards, setRewards] = useState<Reward[] | null>(null)
  const [summary, setSummary] = useState<PointsSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ kind: 'earn'; item: Campaign | null } | { kind: 'spend'; item: Reward | null } | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const fail = useCallback((e: unknown) => { if (!onAuthError(e)) setError(errorText(e)) }, [onAuthError])

  const load = useCallback(async () => {
    try {
      const [c, r, s] = await Promise.all([
        api<{ data: Campaign[] }>('/v1/points/campaigns', { key: token }),
        api<{ data: Reward[] }>('/v1/points/rewards', { key: token }),
        api<PointsSummary>('/v1/points/summary', { key: token }).catch(() => null),
      ])
      setCampaigns(c.data); setRewards(r.data); setSummary(s); setError(null)
    } catch (e) {
      fail(e)
      setCampaigns((x) => x ?? []); setRewards((x) => x ?? [])
    }
  }, [token, fail])
  useEffect(() => { void load() }, [load])

  const setStatus = async (kind: 'earn' | 'spend', id: string, status: ItemStatus) => {
    setBusyId(id)
    try {
      await api(`/v1/points/${kind === 'earn' ? 'campaigns' : 'rewards'}/${id}`, { method: 'PATCH', key: token, body: { status } })
      await load()
    } catch (e) { fail(e) } finally { setBusyId(null) }
  }

  const list = tab === 'earn' ? campaigns : rewards
  const visible = useMemo(() => (list ?? []).filter((x) => showArchived || x.status !== 'archived'), [list, showArchived])
  const archivedCount = (list ?? []).filter((x) => x.status === 'archived').length
  const liveEarn = (campaigns ?? []).filter((c) => c.live).length

  return (
    <section className="pk-panel camp" aria-label="Campaigns">
      <div className="camp__head">
        <div>
          <h3 className="pk-panel__title">Campaigns</h3>
          <p className="pk-muted">Reward customers with ChainCred points when they pay, and let them spend points with you. Run as many as you like.</p>
        </div>
        <button type="button" className="pk-button pk-button--primary" onClick={() => setEditing(tab === 'earn' ? { kind: 'earn', item: null } : { kind: 'spend', item: null })}>
          {tab === 'earn' ? 'New earn campaign' : 'New spend offer'}
        </button>
      </div>

      {summary && (
        <div className="camp__stats">
          <div><span>Points given</span><b>{fmt(summary.issued.points)}</b><small>{summary.issued.customers} customers</small></div>
          <div><span>Points spent with you</span><b>{fmt(summary.redeemedAtYou.points)}</b><small>{summary.redeemedAtYou.redemptions} orders</small></div>
          <div><span>Discounts given</span><b>{usdt(summary.redeemedAtYou.discountGiven)}</b><small>funded by you</small></div>
          <div><span>New customers via points</span><b>{summary.redeemedAtYou.newCustomersViaPoints}</b><small>from other ChainCred shops</small></div>
        </div>
      )}

      <div className="pk-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'earn'} className={`pk-tab${tab === 'earn' ? ' pk-tab--on' : ''}`} onClick={() => { setTab('earn'); setEditing(null) }}>
          Earn points · {(campaigns ?? []).filter((c) => c.status !== 'archived').length}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'spend'} className={`pk-tab${tab === 'spend' ? ' pk-tab--on' : ''}`} onClick={() => { setTab('spend'); setEditing(null) }}>
          Spend points · {(rewards ?? []).filter((r) => r.status !== 'archived').length}
        </button>
      </div>

      <p className="pk-muted camp__hint">
        {tab === 'earn'
          ? `Customers earn points when they pay you. If several campaigns match an order, only the one that gives the most points applies.${liveEarn > 1 ? ` ${liveEarn} are live now.` : ''}`
          : 'Customers choose one offer at checkout and pay less. You receive the discounted amount; the points are burned.'}
      </p>

      {error && <div className="pk-state pk-state--error" role="alert"><div className="pk-state__body">{error}</div></div>}

      {editing?.kind === 'earn' && tab === 'earn' && (
        <EarnForm token={token} item={editing.item} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} onError={fail} />
      )}
      {editing?.kind === 'spend' && tab === 'spend' && (
        <SpendForm token={token} item={editing.item} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} onError={fail} />
      )}

      {list === null ? <p className="pk-muted">Loading…</p> : visible.length === 0 ? (
        <div className="camp__empty">
          <p>{tab === 'earn' ? 'No earn campaigns yet. Start with something like 10 points for every 100 USDT.' : 'No spend offers yet. Let customers use their points with you, for example 100 points for 5 USDT off.'}</p>
        </div>
      ) : (
        <ul className="camp__list">
          {tab === 'earn'
            ? (visible as Campaign[]).map((c) => (
                <Row key={c.id} name={c.name} headline={campaignHeadline(c)} details={campaignDetails(c)}
                  stats={`${fmt(c.issued)} points given · ${c.wallets} customers`}
                  badge={badgeFor(c, !!c.budget && (c.remainingBudget ?? 0) <= 0)} status={c.status} busy={busyId === c.id}
                  onEdit={() => setEditing({ kind: 'earn', item: c })} onStatus={(s) => setStatus('earn', c.id, s)} />
              ))
            : (visible as Reward[]).map((r) => (
                <Row key={r.id} name={r.name} headline={r.label} details={rewardDetails(r)}
                  stats={`${r.redeemed} redeemed · ${usdt(r.discountGiven)} off given`}
                  badge={badgeFor(r, !!r.totalLimit && (r.remaining ?? 0) <= 0)} status={r.status} busy={busyId === r.id}
                  onEdit={() => setEditing({ kind: 'spend', item: r })} onStatus={(s) => setStatus('spend', r.id, s)} />
              ))}
        </ul>
      )}
      {archivedCount > 0 && (
        <button type="button" className="pk-link camp__archived" onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
        </button>
      )}
    </section>
  )
}

function Row({ name, headline, details, stats, badge, status, busy, onEdit, onStatus }: {
  name: string; headline: string; details: string[]; stats: string; badge: Badge; status: ItemStatus; busy: boolean
  onEdit: () => void; onStatus: (s: ItemStatus) => void
}) {
  return (
    <li className={`camp__row${status !== 'active' ? ' camp__row--off' : ''}`}>
      <div className="camp__main">
        <b>{name}</b>
        <span className="camp__headline">{headline}</span>
        {details.length > 0 && <span className="camp__meta">{details.join(' · ')}</span>}
        <span className="camp__meta">{stats}</span>
      </div>
      <div className="camp__side">
        <span className={`pk-tag ${badge.tone === 'good' ? 'pk-tag--good' : badge.tone === 'progress' ? 'pk-tag--progress' : ''}`}>{badge.label}</span>
        <span className="camp__actions">
          {status !== 'archived' && <button type="button" className="pk-link" disabled={busy} onClick={onEdit}>Edit</button>}
          {status === 'active' && <button type="button" className="pk-link" disabled={busy} onClick={() => onStatus('paused')}>Pause</button>}
          {status === 'paused' && <button type="button" className="pk-link" disabled={busy} onClick={() => onStatus('active')}>Resume</button>}
          {status !== 'archived'
            ? <button type="button" className="pk-link" disabled={busy} onClick={() => onStatus('archived')}>Archive</button>
            : <button type="button" className="pk-link" disabled={busy} onClick={() => onStatus('paused')}>Restore</button>}
        </span>
      </div>
    </li>
  )
}

function F({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="onb-field"><span className="onb-field__label">{label}{hint && <span className="onb-field__hint"> · {hint}</span>}</span>{children}</label>
}

const positive = (v: string) => Number.isFinite(Number(v)) && Number(v) > 0
const usdtOk = (v: string) => /^\d+(\.\d{1,6})?$/.test(v.trim()) && Number(v) > 0
const optional = (v: string) => (v.trim() === '' ? null : v.trim())

// ───────────────────────── earn form ─────────────────────────

type EarnDraft = {
  kind: 'rate' | 'bonus'; name: string
  points: string; per: string // rate: X points for every Y USDT
  bonus: string; threshold: string // bonus: N points on orders of M+ USDT
  minSpend: string; maxPerOrder: string; budget: string
  firstPurchaseOnly: boolean; appliesTo: AppliesTo; startsAt: string; endsAt: string
}

function earnDraftFrom(c: Campaign | null): EarnDraft {
  const base: EarnDraft = { kind: 'rate', name: '', points: '10', per: '100', bonus: '50', threshold: '500', minSpend: '', maxPerOrder: '', budget: '', firstPurchaseOnly: false, appliesTo: 'all', startsAt: '', endsAt: '' }
  if (!c) return base
  const b = bonusOf(c)
  const r = rateParts(c.pointsPerUsdt)
  return {
    ...base,
    kind: b ? 'bonus' : 'rate', name: c.name,
    points: String(r.points), per: String(r.per),
    bonus: b ? String(b.points) : base.bonus, threshold: b ? String(b.minSpend) : base.threshold,
    minSpend: !b && c.minSpend ? String(Number(c.minSpend)) : '', maxPerOrder: !b && c.maxPointsPerOrder ? String(c.maxPointsPerOrder) : '',
    budget: c.budget ? String(c.budget) : '', firstPurchaseOnly: c.firstPurchaseOnly, appliesTo: c.appliesTo,
    startsAt: toDateInput(c.startsAt), endsAt: toDateInput(c.endsAt),
  }
}

function EarnForm({ token, item, onCancel, onSaved, onError }: { token: string; item: Campaign | null; onCancel: () => void; onSaved: () => void; onError: (e: unknown) => void }) {
  const [d, setD] = useState<EarnDraft>(() => earnDraftFrom(item))
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof EarnDraft>(k: K, v: EarnDraft[K]) => { setD((x) => ({ ...x, [k]: v })); setProblem(null) }
  const [more, setMore] = useState(() => !!(item && (d.minSpend || d.maxPerOrder || d.budget || d.firstPurchaseOnly || d.appliesTo !== 'all' || d.startsAt || d.endsAt)))

  const autoName = d.kind === 'bonus' ? `Bonus ${d.bonus || 'N'} points over ${d.threshold || 'M'} USDT` : `${d.points || 'X'} points per ${d.per || 'Y'} USDT`
  const example = useMemo(() => {
    const order = d.kind === 'bonus' ? Number(d.threshold) || 0 : 120
    if (d.kind === 'bonus') return order ? `An order of ${usdt(order)} earns ${fmt(Number(d.bonus) || 0)} points. Smaller orders earn nothing from this campaign.` : ''
    let pts = Math.floor((order * (Number(d.points) || 0)) / (Number(d.per) || 1))
    if (d.maxPerOrder && positive(d.maxPerOrder)) pts = Math.min(pts, Number(d.maxPerOrder))
    return `A ${usdt(order)} order earns ${fmt(pts)} points.`
  }, [d])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    let body: Record<string, unknown>
    if (d.kind === 'rate') {
      if (!positive(d.points) || !positive(d.per)) return setProblem('Enter how many points, and for how many USDT spent.')
      if (d.minSpend && !usdtOk(d.minSpend)) return setProblem('Minimum order must be a USDT amount like 25 or 12.50.')
      if (d.maxPerOrder && !(Number.isInteger(Number(d.maxPerOrder)) && Number(d.maxPerOrder) > 0)) return setProblem('Max points per order must be a whole number.')
      body = {
        pointsPerUsdt: Number(d.points) / Number(d.per),
        minSpend: optional(d.minSpend), maxPointsPerOrder: d.maxPerOrder ? Number(d.maxPerOrder) : null,
      }
    } else {
      if (!(Number.isInteger(Number(d.bonus)) && Number(d.bonus) > 0)) return setProblem('Bonus points must be a whole number.')
      if (!usdtOk(d.threshold)) return setProblem('Enter the order amount (in USDT) that unlocks the bonus.')
      body = { pointsPerUsdt: Number(d.bonus) / Number(d.threshold), minSpend: d.threshold.trim(), maxPointsPerOrder: Number(d.bonus) }
    }
    if (d.budget && !(Number.isInteger(Number(d.budget)) && Number(d.budget) > 0)) return setProblem('Budget must be a whole number of points.')
    if (d.startsAt && d.endsAt && d.endsAt < d.startsAt) return setProblem('The end date is before the start date.')
    Object.assign(body, {
      name: d.name.trim() || autoName,
      budget: d.budget ? Number(d.budget) : null,
      firstPurchaseOnly: d.firstPurchaseOnly, appliesTo: d.appliesTo,
      startsAt: fromDateInput(d.startsAt), endsAt: fromDateInput(d.endsAt, true),
    })
    setBusy(true)
    try {
      await api(item ? `/v1/points/campaigns/${item.id}` : '/v1/points/campaigns', { method: item ? 'PATCH' : 'POST', key: token, body })
      onSaved()
    } catch (err) { onError(err) } finally { setBusy(false) }
  }

  return (
    <form className="camp__form" onSubmit={save}>
      <div className="camp__form-head"><b>{item ? 'Edit earn campaign' : 'New earn campaign'}</b><button type="button" className="pk-link" onClick={onCancel}>Cancel</button></div>
      <div className="camp__kinds" role="radiogroup" aria-label="Campaign type">
        <button type="button" role="radio" aria-checked={d.kind === 'rate'} className={`camp__kind${d.kind === 'rate' ? ' camp__kind--on' : ''}`} onClick={() => set('kind', 'rate')}>
          <b>Points per spend</b><span>e.g. 10 points for every 100 USDT</span>
        </button>
        <button type="button" role="radio" aria-checked={d.kind === 'bonus'} className={`camp__kind${d.kind === 'bonus' ? ' camp__kind--on' : ''}`} onClick={() => set('kind', 'bonus')}>
          <b>Bonus on big orders</b><span>e.g. 50 points when they spend 500 USDT or more</span>
        </button>
      </div>

      {d.kind === 'rate' ? (
        <div className="camp__sentence">
          <span>Give</span><input aria-label="Points" inputMode="numeric" value={d.points} onChange={(e) => set('points', e.target.value)} />
          <span>points for every</span><input aria-label="USDT spent" inputMode="decimal" value={d.per} onChange={(e) => set('per', e.target.value)} /><span>USDT spent</span>
        </div>
      ) : (
        <div className="camp__sentence">
          <span>Give</span><input aria-label="Bonus points" inputMode="numeric" value={d.bonus} onChange={(e) => set('bonus', e.target.value)} />
          <span>points when an order is</span><input aria-label="Order amount" inputMode="decimal" value={d.threshold} onChange={(e) => set('threshold', e.target.value)} /><span>USDT or more</span>
        </div>
      )}
      {example && <p className="pk-muted camp__example">{example}</p>}

      <F label="Name" hint="shown in your dashboard"><input value={d.name} maxLength={60} placeholder={autoName} onChange={(e) => set('name', e.target.value)} /></F>

      <button type="button" className="pk-link camp__more" onClick={() => setMore(!more)} aria-expanded={more}>{more ? 'Fewer options' : 'More options: dates, limits, budget'}</button>
      {more && (
        <div className="camp__advanced">
          {d.kind === 'rate' && (
            <div className="onb-grid">
              <F label="Minimum order" hint="USDT, optional"><input inputMode="decimal" value={d.minSpend} placeholder="none" onChange={(e) => set('minSpend', e.target.value)} /></F>
              <F label="Max points per order" hint="optional"><input inputMode="numeric" value={d.maxPerOrder} placeholder="no cap" onChange={(e) => set('maxPerOrder', e.target.value)} /></F>
            </div>
          )}
          <div className="onb-grid">
            <F label="Total points budget" hint="stops when used up"><input inputMode="numeric" value={d.budget} placeholder="unlimited" onChange={(e) => set('budget', e.target.value)} /></F>
            <F label="Applies to">
              <select value={d.appliesTo} onChange={(e) => set('appliesTo', e.target.value as AppliesTo)}>
                <option value="all">All payments</option>
                <option value="payments">One-off payments only</option>
                <option value="subscriptions">Subscriptions only</option>
              </select>
            </F>
          </div>
          <div className="onb-grid">
            <F label="Starts" hint="optional"><input type="date" value={d.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></F>
            <F label="Ends" hint="optional"><input type="date" value={d.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></F>
          </div>
          <label className="onb-toggle"><input type="checkbox" checked={d.firstPurchaseOnly} onChange={(e) => set('firstPurchaseOnly', e.target.checked)} /><span>Only a customer's first purchase with you</span></label>
        </div>
      )}

      {problem && <p className="onb-error">{problem}</p>}
      <div className="camp__form-actions">
        <button type="submit" className="pk-button pk-button--primary" disabled={busy}>{busy ? 'Saving…' : item ? 'Save changes' : 'Start campaign'}</button>
        <button type="button" className="pk-button pk-button--secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  )
}

// ───────────────────────── spend form ─────────────────────────

type SpendDraft = {
  name: string; pointsCost: string; type: 'fixed_off' | 'percent_off'; value: string
  maxDiscount: string; minSpend: string; perWalletLimit: string; totalLimit: string; startsAt: string; endsAt: string
}

function spendDraftFrom(r: Reward | null): SpendDraft {
  const base: SpendDraft = { name: '', pointsCost: '100', type: 'fixed_off', value: '5', maxDiscount: '', minSpend: '', perWalletLimit: '', totalLimit: '', startsAt: '', endsAt: '' }
  if (!r) return base
  return {
    name: r.name, pointsCost: String(r.pointsCost), type: r.type, value: String(Number(r.value)),
    maxDiscount: r.maxDiscount ? String(Number(r.maxDiscount)) : '', minSpend: r.minSpend ? String(Number(r.minSpend)) : '',
    perWalletLimit: r.perWalletLimit ? String(r.perWalletLimit) : '', totalLimit: r.totalLimit ? String(r.totalLimit) : '',
    startsAt: toDateInput(r.startsAt), endsAt: toDateInput(r.endsAt),
  }
}

function SpendForm({ token, item, onCancel, onSaved, onError }: { token: string; item: Reward | null; onCancel: () => void; onSaved: () => void; onError: (e: unknown) => void }) {
  const [d, setD] = useState<SpendDraft>(() => spendDraftFrom(item))
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof SpendDraft>(k: K, v: SpendDraft[K]) => { setD((x) => ({ ...x, [k]: v })); setProblem(null) }
  const [more, setMore] = useState(() => !!(item && (d.maxDiscount || d.minSpend || d.perWalletLimit || d.totalLimit || d.startsAt || d.endsAt)))
  const autoName = d.type === 'percent_off' ? `${d.value || 'X'}% off your order` : `${d.value || 'X'} USDT off your order`
  const wholeOpt = (v: string) => !v || (Number.isInteger(Number(v)) && Number(v) > 0)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!(Number.isInteger(Number(d.pointsCost)) && Number(d.pointsCost) > 0)) return setProblem('Points cost must be a whole number.')
    if (d.type === 'percent_off' ? !(positive(d.value) && Number(d.value) <= 100) : !usdtOk(d.value)) {
      return setProblem(d.type === 'percent_off' ? 'Enter a percentage between 1 and 100.' : 'Enter a USDT amount like 5 or 2.50.')
    }
    if ((d.maxDiscount && !usdtOk(d.maxDiscount)) || (d.minSpend && !usdtOk(d.minSpend))) return setProblem('Amounts must be in USDT, like 25 or 12.50.')
    if (!wholeOpt(d.perWalletLimit) || !wholeOpt(d.totalLimit)) return setProblem('Limits must be whole numbers.')
    if (d.startsAt && d.endsAt && d.endsAt < d.startsAt) return setProblem('The end date is before the start date.')
    const body = {
      name: d.name.trim() || autoName,
      pointsCost: Number(d.pointsCost), type: d.type,
      value: d.type === 'percent_off' ? Number(d.value) : d.value.trim(),
      maxDiscount: d.type === 'percent_off' ? optional(d.maxDiscount) : null,
      minSpend: optional(d.minSpend),
      perWalletLimit: d.perWalletLimit ? Number(d.perWalletLimit) : null,
      totalLimit: d.totalLimit ? Number(d.totalLimit) : null,
      startsAt: fromDateInput(d.startsAt), endsAt: fromDateInput(d.endsAt, true),
    }
    setBusy(true)
    try {
      await api(item ? `/v1/points/rewards/${item.id}` : '/v1/points/rewards', { method: item ? 'PATCH' : 'POST', key: token, body })
      onSaved()
    } catch (err) { onError(err) } finally { setBusy(false) }
  }

  return (
    <form className="camp__form" onSubmit={save}>
      <div className="camp__form-head"><b>{item ? 'Edit spend offer' : 'New spend offer'}</b><button type="button" className="pk-link" onClick={onCancel}>Cancel</button></div>
      <div className="camp__sentence">
        <span>Customers spend</span><input aria-label="Points cost" inputMode="numeric" value={d.pointsCost} onChange={(e) => set('pointsCost', e.target.value)} />
        <span>points for</span><input aria-label="Value" inputMode="decimal" value={d.value} onChange={(e) => set('value', e.target.value)} />
        <select aria-label="Discount type" value={d.type} onChange={(e) => { const t = e.target.value as SpendDraft['type']; set('type', t); set('value', t === 'percent_off' ? '10' : '5') }}>
          <option value="fixed_off">USDT off</option>
          <option value="percent_off">% off</option>
        </select>
      </div>
      <p className="pk-muted camp__example">
        {d.type === 'percent_off'
          ? `On a 40 USDT order the customer pays ${usdt(Math.max(0, 40 - Math.min((40 * (Number(d.value) || 0)) / 100, d.maxDiscount ? Number(d.maxDiscount) : Infinity)))}.`
          : `On a 40 USDT order the customer pays ${usdt(Math.max(0, 40 - (Number(d.value) || 0)))}.`}
      </p>
      <F label="Name" hint="customers see this at checkout"><input value={d.name} maxLength={60} placeholder={autoName} onChange={(e) => set('name', e.target.value)} /></F>

      <button type="button" className="pk-link camp__more" onClick={() => setMore(!more)} aria-expanded={more}>{more ? 'Fewer options' : 'More options: limits, dates'}</button>
      {more && (
        <div className="camp__advanced">
          <div className="onb-grid">
            <F label="Minimum order" hint="USDT, optional"><input inputMode="decimal" value={d.minSpend} placeholder="none" onChange={(e) => set('minSpend', e.target.value)} /></F>
            {d.type === 'percent_off' && <F label="Max discount" hint="USDT, optional"><input inputMode="decimal" value={d.maxDiscount} placeholder="no cap" onChange={(e) => set('maxDiscount', e.target.value)} /></F>}
          </div>
          <div className="onb-grid">
            <F label="Uses per customer" hint="optional"><input inputMode="numeric" value={d.perWalletLimit} placeholder="unlimited" onChange={(e) => set('perWalletLimit', e.target.value)} /></F>
            <F label="Total available" hint="optional"><input inputMode="numeric" value={d.totalLimit} placeholder="unlimited" onChange={(e) => set('totalLimit', e.target.value)} /></F>
          </div>
          <div className="onb-grid">
            <F label="Starts" hint="optional"><input type="date" value={d.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></F>
            <F label="Ends" hint="optional"><input type="date" value={d.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></F>
          </div>
        </div>
      )}

      {problem && <p className="onb-error">{problem}</p>}
      <div className="camp__form-actions">
        <button type="submit" className="pk-button pk-button--primary" disabled={busy}>{busy ? 'Saving…' : item ? 'Save changes' : 'Start offer'}</button>
        <button type="button" className="pk-button pk-button--secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  )
}
