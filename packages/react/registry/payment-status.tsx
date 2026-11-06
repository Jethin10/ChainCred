"use client";
import { useEffect, useState, type CSSProperties } from 'react';
import { usePayment, errorMessage } from '@paykit/react';
import './paykit-ui.css';

const STATIONS = [
  { status: 'submitted', label: 'Sent', note: 'The relayer sent your signed payment.' },
  { status: 'included', label: 'In block', note: 'Your payment is in a block. The shop can see it.' },
  { status: 'safe', label: 'Safe', note: 'The network reports this block as safe.' },
  { status: 'finalized', label: 'Final', note: 'Finalized. This payment is permanent.' },
] as const;

export function CustomPaymentStatus({ paymentId, className = '' }: { paymentId: string; className?: string }) {
  const { data, loading, error, refetch } = usePayment(paymentId);
  const elapsed = useElapsed(data?.createdAt, data?.status === 'finalized' || data?.status === 'failed' || data?.status === 'expired');
  if (error != null) return <section className={`pkc-card ${className}`} aria-label="Payment progress">
    <p className="pkc-error" role="alert">{errorMessage(error)}</p><button className="pkc-button" onClick={refetch}>Try again</button>
  </section>;
  if (!data) return <section className={`pkc-card ${className}`} aria-label="Payment progress" aria-busy="true">
    <p className="pkc-muted" role="status">{loading ? 'Looking up payment…' : 'Payment unavailable'}</p><div className="pkc-skeleton" /><div className="pkc-skeleton" style={{ width: '60%' }} />
  </section>;

  const failed = data.status === 'failed' || data.status === 'expired';
  const index = STATIONS.findIndex((s) => s.status === data.status);
  const at = Math.max(0, index) / (STATIONS.length - 1);
  const current = STATIONS[index];
  return <section className={`pkc-card ${className}`} aria-label="Payment progress" aria-live="polite">
    <div className="pkc-row"><h3 className="pkc-title">Payment progress</h3><span className="pkc-tag" data-live={!failed && data.status !== 'finalized'}>{data.status.replace('_', ' ')}</span></div>
    <div className="pkc-track" data-failed={failed} style={{ '--at': at } as CSSProperties} role="img" aria-label={`Step ${Math.max(1, index + 1)} of ${STATIONS.length}: ${data.status}`}>
      <span className="pkc-track__rail"><span className="pkc-track__fill" /></span>
      <span className={data.status === 'finalized' ? 'pkc-track__runner pkc-track__runner--done' : 'pkc-track__runner'} />
      {STATIONS.map((s, i) => <span key={s.status} className="pkc-station" data-state={i < index || data.status === 'finalized' ? 'done' : i === index ? 'active' : 'todo'}>{s.label}</span>)}
    </div>
    <p className="pkc-note">
      <b>{failed ? (data.error?.message ?? `Payment ${data.status}.`) : current ? current.note : 'Waiting to be sent.'}</b>
      {elapsed != null && <time>{elapsed}</time>}
    </p>
    <p className="pkc-muted">Safe and final are what the network RPC reports. Fulfill orders from verified webhooks.</p>
    {data.explorerUrl && <a className="pkc-link" href={data.explorerUrl} target="_blank" rel="noreferrer">View transaction</a>}
  </section>;
}

function useElapsed(since: string | undefined, stopped: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (stopped) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [stopped]);
  if (!since) return null;
  const seconds = Math.max(0, Math.round((now - Date.parse(since)) / 1000));
  return seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}
