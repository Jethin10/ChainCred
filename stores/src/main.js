import "./style.css";
import { STORES, priceCart } from "./catalog.mjs";

const store = STORES[import.meta.env.VITE_STORE] ?? STORES["kettle-leaf"];
const PAYKIT_SERVER = (import.meta.env.VITE_PAYKIT_SERVER_URL || "https://paykit-server.vercel.app").replace(/\/$/, "");
const PAYKIT_APP = (import.meta.env.VITE_PAYKIT_APP_URL || "https://paykit-app.vercel.app").replace(/\/$/, "");
const OTHER = Object.values(STORES).find((s) => s.slug !== store.slug);
const OTHER_URL = import.meta.env.VITE_OTHER_STORE_URL || "";

document.documentElement.dataset.theme = store.theme;
document.title = store.name;

// ── state ──
const CART_KEY = `cart:${store.slug}`;
const ORDERS_KEY = `orders:${store.slug}`;
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
let cart = read(CART_KEY, []);
let drawer = false;
let checkout = false;
let busy = false;
let error = "";
const saveCart = () => write(CART_KEY, cart);
const count = () => cart.reduce((n, l) => n + l.qty, 0);
const totals = () => (cart.length ? priceCart(store, cart) : { lines: [], total: "0" });
const money = (v) => `${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ── product art (no photos: drawn tins and book covers) ──
function art(p, big = false) {
  const { body, band, lid } = p.art;
  if (store.theme === "books") {
    const words = p.name.split(" ");
    const lines = [];
    for (const w of words) { const last = lines[lines.length - 1]; if (last && (last + " " + w).length <= 14) lines[lines.length - 1] = last + " " + w; else lines.push(w); }
    return `<svg class="art${big ? " art--big" : ""}" viewBox="0 0 200 240" role="img" aria-label="${esc(p.name)} cover">
      <rect x="0" y="0" width="200" height="240" fill="var(--art-bg)"/>
      <g transform="translate(46 22)">
        <rect x="6" y="6" width="108" height="168" rx="3" fill="rgba(0,0,0,.18)"/>
        <rect width="108" height="168" rx="3" fill="${body}"/>
        <rect x="0" y="0" width="7" height="168" fill="rgba(255,255,255,.12)"/>
        <rect x="14" y="116" width="80" height="3" fill="${band}"/>
        ${lines.slice(0, 4).map((l, i) => `<text x="16" y="${34 + i * 18}" font-family="Instrument Serif, Georgia, serif" font-size="17" fill="${lid}">${esc(l)}</text>`).join("")}
        <text x="16" y="146" font-family="Inter, sans-serif" font-size="7.5" letter-spacing="1.5" fill="${lid}" opacity=".75">PAPER LANTERN</text>
      </g></svg>`;
  }
  return `<svg class="art${big ? " art--big" : ""}" viewBox="0 0 200 240" role="img" aria-label="${esc(p.name)} tin">
    <rect x="0" y="0" width="200" height="240" fill="var(--art-bg)"/>
    <ellipse cx="100" cy="206" rx="58" ry="9" fill="rgba(0,0,0,.12)"/>
    <rect x="48" y="58" width="104" height="146" rx="10" fill="${body}"/>
    <rect x="48" y="58" width="104" height="146" rx="10" fill="url(#shine-${p.id})"/>
    <rect x="44" y="40" width="112" height="26" rx="8" fill="${lid}"/>
    <rect x="48" y="104" width="104" height="46" fill="${band}"/>
    <text x="100" y="124" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-size="12" font-weight="600" fill="${body}">${esc(p.name.split(" ")[0])}</text>
    <text x="100" y="140" text-anchor="middle" font-family="Inter, sans-serif" font-size="7" letter-spacing="1.6" fill="${body}" opacity=".8">KETTLE &amp; LEAF</text>
    <defs><linearGradient id="shine-${p.id}" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient></defs>
  </svg>`;
}

// ── views ──
function header() {
  return `<header class="top">
    <a class="brand" href="#">${store.theme === "books" ? lanternMark() : leafMark()}<span>${esc(store.name)}</span></a>
    <nav class="top__nav"><a href="#shop">Shop</a><a href="#orders">Orders</a></nav>
    <button class="cartbtn" type="button" data-action="open-cart" aria-label="Cart, ${count()} items">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>
      <span>Cart</span>${count() ? `<b>${count()}</b>` : ""}
    </button>
  </header>`;
}
const TEA_ICON = `<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 23h21v5.5a8.5 8.5 0 0 1-8.5 8.5h-4A8.5 8.5 0 0 1 11 28.5V23Z"/><path d="M32 25h2.5a3.75 3.75 0 0 1 0 7.5H31"/><path d="M9 41h26"/><path d="M21.5 19c0-6 3.5-10.5 10-11.5 0 6.5-3.5 11-10 11.5Z" stroke="#e9a15c"/><path d="M21.5 19c2.5-3.5 4.5-6 7.5-8.5" stroke="#e9a15c"/></g>`;
const LANTERN_ICON = `<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M24 4.5v4"/><path d="M18.5 11.5 20 8.5h8l1.5 3"/><rect x="14.5" y="11.5" width="19" height="25" rx="6"/><path d="M14.5 18h19M14.5 30h19" opacity=".45"/><path d="M19 36.5v3h10v-3"/></g><path d="M24 19.5c2.6 2.9 3.6 4.7 3.6 6.4a3.6 3.6 0 0 1-7.2 0c0-1.7 1-3.5 3.6-6.4Z" fill="#f2b44c"/>`;
const markSvg = (bg, fg, icon) => `<svg class="mark" viewBox="0 0 48 48" aria-hidden="true" style="color:${fg}"><rect width="48" height="48" rx="11" fill="${bg}"/>${icon}</svg>`;
const leafMark = () => markSvg("#1f3d2b", "#f6f1e7", TEA_ICON);
const lanternMark = () => markSvg("#13182a", "#fbfaf7", LANTERN_ICON);
// Tab icon: the same mark.
{
  const svg = store.theme === "books" ? markSvg("#13182a", "#fbfaf7", LANTERN_ICON) : markSvg("#1f3d2b", "#f6f1e7", TEA_ICON);
  const link = document.querySelector('link[rel="icon"]');
  if (link) link.href = `data:image/svg+xml,${encodeURIComponent(svg.replace('class="mark" ', 'xmlns="http://www.w3.org/2000/svg" '))}`;
}

