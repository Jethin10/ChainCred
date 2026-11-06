# @paykit/mcp

PayKit as a [Model Context Protocol](https://modelcontextprotocol.io) server. An AI agent can browse
verified shops, start a checkout, spend universal loyalty points on a reward, and pay in USDT on
Whitechain with one gasless signature from its own wallet.

No dependencies beyond the PayKit SDK: JSON-RPC 2.0 over stdio, protocol versions 2025-06-18,
2025-03-26 and 2024-11-05.

## Run

```sh
npm run server:demo                  # PayKit API on :8787 (simulated chain)
npm run mcp                          # read-only: browse, quote, check points
PAYKIT_AGENT_KEY=0x… npm run mcp     # can pay, up to PAYKIT_MAX_SPEND_USDT per payment
```

| Variable | Default | Purpose |
|---|---|---|
| `PAYKIT_API_URL` | `http://127.0.0.1:8787` | PayKit API |
| `PAYKIT_PK` | none | Publishable key, if the API requires one |
| `PAYKIT_AGENT_KEY` | none | Agent wallet private key. Without it the server cannot pay. Use a dedicated low-balance wallet. |
| `PAYKIT_MAX_SPEND_USDT` | `25` | Hard cap per payment |
| `PAYKIT_SECRET_KEY` | none | Merchant secret key (`sk_…`). Adds `merchant_create_invoice` and `merchant_recent_payments`. |

### Claude Code / Claude Desktop

```json
{
  "mcpServers": {
    "paykit": {
      "command": "node",
      "args": ["--conditions=source", "C:/EthGlobal_Mumbai/packages/mcp/src/main.ts"],
      "env": { "PAYKIT_API_URL": "http://127.0.0.1:8787", "PAYKIT_MAX_SPEND_USDT": "10" }
    }
  }
}
```

After `npm run sdk:build` you can use `"command": "paykit-mcp"` (the package bin) instead.

## Tools

| Tool | Moves money | What it does |
|---|---|---|
| `paykit_status` | no | Network, router version, points, sponsorship, agent wallet and cap |
| `list_shops` | no | Verified merchants |
| `list_products` | no | A shop's products and prices |
| `loyalty_program` | no | Points per USDT and rewards at a shop |
| `points_balance` | no | PKP balance of any wallet (default: the agent's) |
| `create_checkout` | no | A quote: exact amount due, points it earns |
| `apply_reward` | no | Spend points on a reward; returns the new amount due |
| `pay_checkout` | **yes** | Pays from the agent wallet and waits for inclusion |
| `get_payment` | no | Payment status |

`pay_checkout` requires `maxAmount`, the amount the user approved. It refuses when the amount due
is higher, or above `PAYKIT_MAX_SPEND_USDT`, and in both cases nothing is signed. The client
verifies every quote (hash, merchant signature, router, token, amount and any points burned)
before the wallet signs, exactly as in the browser SDK.

## Tests

`npm test -w @paykit/mcp` covers the protocol, every tool against the in-memory API, the spend
guards, read-only mode, and the real stdio binary talking to a real HTTP API.
