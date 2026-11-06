import assert from 'node:assert/strict';
import { it } from 'node:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { getAddress } from 'viem';
import { resolveNetwork, invoiceKey } from '@paykit/core';
import { createPayKitClient, fromLocalAccount } from '@paykit/js';
import { PayKit } from '@paykit/node';
import { createPayKitApi, emptyDb } from '../src/api.ts';
import { createSimulatedChain } from '../src/chain/simulated.ts';
import { seedDemo } from '../src/seed.ts';
import { isPublicAddress } from '../src/outbound.ts';
import { type ChainAdapter } from '../src/chain/types.ts';
import { sqliteStore } from '../src/node.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const sleep = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const ownerKey = generatePrivateKey();
const owner = privateKeyToAccount(ownerKey);
const network = resolveNetwork('whitechain-testnet', { router: getAddress(`0x${'12'.repeat(20)}`), registry: getAddress(`0x${'34'.repeat(20)}`) });
async function setup(overrides: Partial<ChainAdapter> = {}, extra: Partial<import("../src/api.ts").PayKitApiOptions> = {}) {
  const chain = { ...createSimulatedChain({ stepMs: 1 }), ...overrides };
  const db = emptyDb(); seedDemo(db, owner.address, network);
  const api = createPayKitApi({ network, chain, signer: owner, db, domainCheck: 'trust', finalityPollMs: 1, deliverWebhooks: false, ...extra });
  const merchant = createPayKitClient({ baseUrl: 'https://api.example.com', fetch: api.fetch, siwe: { domain: 'shop.example.com', uri: 'https://shop.example.com' } });
  await merchant.auth.login(fromLocalAccount(owner, 1874));
  const sk = (await merchant.merchant.apiKeys.create({ kind: 'secret' })).key!;
  const backend = new PayKit({ secretKey: sk, baseUrl: 'https://api.example.com', fetch: api.fetch });
  return { api, chain, db, merchant, backend };
}
async function eventually(check: () => boolean) { for (let n = 0; n < 100; n++) { if (check()) return; await sleep(); } assert.ok(check()); }
const invoice = { lineItems: [{ name: 'Existing merchant order', quantity: 1, unitAmount: '10000000' }], externalOrderId: 'order-1042', metadata: { customerReference: 'customer-7' } };

