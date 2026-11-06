const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

function matches(doc, filter) {
  return Object.entries(filter).every(([k, v]) => doc[k] === v);
}

function createMemoryStore(tables) {
  const db = Object.fromEntries(tables.map((t) => [t, new Map()]));
  const table = (t) => {
    if (!db[t]) throw new Error(`unknown table ${t}`);
    return db[t];
  };
  const now = () => new Date().toISOString();

  return {
    kind: "memory",
    async insert(t, doc) {
      const m = table(t);
      if (m.has(doc.id)) throw new Error(`duplicate id ${doc.id} in ${t}`);
      const d = { ...clone(doc), createdAt: doc.createdAt || now(), updatedAt: now() };
      m.set(doc.id, d);
      return clone(d);
    },
    async upsert(t, doc) {
      const m = table(t);
      const prev = m.get(doc.id);
      const d = { ...(prev || {}), ...clone(doc), createdAt: prev?.createdAt || now(), updatedAt: now() };
      m.set(doc.id, d);
      return clone(d);
    },
    async get(t, id) {
      return clone(table(t).get(id) || null);
    },
    async update(t, id, patch) {
      const m = table(t);
      const prev = m.get(id);
      if (!prev) throw new Error(`${t}/${id} not found`);
      const d = { ...prev, ...clone(patch), updatedAt: now() };
      m.set(id, d);
      return clone(d);
    },
    async find(t, filter = {}, { limit = 100, offset = 0, order = "desc" } = {}) {
      const rows = [...table(t).values()].filter((d) => matches(d, filter));
      rows.sort((a, b) => (order === "asc" ? 1 : -1) * (a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
      return clone(rows.slice(offset, offset + limit));
    },
    async findOne(t, filter) {
      return (await this.find(t, filter, { limit: 1 }))[0] || null;
    },
    async close() {},
  };
}

module.exports = { createMemoryStore };
