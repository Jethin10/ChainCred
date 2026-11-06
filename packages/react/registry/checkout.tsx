"use client";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useCheckout, useCheckoutRewards, errorMessage } from '@paykit/react';
import { formatUsdt } from '@paykit/js';
import './paykit-ui.css';

type CheckoutProps = {
  sessionId: string; amount: string; label?: string; holdMs?: number; className?: string; onPaid?: (paymentId: string) => void;
};

export function CustomCheckout(props: CheckoutProps) {
  return <SessionCheckout key={props.sessionId} {...props} />;
}

const PHASES = ['Sign', 'Relay', 'Settle'] as const;

function SessionCheckout({ sessionId, amount: listed, label = 'Pay with USDT', holdMs = 900, className = '', onPaid }: CheckoutProps) {
  const checkout = useCheckout();
  const rewards = useCheckoutRewards(sessionId);
  const quote = rewards.session?.quote;
  const applied = rewards.session?.reward ?? null;
  // With a reward the server re-quotes; pay exactly the re-signed amount it shows.
  const amount = applied && quote ? quote.gross : listed;
  const earns = quote?.pointsEarned && quote.pointsEarned !== '0' ? quote.pointsEarned : null;
  const offers = rewards.program?.enabled ? rewards.program.rewards : [];
  const done = checkout.phase === 'done';
  const included = checkout.payment && ['included', 'safe', 'finalized'].includes(checkout.payment.status);
  const step = done ? 3 : checkout.phase === 'processing' ? (included ? 2 : 1) : checkout.busy ? 0 : -1;
  const pay = () => checkout.pay({ sessionId }, { expectedAmount: amount }).then((payment) => onPaid?.(payment.paymentId)).catch(() => {});

  return <section className={`pkc-card ${className}`} aria-label="Checkout">
    <div className="pkc-row"><span className="pkc-eyebrow">Order total</span><span className="pkc-tag">USDT · Whitechain</span></div>
    <p className="pkc-total" aria-label={`${formatUsdt(amount)} USDT`}><Digits key={amount} value={formatUsdt(amount)} /><small>USDT</small>{applied && <s className="pkc-was">{formatUsdt(listed)}</s>}</p>
    <ul className="pkc-lines">
      <li><span>Network fee</span><span className="pkc-free">Covered by PayKit</span></li>
      {applied && <li><span>{applied.name}</span><span>−{formatUsdt(applied.discount)} USDT · {applied.pointsCost} PKP</span></li>}
      {earns && <li><span>You earn</span><span className="pkc-earn">+{earns} PKP</span></li>}
      <li><span>You sign</span><span>Once, no gas</span></li>
    </ul>
    {offers.length > 0 && !done && !checkout.busy && <fieldset className="pkc-coupons" disabled={rewards.busy}>
      <legend className="pkc-eyebrow">Spend points{rewards.balance !== null ? ` · you have ${rewards.balance} PKP` : ''}</legend>
      {offers.map((r) => {
        const on = applied?.id.toLowerCase() === r.id.toLowerCase();
        const short = rewards.balance !== null && rewards.balance < BigInt(r.pointsCost) ? BigInt(r.pointsCost) - rewards.balance : null;
        return <button key={r.id} type="button" className="pkc-coupon" aria-pressed={on} disabled={!on && short !== null}
          onClick={() => { void rewards.apply(on ? null : r.id as `0x${string}`).catch(() => {}); }}>
          <span className="pkc-coupon__name">{r.name}</span>
          <span className="pkc-coupon__cost">{short !== null ? `${short} PKP short` : `${r.pointsCost} PKP`}</span>
        </button>;
      })}
    </fieldset>}
    {rewards.error != null && <p className="pkc-error" role="alert">{errorMessage(rewards.error)}</p>}
    {step >= 0 && <ol className="pkc-phases" aria-label="Payment progress">
      {PHASES.map((name, index) => <li key={name} data-state={index < step ? 'done' : index === step ? 'active' : 'todo'}>{name}</li>)}
    </ol>}
    <HoldButton holdMs={holdMs} state={done ? 'done' : checkout.busy ? 'busy' : 'idle'} onConfirm={() => void pay()}>
      {done ? 'Paid ✓' : checkout.busy ? <span className="pkc-dots">{checkout.phase === 'processing' ? 'Settling' : 'Waiting for signature'}</span> : label}
    </HoldButton>
    {done && <Burst />}
    {checkout.error != null && <p className="pkc-error" role="alert">{errorMessage(checkout.error)} Hold again to retry.</p>}
    {checkout.payment && <p className="pkc-muted" aria-live="polite">{checkout.payment.status === 'finalized' ? 'Finalized. Your receipt is ready.' : `Payment ${checkout.payment.status}. Your receipt will update as it settles.`}</p>}
    <details className="pkc-why">
      <summary>What am I signing?</summary>
      <dl className="pkc-details">
        <div><dt>Amount</dt><dd>{formatUsdt(amount)} USDT, exactly</dd></div>
        <div><dt>Gas</dt><dd>Paid by the PayKit relayer</dd></div>
        <div><dt>Session</dt><dd className="pkc-mono">{sessionId.slice(0, 10)}…</dd></div>
      </dl>
    </details>
  </section>;
}

