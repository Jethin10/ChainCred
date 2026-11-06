import { scanEvents } from "@paykit/observer";
/**
 * The real chain: calls the PayKit contracts on Whitechain with the relay wallet.
 *
 * Function names and arguments follow the interface in @paykit/core (abi.ts, plan.md §8).
 * If the deployed contracts differ, this is the one file to adjust.
 */
import { merchantRegistryAbi, paymentRouterV1Abi, paymentRouterV2Abi, feeTreasuryAbi, payKitPointsAbi, planV1Message, quoteV1Message, requireContract, requireUsdt, routerVersionOf, usdtAbi, withPlanDefaults, withQuoteDefaults, type NetworkConfig } from "@paykit/core";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  keccak256,
  formatEther,
  http,
  parseEther,
  parseSignature,
  parseTransaction,
  parseAbi,
  serializeTransaction,
  type Abi,
  type Address,
  type Hex,
  type LocalAccount,
} from "viem";
import { PermanentChainError, type ChainAdapter, type RelayTransaction } from "./types.ts";

export interface ViemChainOptions {
  network: NetworkConfig;
  /** RPC URL. Default: the network's public RPC. */
  rpcUrl?: string;
  /** Relay wallet: sends every transaction and pays WBT gas. */
  relayer: LocalAccount;
  /** Platform admin key for attestDomain (the registry owner). Default: the relayer. */
  admin?: LocalAccount;
  /** Stop sponsoring when the relay wallet drops below this. Default 0.005 WBT. */
  minRelayerBalance?: bigint;
  maxGas?: bigint;
  maxFeePerGas?: bigint;
  dailyGasBudget?: bigint;
  journal?: Record<string, RelayTransaction>;
  onJournalChange?: () => void;
}

