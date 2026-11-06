import { createWebhookHandler } from '@paykit/next';
import { recordFinalizedPayment } from '../../../../lib/fulfillment';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return createWebhookHandler({ secret: process.env.PAYKIT_WEBHOOK_SECRET!, on: { 'payment.finalized': recordFinalizedPayment } })(request);
}
