import { createPayKitClient, type PayKitClient } from '@paykit/react'
import { createMockApi } from '@paykit/testing'
import { useEffect, useMemo, useState } from 'react'

export type Source = 'live' | 'mock'
export type Backend = {
  source: Source
  /** Whether the PayKit API answered the last probe. */
  reachable: boolean | null
  /** The API runs in test mode: orders placed through it never move real funds. */
  testMode: boolean
  apiUrl: string
  client: PayKitClient
  mock: ReturnType<typeof createMockApi> | null
  setSource: (s: Source) => void
}

// VITE_PAYKIT_API_URL wins. Otherwise use this origin: in dev, Vite proxies /v1 to the PayKit server
// (`npm run server:demo`, port 8787), so the app talks to the real SDK backend with no CORS or env setup.
const API_URL = (import.meta.env.VITE_PAYKIT_API_URL as string | undefined)?.replace(/\/$/, '') || window.location.origin
const PK = import.meta.env.VITE_PAYKIT_PK as string | undefined
const KEY = 'paykit:source'

function readChoice(): Source | null {
  try { const v = localStorage.getItem(KEY); return v === 'live' || v === 'mock' ? v : null } catch { return null }
}

async function probe(): Promise<{ ok: boolean; testMode: boolean }> {
  try {
    const r = await fetch(`${API_URL}/v1/status`, { signal: AbortSignal.timeout(6000) })
    if (!r.ok) return { ok: false, testMode: false }
    const body = (await r.json()) as { chainId?: unknown; testMode?: unknown }
    return { ok: typeof body.chainId === 'number', testMode: body.testMode === true }
  } catch {
    return { ok: false, testMode: false }
  }
}

/** Connects to the PayKit API when it is running, and falls back to the in-browser mock when it is not. */
export function useBackend(): Backend {
  const [choice, setChoice] = useState<Source | null>(readChoice)
  const [reachable, setReachable] = useState<boolean | null>(null)
  const [testMode, setTestMode] = useState(false)

  useEffect(() => {
    let alive = true
    const check = () => void probe().then((p) => { if (!alive) return; setReachable(p.ok); setTestMode(p.testMode) })
    check()
    const id = window.setInterval(check, 10_000)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  // Until the probe answers, render the mock so the page is never blank.
  const source: Source = choice === 'mock' ? 'mock' : reachable ? 'live' : 'mock'

  const value = useMemo(() => {
    if (source === 'live') return { client: createPayKitClient({ baseUrl: API_URL, publishableKey: PK }), mock: null }
    const mock = createMockApi()
    return { client: createPayKitClient({ baseUrl: mock.baseUrl, fetch: mock.fetch, siwe: mock.siwe }), mock }
  }, [source])

  return {
    source,
    reachable,
    // The in-browser mock never moves funds either.
    testMode: source === 'mock' || testMode,
    apiUrl: API_URL,
    ...value,
    setSource: (s) => { setChoice(s); try { localStorage.setItem(KEY, s) } catch { /* private mode */ } },
  }
}
