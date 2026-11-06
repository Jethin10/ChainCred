/** Node-only outbound HTTP. Resolve once, reject non-public addresses, pin the connection. */
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { publicUrl } from './validation.ts';

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 2)) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
  }
  // Public global unicast only. IPv4 mapped, local, multicast and documentation ranges fail closed.
  return isIP(address) === 6 && /^[23]/i.test(address) && !/^2001:(db8|0*:|10:|20:)/i.test(address);
}
export const safeFetch: typeof fetch = async (input, init = {}) => {
  const url = publicUrl(String(input));
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
  signal.throwIfAborted();
  const addresses = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    lookup(url.hostname, { all: true }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) throw new Error('Outbound destination resolves to a non-public address');
  const target = addresses[0]!;
  return new Promise<Response>((resolve, reject) => {
    const req = request(url, { method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers)), agent: false, family: target.family, lookup: (_host, _options, cb) => cb(null, target.address, target.family), signal }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1_048_576) { req.destroy(new Error('Outbound response exceeds 1 MiB')); return; }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) { reject(new Error('Outbound redirects are not allowed')); return; }
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        const status = res.statusCode ?? 502;
        resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers }));
      });
    });
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
};