function home() {
  return `${header()}
  <section class="hero">
    <div class="hero__copy">
      <p class="eyebrow">${esc(store.eyebrow)}</p>
      <h1>${esc(store.hero)}</h1>
      <p class="lead">${esc(store.tagline)}</p>
      <div class="hero__cta"><a class="btn btn--primary" href="#shop">Shop now</a><span class="paybadge">${paykitMark()} Pay with USDT · earn points</span></div>
    </div>
    <div class="hero__art">${art(store.products[0], true)}${art(store.products[2], true)}</div>
  </section>
  <section class="perks">
    <div><b>Free delivery</b><span>Across Mumbai, within two days.</span></div>
    <div><b>Pay your way</b><span>Cash on delivery, or USDT on Whitechain with PayKit.</span></div>
    <div><b>Points that travel</b><span>Earn 10 points per USDT here, spend them at ${esc(OTHER.name)} too.</span></div>
  </section>
  <section class="shop" id="shop">
    <div class="shop__head"><h2>${store.theme === "books" ? "On the shelf" : "The tea shelf"}</h2><p>${store.products.length} items</p></div>
    <div class="grid">${store.products.map((p) => `
      <article class="card">
        <div class="card__art">${art(p)}</div>
        <div class="card__body">
          <p class="card__kind">${esc(p.kind)}</p>
          <h3>${esc(p.name)}</h3>
          <p class="card__note">${esc(p.note)}</p>
          <div class="card__foot"><span class="price">${money(p.price)}</span><button class="btn btn--small" type="button" data-action="add" data-id="${p.id}">Add to cart</button></div>
        </div>
      </article>`).join("")}
    </div>
  </section>
  ${footer()}`;
}

function footer() {
  return `<footer class="foot">
    <div><b>${esc(store.name)}</b><span>${esc(store.tagline)}</span></div>
    <div class="foot__pay">${paykitMark()}<span>Payments by <a href="${PAYKIT_APP}" target="_blank" rel="noreferrer">PayKit</a>. Your invoices and points live in your PayKit wallet.</span></div>
    ${OTHER_URL ? `<a class="foot__other" href="${OTHER_URL}">Also on PayKit: ${esc(OTHER.name)} →</a>` : ""}
  </footer>`;
}
const paykitMark = () => `<svg class="pk" viewBox="0 0 22 22" aria-hidden="true"><rect width="22" height="22" rx="5" fill="#0a0a0a"/><path d="M7 16V6h5a3.2 3.2 0 0 1 0 6.4H9.4" fill="none" stroke="#fff" stroke-width="2"/><rect x="14.5" y="14" width="2.5" height="2.5" fill="#00a6ff"/></svg>`;

