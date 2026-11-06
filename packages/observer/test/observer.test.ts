import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ledgerHash, scanEvents, type ChainEvent } from '../src/index.ts';
import { createPublicClient, custom } from 'viem';
const event: ChainEvent = { chainId: 1874, blockNumber: '10', blockHash: `0x${'11'.repeat(32)}`, transactionHash: `0x${'22'.repeat(32)}`, transactionIndex: 0, logIndex: 0, address: `0x${'33'.repeat(20)}`, eventName: 'PaymentSettled', args: { gross: '1000000' } };
it('hashes the same pinned ledger deterministically regardless of input order', () => {
  const second = { ...event, blockNumber: '11' };
  assert.equal(ledgerHash([event, second]), ledgerHash([second, event]));
  assert.notEqual(ledgerHash([event]), ledgerHash([{ ...event, args: { gross: '2000000' } }]));
});
it('refuses unfinalized reconstruction ranges and never sends a transaction', async () => {
  const calls: string[] = [];
  const client = createPublicClient({ transport: custom({ request: async ({ method }) => { calls.push(method); if (method === 'eth_getBlockByNumber') return { number: '0x64', hash: event.blockHash, transactions: [] }; throw new Error(`Unexpected RPC ${method}`); } }) });
  await assert.rejects(scanEvents(client, [event.address], 1n, 101n), /finalized/);
  assert.deepEqual(calls, ['eth_getBlockByNumber']);
});
