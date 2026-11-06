import { canonicalJson, paymentRouterV2Abi, merchantRegistryAbi, feeTreasuryAbi, payKitPointsAbi } from '@paykit/core';
import { decodeEventLog, keccak256, stringToBytes, type Address, type Hex, type PublicClient } from 'viem';
export interface ChainEvent { chainId: number; blockNumber: string; blockHash: Hex; transactionHash: Hex; transactionIndex: number; logIndex: number; address: Address; eventName: string; args: Record<string, unknown>; }
// V2 is a superset of v1's events (PaymentSettled keeps v1's signature). Points adds the loyalty ledger.
const abi = [...paymentRouterV2Abi, ...merchantRegistryAbi, ...feeTreasuryAbi, ...payKitPointsAbi];
export function ledgerHash(events: ChainEvent[]): Hex {
  const ordered = [...events].sort((a, b) => BigInt(a.blockNumber) < BigInt(b.blockNumber) ? -1 : BigInt(a.blockNumber) > BigInt(b.blockNumber) ? 1 : a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex);
  return keccak256(stringToBytes(canonicalJson(ordered)));
}
export async function scanEvents(client: PublicClient, addresses: Address[], from: bigint, to: bigint): Promise<ChainEvent[]> {
  if (from < 0n || to < from || !addresses.length) throw new Error('Invalid observer range or deployment addresses');
  const finalized = await client.getBlock({ blockTag: 'finalized' });
  if (finalized.number === null || to > finalized.number) throw new Error('Observer range must be finalized');
  const chainId = await client.getChainId();
  const events: ChainEvent[] = [];
  for (let start = from; start <= to; start += 2000n) {
    const end = start + 1999n < to ? start + 1999n : to;
    const logs = await client.getLogs({ address: addresses, fromBlock: start, toBlock: end });
    for (const log of logs) {
      let decoded;
      try { decoded = decodeEventLog({ abi, data: log.data, topics: log.topics }); } catch { continue; }
      if (log.blockNumber === null || log.blockHash === null || log.transactionHash === null || log.transactionIndex === null || log.logIndex === null || log.removed) continue;
      const block = await client.getBlock({ blockNumber: log.blockNumber });
      if (block.hash !== log.blockHash) throw new Error('Observer received a noncanonical block; retry the range');
      const args = JSON.parse(JSON.stringify(decoded.args, (_k, value) => typeof value === 'bigint' ? value.toString() : value)) as Record<string, unknown>;
      events.push({ chainId, blockNumber: log.blockNumber.toString(), blockHash: log.blockHash, transactionHash: log.transactionHash, transactionIndex: log.transactionIndex, logIndex: log.logIndex, address: log.address, eventName: decoded.eventName, args });
    }
  }
  return events.sort((a, b) => BigInt(a.blockNumber) < BigInt(b.blockNumber) ? -1 : BigInt(a.blockNumber) > BigInt(b.blockNumber) ? 1 : a.transactionIndex - b.transactionIndex || a.logIndex - b.logIndex);
}
