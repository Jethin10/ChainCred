#!/usr/bin/env node
// npx paykit <command>: set up PayKit in a project and talk to your merchant account.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PayKit, PayKitError, ONBOARDING_URL, DEFAULT_SERVER_URL } from "../src/index.js";
import { setup, printSetup, AGENTS } from "../src/setup.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const GUIDE = path.join(here, "..", "AGENTS.md");
const VERSION = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8")).version;

const HELP = `paykit ${VERSION}: USDT checkout on Whitechain

Usage: npx paykit <command>

Setup (one command does everything)
  init                         Install paykit, add the agent guide, install the PayKit skill/rules
                               for every coding agent it finds, register the PayKit MCP server,
                               and add PAYKIT_* placeholders to .env.example
       --agents <list|all>     ${Object.keys(AGENTS).join(",")} (default: detected)
       --no-install --no-mcp --dir <path>
  mcp                          Run the PayKit MCP server (stdio) for agents
  agents                       Print the agent integration guide (pipe it anywhere)
  signup                       Where to create a merchant account and get your API key
  doctor                       Check the server, and your key if PAYKIT_API_KEY is set

Account (needs PAYKIT_API_KEY, read from the environment or ./.env)
  whoami                       Show your merchant account
  invoice create <amount> [--reference R] [--description D]
  invoice get <id>             Show an invoice and its status
  invoice list                 Your recent invoices
  invoice wait <id>            Wait until an invoice is paid
  webhook set <url>            Set your webhook endpoint
  webhook test                 Send a signed test event to it

Options
  --json                       Machine-readable output
  --server <url>               Default ${DEFAULT_SERVER_URL}
`;

// ── tiny arg parser ──
const argv = process.argv.slice(2);
const BOOLEAN = new Set(["json", "no-install", "no-mcp", "help"]);
const flags = {};
const args = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const [k, v] = a.slice(2).split("=");
    if (v !== undefined) flags[k] = v;
    else if (!BOOLEAN.has(k) && argv[i + 1] && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
    else flags[k] = true;
  } else args.push(a);
}

// ── .env loading (no override of real env) ──
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
loadEnv(path.resolve(".env.local"));
loadEnv(path.resolve(".env"));

const json = !!flags.json;
const out = (human, data) => console.log(json ? JSON.stringify(data, null, 2) : human);
const client = () => new PayKit({ serverUrl: typeof flags.server === "string" ? flags.server : undefined });

