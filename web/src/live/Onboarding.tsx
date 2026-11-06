import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAddress } from 'viem'
import {
  api, connectWallet, errorText, hasWallet, onboardingMessage, short, signMessage, SERVER_URL,
  type Campaign, type Merchant, type MerchantInvoice, type Onboarded, type Reward,
} from './server'

const KEY_STORE = 'paykit:merchant-key'
const readKey = () => { try { return localStorage.getItem(KEY_STORE) } catch { return null } }
const saveKey = (k: string | null) => { try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE) } catch { /* private mode */ } }
const money = (v: string | number) => `${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`

/** The live merchant side: onboarding for new businesses, then their console. */
export function MerchantLive() {
  const [key, setKey] = useState<string | null>(readKey)
  const [fresh, setFresh] = useState<Onboarded | null>(null)
  if (fresh) return <Welcome result={fresh} onOpen={(remember) => { if (remember) saveKey(fresh.apiKey); setKey(fresh.apiKey); setFresh(null) }} />
  if (key) return <Console apiKey={key} onSignOut={() => { saveKey(null); setKey(null) }} />
  return (
    <div className="onb">
      <KeyLogin onKey={(k) => { saveKey(k); setKey(k) }} />
      <Wizard onDone={setFresh} />
      <Vision />
    </div>
  )
}

// ── vision ──

const PRINCIPLES = [
  { title: 'Your customers never touch gas', body: 'They sign once. PayKit submits the payment and pays the network fee, so nobody needs WBT to buy from you.', icon: 'M5 12h14M13 6l6 6-6 6' },
  { title: 'Paid straight to your wallet', body: 'USDT settles onchain into the payout wallet you choose. No balance held by us, no withdrawal step, a receipt on Whitechain for every sale.', icon: 'M4 7h16v10H4zM4 11h16M8 15h3' },
  { title: 'Points that travel', body: 'Customers earn universal points at every PayKit shop and can spend them at yours, so other shops send you new buyers.', icon: 'M12 4l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 9.3l5-.7z' },
  { title: 'Your checkout, your brand', body: 'Your name, colour and tagline on every invoice. Use our hosted pay page, or drop the React components into your own site.', icon: 'M5 19l4-1 9-9-3-3-9 9-1 4zM14 6l3 3' },
]

function Vision() {
  return (
    <section className="onb-vision">
      <div className="onb-vision__head">
        <p className="eyebrow eyebrow--ink"><span className="eyebrow__dot" />For businesses</p>
        <h2>Take USDT like it's a card, keep every cent of the experience</h2>
        <p className="page__lead">PayKit is payments infrastructure for Whitechain: gasless checkout for your customers, onchain settlement to your wallet, and a loyalty network shared by every shop on it. Set up takes about two minutes and costs nothing.</p>
      </div>
      <div className="onb-principles">
        {PRINCIPLES.map((p) => (
          <article key={p.title} className="onb-principle">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={p.icon} /></svg>
            <h3>{p.title}</h3>
            <p>{p.body}</p>
          </article>
        ))}
      </div>
      <ol className="onb-how">
        <li><b>Sign up here</b><span>Your payout wallet signs once to prove it's yours. We register you onchain.</span></li>
        <li><b>Send invoices</b><span>From your server with your API key, or from the console below.</span></li>
        <li><b>Get paid</b><span>Customers pay on PayKit and return to you. Webhooks tell your server.</span></li>
      </ol>
    </section>
  )
}

// ── wizard ──

type Form = {
  name: string; category: string; website: string; tagline: string
  payout: string | null; webhookUrl: string
  pointsOn: boolean; pointsPerUsdt: number
  rewardOn: boolean; rewardName: string; rewardType: 'fixed_off' | 'percent_off'; rewardValue: string; rewardCost: number; rewardMin: string
  accent: string
}
const START: Form = {
  name: '', category: 'Café & food', website: '', tagline: '',
  payout: null, webhookUrl: '',
  pointsOn: true, pointsPerUsdt: 10,
  rewardOn: true, rewardName: '1 USDT off your order', rewardType: 'fixed_off', rewardValue: '1', rewardCost: 20, rewardMin: '3',
  accent: '#0a0a0a',
}
const CATEGORIES = ['Café & food', 'Books & media', 'Fashion', 'Electronics', 'Home & living', 'Services', 'Other']
const ACCENTS = ['#0a0a0a', '#1f3d2b', '#13182a', '#7a3b1d', '#0b63ce', '#9c2f6b']
const STEPS = [
  { title: 'Your shop', why: 'How customers will see you on invoices and receipts.' },
  { title: 'Get paid', why: 'The wallet your sales go to. It also proves the account is yours.' },
  { title: 'Make it yours', why: 'Your colour and a loyalty offer. Good defaults are already set: change anything or keep them.' },
] as const

