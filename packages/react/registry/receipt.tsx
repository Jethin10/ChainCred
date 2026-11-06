"use client";
import { useState, type CSSProperties, type ReactNode } from 'react';
import { usePayment, errorMessage } from '@paykit/react';
import { formatUsdt } from '@paykit/js';
import './paykit-ui.css';

export function PaymentReceipt({ paymentId, className = '' }: { paymentId: string; className?: string }) {
  const { data: payment, error, loading, refetch } = usePayment(paymentId);
  const [copied, setCopied] = useState(false);
  if (error != null) return <div className={`pkc-card ${className}`} role="alert"><p className="pkc-error">{errorMessage(error)}</p><button className="pkc-button" onClick={refetch}>Try again</button></div>;
  if (!payment) return <div className={`pkc-card ${className}`} aria-busy="true"><p className="pkc-muted" role="status">{loading ? 'Printing receipt…' : 'Receipt unavailable'}</p><div className="pkc-skeleton" /><div className="pkc-skeleton" style={{ width: '70%' }} /></div>;
  if (!['included', 'safe', 'finalized'].includes(payment.status)) return <div className={`pkc-card ${className}`}><p className="pkc-muted" role="status">Payment {payment.status}. Your receipt prints once it is in a block.</p><div className="pkc-skeleton" /></div>;

  const order = payment.externalOrderId ?? payment.invoiceId ?? 'Onchain payment';
  const reference = payment.txHash ?? payment.paymentId;
  const rows: Array<[string, ReactNode]> = [
    ['Paid', <strong>{formatUsdt(payment.gross)} USDT</strong>],
    ...(BigInt(payment.refunded) > 0n ? [['Refunded', `${formatUsdt(payment.refunded)} USDT`] as [string, string]] : []),
    ['Order', <span title={order}>{order.length > 22 ? `${order.slice(0, 12)}…${order.slice(-6)}` : order}</span>],
    ['Date', new Date(payment.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })],
    ['Gas', 'Covered by PayKit'],
    ['Reference', <span className="pkc-mono">{reference.slice(0, 8)}…{reference.slice(-6)}<button type="button" className="pkc-copy" data-copied={copied} aria-label="Copy reference" onClick={() => { void navigator.clipboard?.writeText(reference).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }); }}>{copied ? '✓' : '⧉'}</button></span>],
  ];
  return <article className={`pkc-card pkc-receipt ${className}`} aria-label="Payment receipt">
    <span className="pkc-stamp" aria-hidden="true">PAID</span>
    <header className="pkc-receipt__head">
      <span className="pkc-eyebrow">Receipt · {payment.status}</span>
      <h3 className="pkc-title">{payment.merchantName}</h3>
    </header>
    <dl className="pkc-details">
      {rows.map(([label, value], i) => <div key={label} style={{ '--i': i } as CSSProperties}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    {payment.explorerUrl && <a className="pkc-link" href={payment.explorerUrl} target="_blank" rel="noreferrer">View transaction</a>}
  </article>;
}
