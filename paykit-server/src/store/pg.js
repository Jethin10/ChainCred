const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

// All PayKit tables live in their own Postgres schema, so they never collide with tables
// another app created in the same database (e.g. an existing "plans" or "subscriptions").
const SCHEMA = "paykit";

function rowToDoc(r) {
  if (!r) return null;
  return { ...r.data, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() };
}

// pg warns that sslmode=require will change meaning; verify-full is what it does today, so say so.
const normalizeUrl = (u) => u && u.replace(/sslmode=(require|prefer|verify-ca)\b/, "sslmode=verify-full");

/** Create the schema, move PayKit tables made by older versions (in "public") into it, then create the rest. */
async function setupSchema(client, tables) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  for (const t of tables) {
    const { rows } = await client.query(
      `SELECT
         to_regclass($1) IS NOT NULL AS in_schema,
         (SELECT array_agg(column_name::text) FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $2) AS public_cols`,
      [`${SCHEMA}.${t}`, t]
    );
    const { in_schema, public_cols } = rows[0];
    const isOurs = public_cols && ["id", "merchant_id", "data", "created_at", "updated_at"].every((c) => public_cols.includes(c));
    if (!in_schema && isOurs) {
      await client.query(`ALTER TABLE public.${t} SET SCHEMA ${SCHEMA}`);
      console.log(`[store] moved existing PayKit table public.${t} -> ${SCHEMA}.${t}`);
    } else if (!in_schema && public_cols) {
      console.log(`[store] public.${t} belongs to another app; leaving it alone and using ${SCHEMA}.${t}`);
    }
  }
  await client.query(`SET search_path TO ${SCHEMA}`);
  await client.query(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
}

async function createPgStore(url, unpooledUrl, tables) {
  url = normalizeUrl(url);
  unpooledUrl = normalizeUrl(unpooledUrl);
  const ssl = /sslmode=|neon\.tech/.test(url) ? { rejectUnauthorized: true } : undefined;

  const pool = new Pool({ connectionString: url, ssl, max: 5 });
  pool.on("error", (e) => console.error("[store] pg pool error:", e.message));

  // One query tells us whether the schema is complete; only then skip the (slow) setup. This keeps
  // serverless cold starts fast, and a new or older database still gets migrated.
  const { rows: ready } = await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name = ANY($2)`,
    [SCHEMA, tables]
  );
  if (ready[0].n < tables.length) {
    // one-time schema setup on a direct connection (Neon's pooler doesn't keep SET search_path)
    const setup = new Pool({ connectionString: unpooledUrl || url, ssl, max: 1 });
    const client = await setup.connect();
    try {
      await setupSchema(client, tables);
    } finally {
      client.release();
      await setup.end();
    }
  }

  // every query names the schema explicitly, so it works through the pooler too
  const tbl = (t) => {
    if (!tables.includes(t)) throw new Error(`unknown table ${t}`);
    return `${SCHEMA}.${t}`;
  };
  const strip = ({ createdAt, updatedAt, ...rest }) => rest;

  return {
    kind: "postgres",
    async insert(t, doc) {
      const { rows } = await pool.query(
        `INSERT INTO ${tbl(t)} (id, merchant_id, data) VALUES ($1, $2, $3) RETURNING *`,
        [doc.id, doc.merchantId || null, strip(doc)]
      );
      return rowToDoc(rows[0]);
    },
    async upsert(t, doc) {
      const { rows } = await pool.query(
        `INSERT INTO ${tbl(t)} AS cur (id, merchant_id, data) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET data = cur.data || EXCLUDED.data, updated_at = now()
         RETURNING *`,
        [doc.id, doc.merchantId || null, strip(doc)]
      );
      return rowToDoc(rows[0]);
    },
    async get(t, id) {
      const { rows } = await pool.query(`SELECT * FROM ${tbl(t)} WHERE id = $1`, [id]);
      return rowToDoc(rows[0]);
    },
    async update(t, id, patch) {
      const { rows } = await pool.query(
        `UPDATE ${tbl(t)} SET data = data || $2, updated_at = now() WHERE id = $1 RETURNING *`,
        [id, strip(patch)]
      );
      if (!rows[0]) throw new Error(`${t}/${id} not found`);
      return rowToDoc(rows[0]);
    },
    async find(t, filter = {}, { limit = 100, order = "desc" } = {}) {
      const { merchantId, ...rest } = filter;
      const where = [];
      const args = [];
      if (merchantId !== undefined) {
        args.push(merchantId);
        where.push(`merchant_id = $${args.length}`);
      }
      if (Object.keys(rest).length) {
        args.push(JSON.stringify(rest));
        where.push(`data @> $${args.length}::jsonb`);
      }
      args.push(limit);
      const sql = `SELECT * FROM ${tbl(t)} ${where.length ? "WHERE " + where.join(" AND ") : ""}
                   ORDER BY created_at ${order === "asc" ? "ASC" : "DESC"} LIMIT $${args.length}`;
      const { rows } = await pool.query(sql, args);
      return rows.map(rowToDoc);
    },
    async findOne(t, filter) {
      return (await this.find(t, filter, { limit: 1 }))[0] || null;
    },
    async close() {
      await pool.end();
    },
  };
}

module.exports = { createPgStore };