/** Adds https:// when someone types a bare domain. */
const normalizeUrl = (v: string) => { const t = v.trim(); return !t ? '' : /^https?:\/\//i.test(t) ? t : `https://${t}` }
const urlOk = (v: string) => { if (!v) return true; try { return new URL(normalizeUrl(v)).hostname.includes('.') } catch { return false } }

function Wizard({ onDone }: { onDone: (r: Onboarded) => void }) {
  const [step, setStep] = useState(0)
  const [f, setF] = useState<Form>(START)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))

  // What is still missing on a step, in plain words. Shown after a click, never a silent disabled button.
  const problems = (s: number): Partial<Record<'name' | 'website' | 'payout' | 'webhook' | 'reward', string>> => {
    if (s === 0) return { ...(f.name.trim().length < 2 ? { name: 'Add your shop name.' } : {}), ...(!urlOk(f.website) ? { website: 'That website does not look right, for example yourshop.com' } : {}) }
    if (s === 1) return { ...(!f.payout ? { payout: 'Connect the wallet you want to be paid in.' } : {}), ...(!urlOk(f.webhookUrl) ? { webhook: 'That URL does not look right.' } : {}) }
    return f.pointsOn && f.rewardOn && !(f.rewardName.trim().length > 1 && Number(f.rewardValue) > 0 && f.rewardCost > 0) ? { reward: 'Give the reward a name, a value and a points cost, or turn it off.' } : {}
  }
  const shown = tried ? problems(step) : {}

  const next = () => {
    if (Object.keys(problems(step)).length) { setTried(true); return }
    setTried(false)
    setStep(step + 1)
  }

  const connect = async () => {
    setError(null)
    if (!hasWallet()) { window.open('https://metamask.io/download/', '_blank', 'noopener'); return }
    try { set('payout', getAddress(await connectWallet())) } catch (e) { setError(errorText(e)) }
  }

  const submit = async () => {
    for (const s of [0, 1, 2]) if (Object.keys(problems(s)).length) { setStep(s); setTried(true); return }
    if (!f.payout) return
    setBusy(true)
    setError(null)
    try {
      const time = new Date().toISOString()
      const name = f.name.trim()
      const signature = await signMessage(f.payout, onboardingMessage(name, f.payout, time))
      const result = await api<Onboarded>('/v1/public/merchants/onboard', {
        method: 'POST',
        body: {
          name, payoutAddress: f.payout, time, signature,
          webhookUrl: normalizeUrl(f.webhookUrl) || undefined,
          profile: { website: normalizeUrl(f.website) || null, category: f.category, tagline: f.tagline || null, accent: f.accent },
          campaign: f.pointsOn ? { pointsPerUsdt: f.pointsPerUsdt } : undefined,
          reward: f.pointsOn && f.rewardOn ? { name: f.rewardName, pointsCost: f.rewardCost, type: f.rewardType, value: f.rewardType === 'percent_off' ? Number(f.rewardValue) : f.rewardValue, minSpend: f.rewardMin || undefined } : undefined,
        },
      })
      onDone(result)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const last = step === STEPS.length - 1
  return (
    <section className="onb-wizard pk-panel" aria-label="Create a merchant account">
      <div className="onb-promise">
        <div>
          <h3>Create your merchant account</h3>
          <p>You get an API key for your server, a branded payment page, and a place in the PayKit points network. Free: one wallet signature, no gas, about two minutes.</p>
        </div>
        <ol className="onb-dots" aria-label="Progress">
          {STEPS.map((s, i) => <li key={s.title} data-state={i < step ? 'done' : i === step ? 'now' : 'next'}><span>{i + 1}</span>{s.title}</li>)}
        </ol>
      </div>
      <div className="onb-body">
        <div className="onb-form">
          <div className="onb-step-head">
            <span className="onb-step-count">Step {step + 1} of {STEPS.length}</span>
            <h3>{STEPS[step].title}</h3>
            <p className="pk-muted">{STEPS[step].why}</p>
          </div>

          {step === 0 && (
            <>
              <Field label="Shop name" error={shown.name}>
                <input value={f.name} maxLength={80} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Kettle & Leaf" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') next() }} />
              </Field>
              <div className="onb-grid">
                <Field label="Website" hint="optional" error={shown.website}>
                  <input value={f.website} onChange={(e) => set('website', e.target.value)} onBlur={(e) => set('website', normalizeUrl(e.target.value))} placeholder="yourshop.com" inputMode="url" />
                </Field>
                <Field label="Category">
                  <select value={f.category} onChange={(e) => set('category', e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
                </Field>
              </div>
              <Field label="One-line description" hint="optional">
                <input value={f.tagline} maxLength={140} onChange={(e) => set('tagline', e.target.value)} placeholder="e.g. Single-estate teas, packed by hand." />
              </Field>
            </>
          )}

          {step === 1 && (
            <>
              {f.payout ? (
                <div className="onb-wallet"><span className="onb-wallet__dot" /><b>{short(f.payout)}</b><span className="pk-muted">Sales go here</span><button type="button" className="pk-link" onClick={connect}>Use another wallet</button></div>
              ) : (
                <button type="button" className="onb-connect" onClick={connect}>
                  <span className="onb-connect__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h16v11H4zM4 7l2-3h12l2 3M16 13h2" /></svg></span>
                  <span className="onb-connect__text"><b>{hasWallet() ? 'Connect MetaMask' : 'Get MetaMask (free), then come back'}</b><span>Your USDT sales settle straight into this wallet.</span></span>
                </button>
              )}
              {shown.payout && <p className="onb-error">{shown.payout}</p>}
              <details className="onb-more">
                <summary>Developer option: webhook URL</summary>
                <Field label="Webhook URL" hint="we POST signed events here when you are paid" error={shown.webhook}>
                  <input value={f.webhookUrl} onChange={(e) => set('webhookUrl', e.target.value)} onBlur={(e) => set('webhookUrl', normalizeUrl(e.target.value))} placeholder="yourshop.com/api/paykit" inputMode="url" />
                </Field>
              </details>
            </>
          )}

          {step === 2 && (
            <>
              <div className="onb-section">
                <span className="onb-field__label">Brand colour</span>
                <div className="onb-swatches" role="radiogroup" aria-label="Brand colour">
                  {ACCENTS.map((c) => <button key={c} type="button" role="radio" aria-checked={f.accent === c} aria-label={c} style={{ background: c }} onClick={() => set('accent', c)} />)}
                  <label className="onb-swatches__custom"><input type="color" value={f.accent} onChange={(e) => set('accent', e.target.value)} aria-label="Custom colour" /><span>{f.accent}</span></label>
                </div>
              </div>
              <div className="onb-section">
                <label className="onb-toggle"><input type="checkbox" checked={f.pointsOn} onChange={(e) => set('pointsOn', e.target.checked)} /><span>Give customers PayKit points <span className="pk-muted">(spendable at any PayKit shop)</span></span></label>
                {f.pointsOn && (
                  <>
                    <Field label={`${f.pointsPerUsdt} points per 1 USDT spent`}>
                      <input type="range" min={1} max={50} value={f.pointsPerUsdt} onChange={(e) => set('pointsPerUsdt', Number(e.target.value))} />
                    </Field>
                    <label className="onb-toggle"><input type="checkbox" checked={f.rewardOn} onChange={(e) => set('rewardOn', e.target.checked)} /><span>Let customers spend points with you</span></label>
                    {f.rewardOn && (
                      <div className="onb-reward">
                        <input aria-label="Reward name" value={f.rewardName} maxLength={60} onChange={(e) => set('rewardName', e.target.value)} />
                        <span className="onb-reward__row">
                          <span>Costs</span><input aria-label="Points cost" type="number" min={1} value={f.rewardCost} onChange={(e) => set('rewardCost', Number(e.target.value))} /><span>points for</span>
                          <input aria-label="Value" value={f.rewardValue} inputMode="decimal" onChange={(e) => set('rewardValue', e.target.value)} />
                          <select aria-label="Type" value={f.rewardType} onChange={(e) => { const t = e.target.value as Form['rewardType']; set('rewardType', t); set('rewardValue', t === 'percent_off' ? '10' : '1') }}>
                            <option value="fixed_off">USDT off</option>
                            <option value="percent_off">% off</option>
                          </select>
                        </span>
                        {shown.reward && <p className="onb-error">{shown.reward}</p>}
                      </div>
                    )}
                  </>
                )}
              </div>
              <p className="pk-muted onb-fine">Next, MetaMask shows a short message to sign. It is free and moves no money. Then we register your shop on Whitechain (about 15 seconds).</p>
            </>
          )}

          {error && <div className="pk-state pk-state--error" role="alert"><p className="pk-state__title">Not done yet</p><div className="pk-state__body">{error}</div></div>}
          <div className="onb-nav">
            {step > 0 && <button type="button" className="pk-button pk-button--secondary" onClick={() => { setTried(false); setStep(step - 1) }} disabled={busy}>Back</button>}
            {!last ? (
              <button type="button" className="pk-button pk-button--primary" onClick={next}>Continue</button>
            ) : (
              <button type="button" className="pk-button pk-button--primary" disabled={busy} onClick={submit}>{busy ? 'Creating your account…' : 'Create my account'}</button>
            )}
          </div>
        </div>
        <Preview f={f} />
      </div>
    </section>
  )
}

/** Live preview of the customer's pay card with the merchant's brand. */
function Preview({ f }: { f: Form }) {
  const earn = f.pointsOn ? Math.floor(12.5 * f.pointsPerUsdt) : 0
  return (
    <aside className="onb-preview" aria-label="Checkout preview" style={{ ['--brand' as string]: f.accent }}>
      <p className="onb-preview__label">What your customers see</p>
      <div className="onb-card">
        <div className="onb-card__bar" />
        <p className="onb-card__shop">{f.name || 'Your business'}</p>
        {f.tagline && <p className="onb-card__tag">{f.tagline}</p>}
        <p className="onb-card__amount">12.50 <small>USDT</small></p>
        <dl>
          <dt>Network fee</dt><dd>0 WBT, PayKit pays</dd>
          {earn > 0 && <><dt>You earn</dt><dd>+{earn} points</dd></>}
        </dl>
        {f.pointsOn && f.rewardOn && <div className="onb-card__reward"><span>{f.rewardName || 'Reward'}</span><span>{f.rewardCost} pts</span></div>}
        <div className="onb-card__pay">Pay 12.50 USDT</div>
      </div>
    </aside>
  )
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return <label className={error ? 'onb-field onb-field--bad' : 'onb-field'}><span className="onb-field__label">{label}{hint && <span className="onb-field__hint"> · {hint}</span>}</span>{children}{error && <span className="onb-error">{error}</span>}</label>
}

// ── after sign-up ──

function Welcome({ result, onOpen }: { result: Onboarded; onOpen: (remember: boolean) => void }) {
  const [remember, setRemember] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (label: string, v: string) => { void navigator.clipboard?.writeText(v).then(() => setCopied(label)) }
  const curl = `curl -X POST ${SERVER_URL}/v1/invoices \\
  -H "Authorization: Bearer ${result.apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"amount":"12.50","reference":"ORDER-1042","description":"2x Masala chai","successUrl":"https://yourshop.com/thanks"}'`
  return (
    <section className="onb-welcome pk-panel">
      <p className="eyebrow eyebrow--ink"><span className="eyebrow__dot" />You're on PayKit</p>
      <h2>Welcome, {result.merchant.name}</h2>
      <p className="pk-muted">Registered on Whitechain. {result.merchant.registerTx && <a className="pk-link" href={result.merchant.registerTx} target="_blank" rel="noreferrer">See the registration</a>}</p>
      {result.warnings.length > 0 && <div className="pk-state pk-state--info"><div className="pk-state__body">{result.warnings.join(' ')}</div></div>}
      <div className="onb-secret">
        <div><span className="onb-field__label">API key (shown once)</span><code>{result.apiKey}</code></div>
        <button type="button" className="pk-button pk-button--secondary" onClick={() => copy('key', result.apiKey)}>{copied === 'key' ? 'Copied' : 'Copy'}</button>
      </div>
      <div className="onb-secret">
        <div><span className="onb-field__label">Webhook signing secret</span><code>{result.webhookSecret}</code></div>
        <button type="button" className="pk-button pk-button--secondary" onClick={() => copy('secret', result.webhookSecret)}>{copied === 'secret' ? 'Copied' : 'Copy'}</button>
      </div>
      <p className="pk-muted">Keep both on your server. Anyone with the API key can create invoices for you.</p>
      <div className="onb-code"><div className="onb-code__bar"><span>Create an invoice from your server</span><button type="button" onClick={() => copy('curl', curl)}>{copied === 'curl' ? 'Copied' : 'Copy'}</button></div><pre><code>{curl}</code></pre></div>
      <p className="pk-muted">The response has a <code>payUrl</code>: send your customer there. They pay on PayKit and come back to your <code>successUrl</code>.</p>
      <label className="onb-toggle"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><span>Keep my key in this browser to open the console</span></label>
      <button type="button" className="pk-button pk-button--primary" onClick={() => onOpen(remember)}>Open my console</button>
    </section>
  )
}

function KeyLogin({ onKey }: { onKey: (k: string) => void }) {
  const [k, setK] = useState('')
  const [bad, setBad] = useState(false)
  return (
    <form className="onb-login" onSubmit={(e) => { e.preventDefault(); if (/^pk_(test|live)_/.test(k.trim())) onKey(k.trim()); else setBad(true) }}>
      <span>Already a merchant?</span>
      <input value={k} onChange={(e) => { setK(e.target.value); setBad(false) }} placeholder="Paste your API key (pk_test_…)" aria-label="API key" />
      <button type="submit" className="pk-button pk-button--secondary">Open console</button>
      {bad && <span className="onb-error">API keys start with pk_test_ or pk_live_.</span>}
    </form>
  )
}

// ── console ──

function Console({ apiKey, onSignOut }: { apiKey: string; onSignOut: () => void }) {
  const [me, setMe] = useState<Merchant | null>(null)
  const [invoices, setInvoices] = useState<MerchantInvoice[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [rewards, setRewards] = useState<Reward[]>([])
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState({ amount: '', reference: '', description: '', successUrl: '' })
  const [created, setCreated] = useState<MerchantInvoice | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [m, inv, c, r] = await Promise.all([
        api<Merchant>('/v1/merchants/me', { key: apiKey }),
        api<{ data: MerchantInvoice[] }>('/v1/invoices', { key: apiKey }),
        api<{ data: Campaign[] }>('/v1/points/campaigns', { key: apiKey }).catch(() => ({ data: [] })),
        api<{ data: Reward[] }>('/v1/points/rewards', { key: apiKey }).catch(() => ({ data: [] })),
      ])
      setMe(m); setInvoices(inv.data); setCampaigns(c.data); setRewards(r.data); setError(null)
    } catch (e) {
      setError(errorText(e))
    }
  }, [apiKey])
  useEffect(() => { void load() }, [load])

  const paid = useMemo(() => invoices.reduce((n, i) => n + Number(i.amountPaid || 0), 0), [invoices])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!(Number(draft.amount) >= 2)) { setError('Enter an amount of at least 2 USDT.'); return }
    setBusy(true)
    setError(null)
    try {
      const inv = await api<MerchantInvoice>('/v1/invoices', { method: 'POST', key: apiKey, body: { amount: draft.amount, reference: draft.reference || undefined, description: draft.description || undefined, successUrl: draft.successUrl || undefined } })
      setCreated(inv)
      setDraft({ amount: '', reference: '', description: '', successUrl: draft.successUrl })
      void load()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (!me && error) {
    return <div className="pk-state pk-state--error"><p className="pk-state__title">Can't open the console</p><div className="pk-state__body">{error} <button type="button" className="pk-link" onClick={onSignOut}>Use another key</button></div></div>
  }

  return (
    <div className="onb-console" style={{ ['--brand' as string]: me?.profile?.accent ?? '#0a0a0a' }}>
      <header className="onb-console__head pk-panel">
        <div className="onb-console__brand"><span className="onb-console__swatch" />
          <div><h2>{me?.name ?? 'Loading…'}</h2><p className="pk-muted">{[me?.profile?.category, me?.profile?.tagline].filter(Boolean).join(' · ') || 'PayKit merchant'}</p></div>
        </div>
        <div className="onb-console__stats">
          <div><span>Collected</span><b>{money(paid)}</b></div>
          <div><span>Invoices</span><b>{invoices.length}</b></div>
          <div><span>Payouts to</span><b>{me ? short(me.payoutAddress) : '…'}</b></div>
        </div>
        <button type="button" className="pk-link" onClick={onSignOut}>Sign out</button>
      </header>

      <div className="columns">
        <section className="pk-panel">
          <h3 className="pk-panel__title">New invoice</h3>
          <form className="onb-invoice" onSubmit={create}>
            <Field label="Amount (USDT)" hint="at least 2"><input inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} placeholder="12.50" /></Field>
            <Field label="Reference"><input value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} placeholder="ORDER-1042" /></Field>
            <Field label="Description"><input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="2× Masala chai" /></Field>
            <Field label="Return link" hint="Optional. Where customers go after paying."><input value={draft.successUrl} onChange={(e) => setDraft({ ...draft, successUrl: e.target.value })} placeholder="https://yourshop.com/thanks" /></Field>
            <button type="submit" className="pk-button pk-button--primary" disabled={busy}>{busy ? 'Creating…' : 'Create invoice'}</button>
          </form>
          {created && (
            <div className="onb-created">
              <span className="onb-field__label">Payment link</span>
              <code>{created.payUrl}</code>
              <span className="onb-created__actions"><button type="button" className="pk-link" onClick={() => void navigator.clipboard?.writeText(created.payUrl)}>Copy</button><a className="pk-link" href={created.payUrl}>Open</a></span>
            </div>
          )}
          {error && <div className="pk-state pk-state--error" role="alert"><div className="pk-state__body">{error}</div></div>}
        </section>

        <section className="pk-panel">
          <h3 className="pk-panel__title">Loyalty</h3>
          {campaigns.length === 0 && rewards.length === 0 && <p className="pk-muted">No points programme yet.</p>}
          <ul className="receipts receipts--compact">
            {campaigns.map((c) => <li key={c.id} className="receipt"><div className="receipt__main"><b>{c.name}</b><span className="receipt__meta">{c.pointsPerUsdt} points per USDT · {c.issued} issued</span></div><div className="receipt__side"><span className="pk-tag">{c.status ?? 'active'}</span></div></li>)}
            {rewards.map((r) => <li key={r.id} className="receipt"><div className="receipt__main"><b>{r.name}</b><span className="receipt__meta">{r.label} · {r.redeemed} redeemed</span></div><div className="receipt__side"><span className="pk-tag">{r.status ?? 'active'}</span></div></li>)}
          </ul>
        </section>
      </div>

      <section className="pk-panel">
        <h3 className="pk-panel__title">Invoices</h3>
        {invoices.length === 0 ? <p className="pk-muted">No invoices yet. Create one above, or from your server with your API key.</p> : (
          <ul className="receipts">
            {invoices.map((i) => (
              <li key={i.id} className="receipt">
                <div className="receipt__main"><b>{i.reference ?? i.id}</b><span className="receipt__desc">{i.description ?? ''}</span><span className="receipt__meta">{new Date(i.createdAt).toLocaleString()}</span></div>
                <div className="receipt__side"><b className="receipt__amount">{money(i.amount)}</b><span className={`pk-tag ${i.status === 'paid' ? 'pk-tag--good' : 'pk-tag--progress'}`}>{i.status.replace('_', ' ')}</span><a className="pk-link" href={i.payUrl}>Pay link</a></div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
