"use client";
import { usePlanCheckout, errorMessage, periodLabel } from '@paykit/react';
import { installmentSplit, formatUsdt, type CheckoutInput, type PlanOption } from '@paykit/js';
import './paykit-ui.css';

export function CustomInstallmentPlan({ input, total, option, className = '' }: { input: CheckoutInput; total: string; option: PlanOption; className?: string }) {
  const plan = usePlanCheckout();
  const amounts = installmentSplit(BigInt(total), option.count, option.downPaymentPercent ?? 0);
  return <section className={`pkc-card ${className}`} aria-label="Installment plan">
    <div className="pkc-row"><h3 className="pkc-title">Pay over time</h3><span className="pkc-tag">{option.count} payments</span></div>
    <p className="pkc-amount">{formatUsdt(amounts.installmentAmount)} <span>USDT per payment</span></p>
    <p className="pkc-muted">{option.count} payments, every {periodLabel(option.periodSeconds)}. Total {formatUsdt(total)} USDT.</p>
    {amounts.downPayment > 0n && <p className="pkc-muted">{formatUsdt(amounts.downPayment)} USDT down payment</p>}
    <p className="pkc-muted">You sign consent and a bounded token allowance. No customer gas is required.</p>
    <button className="pkc-button" disabled={plan.busy || plan.phase === 'done'} onClick={() => { void plan.start(input, option, total).catch(() => {}); }}>{plan.busy ? 'Setting up plan…' : plan.phase === 'done' ? 'Plan created' : 'Set up plan'}</button>
    {plan.error != null && <p className="pkc-error" role="alert">{errorMessage(plan.error)}</p>}
    {plan.plan && <p className="pkc-muted" role="status">Plan {plan.plan.status}. You can cancel future payments from your account.</p>}
  </section>;
}
