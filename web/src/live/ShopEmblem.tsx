/** Optical 64px brand marks, drawn on one consistent grid. */
export function ShopEmblem({ name }: { name: string }) {
  const value = name.toLowerCase()
  const brand = value.includes('kettle') ? 'leaf' : value.includes('lantern') ? 'lantern' : value.includes('chai') ? 'chai' : value.includes('pixel') ? 'studio' : value.includes('book') ? 'books' : 'studio'
  return <span className={`shop-emblem shop-emblem--${brand}`} aria-hidden="true"><svg viewBox="0 0 64 64" fill="none">
    {brand === 'leaf' && <><path d="M32 43C13 40 12 25 15 15c15 0 25 9 17 28Z" fill="currentColor" /><path d="M32 43C50 38 53 23 49 13c-15 2-23 12-17 30Z" fill="currentColor" opacity=".65" /><path d="M32 49V34M32 40 22 26m10 9 9-11" stroke="var(--emblem-cut)" strokeWidth="2" strokeLinecap="round" /><path d="M23 51h18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></>}
    {brand === 'lantern' && <><path d="M18 16h10c9 0 14 5 14 12s-5 12-14 12h-4v10h-6V16Zm6 6v12h4c5 0 8-2 8-6s-3-6-8-6h-4Z" fill="currentColor" /><path d="M34 41v9h14v-6H40v-3h-6Z" fill="currentColor" /><path d="M45 13c3 4 4 6 4 8a4 4 0 0 1-8 0c0-2 1-4 4-8Z" fill="#b69761" /></>}
    {brand === 'chai' && <><path d="M17 26h27l-3 24H20l-3-24Z" fill="currentColor" /><path d="M21 29h19M22 34h17" stroke="var(--emblem-cut)" strokeWidth="1.5" opacity=".7" /><path d="M25 10c-6 5 6 6 0 12m9-14c-6 5 6 7 0 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /><path d="M16 53h29" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>}
    {brand === 'studio' && <><path d="m32 9 12 7-12 7-12-7 12-7ZM18 19l11 7v13l-11-6V19Zm28 0v14l-11 6V26l11-7ZM18 38l11 7v12l-11-6V38Zm28 0v13l-11 6V45l11-7Z" fill="currentColor" /><path d="m12 17 6-4m28 0 6 4" stroke="currentColor" strokeWidth="1.5" opacity=".4" /></>}
    {brand === 'books' && <><path d="M16 13h16c8 0 12 4 12 10 0 4-2 6-5 8 5 1 8 5 8 10 0 7-5 11-14 11H16V13Zm7 6v10h8c4 0 6-2 6-5s-2-5-6-5h-8Zm0 16v11h9c5 0 8-2 8-6s-3-5-8-5h-9Z" fill="currentColor" /><path d="M12 16v39h27" stroke="currentColor" strokeWidth="1.5" opacity=".4" /></>}
  </svg></span>
}
