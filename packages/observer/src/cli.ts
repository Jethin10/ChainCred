#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { createPublicClient, getAddress, http } from 'viem';
import { scanEvents, ledgerHash } from './index.ts';
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!, process.argv[i + 1]!);
const required = (name: string) => { const value = args.get(name); if (!value) throw new Error(`Missing ${name}`); return value; };
try {
  const client = createPublicClient({ transport: http(required('--rpc')) });
  const addresses = ['--router', '--registry', '--treasury'].flatMap((name) => args.has(name) ? [getAddress(required(name))] : []);
  const events = await scanEvents(client, addresses, BigInt(required('--from')), BigInt(required('--to')));
  writeFileSync(required('--out'), events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''));
  process.stdout.write(JSON.stringify({ events: events.length, ledgerHash: ledgerHash(events) }) + '\n');
} catch (error) { console.error(error instanceof Error ? error.message : 'Observer failed'); process.exitCode = 1; }
