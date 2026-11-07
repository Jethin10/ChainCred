import { useEffect, useState } from 'react'
import { api } from './server'

/** What /v1/public/points/:wallet?verify=1 returns when points live on Arkiv. */
type ArkivRef = { key: string | null; pending?: boolean; ownerUrl?: string | null; createTxUrl?: string | null; lastTxUrl?: string | null; expiresAt?: string | null }
type ArkivWallet = {
  backend: 'arkiv' | 'chain'
  balance: number
  inSync: boolean | null
  lots?: Array<{ shop: string; earned: number; remaining: number; expiresAt: string; paymentTxUrl: string | null; arkiv?: ArkivRef }>
  arkiv?: { chainId: number; balance: number | null; error: string | null; pendingWrites: number; query: string }
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * The customer's points as Arkiv itself reports them: the balance Arkiv computes from the wallet's
 * lots and spends, each lot with the date Arkiv will expire it, links to the Arkiv transactions,
 * and the query anyone can run. Renders nothing when the server keeps points on Whitechain instead.
 */
export function ArkivPoints({ wallet, compact = false }: { wallet: string; compact?: boolean }) {
  const [data, setData] = useState<ArkivWallet | null>(null)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const life = new AbortController()
    api<ArkivWallet>(`/v1/public/points/${wallet}?verify=1`, { signal: life.signal })
      .then((d) => { if (!life.signal.aborted) { setData(d); setFailed(false) } }, () => { if (!life.signal.aborted) setFailed(true) })
    return () => life.abort()
  }, [wallet])
  if (failed || !data || data.backend !== 'arkiv' || !data.arkiv) return null
  const a = data.arkiv
  const lots = (data.lots ?? []).filter((l) => l.remaining > 0)
  const status = a.error ? `Arkiv is slow right now (${a.error}). Showing ChainCred's copy.`
    : a.pendingWrites > 0 ? `${a.pendingWrites} write${a.pendingWrites === 1 ? '' : 's'} on the way to Arkiv`
    : a.balance === data.balance ? 'Matches Arkiv exactly' : `Arkiv shows ${a.balance ?? '…'}, ChainCred shows ${data.balance}`
  const copy = async () => { try { await navigator.clipboard.writeText(a.query); setCopied(true); window.setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ } }
  return (
    <section className={`arkiv-points${compact ? ' arkiv-points--compact' : ''}`} aria-label="Your points on Arkiv">
      <header className="arkiv-points__head">
        <span className="arkiv-points__badge">On Arkiv</span>
        <div>
          <b>{a.balance ?? data.balance} points, read from Arkiv</b>
          <span className={a.error || (a.balance !== null && a.balance !== data.balance) ? 'arkiv-points__warn' : 'arkiv-points__ok'}>{status}</span>
        </div>
      </header>
      {lots.length > 0 && (
        <ul className="arkiv-points__lots">
          {lots.slice(0, compact ? 3 : 20).map((l, i) => (
            <li key={l.arkiv?.key ?? i}>
              <span><b>{l.remaining}</b> from {l.shop}</span>
              <span>Arkiv deletes these on {day(l.arkiv?.expiresAt ?? l.expiresAt)}</span>
              <span className="arkiv-points__links">
                {l.arkiv?.lastTxUrl || l.arkiv?.createTxUrl ? <a href={(l.arkiv.createTxUrl || l.arkiv.lastTxUrl)!} target="_blank" rel="noreferrer">Arkiv tx</a> : l.arkiv?.pending ? <em>writing…</em> : null}
                {l.arkiv?.ownerUrl && <a href={l.arkiv.ownerUrl} target="_blank" rel="noreferrer">Owner: {l.shop}</a>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!compact && (
        <div className="arkiv-points__query">
          <span>Check it yourself on Arkiv (chain {a.chainId}):</span>
          <code>{a.query}</code>
          <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy query'}</button>
        </div>
      )}
    </section>
  )
}
