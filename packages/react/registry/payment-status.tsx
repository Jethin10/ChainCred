"use client";
import { usePayment, errorMessage } from '@paykit/react';
import './paykit-ui.css';

export function CustomPaymentStatus({ paymentId, className = '' }: { paymentId: string; className?: string }) {
  const { data, loading, error, refetch } = usePayment(paymentId);
  return <section className={`pkc-card ${className}`} aria-label="Payment progress" aria-live="polite">
    {error != null ? <><p className="pkc-error" role="alert">{errorMessage(error)}</p><button className="pkc-button" onClick={refetch}>Try again</button></>
      : !data ? <p>{loading ? 'Checking payment…' : 'Payment unavailable'}</p>
      : <><div className="pkc-row"><strong>Payment progress</strong><span className="pkc-tag">{data.status}</span></div>
        <p className="pkc-muted">Safe and finalized states are observations reported by the network RPC.</p>
        <ol className="pkc-steps">{(['submitted', 'included', 'safe', 'finalized'] as const).map((status, index, statuses) => <li key={status} data-complete={statuses.indexOf(data.status as typeof status) >= index}>{status}</li>)}</ol>
        {data.explorerUrl && <a className="pkc-link" href={data.explorerUrl} target="_blank" rel="noreferrer">View transaction</a>}</>}
  </section>;
}
