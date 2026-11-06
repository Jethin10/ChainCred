import { PayKit } from '@paykit/node';
export function paykit() { return new PayKit({ secretKey: process.env.PAYKIT_SECRET_KEY!, baseUrl: process.env.NEXT_PUBLIC_PAYKIT_API_URL ?? 'http://localhost:8787' }); }
