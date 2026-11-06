import { useCallback, useEffect, useState } from 'react'
import {
  api, connectWallet, errorText, EXPLORER, hasWallet, short, signTypedData, sleep, usdt,
  type Invoice, type Offers, type Plan, type Quote, type QuoteStatus, type Receipt, type Subscribe, type Subscription,
} from './server'

/** Hosted checkout for an invoice on the live PayKit server: real USDT on Whitechain testnet. */
export function PayPage({ invoiceId }: { invoiceId: string }) {
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [account, setAccount] = useState<string | null>(null)
  const [offers, setOffers] = useState<Offers | null>(null)
  const [reward, setReward] = useState<string | null>(null)
  const [step, setStep] = useState<'idle' | 'quote' | 'sign' | 'send' | 'settle' | 'done'>('idle')
  const [status, setStatus] = useState<QuoteStatus | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => api<Invoice>(`/v1/public/invoices/${encodeURIComponent(invoiceId)}`).then(setInvoice, (e) => setError(errorText(e))), [invoiceId])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!account) return
    api<Offers>(`/v1/public/invoices/${encodeURIComponent(invoiceId)}/offers?payer=${account}`).then(setOffers, () => setOffers(null))
  }, [account, invoiceId])

  const connect = async () => {
    setError(null)
    try { setAccount(await connectWallet()) } catch (e) { setError(errorText(e)) }
  }

  const pay = async () => {
    if (!account) return
    setError(null)
    try {
      setStep('quote')
      const q = await api<Quote>(`/v1/public/invoices/${encodeURIComponent(invoiceId)}/quote`, { method: 'POST', body: { payer: account, ...(reward ? { rewardId: reward } : {}) } })
      setStep('sign')
      const signature = await signTypedData(account, q.typedData)
      setStep('send')
      setStatus(await api<QuoteStatus>(`/v1/public/quotes/${q.quoteId}/authorize`, { method: 'POST', body: { signature } }))
      setStep('settle')
      // The receipt reads the router onchain, so it is the source of truth for "paid".
      for (let i = 0; i < 60; i++) {
        await sleep(3000)
        const [s, r] = await Promise.all([
          api<QuoteStatus>(`/v1/public/quotes/${q.quoteId}`).catch(() => null),
          api<Receipt>(`/v1/public/receipts/${q.paymentId}`).catch(() => null),
        ])
        if (s) setStatus(s)
        if (s?.status === 'failed') throw new Error(s.error ?? 'The payment failed onchain.')
        if (r?.onchain.verified) { setReceipt(r); setStep('done'); void load(); return }
      }
      throw new Error('Still waiting for the chain. Your payment may settle shortly; reload this page to check.')
    } catch (e) {
      setError(errorText(e))
      setStep('idle')
    }
  }

  if (!invoice) {
    return <Shell>{error ? <State kind="error" title="Invoice not available">{error}</State> : <State kind="loading" title="Loading invoice…" />}</Shell>
  }

  const due = Number(invoice.amountDue)
  const chosen = offers?.offers.find((o) => o.id === reward && o.available)
  const payNow = chosen?.payAfter ?? invoice.amountDue
  const busy = step !== 'idle' && step !== 'done'

  return (
    <Shell>
      <section className="pk-panel livepay">
        <div className="livepay__head">
          <p className="eyebrow eyebrow--ink"><span className="eyebrow__dot" />Pay {invoice.merchant?.name ?? 'merchant'}</p>
          <span className={`pk-tag ${invoice.status === 'paid' ? 'pk-tag--good' : 'pk-tag--progress'}`}>{invoice.status.replace('_', ' ')}</span>
        </div>
        <p className="livepay__amount"><span className="pk-num">{usdt(step === 'done' ? invoice.amount : payNow)}</span></p>
        {invoice.description && <p className="pk-muted">{invoice.description}</p>}
        <dl className="livepay__rows">
          {invoice.reference && <><dt>Reference</dt><dd>{invoice.reference}</dd></>}
          <dt>Total</dt><dd>{usdt(invoice.amount)}</dd>
          {Number(invoice.amountPaid) > 0 && <><dt>Already paid</dt><dd>{usdt(invoice.amountPaid)}</dd></>}
          {chosen && <><dt>Points discount</dt><dd className="pk-good">−{usdt(chosen.discount!)}</dd></>}
          <dt>Network fee</dt><dd>0 WBT, PayKit pays the gas</dd>
        </dl>

        {step === 'done' && receipt ? (
          <State kind="info" title="Paid. Settled on Whitechain.">
            {usdt(receipt.onchain.gross)} reached {invoice.merchant?.name ?? 'the merchant'}
            {receipt.payment && receipt.payment.pointsEarned > 0 ? `, and you earned ${receipt.payment.pointsEarned} points` : ''}.{' '}
            {status?.txUrl && <a className="pk-link" href={status.txUrl} target="_blank" rel="noreferrer">View transaction</a>}
            {invoice.successUrl && <> · <a className="pk-link" href={invoice.successUrl}>Back to the shop</a></>}
          </State>
        ) : due <= 0 ? (
          <State kind="info" title="This invoice is already paid." />
        ) : (
          <>
            {account && offers?.enabled && offers.offers.length > 0 && (
              <div className="livepay__offers" role="radiogroup" aria-label="Use points">
                <p className="pk-field__label">Use points · you have {offers.balance}</p>
                {offers.offers.map((o) => (
                  <button key={o.id} type="button" role="radio" aria-checked={reward === o.id} disabled={!o.available || busy}
                    className={`pk-choice__option${reward === o.id ? ' pk-choice__option--on' : ''}`} onClick={() => setReward(reward === o.id ? null : o.id)}>
                    <span className="pk-choice__main">{o.name}</span>
                    <span className="pk-choice__side">{o.available ? `−${usdt(o.discount!)} · ${o.pointsCost} pts` : o.message}</span>
                  </button>
                ))}
              </div>
            )}
            {account && offers?.enabled && offers.willEarn > 0 && <p className="pk-hint">You earn {chosen?.willEarn ?? offers.willEarn} points with this payment.</p>}

            {!account ? (
              <button type="button" className="pk-button pk-button--primary pk-button--block" onClick={connect}>{hasWallet() ? 'Connect wallet' : 'Open in a wallet browser'}</button>
            ) : (
              <button type="button" className="pk-button pk-button--primary pk-button--block" disabled={busy} onClick={pay}>
                {step === 'quote' ? 'Preparing…' : step === 'sign' ? 'Sign in your wallet…' : step === 'send' ? 'Sending…' : step === 'settle' ? 'Settling onchain…' : `Pay ${usdt(payNow)}`}
              </button>
            )}
            {account && <p className="pk-hint">Paying from {short(account)} on Whitechain testnet. One signature, no gas.</p>}
          </>
        )}
        {status?.txUrl && step === 'settle' && <p className="pk-hint"><a className="pk-link" href={status.txUrl} target="_blank" rel="noreferrer">Transaction submitted</a>, waiting for confirmations…</p>}
        {error && <State kind="error" title="Payment not completed">{error}</State>}
      </section>
    </Shell>
  )
}