function cartDrawer() {
  const t = totals();
  return `<div class="scrim${drawer ? " is-open" : ""}" data-action="close-cart"></div>
  <aside class="drawer${drawer ? " is-open" : ""}" aria-label="Cart" ${drawer ? "" : "inert"}>
    <div class="drawer__head"><h2>Your cart</h2><button class="icon" type="button" data-action="close-cart" aria-label="Close">×</button></div>
    ${t.lines.length === 0 ? `<p class="empty">Your cart is empty.</p>` : `
    <ul class="lines">${t.lines.map((l) => `
      <li><div class="lines__art">${art(store.products.find((p) => p.id === l.id))}</div>
        <div class="lines__main"><b>${esc(l.name)}</b><span>${money(l.unit)}</span>
          <div class="qty"><button type="button" data-action="dec" data-id="${l.id}" aria-label="Remove one">−</button><span>${l.qty}</span><button type="button" data-action="inc" data-id="${l.id}" aria-label="Add one">+</button></div></div>
        <b class="lines__total">${money(l.total)}</b></li>`).join("")}
    </ul>
    <div class="drawer__foot"><div class="row"><span>Subtotal</span><b>${money(t.total)}</b></div><div class="row muted"><span>Delivery</span><span>Free</span></div>
      <button class="btn btn--primary btn--block" type="button" data-action="checkout">Checkout</button></div>`}
  </aside>`;
}

function checkoutModal() {
  if (!checkout) return "";
  const t = totals();
  const pts = Math.floor(Number(t.total) * 10);
  return `<div class="scrim is-open" data-action="close-checkout"></div>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Checkout">
    <div class="drawer__head"><h2>Checkout</h2><button class="icon" type="button" data-action="close-checkout" aria-label="Close">×</button></div>
    <form id="checkout" class="form">
      <label>Name<input name="name" required autocomplete="name" placeholder="Your name" /></label>
      <label>Delivery address<input name="address" required autocomplete="street-address" placeholder="Flat, street, area, Mumbai" /></label>
      <fieldset class="methods"><legend>Payment</legend>
        <label class="method"><input type="radio" name="method" value="paykit" checked />
          <span class="method__main"><b>${paykitMark()} PayKit · USDT on Whitechain</b><span>Pay ${money(t.total)} with one wallet signature, no gas. Earn ${pts} points, or spend points you earned at any PayKit shop.</span></span></label>
        <label class="method"><input type="radio" name="method" value="cod" />
          <span class="method__main"><b>Cash on delivery</b><span>Pay when your order arrives.</span></span></label>
      </fieldset>
      <div class="row total"><span>Total</span><b>${money(t.total)}</b></div>
      ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
      <button class="btn btn--primary btn--block" type="submit" ${busy ? "disabled" : ""}>${busy ? "Creating your invoice…" : "Place order"}</button>
      <p class="fine">With PayKit you finish on the PayKit site, then come straight back here.</p>
    </form>
  </div>`;
}

function ordersPage() {
  const orders = read(ORDERS_KEY, []);
  return `${header()}<section class="orders"><h1>Your orders</h1>
    ${orders.length === 0 ? `<p class="lead">No orders yet. <a href="#shop">Start shopping</a>.</p>` : `<ul class="olist">${orders.map((o) => `
      <li><a href="#order/${o.reference}"><b>${esc(o.reference)}</b><span>${new Date(o.at).toLocaleString()}</span><span>${o.method === "paykit" ? "PayKit · USDT" : "Cash on delivery"}</span><b>${money(o.total)}</b></a></li>`).join("")}</ul>`}
  </section>${footer()}`;
}

function orderPage(ref) {
  const o = read(ORDERS_KEY, []).find((x) => x.reference === ref);
  if (!o) return `${header()}<section class="orders"><h1>Order not found</h1><p class="lead"><a href="#shop">Back to the shop</a></p></section>${footer()}`;
  return `${header()}<section class="order">
    <p class="eyebrow">Order ${esc(o.reference)}</p>
    <h1 id="order-title">${o.method === "cod" ? "Order placed. Pay on delivery." : "Waiting for your payment…"}</h1>
    <div class="order__grid">
      <ul class="lines lines--static">${o.lines.map((l) => `<li><div class="lines__art">${art(store.products.find((p) => p.id === l.id))}</div><div class="lines__main"><b>${esc(l.name)}</b><span>${l.qty} × ${money(l.unit)}</span></div><b class="lines__total">${money(l.total)}</b></li>`).join("")}</ul>
      <aside class="order__side">
        <div class="row"><span>Total</span><b>${money(o.total)}</b></div>
        <div class="row"><span>Payment</span><span>${o.method === "paykit" ? "PayKit · USDT" : "Cash on delivery"}</span></div>
        <div class="row"><span>Deliver to</span><span>${esc(o.address || "-")}</span></div>
        <div id="order-status" class="status">${o.method === "paykit" ? `<span class="pill">Checking payment…</span>` : `<span class="pill pill--ok">Confirmed</span>`}</div>
        ${o.method === "paykit" ? `<a class="btn btn--block" id="order-pay" href="${o.payUrl}">Open invoice on PayKit</a>` : ""}
      </aside>
    </div>
  </section>${footer()}`;
}

