// `npx paykit mcp`: a Model Context Protocol server (stdio, no dependencies) so coding agents can
// read the PayKit guide and use your merchant account: create test invoices, check payments,
// set the webhook. Reads PAYKIT_API_KEY from the environment or the project's .env / .env.local.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PayKit, ONBOARDING_URL } from "./index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const GUIDE = () => fs.readFileSync(path.join(here, "..", "AGENTS.md"), "utf8");
const VERSION = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8")).version;

const str = (description) => ({ type: "string", description });
const TOOLS = [
  { name: "paykit_guide", description: "The PayKit integration guide for coding agents: install, server invoice, in-page checkout, webhooks, checklist. Read this before writing payment code.", inputSchema: { type: "object", properties: {} } },
  { name: "paykit_doctor", description: "Check that the PayKit server is up and the merchant API key (PAYKIT_API_KEY) works.", inputSchema: { type: "object", properties: {} } },
  { name: "paykit_get_merchant", description: "Show the merchant account for PAYKIT_API_KEY: name, payout wallet, webhook URL.", inputSchema: { type: "object", properties: {} } },
  {
    name: "paykit_create_invoice",
    description: "Create a USDT invoice (testnet). Returns id and payUrl. Use it to test checkout; in app code, create invoices on the server with the paykit package instead.",
    inputSchema: { type: "object", properties: { amount: str('USDT decimal string, e.g. "5.00" (minimum about 1.67)'), reference: str("Your order id"), description: str("Shown to the customer") }, required: ["amount"] },
  },
  { name: "paykit_get_invoice", description: "Get an invoice and its payment status.", inputSchema: { type: "object", properties: { id: str("Invoice id (inv_...)") }, required: ["id"] } },
  { name: "paykit_list_invoices", description: "List the merchant's recent invoices.", inputSchema: { type: "object", properties: {} } },
  { name: "paykit_list_payments", description: "List the merchant's settled payments.", inputSchema: { type: "object", properties: {} } },
  { name: "paykit_set_webhook", description: "Set the merchant webhook URL that receives signed events (invoice.paid, payment.settled, ...).", inputSchema: { type: "object", properties: { url: str("https URL of your webhook route") }, required: ["url"] } },
  { name: "paykit_send_test_webhook", description: "Send a signed test.ping event to the configured webhook URL.", inputSchema: { type: "object", properties: {} } },
];

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

async function call(name, a = {}) {
  const pk = new PayKit();
  switch (name) {
    case "paykit_guide": return GUIDE();
    case "paykit_doctor": {
      const lines = [];
      try { const h = await pk.health(); lines.push(`✓ Server ${pk.serverUrl} up (chain ${h.chainId})`); } catch (e) { lines.push(`✗ Server: ${e.message}`); }
      if (!pk.apiKey) lines.push(`! PAYKIT_API_KEY not set. The human gets it at ${ONBOARDING_URL} and puts it in .env`);
      else try { const m = await pk.merchant.get(); lines.push(`✓ Key works: ${m.name}`, m.webhookUrl ? `✓ Webhook ${m.webhookUrl}` : "! No webhook URL set"); } catch (e) { lines.push(`✗ Key: ${e.message}`); }
      if (!process.env.PAYKIT_WEBHOOK_SECRET) lines.push("! PAYKIT_WEBHOOK_SECRET not set");
      return lines.join("\n");
    }
    case "paykit_get_merchant": return pk.merchant.get();
    case "paykit_create_invoice": return pk.invoices.create({ amount: a.amount, reference: a.reference, description: a.description });
    case "paykit_get_invoice": return pk.invoices.get(a.id);
    case "paykit_list_invoices": return (await pk.invoices.list()).slice(0, 25);
    case "paykit_list_payments": return (await pk.payments.list()).slice(0, 25);
    case "paykit_set_webhook": return pk.merchant.update({ webhookUrl: a.url });
    case "paykit_send_test_webhook": return pk.webhooks.test();
    default: throw new Error(`Unknown tool ${name}`);
  }
}

export function startMcpServer({ input = process.stdin, output = process.stdout } = {}) {
  loadEnv(path.resolve(".env.local"));
  loadEnv(path.resolve(".env"));
  const send = (msg) => output.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
  const handle = async (msg) => {
    const { id, method, params } = msg;
    if (id === undefined) return; // notifications
    try {
      if (method === "initialize") {
        return send({ id, result: { protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "paykit", version: VERSION }, instructions: "PayKit payments (USDT on Whitechain). Call paykit_guide before writing checkout, payment or webhook code." } });
      }
      if (method === "ping") return send({ id, result: {} });
      if (method === "tools/list") return send({ id, result: { tools: TOOLS } });
      if (method === "tools/call") {
        try {
          const r = await call(params?.name, params?.arguments);
          return send({ id, result: { content: [{ type: "text", text: typeof r === "string" ? r : JSON.stringify(r, null, 2) }] } });
        } catch (e) {
          return send({ id, result: { isError: true, content: [{ type: "text", text: e.message }] } });
        }
      }
      send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
    } catch (e) {
      send({ id, error: { code: -32603, message: e.message } });
    }
  };
  let buf = "";
  input.setEncoding("utf8");
  input.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { send({ id: null, error: { code: -32700, message: "Parse error" } }); continue; }
      void handle(msg);
    }
  });
}
