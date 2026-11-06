// `npx paykit init`: one command that sets a project up for PayKit and for whichever coding agents
// it uses. It installs the package, adds the guide (PAYKIT.md + AGENTS.md pointer), installs a
// PayKit skill/rule per agent, registers the PayKit MCP server, and adds env placeholders.
// Never writes secrets: the MCP server reads PAYKIT_API_KEY from the project's .env at runtime.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ONBOARDING_URL, DEFAULT_SERVER_URL } from "./index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const guide = () => fs.readFileSync(path.join(here, "..", "AGENTS.md"), "utf8");

export const MCP_COMMAND = { command: "npx", args: ["-y", "paykit@latest", "mcp"] };
const SKILL_DESCRIPTION =
  "Add PayKit payments (USDT on Whitechain, paid in MetaMask) to this app: server-created invoices, in-page checkout, signed webhooks, loyalty points, subscriptions and refunds. Use when building or changing checkout, payments, invoices or PayKit webhooks.";
const POINTER =
  "## Payments (PayKit)\n\nThis project takes payments with PayKit (`paykit` on npm). Before touching checkout, payments or webhooks, read `PAYKIT.md` and follow it. The `paykit` MCP server (if available) can create test invoices and check payments.\n";

export const AGENTS = {
  claude: { label: "Claude Code", detect: [".claude", "CLAUDE.md", ".mcp.json"] },
  cursor: { label: "Cursor", detect: [".cursor", ".cursorrules"] },
  vscode: { label: "VS Code / GitHub Copilot", detect: [".vscode", ".github/copilot-instructions.md"] },
  codex: { label: "Codex", detect: [".codex", ".agents"] },
  windsurf: { label: "Windsurf", detect: [".windsurf", ".windsurfrules"] },
  gemini: { label: "Gemini CLI", detect: [".gemini", "GEMINI.md"] },
};

export function detectAgents(dir) {
  const found = Object.entries(AGENTS).filter(([, a]) => a.detect.some((p) => fs.existsSync(path.join(dir, p)))).map(([k]) => k);
  // Claude Code and Codex read plain files (CLAUDE.md / AGENTS.md / .mcp.json), so they are always set up.
  return [...new Set(["claude", "codex", ...found])];
}

function write(dir, rel, content, log) {
  const file = path.join(dir, rel);
  const existed = fs.existsSync(file);
  if (existed && fs.readFileSync(file, "utf8") === content) return log.push([rel, "unchanged"]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  log.push([rel, existed ? "updated" : "created"]);
}

function pointer(dir, rel, create, log) {
  const file = path.join(dir, rel);
  if (!fs.existsSync(file)) {
    if (create) write(dir, rel, `# Agent instructions\n\n${POINTER}`, log);
    return;
  }
  const s = fs.readFileSync(file, "utf8");
  if (s.includes("PAYKIT.md")) return log.push([rel, "unchanged"]);
  fs.writeFileSync(file, `${s.replace(/\s*$/, "")}\n\n${POINTER}`);
  log.push([rel, "updated"]);
}

function mergeJson(dir, rel, key, server, log) {
  const file = path.join(dir, rel);
  let cfg = {};
  if (fs.existsSync(file)) {
    try { cfg = JSON.parse(fs.readFileSync(file, "utf8") || "{}"); } catch { return log.push([rel, `skipped: not plain JSON, add "paykit" under "${key}" by hand`]); }
  }
  if (JSON.stringify(cfg?.[key]?.paykit) === JSON.stringify(server)) return log.push([rel, "unchanged"]);
  cfg[key] = { ...(cfg[key] || {}), paykit: server };
  write(dir, rel, JSON.stringify(cfg, null, 2) + "\n", log);
}

const skill = () => `---\nname: paykit\ndescription: ${SKILL_DESCRIPTION}\n---\n\n${guide()}`;

function packageManager(dir) {
  if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) return ["pnpm", ["add", "paykit"]];
  if (fs.existsSync(path.join(dir, "yarn.lock"))) return ["yarn", ["add", "paykit"]];
  if (fs.existsSync(path.join(dir, "bun.lockb")) || fs.existsSync(path.join(dir, "bun.lock"))) return ["bun", ["add", "paykit"]];
  return ["npm", ["install", "paykit"]];
}

/**
 * @param {{ dir?: string, agents?: string[] | "all", install?: boolean, mcp?: boolean, quiet?: boolean }} opts
 */