// ── commands ──
async function main() {
  const [cmd, sub, ...rest] = args;
  switch (cmd) {
    case undefined:
    case "help":
    case "-h":
      return console.log(HELP);
    case "version":
      return console.log(VERSION);
    case "agents":
      return process.stdout.write(fs.readFileSync(GUIDE, "utf8"));
    case "init":
    case "setup":
    case "add": {
      const agents = typeof flags.agents === "string" ? (flags.agents === "all" ? "all" : flags.agents.split(",").map((a) => a.trim().toLowerCase())) : undefined;
      const r = setup({ dir: typeof flags.dir === "string" ? flags.dir : ".", agents, install: !flags["no-install"], mcp: !flags["no-mcp"], quiet: json });
      return json ? out("", r) : printSetup(r);
    }
    case "mcp": {
      const { startMcpServer } = await import("../src/mcp.js");
      return startMcpServer();
    }
    case "signup":
      return out(`Create a merchant account (2 minutes, one MetaMask signature):\n  ${ONBOARDING_URL}\nYou get PAYKIT_API_KEY (pk_test_...) and PAYKIT_WEBHOOK_SECRET (whsec_...).`, { url: ONBOARDING_URL });
    case "doctor": {
      const pk = client();
      const checks = [];
      try {
        const h = await pk.health();
        checks.push([true, `Server ${pk.serverUrl} is up (chain ${h.chainId}, points ${h.pointsEnabled ? "on" : "off"})`]);
      } catch (e) {
        checks.push([false, `Server ${pk.serverUrl}: ${e.message}`]);
      }
      if (!pk.apiKey) checks.push([null, `PAYKIT_API_KEY not set. Get one at ${ONBOARDING_URL}`]);
      else {
        try {
          const m = await pk.merchant.get();
          checks.push([true, `API key works: ${m.name} (payout ${m.payoutAddress})`]);
          checks.push([m.webhookUrl ? true : null, m.webhookUrl ? `Webhook: ${m.webhookUrl}` : "No webhook URL set (npx paykit webhook set <url>)"]);
        } catch (e) {
          checks.push([false, `API key: ${e.message}`]);
        }
      }
      if (!process.env.PAYKIT_WEBHOOK_SECRET) checks.push([null, "PAYKIT_WEBHOOK_SECRET not set (needed to verify webhooks)"]);
      out(checks.map(([ok, msg]) => `${ok === true ? "✓" : ok === false ? "✗" : "!"} ${msg}`).join("\n"), checks.map(([ok, message]) => ({ ok, message })));
      if (checks.some(([ok]) => ok === false)) process.exitCode = 1;
      return;
    }
    case "whoami": {
      const m = await client().merchant.get();
      return out(`${m.name}\n  id      ${m.id}\n  payout  ${m.payoutAddress}\n  webhook ${m.webhookUrl || "(not set)"}`, m);
    }
    case "invoice": {
      const pk = client();
      if (sub === "create") {
        const amount = rest[0] ?? flags.amount;
        if (!amount) throw new PayKitError("Usage: paykit invoice create <amount> [--reference R] [--description D]");
        const inv = await pk.invoices.create({ amount, reference: flags.reference, description: flags.description });
        return out(`Invoice ${inv.id}: ${inv.amount} USDT, ${inv.status}\n  pay page  ${inv.payUrl}\n  in-page   openCheckout({ invoiceId: "${inv.id}" })`, inv);
      }
      if (sub === "get") {
        if (!rest[0]) throw new PayKitError("Usage: paykit invoice get <id>");
        const inv = await pk.invoices.get(rest[0]);
        return out(`Invoice ${inv.id}: ${inv.status}\n  amount ${inv.amount} USDT, paid ${inv.amountPaid}, due ${inv.amountDue}\n  ${inv.payUrl}`, inv);
      }
      if (sub === "list") {
        const list = await pk.invoices.list();
        return out(list.length ? list.slice(0, 20).map((i) => `${i.id}  ${i.status.padEnd(14)} ${i.amount.padStart(10)} USDT  ${i.reference || ""}`).join("\n") : "No invoices yet.", list);
      }
      if (sub === "wait") {
        if (!rest[0]) throw new PayKitError("Usage: paykit invoice wait <id>");
        if (!json) console.log(`Waiting for ${rest[0]} to be paid…`);
        const inv = await pk.invoices.waitForPaid(rest[0], { timeoutMs: Number(flags.timeout || 600) * 1000 });
        return out(`Paid: ${inv.amountPaid} USDT`, inv);
      }
      throw new PayKitError("Usage: paykit invoice <create|get|list|wait>");
    }
    case "webhook": {
      const pk = client();
      if (sub === "set") {
        if (!rest[0]) throw new PayKitError("Usage: paykit webhook set <url>");
        const m = await pk.merchant.update({ webhookUrl: rest[0] });
        return out(`Webhook set: ${m.webhookUrl}`, m);
      }
      if (sub === "test") {
        const r = await pk.webhooks.test();
        return out(`Test event queued${r?.id ? ` (${r.id})` : ""}. Check your endpoint logs.`, r);
      }
      throw new PayKitError("Usage: paykit webhook <set|test>");
    }
    default:
      throw new PayKitError(`Unknown command "${cmd}". Run: npx paykit help`);
  }
}

main().catch((e) => {
  console.error(json ? JSON.stringify({ error: { message: e.message, code: e.code, status: e.status } }) : `✗ ${e.message}`);
  process.exitCode = 1;
});
