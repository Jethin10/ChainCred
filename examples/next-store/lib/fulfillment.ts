import { DatabaseSync } from 'node:sqlite';
import type { WebhookEvent } from '@paykit/core';
// Demonstration of durable event deduplication. Use your existing order transaction in production.
export function recordFinalizedPayment(event: WebhookEvent<'payment.finalized'>) {
  if (event.data.externalOrderId !== 'next-demo-order-1042' || event.data.gross !== '10000000' || event.data.status !== 'finalized' || event.merchantSlug !== process.env.PAYKIT_MERCHANT) throw new Error('Unexpected order, merchant or amount');
  const db = new DatabaseSync(process.env.ORDERS_DB ?? './orders.sqlite');
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS fulfilled (order_id TEXT PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, payment_id TEXT NOT NULL UNIQUE)');
    db.prepare('INSERT OR IGNORE INTO fulfilled(order_id,event_id,payment_id) VALUES(?,?,?)').run(event.data.externalOrderId, event.id, event.data.paymentId);
  } finally { db.close(); }
}
