import { formatUsdt, parseUsdt, type CheckoutSession, type PayKitClient, type Payment, type WalletSigner } from "@paykit/js";
import type { PayKit } from "@paykit/node";
import type { Address, Hex } from "viem";
import { ToolError, type Tool } from "./protocol.ts";

export interface PayKitToolsOptions {
  /** Browser/agent client pointed at a PayKit API. */
  client: PayKitClient;
  /** The agent's own wallet. Without it the server is read-only and cannot pay. */
  wallet?: WalletSigner;
  /** Hard cap per payment in USDT base units. Default 25 USDT. */
  maxSpend?: bigint;
  /** Merchant server SDK (secret key). Enables the merchant tools. */
  merchant?: PayKit;
}

const usdt = (base: string | bigint) => `${formatUsdt(base)} USDT`;

function summarizeSession(s: CheckoutSession) {
  return {
    sessionId: s.id,
    merchant: { slug: s.merchant.slug, name: s.merchant.name, verifiedDomains: s.merchant.verifiedDomains.map((d) => d.domain) },
    items: s.invoice.lineItems.map((l) => ({ name: l.name, quantity: l.quantity, amount: usdt(l.amount) })),
    invoiceTotal: usdt(s.invoice.total),
    amountDue: usdt(s.quote.gross),
    amountDueBaseUnits: s.quote.gross,
    networkFee: "0 (PayKit pays the gas)",
    pointsEarned: s.quote.pointsEarned ?? "0",
    reward: s.reward ? { name: s.reward.name, discount: usdt(s.reward.discount), pointsCost: s.reward.pointsCost } : null,
    expiresAt: s.expiresAt,
  };
}

function summarizePayment(p: Payment) {
  return {
    paymentId: p.paymentId,
    status: p.status,
    merchant: p.merchantName,
    paid: usdt(p.gross),
    discount: p.discount ? usdt(p.discount) : null,
    pointsEarned: p.pointsEarned ?? "0",
    pointsRedeemed: p.pointsRedeemed ?? "0",
    refunded: usdt(p.refunded),
    txHash: p.txHash,
    explorerUrl: p.explorerUrl,
  };
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new ToolError(`${name} must be a non-empty string`);
  return v.trim();
};

