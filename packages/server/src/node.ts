import { DatabaseSync } from "node:sqlite";
/** Node-only helpers: JSON file storage and an HTTP listener for the API. */
import { mkdirSync, readFileSync, renameSync, writeFileSync, openSync, fsyncSync, closeSync, unlinkSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname } from "node:path";
import { emptyDb, type PayKitApi, type PayKitDb } from "./api.ts";

/** Synchronous, fsynced snapshot storage for a single server. Saves complete before broadcasting. */
export function fileStore(path: string): { db: PayKitDb; save: (db: PayKitDb) => void } {
  let db = emptyDb();
  try { db = { ...db, ...JSON.parse(readFileSync(path, "utf8")) }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return { db, save(state) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    const fd = openSync(tmp, "w", 0o600);
    try { writeFileSync(fd, JSON.stringify(state)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, path);
  } };
}

/** Transactional local store. WAL + FULL sync makes job and outbox snapshots crash durable.
 * One API process owns the store; scale-out operators must supply a transactional shared store.
 */
export function sqliteStore(path: string): { db: PayKitDb; save: (db: PayKitDb) => void; close(): void } {
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  try { writeFileSync(lockPath, String(process.pid), { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(readFileSync(lockPath, "utf8"));
    let alive = true;
    try { process.kill(pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ESRCH") alive = false; }
    if (alive || !Number.isSafeInteger(pid) || pid < 1) throw new Error("PayKit data store is already owned by another server");
    unlinkSync(lockPath);
    writeFileSync(lockPath, String(process.pid), { flag: "wx", mode: 0o600 });
  }
  const sql = new DatabaseSync(path);
  sql.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)");
  const row = sql.prepare("SELECT body FROM state WHERE id=1").get() as { body: string } | undefined;
  const db: PayKitDb = { ...emptyDb(), ...(row ? JSON.parse(row.body) : {}) };
  let closed = false;
  return { db, save(state) {
    sql.exec("BEGIN IMMEDIATE");
    try { sql.prepare("INSERT INTO state(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(JSON.stringify(state)); sql.exec("COMMIT"); }
    catch (error) { sql.exec("ROLLBACK"); throw error; }
  }, close() { if (!closed) { closed = true; sql.close(); unlinkSync(lockPath); } } };
}
export { safeFetch, isPublicAddress } from "./outbound.ts";

/** Serves the API over HTTP (CORS included). */
export function listen(api: PayKitApi, port: number, host = "127.0.0.1"): Server {
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > 262144) { res.writeHead(413, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: "validation_failed", message: "Request exceeds 256 KiB" } })); return; }
        chunks.push(chunk as Buffer);
      }
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      headers.set("x-paykit-peer", req.socket.remoteAddress ?? "unknown");
      const request = new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, {
        method: req.method,
        headers,
        body: body && req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
      });
      const response = await api.handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "server_error", message: String(error) } }));
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(port, host);
  return server;
}
