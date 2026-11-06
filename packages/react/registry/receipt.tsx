"use client";
import { usePayment, errorMessage } from '@paykit/react';
import { formatUsdt } from '@paykit/js';
import './paykit-ui.css';

export function PaymentReceipt({ paymentId, className = '' }: { paymentId: string; className?: string }) {
  const { data: payment, error, loading, refetch } = usePayment(paymentId);
  if (error != null) return <div role="alert"><p>{errorMessage(error)}</p><button onClick={refetch}>Try again</button></div>;
  if (!payment) return <p role="status">{loading ? 'Loading receipt…' : 'Receipt unavailable'}</p>;
  if (!['included', 'safe', 'finalized'].includes(payment.status)) return <p role="status">Payment {payment.status}. A receipt is available after inclusion.</p>;
  return <article className={`pkc-card ${className}`} aria-label="Payment receipt">
    <div className="pkc-row"><h3 className="pkc-title">Payment receipt</h3><span className="pkc-tag">{payment.status}</span></div>
    <p className="pkc-muted">{payment.merchantName}</p>
    <dl className="pkc-details">
      <div><dt>Paid</dt><dd>{formatUsdt(payment.gross)} USDT</dd></div>
      <div><dt>Refunded</dt><dd>{formatUsdt(payment.refunded)} USDT</dd></div>
      <div><dt>Order</dt><dd>{payment.externalOrderId ?? payment.invoiceId ?? 'Onchain payment'}</dd></div>
      <div><dt>Gas</dt><dd>Paid by PayKit</dd></div>
    </dl>
    {payment.explorerUrl && <a className="pkc-link" href={payment.explorerUrl} target="_blank" rel="noreferrer">View transaction</a>}
  </article>;
}
