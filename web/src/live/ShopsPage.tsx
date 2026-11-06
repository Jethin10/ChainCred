import { useEffect, useMemo, useState } from 'react'
import { api, COMPANIES, type MarketReward } from './server'
import { BrandMark } from './BrandMark'
import { Icon } from '../mobile/icons'

export function ShopsPage() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All shops')
  const [rewards, setRewards] = useState<MarketReward[]>([])
  useEffect(() => { const lifecycle = new AbortController(); void api<{ data: MarketReward[] }>('/v1/public/rewards').then((result) => { if (!lifecycle.signal.aborted) setRewards(result.data) }, () => {}); return () => lifecycle.abort() }, [])
  const companies = useMemo(() => COMPANIES.filter((company) => (category === 'All shops' || company.kind === category) && `${company.name} ${company.kind} ${company.blurb}`.toLowerCase().includes(search.toLowerCase().trim())), [search, category])
  return <section className="shop-directory">
    <header className="customer-heading"><div><p className="customer-greeting">Good things, good company.</p><h1>A little more rewarding.</h1><p>Independent shops. Thoughtful finds. Points that go with you.</p></div><span className="pixel-stamp" aria-hidden="true"><i /><i /><i /><i /><i /></span></header>
    <div className="shop-benefit"><span className="shop-benefit__icon"><Icon name="spark" size={23} /></span><div><b>One points balance. Every shop.</b><p>Earn at one, spend at another. Your rewards travel with you.</p></div><a href="#wallet" aria-label="View your PayKit points"><Icon name="arrow" size={22} /></a></div>
    <div className="shop-toolbar"><label className="shop-search"><Icon name="search" size={19} /><input aria-label="Search shops" placeholder="Find your next favourite" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button aria-label="Clear shop search" onClick={() => setSearch('')}><Icon name="close" size={16} /></button>}</label><div className="shop-filters" role="group" aria-label="Shop category">{['All shops', 'Tea house', 'Bookshop'].map((value) => <button key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value === 'Tea house' ? 'Tea & pantry' : value === 'Bookshop' ? 'Books & culture' : value}</button>)}</div></div>
    <div className="directory-label"><h2>Meet the shops</h2><span>{companies.length} {companies.length === 1 ? 'shop' : 'shops'}</span></div>
    <div className="partner-grid">{companies.map((company) => {
      const reward = rewards.find((item) => item.merchant.name === company.name)
      return <a className={`partner-card partner-card--${company.tone}`} href={company.url} target="_blank" rel="noreferrer" key={company.name} aria-label={`Visit ${company.name}`}>
        <div className="partner-scene"><span className="partner-scene__caption">{company.tone === 'tea' ? 'Make room for a slower morning.' : 'For the love of getting lost.'}</span><span className="partner-scene__seal"><BrandMark name={company.name} /></span>{company.tone === 'tea' ? <div className="tea-still" aria-hidden="true"><div className="tea-tin tea-tin--back"><i /><span>EARL<br />GREY</span></div><div className="tea-tin"><i /><span>KETTLE<br /><em>&</em> LEAF<small>ASSAM BREAKFAST</small></span></div><div className="tea-leaf" /></div> : <div className="book-still" aria-hidden="true"><div className="book book--back"><span>Small<br />hours.</span></div><div className="book"><span>The art<br />of being<br /><em>here.</em></span><small>PAPER LANTERN BOOKS</small></div></div>}<span className="partner-scene__category">{company.kind}</span></div>
        <div className="partner-card__body"><div className="partner-card__title"><h3>{company.name}</h3><span><Icon name="external" size={18} /></span></div><p>{company.blurb}</p><div className="partner-card__reward"><Icon name="spark" size={16} /><span>{reward?.label || company.reward.replace('→', 'for')}</span><b>Shop now <Icon name="arrow" size={16} /></b></div></div>
      </a>
    })}</div>
    {!companies.length && <div className="directory-empty"><Icon name="search" size={28} /><h3>No shops found</h3><p>Try another name or browse all shops.</p><button className="mobile-secondary" onClick={() => { setSearch(''); setCategory('All shops') }}>Show all shops</button></div>}
    <aside className="shop-business"><span><Icon name="business" size={22} /></span><div><h3>Your shop belongs here.</h3><p>Bring your business to PayKit.</p></div><a href="#merchant">Get started <Icon name="arrow" size={17} /></a></aside>
  </section>
}