/** Hosted subscribe page for a plan on the live server: a USDT permit plus a plan consent, both gasless. */
export function SubscribePage({ planId }: { planId: string }) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [account, setAccount] = useState<string | null>(null)
  const [step, setStep] = useState<'idle' | 'terms' | 'permit' | 'consent' | 'send' | 'done'>('idle')
  const [sub, setSub] = useState<Subscription | null>(null)
  const [terms, setTerms] = useState<Subscribe['summary'] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { api<Plan>(`/v1/public/plans/${encodeURIComponent(planId)}`).then(setPlan, (e) => setError(errorText(e))) }, [planId])

  const connect = async () => {
    setError(null)
    try { setAccount(await connectWallet()) } catch (e) { setError(errorText(e)) }
  }

  const subscribe = async () => {
    if (!account) return
    setError(null)
    try {
      setStep('terms')
      const s = await api<Subscribe>(`/v1/public/plans/${encodeURIComponent(planId)}/subscribe`, { method: 'POST', body: { payer: account } })
      setTerms(s.summary)
      setStep('permit')
      const permitSignature = await signTypedData(account, s.typedData.permit)
      setStep('consent')
      const consentSignature = await signTypedData(account, s.typedData.consent)
      setStep('send')
      await api(`/v1/public/subscriptions/${s.subscriptionId}/authorize`, { method: 'POST', body: { permitSignature, consentSignature } })
      for (let i = 0; i < 40; i++) {
        const cur = await api<Subscription>(`/v1/public/subscriptions/${s.subscriptionId}`)
        setSub(cur)
        if (cur.status === 'active' || cur.status === 'completed') { setStep('done'); return }
        if (cur.status === 'failed') throw new Error('The plan could not be created onchain.')
        await sleep(3000)
      }
      setStep('done')
    } catch (e) {
      setError(errorText(e))
      setStep('idle')
    }
  }

  if (!plan) return <Shell>{error ? <State kind="error" title="Plan not available">{error}</State> : <State kind="loading" title="Loading plan…" />}</Shell>
  const busy = step !== 'idle' && step !== 'done'

  return (
    <Shell>
      <section className="pk-panel livepay">
        <div className="livepay__head">
          <p className="eyebrow eyebrow--ink"><span className="eyebrow__dot" />{plan.kind === 'installments' ? 'Installments' : 'Subscription'} · {plan.merchant?.name ?? 'merchant'}</p>
          {!plan.active && <span className="pk-tag pk-tag--bad">closed</span>}
        </div>
        <h2 className="livepay__title">{plan.name}</h2>
        <p className="livepay__amount"><span className="pk-num">{usdt(plan.amount)}</span> <span className="pk-muted">every {plan.interval}</span></p>
        {plan.description && <p className="pk-muted">{plan.description}</p>}
        <dl className="livepay__rows">
          <dt>Charged today</dt><dd>{usdt(plan.chargedAtSignup)}</dd>
          <dt>Scheduled charges</dt><dd>{plan.scheduledCharges}</dd>
          <dt>Total</dt><dd>{usdt(plan.total)}</dd>
          {terms && <><dt>First scheduled charge</dt><dd>{new Date(terms.firstScheduledCharge).toLocaleString()}</dd></>}
          <dt>Network fee</dt><dd>0 WBT, PayKit pays the gas</dd>
        </dl>
        {step === 'done' && sub ? (
          <State kind="info" title={sub.status === 'active' ? 'Subscribed.' : `Plan ${sub.status}.`}>
            Paid so far {usdt(sub.amountPaid)} · {sub.scheduledChargesCollected}/{sub.scheduledChargesTotal} scheduled charges
            {sub.nextChargeAt ? ` · next on ${new Date(sub.nextChargeAt).toLocaleDateString()}` : ''}. You can cancel any time.
          </State>
        ) : !account ? (
          <button type="button" className="pk-button pk-button--primary pk-button--block" disabled={!plan.active} onClick={connect}>Connect wallet</button>
        ) : (
          <button type="button" className="pk-button pk-button--primary pk-button--block" disabled={busy || !plan.active} onClick={subscribe}>
            {step === 'terms' ? 'Preparing terms…' : step === 'permit' ? 'Sign 1 of 2: spending limit…' : step === 'consent' ? 'Sign 2 of 2: plan terms…' : step === 'send' ? 'Starting plan…' : `Subscribe for ${usdt(plan.chargedAtSignup)} today`}
          </button>
        )}
        {account && step !== 'done' && <p className="pk-hint">From {short(account)}. Two signatures, no transactions: a USDT spending limit capped at the plan total, and your consent to these terms.</p>}
        {error && <State kind="error" title="Not subscribed">{error}</State>}
      </section>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="page">
      <div className="narrow">{children}</div>
      <p className="pk-hint livepay__foot">
        Live on Whitechain testnet with real test USDT. Need some? Ask the merchant, or check the <a className="pk-link" href={EXPLORER} target="_blank" rel="noreferrer">explorer</a>.
      </p>
    </section>
  )
}

function State({ kind, title, children }: { kind: 'info' | 'error' | 'loading'; title: string; children?: React.ReactNode }) {
  return (
    <div className={`pk-state pk-state--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <p className="pk-state__title">{title}</p>
      {children && <div className="pk-state__body">{children}</div>}
    </div>
  )
}
