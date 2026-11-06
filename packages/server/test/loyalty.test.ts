/**
 * Universal points through the real client and API (simulated chain), following PayKitPoints.sol:
 * earn on payment, redeem for a merchant-funded discount, and proportional reversal on refund.
 */
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { getAddress } from 'viem';
import { resolveNetwork, paymentQuoteTypedData } from '@paykit/core';
import { createPayKitClient, fromLocalAccount } from '@paykit/js';
import { createPayKitApi, emptyDb } from '../src/api.ts';
import { createSimulatedChain } from '../src/chain/simulated.ts';
import { seedDemo } from '../src/seed.ts';

const owner = privateKeyToAccount(generatePrivateKey());
const contracts = { router: getAddress(`0x${'12'.repeat(20)}`), registry: getAddress(`0x${'34'.repeat(20)}`), points: getAddress(`0x${'56'.repeat(20)}`) };
const siwe = { domain: 'shop.example.com', uri: 'https://shop.example.com' };

async function setup(network = resolveNetwork('whitechain-testnet', contracts)) {
  const db = emptyDb(); seedDemo(db, owner.address, network);
  const api = createPayKitApi({ network, chain: createSimulatedChain({ stepMs: 1 }), signer: owner, db, domainCheck: 'trust', finalityPollMs: 1, deliverWebhooks: false, maxPointsPerUsdt: 50 });
  const client = (opts = {}) => createPayKitClient({ baseUrl: 'https://api.example.com', fetch: api.fetch, siwe, ...opts });
  return { db, api, client };
}

it('earns points on payment, redeems them for a discount, and reverses them on refund', async () => {
  const { client, db } = await setup();
  const buyerKey = privateKeyToAccount(generatePrivateKey());
  const buyer = fromLocalAccount(buyerKey, 1874);
  const shop = client();
  const program = await shop.merchants.loyalty('chai-co');
  assert.equal(program.enabled, true);
  assert.equal(program.pointsPerUsdt, 10);
  const [box] = (await shop.merchants.products('chai-co')).filter((p) => p.name.includes('subscription'));

  // 1. Pay 45 USDT → 450 points.
  const first = await shop.checkout.pay({ merchant: 'chai-co', items: [{ productId: box!.id, quantity: 1 }] }, buyer, { wait: { until: 'included', intervalMs: 1 } });
  assert.equal(first.session.quote.pointsEarned, '450');
  assert.equal(first.payment.pointsEarned, '450');
  const me = client();
  await me.auth.login(buyer);
  assert.equal((await me.me.points()).balance, '450');

  // 2. Redeem 60 points for 2.50 off a 3 USDT vada pav: pays 0.50 and earns 5 points on it.
  const vada = (await shop.merchants.products('chai-co')).find((p) => p.name === 'Vada pav')!;
  const reward = program.rewards.find((r) => r.name === 'Free masala chai')!;
  const session = await shop.checkout.createSession({ merchant: 'chai-co', items: [{ productId: vada.id, quantity: 1 }] });
  const discounted = await shop.checkout.applyReward(session.id, reward.id as `0x${string}`, buyerKey.address);
  assert.equal(discounted.quote.gross, '500000');
  assert.equal(discounted.quote.discount, '2500000');
  assert.equal(discounted.quote.pointsRedeemed, '60');
  assert.equal(discounted.quote.pointsEarned, '5');
  assert.equal(discounted.reward?.name, 'Free masala chai');
  const paid = await shop.checkout.authorize(discounted, buyer, { expectedAmount: '500000' });
  const settled = await shop.payments.wait(paid.paymentId, { until: 'included', intervalMs: 1 });
  assert.equal(settled.discount, '2500000');
  const after = await me.me.points();
  assert.equal(after.balance, String(450 - 60 + 5));
  assert.equal(after.lifetimeRedeemed, '60');
  assert.deepEqual(after.history.map((h) => h.kind).slice(0, 3), ['earned', 'redeemed', 'earned']);
  // The discount counts toward the invoice: it is fully paid.
  const inv = db.invoices.find((i) => i.id === discounted.invoice.id)!;
  assert.equal(inv.paid, '3000000');
  assert.equal(inv.status, 'paid');

  // 3. Refund half of the 45 USDT payment → half of its 450 points are removed.
  const merchant = client();
  const ownerWallet = fromLocalAccount(owner, 1874);
  await merchant.auth.login(ownerWallet);
  const refund = await merchant.merchant.refund(first.payment.paymentId, '22500000', { merchant: ownerWallet });
  for (let n = 0; n < 200 && db.refunds.find((r) => r.id === refund.id)?.status !== 'settled'; n++) await new Promise((r) => setTimeout(r, 5));
  const reversed = await me.me.points();
  assert.equal(reversed.balance, String(395 - 225));
  assert.equal(reversed.history[0]!.kind, 'reversed');
});

