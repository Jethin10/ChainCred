import type { Activity } from './server'
export type ActivityRange = '7d' | '30d' | '6m'
export function spendingOverview(activity: Activity[], range: ActivityRange, now = new Date()) {
  const end = new Date(now); end.setHours(23, 59, 59, 999)
  const start = new Date(now); start.setHours(0, 0, 0, 0)
  if (range === '6m') { start.setDate(1); start.setMonth(start.getMonth() - 5) }
  else start.setDate(start.getDate() - (range === '7d' ? 6 : 29))
  const count = range === '7d' ? 7 : 6
  const buckets = Array.from({ length: count }, (_, i) => {
    const date = new Date(start)
    if (range === '6m') date.setMonth(date.getMonth() + i)
    else date.setDate(date.getDate() + i * (range === '7d' ? 1 : 5))
    return { label: date.toLocaleDateString('en', range === '6m' ? { month: 'short' } : { day: 'numeric', month: 'short' }), value: 0, count: 0 }
  })
  const rows = activity.filter((item) => { const date = new Date(item.settledAt ?? ''); return date >= start && date <= end })
  const merchants = new Map<string, { name: string; total: number; count: number }>()
  for (const item of rows) {
    const date = new Date(item.settledAt!)
    // Calendar-day arithmetic remains correct across daylight-saving transitions.
    const days = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86_400_000)
    const index = range === '6m' ? (date.getFullYear() - start.getFullYear()) * 12 + date.getMonth() - start.getMonth() : Math.floor(days / (range === '7d' ? 1 : 5))
    const gross = Number(item.gross), refunded = Number(item.refunded)
    const net = Math.max(0, (Number.isFinite(gross) ? gross : 0) - (Number.isFinite(refunded) ? refunded : 0))
    if (buckets[index]) { buckets[index].value += net; buckets[index].count++ }
    const key = item.merchant.id
    const merchant = merchants.get(key) ?? { name: item.merchant.name || 'Merchant', total: 0, count: 0 }
    merchant.total += net; merchant.count++; merchants.set(key, merchant)
  }
  const total = buckets.reduce((sum, bucket) => sum + bucket.value, 0)
  return { buckets, total, count: rows.length, average: rows.length ? total / rows.length : 0, merchants: [...merchants.values()].sort((a, b) => b.total - a.total) }
}
