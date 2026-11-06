import { paykit } from '../../../lib/paykit';
export const runtime = 'nodejs';
export async function POST() {
  try {
    // Replace this fixed demo order with your existing authenticated order lookup.
    const session = await paykit().checkout.createSession({ externalOrderId: 'next-demo-order-1042', lineItems: [{ name: 'Demo order', quantity: 1, unitAmount: '10000000' }] });
    return Response.json({ id: session.id, invoiceId: session.invoice.id });
  } catch { return Response.json({ error: 'Configure the PayKit service and merchant keys before checkout.' }, { status: 503 }); }
}
