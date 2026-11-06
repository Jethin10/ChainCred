import { MerchantModal, useMerchants } from '@paykit/react'
import type { Merchant } from '@paykit/js'
import { useMemo, useState } from 'react'
import { COMPANIES } from './server'
import { ShopEmblem } from './ShopEmblem'
import { Icon } from '../mobile/icons'
import './desktop-shops.css'

export function FeaturedShops() {
  return <section className="curated-shops" aria-label="PayKit partner shops"><div className="curated-shops__intro"><span>In good company</span><p>Independent shops. One effortless checkout.</p></div><div className="curated-shops__grid">{COMPANIES.map((company) => <a className={`curated-partner curated-partner--${company.tone}`} href={company.url} target="_blank" rel="noreferrer" key={company.name}>
    <div className="curated-partner__top"><ShopEmblem name={company.name} /><span className="curated-partner__category">{company.kind}</span><span className="curated-partner__external"><Icon name="external" size={18} /></span></div>
    <div className="curated-partner__copy"><h2>{company.name}</h2><p>{company.blurb}</p></div>
    <div className="curated-partner__bottom"><span><Icon name="spark" size={15} />{company.reward.replace('→', 'for')}</span><b>Visit store <Icon name="arrow" size={16} /></b></div>
  </a>)}</div></section>
}

function shopCopy(merchant: Merchant) {
  const name = merchant.name.toLowerCase()
  if (name.includes('chai')) return { line: 'A better kind of chai break.', description: 'Small-batch blends, everyday rituals, and a little taste of Mumbai.', action: 'Explore the menu', tone: 'chai' }
  if (name.includes('pixel')) return { line: 'Make something worth keeping.', description: 'Design essentials and considered digital goods for your next idea.', action: 'Explore the studio', tone: 'studio' }
  if (name.includes('book')) return { line: 'Find your next good read.', description: 'Good stories, curious minds, and books you’ll come back to.', action: 'Browse the shelves', tone: 'books' }
  return { line: merchant.category || 'Something worth discovering.', description: merchant.description || 'Explore this shop and try a PayKit checkout.', action: 'Explore shop', tone: 'studio' }
}

export function DemoShops() {
  const query = useMerchants()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All shops')
  const [open, setOpen] = useState<Merchant | null>(null)
  const categories = useMemo(() => ['All shops', ...new Set((query.data ?? []).map((merchant) => merchant.category).filter((value): value is string => !!value))], [query.data])
  const visible = useMemo(() => (query.data ?? []).filter((merchant) => (category === 'All shops' || merchant.category === category) && `${merchant.name} ${merchant.category || ''}`.toLowerCase().includes(search.trim().toLowerCase())), [query.data, search, category])
  return <section className="demo-shops" aria-label="Interactive SDK shops">
    <header className="demo-shops__head"><div><span className="demo-shops__eyebrow">The PayKit experience</span><h2>Find a shop. Try a checkout.</h2><p>Explore a working storefront, build a cart, and see how smooth checkout can feel.</p></div><span className="demo-shops__mode"><i />Interactive previews · no funds move</span></header>
    <div className="demo-shops__toolbar"><label className="demo-shops__search"><Icon name="search" size={19} /><input type="search" aria-label="Search demo shops" placeholder="Find a shop or category" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" aria-label="Clear demo shop search" onClick={() => setSearch('')}><Icon name="close" size={15} /></button>}</label><div className="demo-shops__filters" role="group" aria-label="Demo shop categories">{categories.map((value) => <button key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}</div></div>
    {query.loading && !query.data && <div className="demo-shops__loading" role="status">Getting the shops ready…</div>}
    {!!query.error && <div className="demo-shops__empty" role="alert"><h3>Couldn’t load the shops</h3><p>Try again in a moment.</p><button onClick={query.refetch}>Try again</button></div>}
    {!query.error && <div className="demo-shops__grid">{visible.map((merchant) => {
      const copy = shopCopy(merchant)
      return <button type="button" className={`demo-shop demo-shop--${copy.tone}`} onClick={() => setOpen(merchant)} key={merchant.slug} aria-label={`Explore ${merchant.name}`}>
        <div className="demo-shop__art"><ShopEmblem name={merchant.name} /><span className="demo-shop__category">{merchant.category || 'Shop'}</span><span className="demo-shop__ornament" aria-hidden="true" /></div>
        <div className="demo-shop__body"><h3>{merchant.name}</h3><span className="demo-shop__line">{copy.line}</span><p>{copy.description}</p><span className="demo-shop__foot"><span><Icon name="shield" size={14} />PayKit checkout</span><b>{copy.action}<Icon name="arrow" size={16} /></b></span></div>
      </button>
    })}</div>}
    {!query.loading && !query.error && !visible.length && <div className="demo-shops__empty"><Icon name="search" size={25} /><h3>No shops found</h3><p>Try another name or browse every shop.</p><button onClick={() => { setSearch(''); setCategory('All shops') }}>Show all shops</button></div>}
    <div className="demo-shops__note"><Icon name="shield" size={15} /><span>A complete checkout experience, with simulated settlement and no real funds.</span><a href="#components">Explore the SDK <Icon name="arrow" size={14} /></a></div>
    <MerchantModal merchant={open} onClose={() => setOpen(null)} />
  </section>
}