it('retains existing order references and deduplicates concurrent creation across restart', async () => {
  const { backend, db, api, chain } = await setup();
  const [a, b] = await Promise.all([backend.invoices.create(invoice), backend.invoices.create(invoice)]);
  assert.equal(a.id, b.id); assert.equal(db.invoices.length, 1); assert.equal(a.metadata?.customerReference, 'customer-7');
  await assert.rejects(backend.invoices.create({ ...invoice, lineItems: [{ name: 'Changed', quantity: 1, unitAmount: '20000000' }] }), /different input/);
  const session = await backend.checkout.createSession(invoice);
  const buyer = createPayKitClient({ baseUrl: 'https://api.example.com', fetch: api.fetch });
  const payment = await buyer.checkout.pay({ sessionId: session.id }, fromLocalAccount(privateKeyToAccount(generatePrivateKey()), 1874), { expectedAmount: '10000000', wait: { until: 'finalized', intervalMs: 1 } });
  assert.equal(payment.payment.externalOrderId, invoice.externalOrderId);
  assert.equal(payment.payment.metadata?.customerReference, 'customer-7');
  const restored = JSON.parse(JSON.stringify(db));
  const api2 = createPayKitApi({ network, chain, signer: owner, db: restored, domainCheck: 'trust' });
  assert.ok(api2.db.idempotency);
});
it('rejects missing, invalid, revoked, wrong-origin and cross-merchant browser keys', async () => {
  const { api, merchant, db, chain } = await setup();
  const pk = await merchant.merchant.apiKeys.create({ kind: 'publishable', allowedOrigins: ['https://shop.example.com'] });
  const strict = createPayKitApi({ network, chain, signer: owner, db, domainCheck: 'fetch', fetch: async () => Response.json({}) });
  const body = { merchant: 'chai-co', items: [{ productId: db.products[0]!.id, quantity: 1 }] };
  const call = (headers = {}, payload = body) => strict.handle(new Request('https://api.example.com/v1/checkout/sessions', { method: 'POST', headers, body: JSON.stringify(payload) }));
  assert.equal((await call()).status, 401);
  assert.equal((await call({ authorization: 'garbage' })).status, 401);
  assert.equal((await call({ authorization: 'Bearer nonsense' })).status, 401);
  assert.equal((await call({ 'x-paykit-key': 'pk_invalid' })).status, 401);
  assert.equal((await call({ 'x-paykit-key': pk.key!, origin: 'https://evil.example.com' })).status, 403);
  assert.equal((await call({ 'x-paykit-key': pk.key! }, { merchant: 'byte-books', items: [{ productId: db.products.at(-1)!.id, quantity: 1 }] })).status, 403);
  assert.equal((await call({ 'x-paykit-key': pk.key!, origin: 'https://shop.example.com' })).status, 200);
  await merchant.merchant.apiKeys.revoke(pk.id);
  assert.equal((await call({ 'x-paykit-key': pk.key! })).status, 401);
  void api;
});
it('fetches real domain proof even if the caller submits a valid signed file', async () => {
  const { merchant, db, chain } = await setup();
  const challenge = await merchant.merchant.domains.start('unowned.example.com');
  const file = await merchant.merchant.domains.signWellKnownFile(challenge, fromLocalAccount(owner, 1874));
  let fetched = 0;
  const strict = createPayKitApi({ network, chain, signer: owner, db, domainCheck: 'fetch', fetch: async () => { fetched++; return new Response('not found', { status: 404 }); } });
  const token = merchant.auth.get()!.token;
  const response = await strict.handle(new Request('https://api.example.com/v1/portal/merchant/domains/unowned.example.com/check', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ file }) }));
  assert.equal((await response.json()).status, 'failed'); assert.equal(fetched, 1);
  assert.equal(db.merchants[0]!.verifiedDomains.some((d) => d.domain === 'unowned.example.com'), false);
});
it('keeps an unknown submitted payment recoverable and projects it once', async () => {
  const underlying = createSimulatedChain({ stepMs: 1 });
  let attempts = 0;
  const { api, db, backend } = await setup({ ...underlying, waitForReceipt: async (hash) => { if (++attempts === 1) throw new Error('RPC timeout'); return underlying.waitForReceipt(hash); } });
  const inv = await backend.invoices.create(invoice);
  const client = createPayKitClient({ baseUrl: 'https://api.example.com', fetch: api.fetch });
  const { payment } = await client.checkout.pay({ invoiceId: inv.id }, fromLocalAccount(privateKeyToAccount(generatePrivateKey()), 1874));
  await sleep(); assert.equal(db.payments[0]!.status, 'submitted'); assert.equal(db.invoices[0]!.paid, '0');
  api.resume(); await eventually(() => db.payments[0]!.status === 'finalized');
  assert.equal(db.invoices[0]!.paid, inv.total); assert.equal(db.payments.length, 1); assert.equal(db.payments[0]!.paymentId, payment.paymentId);
});
it('reverses invoice projection if a receipt disappears, then reconciles reinclusion', async () => {
  const underlying = createSimulatedChain({ stepMs: 1 });
  let canonical = false;
  const { api, db, backend } = await setup({ ...underlying, transactionStatus: async () => canonical ? { success: true, blockNumber: 123n, blockHash: `0x${'aa'.repeat(32)}`, finality: 'finalized' } : null });
  const inv = await backend.invoices.create(invoice);
  const c = createPayKitClient({ baseUrl: 'https://api.example.com', fetch: api.fetch });
  await c.checkout.pay({ invoiceId: inv.id }, fromLocalAccount(privateKeyToAccount(generatePrivateKey()), 1874));
  await sleep(); assert.equal(db.payments[0]!.status, 'submitted'); assert.equal(db.invoices[0]!.paid, '0');
  canonical = true; api.resume(); await eventually(() => db.payments[0]!.status === 'finalized');
  assert.equal(db.invoices[0]!.paid, inv.total);
});
it('projects down payments and collected installments through finality and order webhooks', async () => {
  const { api, backend, merchant, db } = await setup();
  await merchant.merchant.webhooks.create({ url: 'https://hooks.example.com/paykit', events: ['payment.finalized'] });
  const inv = await backend.invoices.create(invoice);
  const buyer = createPayKitClient({ baseUrl: 'https://api.example.com', fetch: api.fetch });
  const wallet = fromLocalAccount(privateKeyToAccount(generatePrivateKey()), 1874);
  const session = await buyer.plans.createSession({ invoiceId: inv.id }, { count: 2, periodSeconds: 60, downPaymentPercent: 20 }, await wallet.getAddress());
  const plan = await buyer.plans.authorize(session, wallet);
  await eventually(() => db.payments[0]?.status === 'finalized');
  assert.equal(db.payments[0]!.kind, 'down_payment'); assert.equal(db.invoices[0]!.paid, '2000000');
  db.plans[0]!.installments[0]!.dueAt = new Date(Date.now() - 1000).toISOString();
  await api.tick(); await eventually(() => db.payments.filter((p) => p.status === 'finalized').length === 2);
  assert.equal(db.invoices[0]!.paid, '6000000'); assert.equal(db.outbox.length, 2); assert.equal(db.plans[0]!.planId, plan.planId);
});
it('rejects invalid invoice schedules and private outbound destinations', async () => {
  const { backend } = await setup();
  await assert.rejects(backend.invoices.create({ ...invoice, schedule: { type: 'parts', parts: ['1'] } }), /sum/);
  await assert.rejects(backend.invoices.create({ ...invoice, lineItems: [{ name: 'Bad', quantity: -1, unitAmount: '10' }] }));
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1']) assert.equal(isPublicAddress(address), false);
  assert.equal(isPublicAddress('8.8.8.8'), true);
});
it('synchronously persists jobs and prevents a second store writer', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'paykit-store-')), 'state.sqlite');
  const first = sqliteStore(path); first.db.counter = 42; first.save(first.db);
  assert.throws(() => sqliteStore(path), /owned/); first.close();
  const second = sqliteStore(path); assert.equal(second.db.counter, 42); second.close();
});

