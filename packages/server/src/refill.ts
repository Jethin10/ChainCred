/** Refill policy is separate from payment submission. All values use integer base units. */
export interface RefillState { nativeBalance: bigint; reservedGas: bigint; treasuryAvailable: bigint; maxPerRun: bigint; remainingDaily: bigint; priceFloor: bigint; }
export interface RefillQuote { output: bigint; cost: bigint; }
export type RefillDecision = { action: 'SKIP' | 'PAUSE'; reason: string } | { action: 'RUN'; amount: bigint; minOutput: bigint; cost: bigint };
export function refillAmount(state: RefillState, pricePerUsdt: bigint, options: { reserve: bigint; target: bigint }): bigint {
  if (pricePerUsdt <= 0n) return 0n;
  const available = state.nativeBalance - state.reservedGas - options.reserve;
  const deficit = options.target > available ? options.target - available : 0n;
  const needed = (deficit * 1_000_000n * 101n + pricePerUsdt * 100n - 1n) / (pricePerUsdt * 100n);
  return [needed, state.treasuryAvailable, state.maxPerRun, state.remainingDaily].reduce((a, b) => a < b ? a : b);
}
export function decideRefill(state: RefillState, amount: bigint, quote: RefillQuote, options: { reserve: bigint; highWatermark: bigint; minBatch?: bigint; slippageBps?: bigint }): RefillDecision {
  if (state.nativeBalance - state.reservedGas - options.reserve >= options.highWatermark) return { action: 'SKIP', reason: 'runway ok' };
  if (amount < (options.minBatch ?? 1_000_000n) || amount > state.treasuryAvailable || amount > state.maxPerRun || amount > state.remainingDaily) return { action: 'SKIP', reason: 'batch too small or exceeds limits' };
  const quotedMinimum = quote.output * (10000n - (options.slippageBps ?? 100n)) / 10000n;
  const floor = amount * state.priceFloor / 1_000_000n;
  if (floor > quotedMinimum) return { action: 'SKIP', reason: 'quote below independent price floor' };
  if (quotedMinimum < quote.cost * 10n) return { action: 'SKIP', reason: 'uneconomical: cost exceeds 10% of output' };
  if (state.nativeBalance - state.reservedGas < quote.cost * 2n) return { action: 'PAUSE', reason: 'manual top-up required' };
  return { action: 'RUN', amount, minOutput: quotedMinimum, cost: quote.cost };
}
