import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PayKit, PayKitError, verifyWebhook, signWebhook } from "../src/index.js";
import { setup } from "../src/setup.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const { status = 200, body } = await handler(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  f.calls = calls;
  return f;
}

test("invoices.create sends the key and a string amount", async () => {
  const fetch = fakeFetch(() => ({ status: 201, body: { id: "inv_1", payUrl: "https://x/pay/inv_1", status: "open" } }));
  const pk = new PayKit({ apiKey: "pk_test_abc", serverUrl: "https://srv.test/", fetch });
  const inv = await pk.invoices.create({ amount: 12.5, reference: "O-1" });
  assert.equal(inv.id, "inv_1");
  const { url, init } = fetch.calls[0];
  assert.equal(url, "https://srv.test/v1/invoices");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.authorization, "Bearer pk_test_abc");
  assert.deepEqual(JSON.parse(init.body), { amount: "12.5", reference: "O-1" });
});

test("server errors become PayKitError with status and code", async () => {
  const fetch = fakeFetch(() => ({ status: 401, body: { error: { code: "unauthorized", message: "Valid merchant API key required" } } }));
  const pk = new PayKit({ apiKey: "pk_test_bad", fetch });
  await assert.rejects(pk.merchant.get(), (e) => e instanceof PayKitError && e.status === 401 && e.code === "unauthorized");
});

test("missing key fails before any request; public calls need none", async () => {
  const fetch = fakeFetch(() => ({ body: { id: "inv_2", status: "paid" } }));
  const pk = new PayKit({ apiKey: "", fetch });
  pk.apiKey = undefined;
  await assert.rejects(pk.invoices.list(), (e) => e.code === "missing_api_key");
  assert.equal(fetch.calls.length, 0);
  const inv = await pk.invoices.getPublic("inv_2");
  assert.equal(inv.status, "paid");
  assert.equal(fetch.calls[0].init.headers.authorization, undefined);
});

test("webhook signatures round-trip and reject tampering and stale timestamps", async () => {
  const body = JSON.stringify({ id: "evt_1", type: "invoice.paid", createdAt: "x", data: { invoice: { id: "inv_1" } } });
  const header = await signWebhook(body, "whsec_test");
  const evt = await verifyWebhook(body, header, "whsec_test");
  assert.equal(evt.type, "invoice.paid");
  await assert.rejects(verifyWebhook(body.replace("inv_1", "inv_9"), header, "whsec_test"), (e) => e.code === "bad_signature");
  await assert.rejects(verifyWebhook(body, header, "whsec_other"), (e) => e.code === "bad_signature");
  const old = await signWebhook(body, "whsec_test", Math.floor(Date.now() / 1000) - 3600);
  await assert.rejects(verifyWebhook(body, old, "whsec_test"), (e) => e.code === "stale_signature");
  await assert.rejects(verifyWebhook(body, undefined, "whsec_test"), (e) => e.code === "bad_signature");
});

test("webhook signature matches the server's Node HMAC", async () => {
  const { createHmac } = await import("node:crypto");
  const t = Math.floor(Date.now() / 1000);
  const body = '{"id":"evt_2"}';
  const v1 = createHmac("sha256", "whsec_x").update(`${t}.${body}`).digest("hex");
  assert.equal((await verifyWebhook(body, `t=${t},v1=${v1}`, "whsec_x")).id, "evt_2");
});

test("setup installs guide, skills, rules and MCP config for detected agents, idempotently", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paykit-setup-"));
  fs.mkdirSync(path.join(dir, ".cursor"));
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# Mine\n\nKeep this.\n");
  fs.writeFileSync(path.join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
  const r = setup({ dir, install: false, quiet: true });
  assert.deepEqual(r.agents.sort(), ["claude", "codex", "cursor"]);
  for (const f of ["PAYKIT.md", "AGENTS.md", ".agents/skills/paykit/SKILL.md", ".claude/skills/paykit/SKILL.md", ".cursor/rules/paykit.mdc", ".cursor/mcp.json", ".env.example"]) {
    assert.ok(fs.existsSync(path.join(dir, f)), f);
  }
  const claude = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
  assert.ok(claude.startsWith("# Mine\n\nKeep this.") && claude.includes("PAYKIT.md"));
  const mcp = JSON.parse(fs.readFileSync(path.join(dir, ".mcp.json"), "utf8"));
  assert.equal(mcp.mcpServers.other.command, "x");
  assert.deepEqual(mcp.mcpServers.paykit.args, ["-y", "usepaykit@latest", "mcp"]);
  assert.match(fs.readFileSync(path.join(dir, ".claude/skills/paykit/SKILL.md"), "utf8"), /^---\nname: paykit\ndescription: .+\n---\n/);
  const env = fs.readFileSync(path.join(dir, ".env.example"), "utf8");
  assert.match(env, /^PAYKIT_API_KEY=$/m);
  assert.doesNotMatch(env, /pk_test_\w/);
  // second run changes nothing
  const again = setup({ dir, install: false, quiet: true });
  assert.ok(again.files.every(([, s]) => s === "unchanged"), JSON.stringify(again.files));
  assert.equal(fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8").match(/PAYKIT\.md/g).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("setup --agents all writes VS Code and Gemini configs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paykit-setup-"));
  setup({ dir, agents: "all", install: false, quiet: true });
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, ".vscode/mcp.json"), "utf8")).servers.paykit);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, ".gemini/settings.json"), "utf8")).mcpServers.paykit);
  assert.ok(fs.existsSync(path.join(dir, ".github/instructions/paykit.instructions.md")));
  assert.ok(fs.existsSync(path.join(dir, ".windsurf/rules/paykit.md")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("MCP server answers initialize, tools/list and the guide tool over stdio", async () => {
  const child = spawn(process.execPath, [path.join(root, "bin/paykit.mjs"), "mcp"], { stdio: ["pipe", "pipe", "inherit"], cwd: os.tmpdir() });
  const replies = new Map();
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); replies.set(m.id, m); }
  });
  const ask = (id, method, params) => { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); };
  ask(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  ask(2, "tools/list", {});
  ask(3, "tools/call", { name: "paykit_guide", arguments: {} });
  for (let t = 0; t < 100 && replies.size < 3; t++) await new Promise((r) => setTimeout(r, 30));
  child.kill();
  assert.equal(replies.get(1).result.serverInfo.name, "paykit");
  assert.ok(replies.get(2).result.tools.some((t) => t.name === "paykit_create_invoice"));
  assert.match(replies.get(3).result.content[0].text, /PayKit: instructions for coding agents/);
});