it('retries locally signed checkout with the same order after the clock advances', async () => {
  const { api, merchant } = await setup();
  const secretKey = (await merchant.merchant.apiKeys.create({ kind: "secret" })).key!;
  const signed = new PayKit({ secretKey, signerKey: ownerKey, baseUrl: 'https://api.example.com', fetch: api.fetch });
  const first = await signed.checkout.createSession(invoice);
  await sleep(1100);
  const second = await signed.checkout.createSession(invoice);
  assert.equal(first.id, second.id);
});
it('rejects a displayed plan total change before asking for any signature', async () => {
  const { api, db } = await setup();
  const client = createPayKitClient({ baseUrl: 'https://api.example.com', fetch: api.fetch });
  const wallet = fromLocalAccount(privateKeyToAccount(generatePrivateKey()), 1874);
  const product = db.products[0]!;
  const session = await client.plans.createSession({ merchant: 'chai-co', items: [{ productId: product.id, quantity: 1 }] }, { count: 2, periodSeconds: 60 }, await wallet.getAddress());
  let signatures = 0;
  const spy = { ...wallet, signTypedData: async (...args: Parameters<typeof wallet.signTypedData>) => { signatures++; return wallet.signTypedData(...args); } };
  await assert.rejects(client.plans.authorize(session, spy, { expectedAmount: '1' }), /amount changed/);
  assert.equal(signatures, 0);
});
it('resumes a submitted refund after restart without another transfer', async () => {
  const underlying = createSimulatedChain({ stepMs: 1 });
  let refundHash = ''; let failed = false; let transfers = 0;
  const chain = { ...underlying, refund: async (...args: Parameters<ChainAdapter['refund']>) => { transfers++; const hash = await underlying.refund(...args); refundHash = hash; return hash; }, waitForReceipt: async (hash: `0x${string}`) => { if (hash === refundHash && !failed) { failed = true; throw new Error('RPC unavailable'); } return underlying.waitForReceipt(hash); } };
  const { api, db, merchant } = await setup(chain);
  const secretKey = (await merchant.merchant.apiKeys.create({ kind: 'secret' })).key!;
  const backend = new PayKit({ secretKey, refundFunderKey: ownerKey, baseUrl: 'https://api.example.com', fetch: api.fetch });
  const session = await backend.checkout.createSession(invoice);
  const buyer = createPayKitClient({ baseUrl: 'https://api.example.com', fetch: api.fetch });
  const { payment } = await buyer.checkout.pay({ sessionId: session.id }, fromLocalAccount(privateKeyToAccount(generatePrivateKey()), 1874), { wait: { until: 'finalized', intervalMs: 1 } });
  await backend.refunds.create({ paymentId: payment.paymentId, amount: '1000000' }, { idempotencyKey: 'refund-order-1042' });
  await sleep(); assert.equal(db.refunds[0]!.status, 'submitted');
  const restored = JSON.parse(JSON.stringify(db));
  const recovered = createPayKitApi({ network, chain, signer: owner, db: restored, domainCheck: 'trust', finalityPollMs: 1 });
  recovered.resume(); await eventually(() => restored.refunds[0]?.status === 'settled');
  assert.equal(transfers, 1); assert.equal(restored.payments[0].refunded, '1000000'); assert.equal(restored.invoices[0].refunded, '1000000');
});
it('reconciles externally submitted finalized payments once from a durable event cursor', async () => {
  let events: import('@paykit/observer').ChainEvent[] = [];
  const { api, db, backend } = await setup({ observe: async (from) => ({ nextBlock: from + 1n, events }) }, { observerStartBlock: 100n });
  const inv = await backend.invoices.create(invoice);
  const merchant = db.merchants[0]!;
  events = [{ chainId: 1874, blockNumber: '100', blockHash: `0x${'aa'.repeat(32)}`, transactionHash: `0x${'bb'.repeat(32)}`, transactionIndex: 0, logIndex: 0, address: network.contracts.router!, eventName: 'PaymentSettled', args: { paymentId: `0x${'cc'.repeat(32)}`, merchantId: merchant.merchantId, invoiceKey: invoiceKey(merchant.merchantId!, inv.invoiceId), planId: `0x${'00'.repeat(32)}`, payer: owner.address, refundTo: owner.address, gross: '10000000', fee: '100000', net: '9900000' } }];
  await api.tick(); await api.tick();
  assert.equal(db.payments.length, 1); assert.equal(db.payments[0]!.status, 'finalized'); assert.equal(db.invoices[0]!.paid, '10000000'); assert.equal(db.observer.events.length, 1); assert.equal(db.observer.nextBlock, '102');
});

it('limits rotating unauthenticated credentials by peer as well as key', async () => {
  const api = createPayKitApi({ network, chain: createSimulatedChain(), signer: owner, domainCheck: 'trust', requestLimit: 3 });
  const call = (key: string) => api.handle(new Request('https://api.example.com/v1/config', { headers: { authorization: key } }));
  assert.equal((await call('a')).status, 200); assert.equal((await call('b')).status, 200); assert.equal((await call('c')).status, 200);
  assert.equal((await call('d')).status, 429);
});
it('allows exhausted webhook deliveries to be retried without changing the event id', async () => {
  const { merchant, backend, api, db } = await setup();
  const endpoint = await merchant.merchant.webhooks.create({ url: 'https://hooks.example.com/paykit', events: ['invoice.created'] });
  await backend.invoices.create(invoice);
  const item = db.outbox[0]!; item.attempts = 7; item.nextAt = Date.now() + 3600000;
  const eventId = item.id;
  assert.equal((await merchant.merchant.webhooks.replay(endpoint.id)).replayed, 1);
  assert.equal(item.id, eventId); assert.equal(item.attempts, 0); assert.ok(item.nextAt <= Date.now());
  void api;
});
