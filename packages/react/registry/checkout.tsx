"use client";
import { useCheckout, errorMessage } from '@paykit/react';
export function CustomCheckout({ sessionId, amount, className, onPaid }: {
  sessionId: string; amount: string; className?: string; onPaid?: (paymentId: string) => void;
}) {
  const checkout = useCheckout();
  return <div className={className}>
    <button disabled={checkout.busy} onClick={() => {
      checkout.pay({ sessionId }, { expectedAmount: amount }).then((payment) => onPaid?.(payment.paymentId)).catch(() => {});
    }}>{checkout.busy ? 'Processing payment…' : 'Pay with USDT'}</button>
    {checkout.error != null && <p role="alert">{errorMessage(checkout.error)}</p>}
    {checkout.payment && <p aria-live="polite">{checkout.payment.status}</p>}
  </div>;
}
