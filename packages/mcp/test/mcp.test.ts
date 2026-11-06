/**
 * The PayKit MCP server, tested two ways:
 *  1. in-process against the in-memory API (protocol + every tool, including spend guards),
 *  2. end to end: the real stdio binary talking to a real HTTP PayKit API.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { getAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { resolveNetwork } from '@paykit/core';
import { createPayKitClient } from '@paykit/js';
import { createMockApi, MOCK_TEST_KEYS } from '@paykit/testing';
import { createPayKitApi, createSimulatedChain, emptyDb, seedDemo } from '@paykit/server';
import { listen } from '@paykit/server/node';
import { createPayKitMcpServer } from '../src/index.ts';

type Server = Awaited<ReturnType<typeof createPayKitMcpServer>>;
let nextId = 1;
async function call(server: Server, name: string, args: Record<string, unknown> = {}) {
  const res = await server.handle({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } });
  const result = res!.result as { content: Array<{ text: string }>; isError?: boolean; structuredContent?: Record<string, unknown> };
  return { error: result.isError ? result.content[0]!.text : null, data: (result.structuredContent ?? {}) as Record<string, any> };
}

async function mockServer(options: { agentKey?: `0x${string}`; maxSpendUsdt?: string } = {}) {
  const mock = createMockApi({ latencyMs: 0, stepMs: 5 });
  const client = createPayKitClient({ baseUrl: mock.baseUrl, fetch: mock.fetch, siwe: mock.siwe });
  return createPayKitMcpServer({ apiUrl: mock.baseUrl, client, ...options });
}

describe('MCP protocol', () => {
  it('negotiates the protocol version, lists tools with schemas and answers ping', async () => {
    const server = await mockServer();
    const init = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    const r = init!.result as { protocolVersion: string; capabilities: { tools: unknown }; serverInfo: { name: string }; instructions: string };
    assert.equal(r.protocolVersion, '2025-06-18');
    assert.ok(r.capabilities.tools);
    assert.equal(r.serverInfo.name, 'paykit');
    assert.match(r.instructions, /maxAmount/);
    assert.equal(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
    const old = await server.handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    assert.equal((old!.result as { protocolVersion: string }).protocolVersion, '2025-06-18');
    const list = await server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const tools = (list!.result as { tools: Array<{ name: string; inputSchema: { type: string }; annotations?: { readOnlyHint?: boolean } }> }).tools;
    assert.deepEqual(tools.map((t) => t.name), ['paykit_status', 'list_shops', 'list_products', 'loyalty_program', 'points_balance', 'create_checkout', 'apply_reward', 'pay_checkout', 'get_payment']);
    assert.ok(tools.every((t) => t.inputSchema.type === 'object'));
    assert.equal(tools.find((t) => t.name === 'pay_checkout')!.annotations?.readOnlyHint, false);
    assert.deepEqual(await server.handle({ jsonrpc: '2.0', id: 4, method: 'ping' }), { jsonrpc: '2.0', id: 4, result: {} });
    assert.equal((await server.handle({ jsonrpc: '2.0', id: 5, method: 'nope' }))!.error!.code, -32601);
    assert.equal((await server.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope' } }))!.error!.code, -32602);
    assert.match((await call(server, 'list_products')).error!, /Missing argument\(s\): merchant/);
  });
});

describe('MCP shopping agent', () => {
  it('browses, checks out, refuses unapproved amounts, pays, earns points and spends them', async () => {
    const server = await mockServer({ agentKey: MOCK_TEST_KEYS.customer });
    const status = await call(server, 'paykit_status');
    assert.equal(status.data.routerVersion, '2');
    assert.equal(status.data.loyaltyPoints, true);
    assert.equal(status.data.maxSpendPerPayment, '25 USDT');

    const shops = await call(server, 'list_shops');
    assert.ok(shops.data.shops.some((s: { slug: string }) => s.slug === 'chai-co'));
    const products = (await call(server, 'list_products', { merchant: 'chai-co' })).data.products;
    const chai = products.find((p: { name: string }) => p.name === 'Masala chai');
    const checkout = await call(server, 'create_checkout', { merchant: 'chai-co', items: [{ productId: chai.productId, quantity: 4 }] });
    assert.equal(checkout.data.amountDue, '10 USDT');
    assert.equal(checkout.data.pointsEarned, '100');

    const tooLow = await call(server, 'pay_checkout', { sessionId: checkout.data.sessionId, maxAmount: '9.99' });
    assert.match(tooLow.error!, /above the approved 9\.99 USDT\. Nothing was paid/);
    const paid = await call(server, 'pay_checkout', { sessionId: checkout.data.sessionId, maxAmount: '10' });
    assert.equal(paid.error, null);
    assert.ok(['included', 'safe', 'finalized'].includes(paid.data.status));
    assert.equal(paid.data.pointsEarned, '100');
    assert.equal((await call(server, 'get_payment', { paymentId: paid.data.paymentId })).data.paymentId, paid.data.paymentId);
    assert.equal((await call(server, 'points_balance')).data.points, '100');

    const program = (await call(server, 'loyalty_program', { merchant: 'chai-co' })).data;
    const reward = program.rewards.find((r: { name: string }) => r.name === 'Free masala chai');
    const vada = products.find((p: { name: string }) => p.name === 'Vada pav');
    const second = await call(server, 'create_checkout', { merchant: 'chai-co', items: [{ productId: vada.productId, quantity: 1 }] });
    const discounted = await call(server, 'apply_reward', { sessionId: second.data.sessionId, rewardId: reward.rewardId });
    assert.equal(discounted.data.amountDue, '0.5 USDT');
    assert.equal(discounted.data.reward.name, 'Free masala chai');
    const paid2 = await call(server, 'pay_checkout', { sessionId: second.data.sessionId, maxAmount: '0.50' });
    assert.equal(paid2.data.discount, '2.5 USDT');
    assert.equal(paid2.data.pointsRedeemed, '60');
    assert.equal((await call(server, 'points_balance')).data.points, String(100 - 60 + 5));
  });

  it('enforces the server spending cap even when the user approves more', async () => {
    const server = await mockServer({ agentKey: generatePrivateKey(), maxSpendUsdt: '5' });
    const products = (await call(server, 'list_products', { merchant: 'chai-co' })).data.products;
    const checkout = await call(server, 'create_checkout', { merchant: 'chai-co', items: [{ productId: products[0].productId, quantity: 4 }] });
    const res = await call(server, 'pay_checkout', { sessionId: checkout.data.sessionId, maxAmount: '100' });
    assert.match(res.error!, /cap of 5 USDT per payment\. Nothing was paid/);
  });

  it('is read-only without an agent key', async () => {
    const server = await mockServer();
    const products = (await call(server, 'list_products', { merchant: 'chai-co' })).data.products;
    const checkout = await call(server, 'create_checkout', { merchant: 'chai-co', items: [{ productId: products[0].productId, quantity: 1 }] });
    assert.match((await call(server, 'pay_checkout', { sessionId: checkout.data.sessionId, maxAmount: '5' })).error!, /No agent wallet/);
    assert.match((await call(server, 'points_balance')).error!, /Pass an address/);
  });
});

describe('MCP over stdio', () => {
  it('runs the real binary against a real HTTP API: initialize, list tools, check out and pay', { timeout: 60_000 }, async () => {
    const owner = privateKeyToAccount(MOCK_TEST_KEYS.merchant);
    const network = resolveNetwork('whitechain-testnet', { router: getAddress(`0x${'12'.repeat(20)}`), registry: getAddress(`0x${'34'.repeat(20)}`), points: getAddress(`0x${'56'.repeat(20)}`) });
    const db = emptyDb(); seedDemo(db, owner.address, network);
    const api = createPayKitApi({ network, chain: createSimulatedChain({ stepMs: 5 }), signer: owner, db, domainCheck: 'trust', finalityPollMs: 5, deliverWebhooks: false });
    const http = listen(api, 0);
    await once(http, 'listening');
    const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const main = fileURLToPath(new URL('../src/main.ts', import.meta.url));
    const child = spawn(process.execPath, ['--conditions=source', main], { env: { ...process.env, PAYKIT_API_URL: url, PAYKIT_AGENT_KEY: MOCK_TEST_KEYS.customer, PAYKIT_MAX_SPEND_USDT: '20' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    const pending = new Map<number, (v: any) => void>();
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        const msg = JSON.parse(line);
        pending.get(msg.id)?.(msg); pending.delete(msg.id);
      }
    });
    let id = 100;
    const rpc = (method: string, params?: unknown) => new Promise<any>((resolve) => { const n = ++id; pending.set(n, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`); });
    const tool = async (name: string, args: Record<string, unknown> = {}) => (await rpc('tools/call', { name, arguments: args })).result;
    try {
      const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
      assert.equal(init.result.serverInfo.name, 'paykit');
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      assert.equal((await rpc('tools/list')).result.tools.length, 9);
      const products = (await tool('list_products', { merchant: 'chai-co' })).structuredContent.products;
      const checkout = (await tool('create_checkout', { merchant: 'chai-co', items: [{ productId: products[0].productId, quantity: 2 }] })).structuredContent;
      assert.equal(checkout.amountDue, '5 USDT');
      const paid = await tool('pay_checkout', { sessionId: checkout.sessionId, maxAmount: '5' });
      assert.equal(paid.isError, undefined, paid.content?.[0]?.text);
      assert.equal(paid.structuredContent.paid, '5 USDT');
      assert.equal((await tool('points_balance')).structuredContent.points, '50');
      assert.match(stderr, /ready: 9 tools, agent wallet set/);
    } finally {
      child.kill();
      http.close();
    }
  });
});
