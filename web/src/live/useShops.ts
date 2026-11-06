import { useCallback, useEffect, useState } from 'react'
import { api, errorText, type MerchantProfile } from './server'

export type Shop = {
  id: string
  name: string
  profile: MerchantProfile | null
  createdAt: string
  url: string | null
  kind: string
  blurb: string
  reward: string
}
type DirectoryPage = { data: Array<Pick<Shop, 'id' | 'name' | 'profile' | 'createdAt'>>; hasMore: boolean }

export function useShops() {
  const [shops, setShops] = useState<Shop[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const retry = useCallback(() => { setLoading(true); setRevision((n) => n + 1) }, [])

  useEffect(() => {
    const life = new AbortController()
    const flight = { running: false }
    const load = async () => {
      if (flight.running) return
      flight.running = true
      try {
        const rows: DirectoryPage['data'] = []
        let hasMore = true
        while (hasMore) {
          const signal = AbortSignal.any([life.signal, AbortSignal.timeout(20_000)])
          const page = await api<DirectoryPage>(`/v1/public/merchants?limit=100&offset=${rows.length}`, { signal })
          rows.push(...page.data)
          hasMore = page.hasMore && page.data.length > 0
        }
        if (!life.signal.aborted) {
          setShops(rows.map((m) => {
            let url: string | null = null
            try {
              const parsed = new URL(m.profile?.website ?? '')
              if (parsed.protocol === 'https:' || parsed.protocol === 'http:') url = parsed.href
            } catch { /* A shop can register without a website. */ }
            return { ...m, url, kind: m.profile?.category || 'Shop', blurb: m.profile?.tagline || 'Accepts USDT with PayKit.', reward: 'Pay with PayKit' }
          }))
          setError('')
        }
      } finally {
        flight.running = false
      }
    }
    const refresh = () => { void load().catch((e) => { if (!life.signal.aborted) setError(errorText(e)) }) }
    void load().catch((e) => { if (!life.signal.aborted) setError(errorText(e)) }).finally(() => { if (!life.signal.aborted) setLoading(false) })
    const interval = window.setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    return () => { life.abort(); window.clearInterval(interval); window.removeEventListener('focus', refresh) }
  }, [revision])
  return { shops, loading, error, retry }
}

// Only these shops have bundled photography. New businesses use their brand mark.
export const shopPhoto = (shop: Shop): string | null => {
  const names = ['Kettle & Leaf', 'Paper Lantern Books']
  return names.includes(shop.name) ? `${import.meta.env.BASE_URL}shops/${shop.name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-')}.jpg` : null
}
