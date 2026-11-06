"use client";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { usePlanCheckout, errorMessage, periodLabel } from '@paykit/react';
import { installmentSplit, formatUsdt, type CheckoutInput, type PlanOption } from '@paykit/js';
import './paykit-ui.css';

export function CustomInstallmentPlan({ input, total, option, holdMs = 900, className = '' }: { input: CheckoutInput; total: string; option: PlanOption; holdMs?: number; className?: string }) {
  const plan = usePlanCheckout();
  const amounts = installmentSplit(BigInt(total), option.count, option.downPaymentPercent ?? 0);
  const done = plan.phase === 'done';
  const every = periodLabel(option.periodSeconds);
  const slots = [
    ...(amounts.downPayment > 0n ? [{ kind: 'now', label: 'Now', amount: amounts.downPayment, note: `${formatUsdt(amounts.downPayment)} USDT down payment, taken when you set up the plan.` }] : []),
    ...Array.from({ length: option.count }, (_, i) => ({ kind: 'later', label: `#${i + 1}`, amount: amounts.installmentAmount, note: `Payment ${i + 1} of ${option.count}: ${formatUsdt(amounts.installmentAmount)} USDT${i === 0 ? '' : `, ${i} × ${every} after the first`}.` })),
  ];
  const peak = slots.reduce((max, s) => (s.amount > max ? s.amount : max), 1n);
  const [picked, setPicked] = useState<number | null>(null);
  const note = picked == null ? `${option.count} payments, every ${every}. Total ${formatUsdt(total)} USDT.` : slots[picked].note;

  return <section className={`pkc-card ${className}`} aria-label="Installment plan">
    <div className="pkc-row"><h3 className="pkc-title">Pay over time</h3><span className="pkc-tag">{option.count} × {every}</span></div>
    <p className="pkc-amount"><span>{formatUsdt(amounts.installmentAmount)}</span><small>USDT per payment</small></p>
    <div className="pkc-schedule" data-done={done} style={{ '--n': slots.length } as CSSProperties} role="group" aria-label="Payment schedule">
      {slots.map((slot, i) => <button key={i} type="button" className="pkc-slot" data-kind={slot.kind} aria-pressed={picked === i}
        style={{ '--i': i, '--h': Number((slot.amount * 100n) / peak) / 100 } as CSSProperties}
        onClick={() => setPicked(picked === i ? null : i)} onMouseEnter={() => setPicked(i)} onMouseLeave={() => setPicked(null)}>{slot.label}</button>)}
    </div>
    <p className="pkc-slot-note pkc-muted" aria-live="polite"><span key={note}>{note}</span></p>
    <HoldButton holdMs={holdMs} state={done ? 'done' : plan.busy ? 'busy' : 'idle'} onConfirm={() => { void plan.start(input, option, total).catch(() => {}); }}>
      {done ? 'Plan created ✓' : plan.busy ? <span className="pkc-dots">Setting up plan</span> : 'Set up plan'}
    </HoldButton>
    {plan.error != null && <p className="pkc-error" role="alert">{errorMessage(plan.error)}</p>}
    {plan.plan && <p className="pkc-muted" role="status">Plan {plan.plan.status}. You can cancel future payments from your account.</p>}
    <details className="pkc-why">
      <summary>What am I agreeing to?</summary>
      <dl className="pkc-details">
        <div><dt>You sign</dt><dd>Plan consent and a bounded USDT allowance</dd></div>
        <div><dt>Gas</dt><dd>Paid by PayKit</dd></div>
        <div><dt>Cancel</dt><dd>Future payments, any time</dd></div>
      </dl>
    </details>
  </section>;
}

/** Press and hold to confirm. Releasing early drains the fill, so a commitment is never a stray click. */
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
    aria-label={state === 'idle' ? `Press and hold to confirm: ${typeof children === 'string' ? children : 'continue'}` : undefined}
    onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); start(); }} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
    onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(); } }}
    onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') stop(); }} onContextMenu={(e) => e.preventDefault()}>
    <span className="pkc-hold__label">{children}{state === 'idle' && <span className="pkc-hold__hint"><span className="pkc-hold__key" aria-hidden="true">●</span> {holding ? 'keep holding' : 'hold'}</span>}</span>
  </button>;
}
