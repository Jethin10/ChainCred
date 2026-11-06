import assert from 'node:assert/strict';
import { it } from 'node:test';
import { parseUsdt } from '@paykit/core';
import { createPayKitClient, fromLocalAccount } from '../src/index.ts';
import { createMockApi, MOCK_TEST_KEYS } from '../src/mock.ts';
import { privateKeyToAccount } from 'viem/accounts';

it('rejects numeric amounts with excess precision instead of rounding', () => {
  assert.throws(() => parseUsdt(1.0000001));
});
it('does not sign a checkout whose total changed', async () => {
  const mock = createMockApi({ latencyMs: 0, stepMs: 1 });
  const c = createPayKitClient({ baseUrl: mock.baseUrl, fetch: mock.fetch });
  const p = mock.db.products[0]!;
  const expectedAmount = p.price;
  p.price = (BigInt(p.price) * 2n).toString();
  await assert.rejects(c.checkout.pay({ merchant: p.merchantSlug, items: [{ productId: p.id, quantity: 1 }] }, fromLocalAccount(privateKeyToAccount(MOCK_TEST_KEYS.customer), 1874), { expectedAmount }), /amount|price/i);
  assert.equal(mock.db.payments.length, 0);
});