/** Press and hold to confirm. Releasing early drains the fill, so a payment is never a stray click. */
function HoldButton({ holdMs, state, onConfirm, children }: { holdMs: number; state: 'idle' | 'busy' | 'done'; onConfirm: () => void; children: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const anim = useRef({ raf: 0, p: 0, dir: 0, last: 0 });
  const [holding, setHolding] = useState(false);
  useEffect(() => () => cancelAnimationFrame(anim.current.raf), []);
  const frame = (now: number) => {
    const a = anim.current;
    const dt = now - (a.last || now); a.last = now;
    a.p = Math.min(1, Math.max(0, a.p + (a.dir > 0 ? dt / holdMs : -dt / 260)));
    ref.current?.style.setProperty('--p', String(a.p));
    if (a.dir > 0 && a.p >= 1) { a.dir = 0; a.p = 0; setHolding(false); navigator.vibrate?.(15); ref.current?.style.setProperty('--p', '0'); onConfirm(); return; }
    if (a.dir > 0 || a.p > 0) a.raf = requestAnimationFrame(frame);
  };
  const start = () => { if (state !== 'idle') return; const a = anim.current; a.dir = 1; a.last = 0; setHolding(true); cancelAnimationFrame(a.raf); a.raf = requestAnimationFrame(frame); };
  const stop = () => { const a = anim.current; if (a.dir <= 0) return; a.dir = -1; a.last = 0; setHolding(false); cancelAnimationFrame(a.raf); a.raf = requestAnimationFrame(frame); };
  return <button ref={ref} type="button" className="pkc-hold" data-state={state} data-holding={holding} disabled={state !== 'idle'}
    aria-label={state === 'idle' ? `Press and hold to confirm: ${typeof children === 'string' ? children : 'pay'}` : undefined}
    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); start(); }} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
    onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(); } }}
    onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') stop(); }} onContextMenu={(e) => e.preventDefault()}>
    <span className="pkc-hold__label">{children}{state === 'idle' && <span className="pkc-hold__hint"><span className="pkc-hold__key" aria-hidden="true">●</span> {holding ? 'keep holding' : 'hold'}</span>}</span>
  </button>;
}

function Digits({ value }: { value: string }) {
  return <span className="pkc-digits" aria-hidden="true">{[...value].map((char, i) => <span key={`${i}${char}`} style={{ '--i': i } as CSSProperties}>{char}</span>)}</span>;
}

function Burst() {
  return <span className="pkc-burst" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => {
    const angle = (i / 14) * Math.PI * 2;
    const r = 70 + (i % 3) * 26;
    return <i key={i} style={{ '--x': `${Math.round(Math.cos(angle) * r)}px`, '--y': `${Math.round(Math.sin(angle) * r * 0.7)}px` } as CSSProperties} />;
  })}</span>;
}
