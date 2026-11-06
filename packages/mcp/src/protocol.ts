/**
 * A small Model Context Protocol server: JSON-RPC 2.0, one message per line, over stdio.
 * It implements what tool servers need (initialize, ping, tools/list, tools/call) with no
 * dependencies, so it runs anywhere Node runs.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export type JsonSchema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };

export interface Tool {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  /** MCP tool hints. readOnlyHint tools never move money. */
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run(args: Record<string, unknown>): Promise<unknown>;
}

type Id = string | number | null;
export interface JsonRpcMessage { jsonrpc: "2.0"; id?: Id; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown }
export interface JsonRpcResponse { jsonrpc: "2.0"; id: Id; result?: unknown; error?: { code: number; message: string; data?: unknown } }

/** Thrown by a tool for a user-facing problem (bad input, limit reached). Reported as a tool error. */
export class ToolError extends Error {}

export function createMcpServer(info: { name: string; version: string; instructions?: string }, tools: Tool[]) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const ok = (id: Id, result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
  const fail = (id: Id, code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

  /** Handles one message. Returns null for notifications (no response). */
  async function handle(message: JsonRpcMessage): Promise<JsonRpcResponse | null> {
    if (message?.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return message && "id" in message ? fail(message.id ?? null, -32600, "Invalid request") : null;
    }
    const id = message.id;
    if (id === undefined) return null; // notification, e.g. notifications/initialized
    switch (message.method) {
      case "initialize": {
        const requested = String(message.params?.protocolVersion ?? "");
        const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
        return ok(id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: info.name, version: info.version }, ...(info.instructions ? { instructions: info.instructions } : {}) });
      }
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: tools.map(({ name, title, description, inputSchema, annotations }) => ({ name, ...(title ? { title } : {}), description, inputSchema, ...(annotations ? { annotations } : {}) })) });
      case "tools/call": {
        const tool = byName.get(String(message.params?.name));
        if (!tool) return fail(id, -32602, `Unknown tool: ${String(message.params?.name)}`);
        const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
        const missing = (tool.inputSchema.required ?? []).filter((k) => args[k] === undefined || args[k] === null || args[k] === "");
        if (missing.length) return ok(id, { content: [{ type: "text", text: `Missing argument(s): ${missing.join(", ")}` }], isError: true });
        try {
          const value = await tool.run(args);
          const text = JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
          return ok(id, { content: [{ type: "text", text }], structuredContent: value && typeof value === "object" && !Array.isArray(value) ? value : { result: value } });
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          return ok(id, { content: [{ type: "text", text }], isError: true });
        }
      }
      default:
        return fail(id, -32601, `Method not found: ${message.method}`);
    }
  }

  /** Serves newline-delimited JSON-RPC on the given streams (stdin/stdout). Logs go to stderr. */
  function serveStdio(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout) {
    let buffer = "";
    const write = (response: JsonRpcResponse | null) => { if (response) output.write(`${JSON.stringify(response)}\n`); };
    input.setEncoding?.("utf8");
    input.on("data", (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message: JsonRpcMessage;
        try { message = JSON.parse(line); } catch { write(fail(null, -32700, "Parse error")); continue; }
        void handle(message).then(write, (e) => write(fail(message.id ?? null, -32603, e instanceof Error ? e.message : "Internal error")));
      }
    });
  }

  return { handle, serveStdio, tools };
}