it('refuses a reward the wallet cannot afford, and a client rejects points burned without a reward', async () => {
  const { client } = await setup();
  const poor = privateKeyToAccount(generatePrivateKey());
  const shop = client();
  const program = await shop.merchants.loyalty('chai-co');
  const [chai] = await shop.merchants.products('chai-co');
  const session = await shop.checkout.createSession({ merchant: 'chai-co', items: [{ productId: chai!.id, quantity: 2 }] });
  await assert.rejects(shop.checkout.applyReward(session.id, program.rewards[0]!.id as `0x${string}`, poor.address), /Not enough points/);
  // A tampered session that hides the reward but burns points is refused before signing.
  const tampered = { ...session, quote: { ...session.quote, pointsRedeemed: '25', discount: '1000000' } };
  await assert.rejects(shop.checkout.authorize(tampered, fromLocalAccount(poor, 1874)), /quote hash differs|points would be spent/);
});

it('lets the merchant edit the program, capped by the platform maximum', async () => {
  const { client } = await setup();
  const merchant = client();
  await merchant.auth.login(fromLocalAccount(owner, 1874));
  const current = await merchant.merchant.loyalty.get();
  assert.equal(current.available, true);
  const updated = await merchant.merchant.loyalty.update({ pointsPerUsdt: 20, rewards: [{ name: '5 USDT off', pointsCost: '200', discount: '5000000', active: true }] });
  assert.equal(updated.pointsPerUsdt, 20);
  assert.equal(updated.rewards[0]!.name, '5 USDT off');
  await assert.rejects(merchant.merchant.loyalty.update({ pointsPerUsdt: 51 }), /capped at 50/);
});

it('turns points off on a v1 router and never puts points fields in a v1 quote', async () => {
  const network = resolveNetwork('whitechain-testnet', { ...contracts, routerVersion: '1' });
  const { client } = await setup(network);
  const shop = client();
  assert.equal((await shop.merchants.loyalty('chai-co')).enabled, false);
  const [chai] = await shop.merchants.products('chai-co');
  const session = await shop.checkout.createSession({ merchant: 'chai-co', items: [{ productId: chai!.id, quantity: 1 }] });
  assert.equal(session.quote.pointsEarned, undefined);
  assert.equal(paymentQuoteTypedData(network, { ...session.quote, invoiceTotal: 1n, gross: 1n, fee: 0n, validUntil: 1n, merchantId: session.quote.merchantId as `0x${string}`, invoiceId: session.quote.invoiceId as `0x${string}`, invoiceDigest: session.quote.invoiceDigest as `0x${string}`, paymentId: session.quote.paymentId as `0x${string}`, token: session.quote.token as `0x${string}`, payer: session.quote.payer as `0x${string}`, discount: undefined, pointsEarned: undefined, pointsRedeemed: undefined, campaignId: undefined, rewardId: undefined }).domain.version, '1');
});
