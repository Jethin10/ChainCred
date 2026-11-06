/** Public-entry smoke: start the normal demo service, integrate an existing order, fulfill, refund, restart. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { createPayKitClient, fromLocalAccount } from '@paykit/js';
import { PayKit, verifyWebhook } from '@paykit/node';
import { MOCK_TEST_KEYS } from '@paykit/testing';
import { privateKeyToAccount } from 'viem/accounts';
const port = 8799;
const baseUrl = `http://127.0.0.1:${port}`;
const file = resolve('.local', `sdk-smoke-${crypto.randomUUID()}.sqlite`);
const orderId = `qa-${crypto.randomUUID()}`;
const events = new Map();
let webhookSecret = '';
let child;
const hook = createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  try { const event = verifyWebhook(body, request.headers['paykit-signature'], webhookSecret); events.set(event.id, event); response.writeHead(200).end('ok'); }
  catch { response.writeHead(400).end('invalid'); }
});
async function start() {
  child = spawn(process.execPath, ['--conditions=source', 'src/main.ts', '--demo'], { cwd: resolve('packages/server'), env: { ...process.env, DEMO: '1', PORT: String(port), HOST: '127.0.0.1', DATA_FILE: file, TICK_MS: '50' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Demo API did not start')), 15000);
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Demo API exited before startup')); });
    child.stdout.on('data', (data) => { if (String(data).includes('API on')) { clearTimeout(timer); resolveReady(); } });
    child.stderr.on('data', () => {});
  });
  await until(async () => { try { return (await fetch(`${baseUrl}/v1/config`)).ok; } catch { return false; } });
}
async function stop() { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } }
async function until(check) { const deadline = Date.now() + 15000; while (Date.now() < deadline) { if (await check()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error('Smoke outcome timed out'); }
try {
  hook.listen(0, '127.0.0.1'); await once(hook, 'listening');
  await start();
  const merchant = createPayKitClient({ baseUrl, siwe: { domain: 'localhost:5174', uri: 'http://localhost:5174' } });
  await merchant.auth.login(fromLocalAccount(privateKeyToAccount(MOCK_TEST_KEYS.merchant), 1874));
  const secretKey = (await merchant.merchant.apiKeys.create({ kind: 'secret' })).key;
  const publishableKey = (await merchant.merchant.apiKeys.create({ kind: 'publishable' })).key;
  const endpoint = await merchant.merchant.webhooks.create({ url: `http://127.0.0.1:${hook.address().port}/webhook`, events: ['payment.finalized', 'refund.succeeded'] });
  webhookSecret = endpoint.secret;
  const backend = new PayKit({ baseUrl, secretKey, refundFunderKey: MOCK_TEST_KEYS.merchant });
  const input = { externalOrderId: orderId, metadata: { source: 'independent-smoke' }, lineItems: [{ name: 'Existing order', quantity: 1, unitAmount: '10000000' }] };
  const session = await backend.checkout.createSession(input);
  assert.equal((await backend.checkout.createSession(input)).id, session.id);
  const customer = createPayKitClient({ baseUrl, publishableKey });
  const { payment } = await customer.checkout.pay({ sessionId: session.id }, fromLocalAccount(privateKeyToAccount(MOCK_TEST_KEYS.customer), 1874), { expectedAmount: '10000000', wait: { until: 'finalized', intervalMs: 100 } });
  assert.equal(payment.externalOrderId, orderId);
  await until(() => [...events.values()].some((e) => e.type === 'payment.finalized' && e.data.externalOrderId === orderId));
  const refund = await backend.refunds.create({ paymentId: payment.paymentId, amount: '1000000' }, { idempotencyKey: `${orderId}:refund` });
  await until(async () => (await backend.refunds.get(refund.refund.id)).status === 'settled');
  await until(() => [...events.values()].some((e) => e.type === 'refund.succeeded'));
  await stop(); await start();
  const recovered = await backend.payments.get(payment.paymentId);
  assert.equal(recovered.status, 'finalized'); assert.equal(recovered.refunded, '1000000');
  assert.equal((await backend.invoices.get(session.invoice.id)).externalOrderId, orderId);
  console.log('PASS: normal demo service, existing-order session, retry, signature, verified fulfillment webhook, refund, durable restart.');
  console.log('All payment movements were simulated; no blockchain write was made.');
} finally { await stop(); hook.closeAllConnections(); await new Promise((r) => hook.close(r)); }
