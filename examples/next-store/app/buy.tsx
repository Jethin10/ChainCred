"use client";
import { CheckoutButton, PaymentStatus } from '@paykit/react';
import { useState } from 'react';
export default function Buy() {
  const [session, setSession] = useState<string | null>(null);
  const [payment, setPayment] = useState<string | null>(null);
  const [error, setError] = useState('');
  if (payment) return <PaymentStatus paymentId={payment} />;
  if (session) return <CheckoutButton input={{ sessionId: session }} amount="10000000" onSuccess={(p) => setPayment(p.paymentId)} />;
  return <><button onClick={async () => {
    try { const res = await fetch('/api/checkout', { method: 'POST' }); const data = await res.json(); if (!res.ok) throw new Error(data.error ?? 'Checkout unavailable'); setSession(data.id); }
    catch (e) { setError(e instanceof Error ? e.message : 'Checkout unavailable'); }
  }}>Checkout</button>{error && <p role="alert">{error}</p>}</>;
}
