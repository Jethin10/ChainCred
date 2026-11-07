import { useEffect, useMemo, useState } from 'react'
import { api, type MarketReward } from '../live/server'
import { useShops, shopPhoto } from '../live/useShops'
import { BrandMark } from '../live/BrandMark'
import { Icon } from './icons'

export function Shops() {
  const { shops, loading, error, retry } = useShops()
  const [q, setQ] = useState('')
  const [rewards, setRewards] = useState<MarketReward[]>([])
  useEffect(() => { const life = new AbortController(); void api<{ data: MarketReward[] }>('/v1/public/rewards?source=arkiv', { signal: life.signal }).then((r) => setRewards(r.data), () => {}); return () => life.abort() }, [])
  const list = useMemo(() => shops.filter((c) => `${c.name} ${c.kind} ${c.blurb}`.toLowerCase().includes(q.toLowerCase().trim())), [q, shops])
  return <div className="m-shops m-rise">
    <header className="m-shops-intro"><p className="m-label">{shops.length} shops take ChainCred</p><h2>Pay once, earn everywhere.</h2></header>
    <label className="m-search"><Icon name="search" size={18} /><input aria-label="Search shops" placeholder="Search shops" value={q} onChange={(e) => setQ(e.target.value)} />{q && <button aria-label="Clear search" onClick={() => setQ('')}><Icon name="close" size={13} /></button>}</label>
    <p className="m-note"><Icon name="spark" size={15} />Earn points at one shop, spend them at any.</p>
    {loading && <p role="status">Loading shops…</p>}
    {error && <div className="m-empty" role="alert"><p>Could not refresh shops. {error}</p><button onClick={retry}>Try again</button></div>}
    {list.length > 0 && <ul className="m-shoplist">{list.map((c) => {
      const reward = rewards.find((r) => r.merchant.id === c.id)
      return <li key={c.id}><a className="m-shop" href={c.url ?? undefined} target={c.url ? '_blank' : undefined} rel="noreferrer">
        <span className="m-shop__photo">{shopPhoto(c) && <img src={shopPhoto(c)!} alt="" loading="lazy" />}<BrandMark name={c.name} /></span>
        <span className="m-shop__body"><b>{c.name}</b><span className="m-muted">{c.kind}</span><span className="m-shop__perk"><Icon name="spark" size={11} />{reward?.label || c.reward.replace('→', 'for')}</span></span>
        <span className="m-shop__go" aria-label={c.url ? "Opens the shop's website" : 'Website not added yet'}><Icon name={c.url ? 'external' : 'shops'} size={15} /></span>
      </a></li>
    })}</ul>}
    {!loading && !error && !list.length && <div className="m-empty"><Icon name="search" size={24} /><p>{q ? `No shops match “${q}”.` : 'No shops registered yet.'}</p>{q && <button onClick={() => setQ('')}>Clear search</button>}</div>}
    <a className="m-rowlink" href="#merchant"><span><b>Run a shop?</b><span>Take USDT with ChainCred in two minutes</span></span><Icon name="arrow" size={20} /></a>
  </div>
}