/** PayKit as MCP tools: browse shops, check out, spend points and pay with an agent wallet. */
export function payKitTools({ client, wallet, maxSpend = 25_000_000n, merchant }: PayKitToolsOptions): Tool[] {
  const requireWallet = () => {
    if (!wallet) throw new ToolError("No agent wallet. Set PAYKIT_AGENT_KEY to let this server pay.");
    return wallet;
  };

  const tools: Tool[] = [
    {
      name: "paykit_status",
      title: "PayKit status",
      description: "Network, contract version and whether payments are currently sponsored (gasless). Also shows the agent wallet and its spending cap.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true, openWorldHint: true },
      run: async () => {
        const [config, status] = await Promise.all([client.getConfig(), client.status()]);
        return {
          network: config.network,
          chainId: config.chainId,
          routerVersion: config.contracts.routerVersion ?? "2",
          loyaltyPoints: !!config.contracts.points,
          sponsorship: status,
          agentWallet: wallet ? await wallet.getAddress() : null,
          maxSpendPerPayment: usdt(maxSpend),
        };
      },
    },
    {
      name: "list_shops",
      title: "List shops",
      description: "Verified merchants that accept USDT through PayKit. Optional search text.",
      inputSchema: { type: "object", properties: { query: { type: "string", description: "Search by shop name" }, category: { type: "string" } } },
      annotations: { readOnlyHint: true, openWorldHint: true },
      run: async (a) => {
        const page = await client.merchants.list({ q: typeof a.query === "string" ? a.query : undefined, category: typeof a.category === "string" ? a.category : undefined });
        return { shops: page.data.map((m) => ({ slug: m.slug, name: m.name, category: m.category, description: m.description, verifiedDomains: m.verifiedDomains.map((d) => d.domain) })) };
      },
    },
    {
      name: "list_products",
      title: "List products",
      description: "Products a shop sells, with prices in USDT.",
      inputSchema: { type: "object", properties: { merchant: { type: "string", description: "Shop slug from list_shops" } }, required: ["merchant"] },
      annotations: { readOnlyHint: true, openWorldHint: true },
      run: async (a) => ({ products: (await client.merchants.products(str(a.merchant, "merchant"))).map((p) => ({ productId: p.id, name: p.name, description: p.description, price: usdt(p.price), active: p.active })) }),
    },
    {
      name: "loyalty_program",
      title: "Loyalty program",
      description: "How many PayKit points a shop gives per USDT, and the rewards (discounts) points can buy there. Points are universal: earned at any PayKit shop, spendable at any other.",
      inputSchema: { type: "object", properties: { merchant: { type: "string" } }, required: ["merchant"] },
      annotations: { readOnlyHint: true, openWorldHint: true },
      run: async (a) => {
        const p = await client.merchants.loyalty(str(a.merchant, "merchant"));
        return { enabled: p.enabled, pointsPerUsdt: p.pointsPerUsdt, rewards: p.rewards.map((r) => ({ rewardId: r.id, name: r.name, pointsCost: r.pointsCost, discount: usdt(r.discount) })) };
      },
    },
    {
      name: "points_balance",
      title: "Points balance",
      description: "PayKit points (PKP) held by a wallet. Defaults to the agent wallet.",
      inputSchema: { type: "object", properties: { address: { type: "string", description: "0x wallet address" } } },
      annotations: { readOnlyHint: true, openWorldHint: true },
      run: async (a) => {
        const address = (typeof a.address === "string" && a.address) || (wallet ? await wallet.getAddress() : null);
        if (!address) throw new ToolError("Pass an address, or set PAYKIT_AGENT_KEY.");
        const b = await client.merchants.points(address as Address);
        return { wallet: b.wallet, points: b.balance, source: b.source };
      },
    },
    {
      name: "create_checkout",
      title: "Create checkout",
      description: "Starts a checkout for products at one shop. Returns the exact amount due and the points it earns. Nothing is paid until pay_checkout.",
      inputSchema: {
        type: "object",
        properties: {
          merchant: { type: "string" },
          items: { type: "array", items: { type: "object", properties: { productId: { type: "string" }, quantity: { type: "integer", minimum: 1 } }, required: ["productId", "quantity"] } },
        },
        required: ["merchant", "items"],
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      run: async (a) => {
        if (!Array.isArray(a.items) || a.items.length === 0) throw new ToolError("items must list at least one product");
        const items = a.items.map((i) => ({ productId: str((i as { productId?: unknown }).productId, "productId"), quantity: Number((i as { quantity?: unknown }).quantity ?? 1) }));
        const session = await client.checkout.createSession({ merchant: str(a.merchant, "merchant"), items }, { payer: wallet ? await wallet.getAddress() : undefined });
        return summarizeSession(session);
      },
    },
    {
      name: "apply_reward",
      title: "Spend points on a reward",
      description: "Applies a loyalty reward to a checkout using the agent wallet's points (rewardId from loyalty_program), or removes it with rewardId null. Returns the new amount due.",
      inputSchema: { type: "object", properties: { sessionId: { type: "string" }, rewardId: { type: ["string", "null"] } }, required: ["sessionId"] },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      run: async (a) => {
        const payer = await requireWallet().getAddress();
        const rewardId = typeof a.rewardId === "string" && a.rewardId ? (a.rewardId as Hex) : null;
        return summarizeSession(await client.checkout.applyReward(str(a.sessionId, "sessionId"), rewardId, payer));
      },
    },
    {
      name: "pay_checkout",
      title: "Pay a checkout",
      description: "Pays a checkout from the agent wallet with one gasless USDT signature, then waits until the payment is in a block. `maxAmount` is the most you agree to pay (e.g. \"10.50\"); the payment is refused if the amount due is higher or above the server's spending cap.",
      inputSchema: { type: "object", properties: { sessionId: { type: "string" }, maxAmount: { type: "string", description: "Highest USDT amount you approve, e.g. \"12.00\"" } }, required: ["sessionId", "maxAmount"] },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      run: async (a) => {
        const signer = requireWallet();
        const session = await client.checkout.getSession(str(a.sessionId, "sessionId"));
        let approved: bigint;
        try { approved = parseUsdt(str(a.maxAmount, "maxAmount")); } catch { throw new ToolError("maxAmount must be a USDT amount like 10.50"); }
        const due = BigInt(session.quote.gross);
        if (due > approved) throw new ToolError(`Amount due ${usdt(due)} is above the approved ${usdt(approved)}. Nothing was paid.`);
        if (due > maxSpend) throw new ToolError(`Amount due ${usdt(due)} is above this server's cap of ${usdt(maxSpend)} per payment. Nothing was paid.`);
        const queued = await client.checkout.authorize(session, signer, { expectedAmount: session.quote.gross });
        const payment = await client.payments.wait(queued.paymentId, { until: "included", timeoutMs: 120_000 });
        return summarizePayment(payment);
      },
    },
    {
      name: "get_payment",
      title: "Payment status",
      description: "Status of a payment: queued, submitted, included, safe, finalized or failed.",
      inputSchema: { type: "object", properties: { paymentId: { type: "string" } }, required: ["paymentId"] },
      annotations: { readOnlyHint: true, openWorldHint: true },
      run: async (a) => summarizePayment(await client.payments.get(str(a.paymentId, "paymentId"))),
    },
  ];

  if (merchant) {
    tools.push(
      {
        name: "merchant_create_invoice",
        title: "Create invoice (merchant)",
        description: "Creates an invoice for your shop that a customer can pay by link. Amounts in USDT.",
        inputSchema: {
          type: "object",
          properties: {
            lineItems: { type: "array", items: { type: "object", properties: { name: { type: "string" }, quantity: { type: "integer", minimum: 1 }, unitAmount: { type: "string", description: "USDT, e.g. \"4.50\"" } }, required: ["name", "quantity", "unitAmount"] } },
            externalOrderId: { type: "string" },
          },
          required: ["lineItems"],
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
        run: async (a) => {
          if (!Array.isArray(a.lineItems) || !a.lineItems.length) throw new ToolError("lineItems must not be empty");
          const lineItems = a.lineItems.map((l) => {
            const item = l as { name?: unknown; quantity?: unknown; unitAmount?: unknown };
            return { name: str(item.name, "name"), quantity: Number(item.quantity ?? 1), unitAmount: parseUsdt(str(item.unitAmount, "unitAmount")).toString() };
          });
          const invoice = await merchant.invoices.create({ lineItems, externalOrderId: typeof a.externalOrderId === "string" ? a.externalOrderId : undefined });
          return { invoiceId: invoice.id, number: invoice.number, total: usdt(invoice.total), status: invoice.status, validUntil: invoice.validUntil };
        },
      },
      {
        name: "merchant_recent_payments",
        title: "Recent payments (merchant)",
        description: "Your shop's latest payments.",
        inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } } },
        annotations: { readOnlyHint: true, openWorldHint: true },
        run: async (a) => ({ payments: (await merchant.payments.list({ limit: Number(a.limit ?? 10) })).data.map(summarizePayment) }),
      },
    );
  }
  return tools;
}
