# usepaykit

Accept USDT on Whitechain on your own checkout page. The customer pays in MetaMask with one gasless signature, and PayKit pays the gas. Customers earn loyalty points they can spend at any PayKit shop. The package has no dependencies.

## One command

```sh
npx usepaykit@latest init
```

This does the whole setup:

- Installs `usepaykit` with your package manager.
- Finds the coding agents you use: Claude Code, Cursor, VS Code/Copilot, Codex, Windsurf, Gemini CLI.
- Installs a PayKit skill or rule for each one.
- Registers the PayKit MCP server, so your agent can create test invoices and check payments.
- Adds `PAYKIT_*` placeholders to `.env.example`.

Then ask your agent: **"Add PayKit checkout to this app."**

Only want the MCP server in your editor? Install it in one click:

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=paykit&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInVzZXBheWtpdEBsYXRlc3QiLCJtY3AiXX0=)
[![Add to VS Code](https://img.shields.io/badge/VS_Code-Add_PayKit_MCP-0098FF?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=paykit&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22usepaykit%40latest%22%2C%22mcp%22%5D%7D)

From a terminal:

```sh
claude mcp add paykit -- npx -y usepaykit@latest mcp    # Claude Code
codex mcp add paykit -- npx -y usepaykit@latest mcp     # Codex
```

> Testnet: Whitechain Testnet (chain 1874), test USDT. Get your keys at https://paykit-app.vercel.app/#merchant (2 minutes, one signature).

## Using a coding agent?

Give it the guide. Use whichever is easiest:

- Run `npx usepaykit@latest init` (above). It covers everything.
- Run `npx usepaykit agents > PAYKIT.md`, or paste the output into your chat.
- Drag [`AGENTS.md`](./AGENTS.md) into the agent's chat, or link the raw file: `https://raw.githubusercontent.com/Jethin10/PayKit/main/packages/paykit/AGENTS.md`.

## 1. Server: create an invoice

```js
import { PayKit } from "usepaykit";
const paykit = new PayKit(); // PAYKIT_API_KEY from env

const invoice = await paykit.invoices.create({ amount: "12.50", reference: order.id });
return { invoiceId: invoice.id };
```

## 2. Browser: pay in place

```js
import { openCheckout } from "usepaykit/checkout";

const result = await openCheckout({ invoiceId });
if (result.status === "paid") showThankYou(result.paymentId);
```

Without a bundler, import it as a module script:

```html
<script type="module">
  import { openCheckout } from "https://esm.sh/usepaykit/checkout";
</script>
```

## 3. Server: fulfil from the webhook

```js
import { verifyWebhook } from "usepaykit";

const event = await verifyWebhook(rawBody, req.headers["paykit-signature"], process.env.PAYKIT_WEBHOOK_SECRET);
if (event.type === "invoice.paid") await markPaid(event.data.invoice.reference);
```

## API

| | |
|---|---|
| `paykit.invoices` | `create`, `get`, `list`, `getPublic`, `waitForPaid` |
| `paykit.payments` | `list`, `get`, `receipt` |
| `paykit.refunds` | `create`, `authorize` |
| `paykit.plans` / `paykit.subscriptions` | subscriptions and installments |
| `paykit.points` | `createCampaign`, `createReward`, `summary`, `customer` |
| `paykit.merchant` | `get`, `update({ webhookUrl, profile })` |
| `paykit.webhooks` | `test`, `events`, `redeliver`, `verify` |
| `verifyWebhook`, `signWebhook` | HMAC-SHA256 over `${t}.${rawBody}`, 5-minute tolerance |

Every error is a `PayKitError` with `status`, `code` and `message`. The package includes full TypeScript types.

## CLI

```
npx usepaykit init [--agents all]      set up a project for PayKit and its coding agents
npx usepaykit mcp                      run the PayKit MCP server (stdio)
npx usepaykit agents                   print the agent guide
npx usepaykit doctor                   check the server and your key
npx usepaykit whoami
npx usepaykit invoice create 5 --reference ORDER-1
npx usepaykit invoice get <id> | list | wait <id>
npx usepaykit webhook set <url> | test
```

The CLI reads `PAYKIT_API_KEY` from the environment, `.env` or `.env.local`. Add `--json` for machine-readable output.

MIT