export function setup(opts = {}) {
  const dir = path.resolve(opts.dir || ".");
  if (!fs.existsSync(dir)) throw new Error(`No such folder: ${dir}`);
  const agents = opts.agents === "all" ? Object.keys(AGENTS) : opts.agents?.length ? opts.agents : detectAgents(dir);
  const unknown = agents.filter((a) => !AGENTS[a]);
  if (unknown.length) throw new Error(`Unknown agent "${unknown.join(", ")}". Use: ${Object.keys(AGENTS).join(", ")}, all`);
  const mcp = opts.mcp !== false;
  const log = [];
  const notes = [];

  // 1. the package
  const pkgFile = path.join(dir, "package.json");
  let installed = "no package.json";
  if (fs.existsSync(pkgFile)) {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
    if (pkg.dependencies?.paykit || pkg.devDependencies?.paykit || pkg.name === "paykit") installed = "already a dependency";
    else if (opts.install === false) installed = "skipped (--no-install)";
    else {
      const [cmd, args] = packageManager(dir);
      if (!opts.quiet) console.log(`Installing paykit with ${cmd}…`);
      const r = spawnSync(cmd, args, { cwd: dir, stdio: opts.quiet ? "ignore" : "inherit", shell: process.platform === "win32" });
      installed = r.status === 0 ? `installed with ${cmd}` : `failed, run: ${cmd} ${args.join(" ")}`;
    }
  }

  // 2. the guide, everywhere agents look
  write(dir, "PAYKIT.md", guide(), log);
  pointer(dir, "AGENTS.md", true, log);
  write(dir, ".agents/skills/paykit/SKILL.md", skill(), log);

  // 3. per agent
  for (const a of agents) {
    if (a === "claude") {
      pointer(dir, "CLAUDE.md", false, log);
      write(dir, ".claude/skills/paykit/SKILL.md", skill(), log);
      if (mcp) mergeJson(dir, ".mcp.json", "mcpServers", MCP_COMMAND, log);
    }
    if (a === "cursor") {
      write(dir, ".cursor/rules/paykit.mdc", `---\ndescription: ${SKILL_DESCRIPTION}\nalwaysApply: false\n---\n\n${guide()}`, log);
      if (mcp) mergeJson(dir, ".cursor/mcp.json", "mcpServers", MCP_COMMAND, log);
    }
    if (a === "vscode") {
      write(dir, ".github/instructions/paykit.instructions.md", `---\napplyTo: "**"\ndescription: ${SKILL_DESCRIPTION}\n---\n\n${guide()}`, log);
      if (mcp) mergeJson(dir, ".vscode/mcp.json", "servers", { type: "stdio", ...MCP_COMMAND }, log);
    }
    if (a === "codex" && mcp) notes.push(`Codex MCP (global, once):  codex mcp add paykit -- ${MCP_COMMAND.command} ${MCP_COMMAND.args.join(" ")}`);
    if (a === "windsurf") {
      write(dir, ".windsurf/rules/paykit.md", `---\ntrigger: model_decision\ndescription: ${SKILL_DESCRIPTION}\n---\n\n${guide()}`, log);
      if (mcp) notes.push(`Windsurf MCP: add "paykit": ${JSON.stringify(MCP_COMMAND)} to ~/.codeium/windsurf/mcp_config.json`);
    }
    if (a === "gemini") {
      pointer(dir, "GEMINI.md", true, log);
      if (mcp) mergeJson(dir, ".gemini/settings.json", "mcpServers", MCP_COMMAND, log);
    }
  }

  // 4. env placeholders (never values)
  const envEx = path.join(dir, ".env.example");
  const cur = fs.existsSync(envEx) ? fs.readFileSync(envEx, "utf8") : "";
  const add = ["PAYKIT_API_KEY=", "PAYKIT_WEBHOOK_SECRET=", `# PAYKIT_SERVER_URL=${DEFAULT_SERVER_URL}`].filter((l) => !cur.includes(l.replace(/^# /, "").split("=")[0]));
  if (add.length) {
    fs.writeFileSync(envEx, `${cur.replace(/\s*$/, "")}${cur ? "\n\n" : ""}# PayKit (server only, never expose to the browser)\n${add.join("\n")}\n`);
    log.push([".env.example", cur ? "updated" : "created"]);
  }
  const gi = path.join(dir, ".gitignore");
  if (fs.existsSync(path.join(dir, ".git")) && !(fs.existsSync(gi) && /^\.env\b/m.test(fs.readFileSync(gi, "utf8")))) {
    notes.push("Add .env to .gitignore before you put your PayKit keys in it.");
  }
  const hasKey = !!process.env.PAYKIT_API_KEY || [".env", ".env.local"].some((f) => fs.existsSync(path.join(dir, f)) && /^PAYKIT_API_KEY=\S+/m.test(fs.readFileSync(path.join(dir, f), "utf8")));
  return { dir, agents, installed, files: log, notes, hasKey };
}

export function printSetup(r) {
  const lines = [`\n✓ PayKit is set up in ${r.dir}\n`, `  package   ${r.installed}`, `  agents    ${r.agents.map((a) => AGENTS[a].label).join(", ")}\n`];
  for (const [f, s] of r.files) lines.push(`  ${s === "unchanged" ? "·" : "+"} ${f.padEnd(44)} ${s}`);
  if (r.notes.length) lines.push("", ...r.notes.map((n) => `  ! ${n}`));
  lines.push(
    "",
    "Next:",
    r.hasKey ? "  1. Keys found." : `  1. Get your keys (2 min, one MetaMask signature): ${ONBOARDING_URL}\n     Put PAYKIT_API_KEY and PAYKIT_WEBHOOK_SECRET in .env`,
    '  2. Restart your agent, then ask it: "Add PayKit checkout to this app."',
    "  3. Check anytime: npx paykit doctor\n"
  );
  console.log(lines.join("\n"));
}
