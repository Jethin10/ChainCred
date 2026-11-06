import { useState } from 'react'
import { spendingOverview, type ActivityRange } from './overview'
import type { Activity } from './server'
import { Icon } from '../mobile/icons'

export function SpendingChart({ activity, connected, loading }: { activity: Activity[]; connected: boolean; loading: boolean }) {
  const [range, setRange] = useState<ActivityRange>('30d')
  const [selected, setSelected] = useState<number | null>(null)
  const overview = spendingOverview(activity, range)
  const max = Math.max(...overview.buckets.map((bucket) => bucket.value), 1)
  const chosen = selected === null ? null : overview.buckets[selected]
  return <section className="spending-card" aria-label="Spending overview">
    <header className="section-heading"><div><span className="section-kicker">Your activity</span><h2>Spending overview</h2></div><div className="range-control" aria-label="Spending period">{([['7d', '7 days'], ['30d', '30 days'], ['6m', '6 months']] as const).map(([value, label]) => <button key={value} onClick={() => { setRange(value); setSelected(null) }} aria-pressed={range === value}>{label}</button>)}</div></header>
    <div className="spending-total"><strong>{connected ? overview.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}<small>USDT</small></strong><span>{loading ? 'Refreshing activity…' : `${overview.count} ${overview.count === 1 ? 'payment' : 'payments'}`}<i />{connected ? 'After refunds' : 'Connect to see your activity'}</span></div>
    <div className="spending-plot">
      <div className="chart-guides" aria-hidden="true"><span>{max > 1 ? max.toFixed(0) : '100'}</span><span>{max > 1 ? (max / 2).toFixed(0) : '50'}</span><span>0</span></div>
      <div className="chart-bars" role="group" aria-label="Payment amounts by date">
        {overview.buckets.map((bucket, index) => <button key={bucket.label} className={`chart-column ${selected === index ? 'chart-column--selected' : ''}`} aria-label={`${bucket.label}: ${bucket.value.toFixed(2)} USDT, ${bucket.count} payments`} aria-pressed={selected === index} onClick={() => setSelected(selected === index ? null : index)}><span className="chart-column__track"><i style={{ height: bucket.value ? `${Math.max(4, bucket.value / max * 100)}%` : '3px' }} /></span><span>{range === '7d' ? bucket.label.split(' ')[1] || bucket.label : bucket.label}</span></button>)}
      </div>
      {!overview.count && <div className="chart-empty"><Icon name="receipt" size={23} /><b>{loading ? 'Bringing your activity together' : connected ? 'Your next payment starts the story' : 'A clearer picture of your payments'}</b><span>{connected ? 'Your payments will appear here.' : 'One place for every PayKit purchase.'}</span></div>}
    </div>
    <div className="chart-caption" aria-live="polite">{chosen ? <><span>{chosen.label}</span><b>{chosen.value.toFixed(2)} USDT · {chosen.count} payments</b></> : <><span><i />Settled payments</span><span>USDT on Whitechain</span></>}</div>
  </section>
}
