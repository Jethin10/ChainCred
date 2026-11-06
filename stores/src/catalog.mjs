// The two demo companies that sell through PayKit. Shared by the storefront (display) and the
// checkout function (pricing), so the server always prices the cart from this list, never from the
// browser. Prices are in USDT; every order is at least 2 USDT (the PayKit fee floor).

export const STORES = {
  "kettle-leaf": {
    slug: "kettle-leaf",
    name: "Kettle & Leaf",
    tagline: "Single-estate teas from Assam to Kashmir, packed by hand in Mumbai.",
    eyebrow: "Tea house · Mumbai",
    hero: "Tea worth slowing down for.",
    refPrefix: "KL",
    theme: "tea",
    products: [
      { id: "assam-breakfast", name: "Assam Breakfast", kind: "Black tea · 100 g", price: "2.50", art: { body: "#7a3b1d", band: "#e9c46a", lid: "#2b2b2b" }, note: "Malty, bright, takes milk well." },
      { id: "darjeeling-first-flush", name: "Darjeeling First Flush", kind: "Black tea · 50 g", price: "4.50", art: { body: "#c97b4a", band: "#f6f1e7", lid: "#1f3d2b" }, note: "Muscatel, floral, spring harvest." },
      { id: "masala-chai", name: "Masala Chai Blend", kind: "Spiced black tea · 100 g", price: "3.00", art: { body: "#9c2f24", band: "#f2a541", lid: "#2b2b2b" }, note: "Cardamom, ginger, clove, cinnamon." },
      { id: "kashmiri-kahwa", name: "Kashmiri Kahwa", kind: "Green tea · 75 g", price: "5.50", art: { body: "#3e6b48", band: "#e8d9b5", lid: "#c8a24a" }, note: "Saffron, almond, cardamom." },
      { id: "nilgiri-frost", name: "Nilgiri Frost", kind: "Black tea · 100 g", price: "3.50", art: { body: "#2f4a6d", band: "#dfe7ef", lid: "#1f2a37" }, note: "Clean, brisk, great iced." },
      { id: "brass-strainer", name: "Brass Tea Strainer", kind: "Accessory", price: "2.00", art: { body: "#b8892c", band: "#f6f1e7", lid: "#7a5a12" }, note: "Fine mesh, fits any cup." },
    ],
  },
  "paper-lantern": {
    slug: "paper-lantern",
    name: "Paper Lantern Books",
    tagline: "An independent bookshop for slow readers and night owls.",
    eyebrow: "Independent bookshop",
    hero: "Books for the hours after dark.",
    refPrefix: "PL",
    theme: "books",
    products: [
      { id: "monsoon-ledger", name: "The Monsoon Ledger", kind: "Novel · Paperback", price: "6.00", art: { body: "#1d3557", band: "#e9c46a", lid: "#f1faee" }, note: "A family, a ledger, forty monsoons." },
      { id: "small-rooms", name: "Small Rooms, Large Skies", kind: "Essays · Paperback", price: "4.50", art: { body: "#e76f51", band: "#264653", lid: "#fefae0" }, note: "On living well in tiny flats." },
      { id: "quiet-machines", name: "Notes on Quiet Machines", kind: "Non-fiction · Hardcover", price: "7.00", art: { body: "#2a2a2a", band: "#a8dadc", lid: "#f1faee" }, note: "How good tools disappear." },
      { id: "night-trains", name: "A Field Guide to Night Trains", kind: "Travel · Paperback", price: "5.00", art: { body: "#3d405b", band: "#f2cc8f", lid: "#f4f1de" }, note: "Sleeper berths, from Kalka to Kanyakumari." },
      { id: "ink-and-salt", name: "Ink & Salt", kind: "Poetry · Paperback", price: "3.00", art: { body: "#6d597a", band: "#eaac8b", lid: "#fdf0d5" }, note: "Short poems about the sea and the city." },
      { id: "bookmark-set", name: "Brass Bookmark Set", kind: "Accessory · Set of 3", price: "2.00", art: { body: "#b08d57", band: "#1d3557", lid: "#fdf0d5" }, note: "Thin, heavy, never slips out." },
    ],
  },
};

const toBase = (usdt) => {
  const [w, f = ""] = String(usdt).split(".");
  return BigInt(w) * 1_000_000n + BigInt((f + "000000").slice(0, 6));
};
const fromBase = (b) => {
  const s = b.toString().padStart(7, "0");
  return `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/\.?0+$/, "") || "0";
};

/** Prices a cart from the catalog. Throws on unknown items or silly quantities. */
export function priceCart(store, items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("Your cart is empty");
  let total = 0n;
  const lines = [];
  for (const it of items) {
    const p = store.products.find((x) => x.id === it.id);
    const qty = Number(it.qty);
    if (!p || !Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error("Your cart has an item we can't sell");
    const line = toBase(p.price) * BigInt(qty);
    total += line;
    lines.push({ id: p.id, name: p.name, qty, unit: p.price, total: fromBase(line) });
  }
  return { lines, total: fromBase(total) };
}

export { toBase, fromBase };
