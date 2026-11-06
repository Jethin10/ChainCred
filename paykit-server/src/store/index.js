// Storage with one small interface and two backends:
//   - Postgres (Neon) when DATABASE_URL is set
//   - in-memory otherwise (for trying things out; everything is lost on restart)
//
// Interface (every method async):
//   insert(table, doc)                  doc.id required; merchantId optional
//   get(table, id)                      -> doc | null
//   update(table, id, patch)            shallow merge, returns the new doc
//   find(table, filter, {limit, offset, order}) filter = {merchantId?, ...equality on doc fields}
//   findOne(table, filter)
//   upsert(table, doc)
//   close()
const config = require("../config");

const TABLES = [
  "merchants",
  "invoices",
  "quotes",
  "payments",
  "refunds",
  "plans",
  "subscriptions",
  "point_campaigns",
  "rewards",
  "points_ledger",
  "points_wallets",
  "point_lots",
  "point_spends",
  "arkiv_outbox",
  "webhook_events",
  "txs",
  "refill_runs",
  "kv",
];

async function createStore() {
  if (config.databaseUrl) {
    const { createPgStore } = require("./pg");
    const store = await createPgStore(config.databaseUrl, config.databaseUrlUnpooled, TABLES);
    console.log("[store] Postgres connected");
    return store;
  }
  const { createMemoryStore } = require("./memory");
  console.warn("[store] DATABASE_URL is empty: using the IN-MEMORY store. Data is lost when the server stops.");
  return createMemoryStore(TABLES);
}

module.exports = { createStore, TABLES };
