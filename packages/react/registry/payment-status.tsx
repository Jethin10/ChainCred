"use client";
import { usePayment, errorMessage } from '@paykit/react';
export function CustomPaymentStatus({ paymentId, className }: { paymentId: string; className?: string }) {
  const { data, loading, error, refetch } = usePayment(paymentId);
  return <div className={className} aria-live="polite">
    {error != null ? <><p role="alert">{errorMessage(error)}</p><button onClick={refetch}>Try again</button></>
      : !data ? <p>{loading ? 'Checking payment…' : 'Payment unavailable'}</p>
      : <><p>Payment {data.status}</p>{data.explorerUrl && <a href={data.explorerUrl} target="_blank" rel="noreferrer">View transaction</a>}</>}
  </div>;
}
