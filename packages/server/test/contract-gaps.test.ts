/**
 * Contract features the API now drives end to end: executing a queued payout change once its delay
 * has passed, revoking a removed domain's attestation, merchant-side plan cancellation, and
 * recording delinquency onchain.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { getAddress, type Hex } from 'viem';
import { resolveNetwork } from '@paykit/core';
import { createPayKitClient, fromLocalAccount } from '@paykit/js';
import { createPayKitApi, emptyDb } from '../src/api.ts';
import { createSimulatedChain } from '../src/chain/simulated.ts';
import { PermanentChainError, type ChainAdapter } from '../src/chain/types.ts';
import { seedDemo } from '../src/seed.ts';

const owner = privateKeyToAccount(generatePrivateKey());
const network = resolveNetwork('whitechain-testnet', { router: getAddress(`0x${'12'.repeat(20)}`), registry: getAddress(`0x${'34'.repeat(20)}`) });
const siwe = { domain: 'shop.example.com', uri: 'https://shop.example.com' };
const sleep = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function eventually(check: () => boolean) { for (let n = 0; n < 200; n++) { if (check()) return; await sleep(); } assert.ok(check()); }

async function setup(overrides: Partial<ChainAdapter> = {}) {
  const calls: Array<{ fn: string; arg: unknown }> = [];
  const base = createSimulatedChain({ stepMs: 1 });
  const chain: ChainAdapter = {
    ...base,
    executePayoutChange: (id) => { calls.push({ fn: 'executePayoutChange', arg: id }); return base.executePayoutChange!(id); },
    markDelinquent: (id) => { calls.push({ fn: 'markDelinquent', arg: id }); return base.markDelinquent!(id); },
    revokeDomain: (args) => { calls.push({ fn: 'revokeDomain', arg: args }); return Promise.resolve(`0x${'ab'.repeat(32)}` as Hex); },
    ...overrides,
  };
  const db = emptyDb(); seedDemo(db, owner.address, network);
  const api = createPayKitApi({ network, chain, signer: owner, db, domainCheck: 'trust', finalityPollMs: 1, deliverWebhooks: false });
  const merchant = createPayKitClient({ baseUrl: 'https://api.example.com', fetch: api.fetch, siwe });
  await merchant.auth.login(fromLocalAccount(owner, 1874));
  return { api, db, merchant, calls };
}

it('executes a queued payout change onchain once the safety delay has passed', async () => {
  const { api, db, calls } = await setup();
  const chai = db.merchants.find((m) => m.slug === 'chai-co')!;
  const next = getAddress(`0x${'77'.repeat(20)}`);
  chai.pendingPayout = { address: next, executableAt: new Date(Date.now() + 60_000).toISOString() };
  await api.tick();
  assert.equal(calls.filter((c) => c.fn === 'executePayoutChange').length, 0, 'not before the delay');
  chai.pendingPayout.executableAt = new Date(Date.now() - 1000).toISOString();
  await api.tick();
  assert.deepEqual(calls.filter((c) => c.fn === 'executePayoutChange').map((c) => c.arg), [chai.merchantId]);
  assert.equal(chai.payout, next);
  assert.equal(chai.pendingPayout, null);
});

it('removing a verified domain drops the badge and revokes the onchain attestation', async () => {
  const { api, db, merchant, calls } = await setup();
  const challenge = await merchant.merchant.domains.start('chai-co.example');
  db.domains[`chai-co:${challenge.domain}`] = { owner: 'chai-co', challenge: { ...challenge, status: 'verified' } };
  await merchant.merchant.domains.remove('chai-co.example');
  const chai = db.merchants.find((m) => m.slug === 'chai-co')!;
  assert.equal(chai.verifiedDomains.some((d) => d.domain === 'chai-co.example'), false);
  assert.equal(chai.listed, false);
  assert.equal((await merchant.merchant.domains.list()).length, 0);
  await api.tick();
  assert.equal(calls.filter((c) => c.fn === 'revokeDomain').length, 1);
});

it('lets the merchant cancel a customer plan, and records missed installments onchain', async () => {
  let failCollect = false;
  const base = createSimulatedChain({ stepMs: 1 });
  const { api, db, merchant, calls } = await setup({ collectInstallment: (id, i) => (failCollect ? Promise.reject(new PermanentChainError('InsufficientAllowance')) : base.collectInstallment(id, i)) });
  const buyer = createPayKitClient({ baseUrl: 'https://api.example.com', fetch: api.fetch });
  const wallet = fromLocalAccount(privateKeyToAccount(generatePrivateKey()), 1874);
  const [box] = db.products.filter((p) => p.name.includes('subscription'));
  const session = await buyer.plans.createSession({ merchant: 'chai-co', items: [{ productId: box!.id, quantity: 1 }] }, { count: 3, periodSeconds: 60, graceSeconds: 0 }, await wallet.getAddress());
  const plan = await buyer.plans.authorize(session, wallet);
  await eventually(() => db.plans[0]?.status === 'active');

  // A due installment the customer can't cover → delinquent locally and onchain.
  failCollect = true;
  db.plans[0]!.installments[0]!.dueAt = new Date(Date.now() - 5000).toISOString();
  await api.tick();
  assert.equal(db.plans[0]!.status, 'delinquent');
  assert.deepEqual(calls.filter((c) => c.fn === 'markDelinquent').map((c) => c.arg), [plan.planId]);

  // The merchant owner stops the plan (CancelPlan signed by an authorized merchant signer).
  const cancelled = await merchant.plans.cancel(plan.planId as Hex, fromLocalAccount(owner, 1874));
  await eventually(() => db.plans[0]!.status === 'cancelled');
  assert.ok(['cancelled', 'delinquent', 'active'].includes(cancelled.status));
});
