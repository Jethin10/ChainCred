"use client";
import { useCheckout, errorMessage } from '@paykit/react';
import { formatUsdt } from '@paykit/js';
import './paykit-ui.css';

type CheckoutProps = {
  sessionId: string; amount: string; label?: string; className?: string; onPaid?: (paymentId: string) => void;
};

export function CustomCheckout(props: CheckoutProps) {
  return <SessionCheckout key={props.sessionId} {...props} />;
}

function SessionCheckout({ sessionId, amount, label = 'Pay with USDT', className = '', onPaid }: CheckoutProps) {
  const checkout = useCheckout();
  return <section className={`pkc-card ${className}`} aria-label="Checkout">
    <div className="pkc-row"><span>Order total</span><strong>{formatUsdt(amount)} USDT</strong></div>
    <p className="pkc-muted">One signature. Gas is paid by the payment service.</p>
    <button className="pkc-button" disabled={checkout.busy || checkout.phase === 'done'} onClick={() => {
      checkout.pay({ sessionId }, { expectedAmount: amount }).then((payment) => onPaid?.(payment.paymentId)).catch(() => {});
    }}>{checkout.busy ? 'Processing payment…' : checkout.phase === 'done' ? 'Payment received' : label}</button>
    {checkout.error != null && <p className="pkc-error" role="alert">{errorMessage(checkout.error)}</p>}
    {checkout.payment && <p className="pkc-muted" aria-live="polite">Payment {checkout.payment.status}. Your receipt will update as it settles.</p>}
  </section>;
}