// ── render + events ──
const app = document.getElementById("app");
let poll = 0;
function render() {
  const h = location.hash.replace(/^#/, "");
  clearInterval(poll);
  let page;
  if (h.startsWith("order/")) { page = orderPage(decodeURIComponent(h.slice(6))); }
  else if (h === "orders") page = ordersPage();
  else page = home();
  app.innerHTML = page + cartDrawer() + checkoutModal();
  if (h.startsWith("order/")) followOrder(decodeURIComponent(h.slice(6)));
  if (h === "shop") document.getElementById("shop")?.scrollIntoView();
}

function followOrder(ref) {
  const orders = read(ORDERS_KEY, []);
  const o = orders.find((x) => x.reference === ref);
  if (!o || o.method !== "paykit") return;
  const check = async () => {
    try {
      const inv = await (await fetch(`${PAYKIT_SERVER}/v1/public/invoices/${o.invoiceId}`)).json();
      const paid = inv.status === "paid";
      const el = document.getElementById("order-status");
      if (!el) return;
      document.getElementById("order-title").textContent = paid ? "Paid. Your order is on its way." : "Waiting for your payment…";
      el.innerHTML = paid
        ? `<span class="pill pill--ok">Paid on Whitechain</span><a class="link" href="${PAYKIT_APP}/#wallet" target="_blank" rel="noreferrer">See the receipt and your points in PayKit →</a>`
        : `<span class="pill">Not paid yet</span>`;
      const pay = document.getElementById("order-pay");
      if (pay) pay.hidden = paid;
      if (paid) { clearInterval(poll); o.status = "paid"; write(ORDERS_KEY, orders); }
    } catch { /* retry on the next tick */ }
  };
  check();
  poll = window.setInterval(check, 4000);
}

app.addEventListener("click", (e) => {
  const t = e.target.closest("[data-action]");
  if (!t) return;
  const a = t.dataset.action;
  const id = t.dataset.id;
  if (a === "add") { const l = cart.find((x) => x.id === id); if (l) l.qty = Math.min(20, l.qty + 1); else cart.push({ id, qty: 1 }); saveCart(); drawer = true; }
  if (a === "inc") { const l = cart.find((x) => x.id === id); if (l) l.qty = Math.min(20, l.qty + 1); saveCart(); }
  if (a === "dec") { const l = cart.find((x) => x.id === id); if (l) l.qty -= 1; cart = cart.filter((x) => x.qty > 0); saveCart(); }
  if (a === "open-cart") drawer = true;
  if (a === "close-cart") drawer = false;
  if (a === "checkout") { drawer = false; checkout = true; error = ""; }
  if (a === "close-checkout") { checkout = false; }
  render();
});

app.addEventListener("submit", async (e) => {
  if (e.target.id !== "checkout") return;
  e.preventDefault();
  const f = new FormData(e.target);
  const method = f.get("method");
  const t = totals();
  const base = { at: Date.now(), method, address: String(f.get("address") || ""), lines: t.lines, total: t.total };
  if (method === "cod") {
    const reference = `${store.refPrefix}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    write(ORDERS_KEY, [{ ...base, reference, status: "placed" }, ...read(ORDERS_KEY, [])]);
    cart = []; saveCart(); checkout = false; location.hash = `order/${reference}`; return;
  }
  busy = true; error = ""; render();
  try {
    const r = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: cart, name: f.get("name") }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Checkout failed");
    write(ORDERS_KEY, [{ ...base, reference: j.reference, invoiceId: j.invoiceId, payUrl: j.payUrl, total: j.total, lines: j.lines, status: "awaiting_payment" }, ...read(ORDERS_KEY, [])]);
    cart = []; saveCart();
    location.href = j.payUrl;
  } catch (err) {
    busy = false; error = err.message; render();
  }
});

window.addEventListener("hashchange", () => { checkout = false; render(); });
render();
