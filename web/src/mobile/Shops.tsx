import { useEffect, useMemo, useState } from 'react'
import { api, COMPANIES, type MarketReward } from '../live/server'
import { BrandMark } from '../live/BrandMark'
import { Icon } from './icons'

const photo = (name: string) => `${import.meta.env.BASE_URL}shops/${name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.jpg`

export function Shops() {
  const [q, setQ] = useState('')
  const [rewards, setRewards] = useState<MarketReward[]>([])
  useEffect(() => { const life = new AbortController(); void api<{ data: MarketReward[] }>('/v1/public/rewards', { signal: life.signal }).then((r) => setRewards(r.data), () => {}); return () => life.abort() }, [])
  const list = useMemo(() => COMPANIES.filter((c) => `${c.name} ${c.kind} ${c.blurb}`.toLowerCase().includes(q.toLowerCase().trim())), [q])
  return <div className="m-shops m-rise">
    <header className="m-shops-intro"><p className="m-label">{COMPANIES.length} shops take PayKit</p><h2>Pay once, earn everywhere.</h2></header>
    <label className="m-search"><Icon name="search" size={18} /><input aria-label="Search shops" placeholder="Search shops" value={q} onChange={(e) => setQ(e.target.value)} />{q && <button aria-label="Clear search" onClick={() => setQ('')}><Icon name="close" size={13} /></button>}</label>
    <p className="m-note"><Icon name="spark" size={15} />Earn points at one shop, spend them at any.</p>
    {list.length > 0 && <ul className="m-shoplist">{list.map((c) => {
      const reward = rewards.find((r) => r.merchant.name === c.name)
      return <li key={c.name}><a className="m-shop" href={c.url} target="_blank" rel="noreferrer">
        <span className="m-shop__photo"><img src={photo(c.name)} alt="" loading="lazy" /><BrandMark name={c.name} /></span>
        <span className="m-shop__body"><b>{c.name}</b><span className="m-muted">{c.kind}</span><span className="m-shop__perk"><Icon name="spark" size={11} />{reward?.label || c.reward.replace('→', 'for')}</span></span>
        <span className="m-shop__go" aria-label="Opens the shop's website"><Icon name="external" size={15} /></span>
      </a></li>
    })}</ul>}
    {!list.length && <div className="m-empty"><Icon name="search" size={24} /><p>No shops match “{q}”.</p><button onClick={() => setQ('')}>Clear search</button></div>}
    <a className="m-rowlink" href="#merchant"><span><b>Run a shop?</b><span>Take USDT with PayKit in two minutes</span></span><Icon name="arrow" size={20} /></a>
  </div>
}
