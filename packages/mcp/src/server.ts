import { createPayKitClient, fromLocalAccount, parseUsdt, type PayKitClient } from "@paykit/js";
import { PayKit } from "@paykit/node";
import { privateKeyToAccount } from "viem/accounts";
import { createMcpServer } from "./protocol.ts";
import { payKitTools } from "./tools.ts";

export interface PayKitMcpOptions {
  /** PayKit API base URL. */
  apiUrl: string;
  publishableKey?: string;
  /** Agent wallet private key. Without it the server cannot pay. Use a dedicated low-balance wallet. */
  agentKey?: `0x${string}`;
  /** Max USDT per payment, as a decimal string. Default "25". */
  maxSpendUsdt?: string;
  /** Merchant secret key (sk_…). Enables merchant tools. */
  secretKey?: string;
  /** For tests: a ready client (e.g. the in-memory mock). */
  client?: PayKitClient;
  fetch?: typeof fetch;
}

const INSTRUCTIONS = `PayKit lets you buy from verified shops in USDT on Whitechain without gas.
Flow: list_shops → list_products → create_checkout → (optional) loyalty_program + apply_reward → pay_checkout with maxAmount set to the amount the user approved.
Never call pay_checkout without the user's approval of the exact amount. Payments are final once included; refunds come from the shop.`;

export async function createPayKitMcpServer(options: PayKitMcpOptions) {
  const client = options.client ?? createPayKitClient({ baseUrl: options.apiUrl, publishableKey: options.publishableKey, fetch: options.fetch });
  const config = await client.getConfig().catch(() => null);
  const chainId = config?.chainId ?? 1874;
  const wallet = options.agentKey ? fromLocalAccount(privateKeyToAccount(options.agentKey), chainId) : undefined;
  const merchant = options.secretKey ? new PayKit({ secretKey: options.secretKey, baseUrl: options.apiUrl, fetch: options.fetch }) : undefined;
  const tools = payKitTools({ client, wallet, merchant, maxSpend: parseUsdt(options.maxSpendUsdt ?? "25") });
  return createMcpServer({ name: "paykit", version: "0.1.0", instructions: INSTRUCTIONS }, tools);
}
