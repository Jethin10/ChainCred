import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createServer } from 'node:http';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { keccak256, parseTransaction, type Hex } from 'viem';
import { resolveNetwork } from '@paykit/core';
import { createViemChain } from '../src/chain/viem.ts';
import type { RelayTransaction } from '../src/chain/types.ts';
it('persists signed bytes before broadcast, replaces under the same nonce and finds the mined original', { timeout: 15000 }, async () => {
  const journal: Record<string, RelayTransaction> = {};
  const blockHash = `0x${'aa'.repeat(32)}`;
  let saves = 0; let winner: string | null = null;
  const sends: Hex[] = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const rpc = JSON.parse(body); let result: unknown;
    switch (rpc.method) {
      case 'eth_fillTransaction': res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not supported' } })); return;
      case 'eth_chainId': result = '0x752'; break;
      case 'eth_call': result = `0x${'00'.repeat(32)}`; break;
      case 'eth_estimateGas': result = '0x186a0'; break;
      case 'eth_getBalance': result = '0xde0b6b3a7640000'; break;
      case 'eth_getTransactionCount': result = '0x0'; break;
      case 'eth_maxPriorityFeePerGas': result = '0x3b9aca00'; break;
      case 'eth_getBlockByNumber': result = { number: '0x64', hash: blockHash, baseFeePerGas: '0x12a05f200', gasLimit: '0x1c9c380', gasUsed: '0x186a0', timestamp: '0x1', transactions: [] }; break;
      case 'eth_sendRawTransaction': {
        assert.ok(saves > 0); const raw = rpc.params[0] as Hex;
        assert.ok(Object.values(journal).some((entry) => entry.raw === raw)); sends.push(raw); result = keccak256(raw); break;
      }
      case 'eth_getTransactionReceipt': result = rpc.params[0] === winner ? { transactionHash: winner, transactionIndex: '0x0', blockHash, blockNumber: '0x64', from: `0x${'11'.repeat(20)}`, to: `0x${'22'.repeat(20)}`, cumulativeGasUsed: '0x186a0', gasUsed: '0x186a0', effectiveGasPrice: '0x12a05f200', contractAddress: null, logs: [], logsBloom: `0x${'00'.repeat(256)}`, status: '0x1', type: '0x2' } : null; break;
      default: throw new Error(`Unexpected RPC ${rpc.method}`);
    }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const account = privateKeyToAccount(generatePrivateKey());
    const network = resolveNetwork('whitechain-testnet', { router: `0x${'22'.repeat(20)}`, registry: `0x${'33'.repeat(20)}` });
    const chain = createViemChain({ network, relayer: account, rpcUrl: `http://127.0.0.1:${port}`, journal, onJournalChange: () => { saves++; } });
    const id = `0x${'44'.repeat(32)}` as Hex;
    const original = await chain.collectInstallment(id, 0);
    const entry = Object.values(journal)[0]!;
    assert.equal(entry.hash, original); entry.createdAt -= 121000;
    const replacement = await chain.collectInstallment(id, 0);
    assert.notEqual(original, replacement);
    const first = parseTransaction(sends[0]!); const second = parseTransaction(sends[1]!);
    assert.equal(first.nonce, second.nonce); assert.equal(first.data, second.data); assert.ok(second.maxFeePerGas! > first.maxFeePerGas!);
    winner = original;
    const status = await chain.transactionStatus!(replacement);
    assert.equal(status?.finality, 'finalized'); assert.equal(entry.hash, original);
    assert.equal((await chain.waitForReceipt(replacement)).transactionHash, original);
    winner = null;
    assert.equal(await chain.transactionStatus!(original), null); assert.equal(entry.settled, false);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
