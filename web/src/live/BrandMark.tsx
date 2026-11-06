export function BrandMark({ name, large = false }: { name: string; large?: boolean }) {
  const tea = /kettle|chai|tea/i.test(name), books = /lantern|book/i.test(name)
  return <span className={`brand-mark ${tea ? 'brand-mark--tea' : books ? 'brand-mark--books' : 'brand-mark--other'} ${large ? 'brand-mark--large' : ''}`} aria-hidden="true">
    {tea ? <svg viewBox="0 0 48 48" fill="none"><path d="M13 24h19v6a8 8 0 0 1-8 8h-3a8 8 0 0 1-8-8v-6Z" fill="currentColor" /><path d="M32 25h2a4 4 0 0 1 0 8h-3M11 41h24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /><path d="M23 21C14 12 24 7 33 7c0 9-3 15-10 14Z" fill="currentColor" /><path d="m21 20 8-9" stroke="#24473e" strokeWidth="1.5" /></svg>
      : books ? <svg viewBox="0 0 48 48" fill="none"><path d="M8 13c6-2 11-1 16 3 5-4 10-5 16-3v23c-6-2-11-1-16 3-5-4-10-5-16-3V13Z" fill="currentColor" /><path d="M24 16v23" stroke="#794837" strokeWidth="2" /><path d="M24 5c4 4 5 5 5 7a5 5 0 0 1-10 0c0-2 1-3 5-7Z" fill="#e8b884" /></svg>
        : <b>{name.trim().slice(0, 1).toUpperCase()}</b>}
  </span>
}
