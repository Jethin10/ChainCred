import { z } from 'zod';
import { zAddress, zAmount } from '@paykit/core';
const positive = zAmount.refine((v) => BigInt(v) > 0n, 'Amount must be positive');
export const invoiceInput = z.object({
  lineItems: z.array(z.object({ name: z.string().trim().min(1).max(200), quantity: z.number().int().positive().max(999999), unitAmount: positive, productId: z.string().optional() })).min(1).max(100),
  schedule: z.discriminatedUnion('type', [z.object({ type: z.literal('full') }), z.object({ type: z.literal('deposit'), depositPercent: z.number().int().min(1).max(99) }), z.object({ type: z.literal('parts'), parts: z.array(positive).min(1).max(100) })]).optional(),
  validUntil: z.string().transform((v) => {
    const duration = /^(\d+)([mhd])$/.exec(v);
    return duration ? new Date(Date.now() + Number(duration[1]) * ({ m: 60000, h: 3600000, d: 86400000 }[duration[2]!] ?? 0)).toISOString() : v;
  }).pipe(z.iso.datetime().refine((v) => Date.parse(v) > Date.now(), 'Expiry must be in the future')).optional(),
  customerWallet: zAddress.optional(),
  externalOrderId: z.string().trim().min(1).max(200).optional(),
  metadata: z.record(z.string().max(64), z.string().max(500)).refine((v) => Object.keys(v).length <= 20, 'At most 20 metadata fields').optional(),
  splitProfileId: z.number().int().nonnegative().optional(),
});
export const planOption = z.object({ count: z.number().int().min(1).max(120).default(3), periodSeconds: z.number().int().min(60).max(31536000).default(2592000), downPaymentPercent: z.number().int().min(0).max(99).default(0), graceSeconds: z.number().int().min(0).max(31536000).default(259200) });

/** Early syntax checks also run in the browser mock. Real outbound transport pins public DNS. */
export function publicUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) throw new Error('Use a public HTTPS URL on port 443');
  return url;
}