export function createViemChain(options: ViemChainOptions): ChainAdapter {
  const { network } = options;
  const router = requireContract(network, "router");
  const v2 = routerVersionOf(network) === "2";
  const paymentRouterAbi = v2 ? paymentRouterV2Abi : paymentRouterV1Abi;
  const registry = requireContract(network, "registry");
  const usdt = requireUsdt(network).address;
  const transport = http(options.rpcUrl ?? network.chain.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain: network.chain, transport });
  const relayer = createWalletClient({ chain: network.chain, transport, account: options.relayer });
  const admin = options.admin ? createWalletClient({ chain: network.chain, transport, account: options.admin }) : relayer;
  const minBalance = options.minRelayerBalance ?? parseEther("0.005");

  const journal = options.journal ?? {};
  let tail: Promise<unknown> = Promise.resolve();
  async function canonicalReceipt(entry: RelayTransaction) {
    for (const hash of [entry.hash, ...(entry.hashes ?? [])]) {
      let receipt;
      try { receipt = await publicClient.getTransactionReceipt({ hash }); }
      catch (error) { if (error instanceof Error && error.name === "TransactionReceiptNotFoundError") continue; throw error; }
      const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
      if (block.hash !== receipt.blockHash) continue;
      if (entry.hash !== hash) {
        entry.hashes = [...new Set([...(entry.hashes ?? []), entry.hash])];
        entry.rawHistory = { ...entry.rawHistory, [entry.hash]: entry.raw };
        entry.raw = entry.rawHistory[hash] ?? entry.raw; entry.hash = hash;
      }
      entry.settled = true;
      options.onJournalChange?.();
      return receipt;
    }
    if (entry.settled) { entry.settled = false; options.onJournalChange?.(); }
    return null;
  }
  async function rebroadcast(wallet: typeof relayer, cached: RelayTransaction, address: Address, data: Hex): Promise<Hex> {
        // Resolve uncertainty by every known hash, including entries that were previously included.
        const receipt = await canonicalReceipt(cached);
        if (receipt) return cached.hash;
        if (!cached.settled) {
          if (Date.now() - (cached.replacedAt ?? cached.createdAt) > 120_000 && (cached.replacements ?? 0) < 3) {
            const previous = parseTransaction(cached.raw);
            const fee = (previous.maxFeePerGas ?? 0n) * 9n / 8n + 1n;
            const priority = (previous.maxPriorityFeePerGas ?? 0n) * 9n / 8n + 1n;
            const additional = (previous.gas ?? 0n) * (fee - (previous.maxFeePerGas ?? 0n));
            const today = new Date().toISOString().slice(0, 10);
            const spent = Object.values(journal).filter((j) => new Date(j.createdAt).toISOString().slice(0, 10) === today).reduce((sum, j) => sum + BigInt(j.cost), 0n);
            if (fee <= (options.maxFeePerGas ?? 50000000000n) && spent + additional <= (options.dailyGasBudget ?? parseEther("0.1"))) {
              const raw = await wallet.signTransaction({ account: wallet.account, chain: network.chain, to: address, data, gas: previous.gas, nonce: cached.nonce, maxFeePerGas: fee, maxPriorityFeePerGas: priority, type: "eip1559" });
              cached.hashes = [...(cached.hashes ?? []), cached.hash];
              cached.rawHistory = { ...cached.rawHistory, [cached.hash]: cached.raw };
              cached.hash = keccak256(raw); cached.raw = raw; cached.cost = (BigInt(cached.cost) + additional).toString(); cached.replacements = (cached.replacements ?? 0) + 1; cached.replacedAt = Date.now();
            }
          }
          options.onJournalChange?.();
          await publicClient.sendRawTransaction({ serializedTransaction: cached.raw }).catch(() => {});
        }
        return cached.hash;
  }
  async function write(wallet: typeof relayer, address: Address, abi: Abi, functionName: string, args: readonly unknown[], operation = ""): Promise<Hex> {
    const action = async () => {
      if (!options.journal || !options.onJournalChange) throw new PermanentChainError("Real writes require a durable transaction journal");
      const data = encodeFunctionData({ abi, functionName, args });
      const key = `${wallet.account.address}:${address}:${data}:${operation}`;
      const cached = journal[key];
      if (cached) return rebroadcast(wallet, cached, address, data);
      try {
        await publicClient.simulateContract({ account: wallet.account, address, abi, functionName, args } as never);
      } catch (error) {
        if (error instanceof BaseError && error.walk((e) => e instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError) throw new PermanentChainError(revertReason(error));
        throw error;
      }
      const gas = await publicClient.estimateGas({ account: wallet.account, to: address, data });
      const limit = gas * 120n / 100n;
      if (limit > (options.maxGas ?? 400000n)) throw new PermanentChainError("Transaction exceeds sponsorship gas limit");
      const fees = await publicClient.estimateFeesPerGas();
      const cap = options.maxFeePerGas ?? 50000000000n;
      if (fees.maxFeePerGas > cap) throw new PermanentChainError("Network fees exceed sponsorship cap");
      // Conservative extra reserve for OP L1 data charges. Operators can raise the reserve.
      const cost = limit * fees.maxFeePerGas + parseEther("0.0001");
      const owned = Object.values(journal).filter((j) => j.sender === wallet.account.address);
      const reserved = owned.filter((j) => !j.settled).reduce((sum, j) => sum + BigInt(j.cost), 0n);
      const spentToday = owned.filter((j) => new Date(j.createdAt).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)).reduce((sum, j) => sum + BigInt(j.cost), 0n);
      if (spentToday + cost > (options.dailyGasBudget ?? parseEther("0.1"))) throw new PermanentChainError("Daily sponsorship budget exhausted");
      if (await publicClient.getBalance({ address: wallet.account.address }) < reserved + cost + minBalance) throw new PermanentChainError("Insufficient unreserved relay balance");
      const chainNonce = await publicClient.getTransactionCount({ address: wallet.account.address, blockTag: "pending" });
      const nonce = Math.max(chainNonce, ...owned.map((j) => j.nonce + 1));
      const prepared = await wallet.prepareTransactionRequest({ account: wallet.account, to: address, data, gas: limit, nonce, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
      const raw = await wallet.signTransaction(prepared);
      const hash = keccak256(raw);
      journal[key] = { hash, raw, sender: wallet.account.address, nonce, cost: cost.toString(), createdAt: Date.now(), settled: false };
      // Persist signed bytes and deterministic hash BEFORE broadcasting. A retry sends the same transaction.
      options.onJournalChange?.();
      await publicClient.sendRawTransaction({ serializedTransaction: raw }).catch(() => {});
      return hash;
    };
    const task = tail.then(action);
    tail = task.catch(() => {});
    return task;
  }
  async function finality(blockNumber: bigint): Promise<"included" | "safe" | "finalized"> {
    const [finalized, safe] = await Promise.all([publicClient.getBlock({ blockTag: "finalized" }).catch(() => null), publicClient.getBlock({ blockTag: "safe" }).catch(() => null)]);
    if (finalized?.number != null && finalized.number >= blockNumber) return "finalized";
    if (safe?.number != null && safe.number >= blockNumber) return "safe";
    return "included";
  }

  const v = (sig: Hex) => {
    const s = parseSignature(sig);
    return { v: Number(s.v ?? BigInt(s.yParity + 27)), r: s.r, s: s.s };
  };

  return {
    pay: ({ quote, merchantSignature, auth }) =>
      write(relayer, router, paymentRouterAbi, "pay", [
        v2 ? withQuoteDefaults(quote) : quoteV1Message(quote),
        merchantSignature,
        { from: auth.from, refundTo: auth.refundTo, salt: auth.salt, validAfter: auth.validAfter, validBefore: auth.validBefore, signature: auth.signature },
      ]),

    refund: ({ terms, merchantSignature, funder }) => write(relayer, router, paymentRouterAbi, "refund", [terms, merchantSignature, funder]),

    createPlan: ({ terms, merchantSignature, consentSignature, consentDeadline, permit }) =>
      write(relayer, router, paymentRouterAbi, "createPlan", [
        v2 ? withPlanDefaults(terms) : planV1Message(terms),
        merchantSignature,
        { deadline: consentDeadline, signature: consentSignature },
        { value: permit.value, deadline: permit.deadline, ...v(permit.signature) },
      ]),

    collectInstallment: (planId, index) => write(relayer, router, paymentRouterAbi, "collectInstallment", [planId], String(index ?? 0)),

    cancelPlan: ({ message, signature }) => write(relayer, router, paymentRouterAbi, "cancelPlan", [message, signature]),

    registerMerchant: ({ message, signature }) => write(relayer, registry, merchantRegistryAbi, "registerWithSig", [message, signature]),

    registryAction: ({ request: r, signature }) => {
      const base = { merchantId: r.merchantId, nonce: BigInt(r.nonce), deadline: BigInt(r.deadline) };
      if (r.action === "set_signer") {
        return write(relayer, registry, merchantRegistryAbi, "setSignerWithSig", [{ ...base, signer: r.signer, expiresAt: BigInt(r.expiresAt), enabled: r.enabled }, signature]);
      }
      if (r.action === "set_split") {
        // The contract recomputes splitHash = keccak256(abi.encode(recipients, bps)) from the arrays.
        return write(relayer, registry, merchantRegistryAbi, "setSplitProfileWithSig", [{ ...base, profileId: r.profileId, recipients: r.recipients, bps: r.bps }, signature]);
      }
      return write(relayer, registry, merchantRegistryAbi, "queuePayoutChangeWithSig", [{ ...base, newPayout: r.newPayout }, signature]);
    },

    revokeDomain: ({ merchantId, domainHash }) => write(admin, registry, merchantRegistryAbi, "revokeDomain", [merchantId, domainHash]),
    attestDomain: ({ merchantId, domainHash, expiresAt }) => write(admin, registry, merchantRegistryAbi, "attestDomain", [merchantId, domainHash, expiresAt]),

    keys: {
      payment: (merchantId, localPaymentId) => publicClient.readContract({ address: router, abi: paymentRouterAbi, functionName: "paymentKeyOf", args: [merchantId, localPaymentId] }),
      plan: (merchantId, localPlanId) => publicClient.readContract({ address: router, abi: paymentRouterAbi, functionName: "planKeyOf", args: [merchantId, localPlanId] }),
      installment: (planKey, index) => publicClient.readContract({ address: router, abi: paymentRouterAbi, functionName: "installmentPaymentId", args: [planKey, BigInt(index)] }),
    },

    async waitForReceipt(hash) {
      const entry = Object.values(journal).find((j) => j.hash === hash || j.hashes?.includes(hash));
      if (entry && !entry.settled) {
        const transaction = parseTransaction(entry.raw);
        const wallet = entry.sender === relayer.account.address ? relayer : admin;
        const task = tail.then(() => rebroadcast(wallet, entry, transaction.to as Address, transaction.data ?? "0x"));
        tail = task.catch(() => {});
        await task;
      }
      const receipt = (entry ? await canonicalReceipt(entry) : null) ?? await publicClient.waitForTransactionReceipt({ hash: entry?.hash ?? hash, timeout: 120_000 });
      for (const entry of Object.values(journal)) if (entry.hash === hash || entry.hashes?.includes(hash)) entry.settled = true;
      options.onJournalChange?.();
      return { success: receipt.status === "success", blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, transactionHash: receipt.transactionHash, error: receipt.status === "success" ? undefined : "Transaction reverted" };
    },

    finality,
    async transactionStatus(hash) {
      const entry = Object.values(journal).find((j) => j.hash === hash || j.hashes?.includes(hash));
      let receipt;
      if (entry) receipt = await canonicalReceipt(entry);
      else {
        try { receipt = await publicClient.getTransactionReceipt({ hash }); }
        catch (error) { if (error instanceof Error && error.name === "TransactionReceiptNotFoundError") return null; throw error; }
      }
      if (!receipt) return null;
      const canonical = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
      if (canonical.hash !== receipt.blockHash) return null;
      return { success: receipt.status === "success", blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, finality: await finality(receipt.blockNumber) };
    },

    async refillState() {
      const treasury = requireContract(network, "treasury");
      const [balance, nativeBalance, limits, spent, dayStart, reserved] = await Promise.all([
        publicClient.readContract({ address: usdt, abi: usdtAbi, functionName: "balanceOf", args: [treasury] }),
        publicClient.getBalance({ address: options.relayer.address }),
        publicClient.readContract({ address: treasury, abi: feeTreasuryAbi, functionName: "limits" }),
        publicClient.readContract({ address: treasury, abi: feeTreasuryAbi, functionName: "spentToday" }),
        publicClient.readContract({ address: treasury, abi: feeTreasuryAbi, functionName: "dayStart" }),
        publicClient.readContract({ address: treasury, abi: feeTreasuryAbi, functionName: "reservedUsdt" }),
      ]);
      const dailySpent = BigInt(Math.floor(Date.now() / 1000)) >= dayStart + 86400n ? 0n : spent;
      return { nativeBalance, reservedGas: Object.values(journal).filter((j) => !j.settled && j.sender === options.relayer.address).reduce((sum, j) => sum + BigInt(j.cost), 0n), treasuryAvailable: balance > reserved ? balance - reserved : 0n, maxPerRun: limits[0], remainingDaily: limits[1] > dailySpent ? limits[1] - dailySpent : 0n, priceFloor: limits[2] };
    },
    async quoteRefill(amount) {
      const treasury = requireContract(network, "treasury");
      const quoteAbi = parseAbi(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"]);
      const quote = await publicClient.simulateContract({ address: "0x90f28c3a6233713d6Df00E5fa92a3f13EFe36191", abi: quoteAbi, functionName: "quoteExactInputSingle", args: [{ tokenIn: usdt, tokenOut: "0x4200000000000000000000000000000000000006", amountIn: amount, fee: 3000, sqrtPriceLimitX96: 0n }] });
      const minOutput = quote.result[0] * 9900n / 10000n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);
      const data = encodeFunctionData({ abi: feeTreasuryAbi, functionName: "refill", args: [amount, minOutput, deadline] });
      const gas = await publicClient.estimateGas({ account: options.relayer, to: treasury, data });
      const fees = await publicClient.estimateFeesPerGas();
      if (fees.maxFeePerGas > (options.maxFeePerGas ?? 50000000000n)) throw new Error("Refill fees exceed cap");
      const nonce = await publicClient.getTransactionCount({ address: options.relayer.address, blockTag: "pending" });
      const raw = serializeTransaction({ type: "eip1559", chainId: network.chain.id, nonce, to: treasury, data, gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
      const l1 = await publicClient.readContract({ address: "0x420000000000000000000000000000000000000F", abi: parseAbi(["function getL1Fee(bytes data) view returns (uint256)"]), functionName: "getL1Fee", args: [raw] });
      return { output: quote.result[0], cost: gas * 120n / 100n * fees.maxFeePerGas + l1 * 120n / 100n };
    },
    refill: ({ amount, minOutput, deadline }) => write(relayer, requireContract(network, "treasury"), feeTreasuryAbi, "refill", [amount, minOutput, deadline]),
    async observe(from) {
      const head = await publicClient.getBlock({ blockTag: "finalized" });
      if (head.number === null || from > head.number) return { nextBlock: from, events: [] };
      const to = from + 1999n < head.number ? from + 1999n : head.number;
      const addresses = [router, registry, ...(network.contracts.treasury ? [network.contracts.treasury] : []), ...(network.contracts.points ? [network.contracts.points] : [])];
      return { nextBlock: to + 1n, events: await scanEvents(publicClient, addresses, from, to) };
    },
    ownerNonce: (owner) => publicClient.readContract({ address: registry, abi: merchantRegistryAbi, functionName: "ownerNonces", args: [owner] }),
    permitNonce: (owner) => publicClient.readContract({ address: usdt, abi: usdtAbi, functionName: "nonces", args: [owner] }),
    committed: (payer) => publicClient.readContract({ address: router, abi: paymentRouterAbi, functionName: "committed", args: [payer, usdt] }),

    async sponsorship() {
      const balance = await publicClient.getBalance({ address: options.relayer.address });
      const reserved = Object.values(journal).filter((j) => !j.settled && j.sender === options.relayer.address).reduce((sum, j) => sum + BigInt(j.cost), 0n);
      if (balance - reserved < minBalance + (options.maxGas ?? 400000n) * (options.maxFeePerGas ?? 50000000000n)) return { ok: false, reason: `Relay wallet is low on WBT (${formatEther(balance)})` };
      return { ok: true, reason: null };
    },
  };
}

function revertReason(error: unknown): string {
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName ?? revert.reason ?? revert.shortMessage;
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : String(error);
}
