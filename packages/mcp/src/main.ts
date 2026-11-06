/**
 * PayKit MCP server over stdio.
 *
 *   PAYKIT_API_URL=http://127.0.0.1:8787 PAYKIT_AGENT_KEY=0x… npx paykit-mcp
 *
 * Env: PAYKIT_API_URL (default http://127.0.0.1:8787), PAYKIT_PK, PAYKIT_AGENT_KEY (agent wallet;
 * omit for read-only), PAYKIT_MAX_SPEND_USDT (default 25), PAYKIT_SECRET_KEY (merchant tools).
 * stdout carries protocol messages only; diagnostics go to stderr.
 */
import { createPayKitMcpServer } from "./server.ts";

const env = process.env;
const agentKey = env.PAYKIT_AGENT_KEY?.trim();
if (agentKey && !/^0x[0-9a-fA-F]{64}$/.test(agentKey)) {
  console.error("PAYKIT_AGENT_KEY must be a 0x-prefixed 32-byte private key.");
  process.exit(2);
}
const server = await createPayKitMcpServer({
  apiUrl: env.PAYKIT_API_URL ?? "http://127.0.0.1:8787",
  publishableKey: env.PAYKIT_PK || undefined,
  agentKey: agentKey as `0x${string}` | undefined,
  maxSpendUsdt: env.PAYKIT_MAX_SPEND_USDT,
  secretKey: env.PAYKIT_SECRET_KEY || undefined,
});
server.serveStdio();
console.error(`[paykit-mcp] ready: ${server.tools.length} tools${agentKey ? ", agent wallet set" : ", read-only (no PAYKIT_AGENT_KEY)"}`);
