import assert from 'node:assert/strict';
import { it } from 'node:test';
import { decideRefill, refillAmount } from '../src/refill.ts';
const state = { nativeBalance: 100000n, reservedGas: 0n, treasuryAvailable: 20000000n, maxPerRun: 20000000n, remainingDaily: 100000000n, priceFloor: 100n };
it('skips uneconomic refills and permits a cost-bounded batch', () => {
  assert.equal(decideRefill(state, 1000000n, { output: 1000n, cost: 1000n }, { reserve: 0n, highWatermark: 200000n }).action, 'SKIP');
  assert.equal(decideRefill(state, 1000000n, { output: 20000n, cost: 1000n }, { reserve: 0n, highWatermark: 200000n }).action, 'RUN');
  assert.equal(decideRefill({ ...state, nativeBalance: 100n }, 1000000n, { output: 20000n, cost: 1000n }, { reserve: 0n, highWatermark: 200000n }).action, 'PAUSE');
  assert.equal(decideRefill(state, 100000n, { output: 20000n, cost: 1000n }, { reserve: 0n, highWatermark: 200000n }).action, 'SKIP');
  assert.equal(decideRefill({ ...state, priceFloor: 100000000n }, 1000000n, { output: 20000n, cost: 1000n }, { reserve: 0n, highWatermark: 200000n }).action, 'SKIP');
  const amount = refillAmount(state, 10000n, { reserve: 0n, target: 200000n });
  assert.ok(amount <= state.maxPerRun && amount > 0n);
});
