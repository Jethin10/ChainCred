// @paykit/embed: PayKit checkout inside any website. No redirect, no framework, no dependencies.
//
//   import { openCheckout } from "@paykit/embed";
//   const result = await openCheckout({ invoiceId, accent: "#1f3d2b" });
//   if (result.status === "paid") showThankYou(result.paymentId);
//
// The shop's own server creates the invoice with its merchant key (POST /v1/invoices). This module
// then pays it on the shop's page: it connects MetaMask (switching it to Whitechain), shows the
// shop's points rewards, asks for one gasless USDT signature, and follows the payment until the
// router has settled it onchain. The invoice and receipt stay on PayKit, so customers also find
// them in their PayKit wallet.

const DEFAULT_SERVER = "https://paykit-server.vercel.app";
const DEFAULT_WALLET_URL = "https://paykit-app.vercel.app/#wallet";
const CHAIN = {
  chainId: "0x752", // 1874
  chainName: "Whitechain Testnet",
  nativeCurrency: { name: "WBT", symbol: "WBT", decimals: 18 },
  rpcUrls: ["https://rpc.testnet.whitechain.io"],
  blockExplorerUrls: ["https://explorer.testnet.whitechain.io"],
};
const MINUTE = 60_000;

// ── wallet (EIP-6963 discovery, MetaMask preferred) ──
const announced = [];
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e) => {
    const d = e.detail;
    if (d?.provider && !announced.some((a) => a.provider === d.provider)) announced.push(d);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}
const provider = () => (announced.find((a) => a.info?.rdns === "io.metamask") ?? announced[0])?.provider ?? window.ethereum ?? null;

class PayKitError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

function ask(eth, method, params, ms = 2 * MINUTE) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new PayKitError("MetaMask did not answer. Click the MetaMask icon in your toolbar to see the request.", "wallet_timeout")), ms); });
  return Promise.race([eth.request({ method, params }), timeout]).finally(() => clearTimeout(t));
}

async function toWhitechain(eth) {
  if (parseInt(await ask(eth, "eth_chainId"), 16) === 1874) return;
  try { await ask(eth, "wallet_switchEthereumChain", [{ chainId: CHAIN.chainId }]); }
  catch (e) { if (e?.code !== 4902) throw e; await ask(eth, "wallet_addEthereumChain", [CHAIN]); }
}

async function connect() {
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const eth = provider();
  if (!eth) throw new PayKitError("MetaMask is not installed in this browser.", "no_wallet");
  let accounts = await ask(eth, "eth_accounts");
  if (!accounts.length) {
    try {
      await ask(eth, "wallet_requestPermissions", [{ eth_accounts: {}, "endowment:permitted-chains": { caveats: [{ type: "restrictNetworkSwitching", value: [CHAIN.chainId] }] } }]);
    } catch (e) {
      if (e?.code === 4001 || e?.code === "wallet_timeout") throw e;
      await ask(eth, "wallet_requestPermissions", [{ eth_accounts: {} }]);
    }
    accounts = await ask(eth, "eth_accounts");
  }
  await toWhitechain(eth);
  if (!accounts[0]) throw new PayKitError("MetaMask did not share an account.", "no_account");
  return { eth, account: accounts[0] };
}

const DOMAIN_FIELDS = [["name", "string"], ["version", "string"], ["chainId", "uint256"], ["verifyingContract", "address"], ["salt", "bytes32"]];
async function signTypedData(eth, account, data) {
  await toWhitechain(eth);
  const EIP712Domain = DOMAIN_FIELDS.filter(([n]) => data.domain[n] !== undefined).map(([name, type]) => ({ name, type }));
  try {
    return await ask(eth, "eth_signTypedData_v4", [account, JSON.stringify({ ...data, types: { EIP712Domain, ...data.types } })], 5 * MINUTE);
  } catch (e) {
    if (e?.code === 4100) throw new PayKitError("MetaMask has not allowed this site to sign yet. Disconnect the site in MetaMask, then pay again.", "unauthorized");
    throw e;
  }
}

const errorText = (e) => {
  if (e?.code === 4001) return "You declined in MetaMask. Nothing was signed.";
  return e?.message || e?.data?.message || String(e);
};

// ── server ──
function client(server) {
  const base = server.replace(/\/$/, "");
  return async (path, body) => {
    let res;
    try {
      res = await fetch(base + path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      throw new PayKitError("Could not reach PayKit. Check your connection.", "network");
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new PayKitError(json?.error?.message || `Request failed (${res.status})`, json?.error?.code);
    return json;
  };
}

// ── UI ──
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usdt = (v) => `${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CSS = `
.pke-scrim{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:rgba(12,14,20,.42);backdrop-filter:blur(3px);animation:pke-fade .2s ease both}
.pke{--a:#0a0a0a;position:relative;width:min(440px,100%);max-height:calc(100vh - 32px);overflow:auto;border-radius:14px;background:#fff;color:#0a0a0a;font:15px/1.45 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 30px 80px -30px rgba(0,0,0,.55);animation:pke-pop .3s cubic-bezier(.22,1,.36,1) both}
.pke::before{content:"";position:absolute;inset:0 0 auto;height:5px;background:var(--a)}
.pke *{box-sizing:border-box}
.pke-head{display:flex;align-items:center;gap:12px;padding:22px 22px 0}
.pke-mark{flex:none;display:grid;place-items:center;width:38px;height:38px;border-radius:9px;background:var(--a);color:#fff;font-weight:700}
.pke-who{flex:1;min-width:0;display:grid}
.pke-who b{overflow-wrap:anywhere}
.pke-who span{color:#6b7178;font-size:13px}
.pke-x{width:32px;height:32px;border:1px solid #e4e9ee;border-radius:8px;background:#fff;font-size:18px;line-height:1;cursor:pointer;color:#3b3f45}
.pke-body{display:grid;gap:14px;padding:18px 22px 22px}
.pke-amount{margin:0;font-size:40px;font-weight:700;letter-spacing:-.02em;line-height:1}
.pke-amount small{font-size:15px;color:#6b7178;font-weight:600}
.pke-was{color:#6b7178;text-decoration:line-through;font-size:15px;margin-left:8px;font-weight:500}
.pke-desc{margin:-6px 0 0;color:#3b3f45;font-size:14px;overflow-wrap:anywhere}
.pke-rows{display:grid;grid-template-columns:1fr auto;gap:6px 14px;margin:0;padding:12px 0;border-block:1px dashed #dfe5eb;font-size:14px}
.pke-rows dt{color:#6b7178}.pke-rows dd{margin:0;text-align:right}
.pke-good{color:#1f7a45;font-weight:600}
.pke-offers{display:grid;gap:8px}
.pke-offers p{margin:0;font-size:13px;font-weight:600}
.pke-offer{display:flex;justify-content:space-between;gap:12px;width:100%;padding:11px 13px;border:1px solid #e4e9ee;border-radius:10px;background:#fff;font:inherit;font-size:14px;text-align:left;cursor:pointer}
.pke-offer[aria-pressed="true"]{border-color:var(--a);box-shadow:inset 0 0 0 1px var(--a)}
.pke-offer:disabled{cursor:not-allowed;opacity:.5}
.pke-offer span:last-child{color:#6b7178;white-space:nowrap}
.pke-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:50px;border:0;border-radius:10px;background:var(--a);color:#fff;font:inherit;font-weight:600;font-size:16px;cursor:pointer;transition:transform .12s,filter .2s}
.pke-btn:hover{filter:brightness(1.12)}.pke-btn:active{transform:scale(.99)}.pke-btn[disabled]{opacity:.7;cursor:progress}
.pke-btn--ghost{background:#fff;color:#0a0a0a;border:1px solid #cfd8e1}
.pke-fox{width:20px;height:20px}
.pke-steps{display:grid;gap:8px;margin:0;padding:0;list-style:none;font-size:14px}
.pke-steps li{display:flex;align-items:center;gap:10px;color:#9aa0a8}
.pke-steps li::before{content:"";width:9px;height:9px;border-radius:3px;background:#e4e9ee}
.pke-steps li[data-s="now"]{color:#0a0a0a;font-weight:600}.pke-steps li[data-s="now"]::before{background:var(--a);animation:pke-pulse 1s ease-in-out infinite}
.pke-steps li[data-s="done"]{color:#3b3f45}.pke-steps li[data-s="done"]::before{background:#1f9d55}
.pke-ok{display:grid;gap:6px;padding:14px;border-radius:10px;background:#eaf7ef;color:#174d2c}
.pke-ok b{font-size:16px}.pke-ok a{color:inherit;font-weight:600}
.pke-err{margin:0;padding:10px 12px;border-radius:9px;background:#fdecea;color:#8a2312;font-size:14px}
.pke-fine{margin:0;color:#6b7178;font-size:12.5px;text-align:center}
.pke-fine a{color:inherit}
.pke-who-acct{display:flex;align-items:center;gap:8px;font-size:13px;color:#3b3f45}
.pke-who-acct i{width:8px;height:8px;border-radius:2px;background:#1f9d55}
@keyframes pke-fade{from{opacity:0}}@keyframes pke-pop{from{opacity:0;transform:translateY(10px) scale(.98)}}@keyframes pke-pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.pke,.pke-scrim,.pke-steps li::before{animation:none}}
`;
const FOX = `<svg class="pke-fox" viewBox="0 0 24 24" aria-hidden="true"><path fill="#E2761B" d="M21 3l-7.5 5.6 1.4-3.3z"/><path fill="#E4761B" d="M3 3l7.4 5.7-1.3-3.4zM18.3 16.2l-2 3 4.3 1.2 1.2-4.1zM2.2 16.3l1.2 4.1 4.3-1.2-2-3z"/><path fill="#E4761B" d="M7.5 10.8l-1.2 1.8 4.3.2-.2-4.6zM16.5 10.8l-3-2.7-.1 4.7 4.3-.2zM7.7 19.2l2.6-1.3-2.2-1.7zM13.7 17.9l2.6 1.3-.4-3z"/><path fill="#F6851B" d="M12 13.6l-1.4 1.1h2.8z"/></svg>`;

function ensureStyles() {
  if (document.getElementById("pke-styles")) return;
  const s = document.createElement("style");
  s.id = "pke-styles";
  s.textContent = CSS;
  document.head.appendChild(s);
}

/**
 * Opens the PayKit checkout for an invoice on top of the current page.
 * @param {{ invoiceId: string, server?: string, accent?: string, walletUrl?: string, onPaid?: (result: object) => void, demo?: boolean, demoInvoice?: object }} options
 * @returns {Promise<{ status: "paid", paymentId: string, txUrl: string|null, pointsEarned: number } | { status: "closed" }>}
 */
export function openCheckout(options) {
  ensureStyles();
  const api = client(options.server || DEFAULT_SERVER);
  const walletUrl = options.walletUrl || DEFAULT_WALLET_URL;
  const scrim = document.createElement("div");
  scrim.className = "pke-scrim";
  const box = document.createElement("div");
  box.className = "pke";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", "Pay with PayKit");
  scrim.appendChild(box);
  document.body.appendChild(scrim);
  const prevOverflow = document.body.style.overflow;
  const prevFocus = document.activeElement;
  document.body.style.overflow = "hidden";

  const s = { invoice: null, account: null, eth: null, offers: null, reward: null, step: "idle", error: "", result: null };
  let finish;
  let closed = false;
  const done = new Promise((r) => { finish = r; });
  const close = (value) => {
    if (closed) return;
    closed = true;
    document.body.style.overflow = prevOverflow;
    scrim.remove();
    document.removeEventListener("keydown", onKey);
    prevFocus?.focus();
    finish(value);
  };
  const isBusy = () => !["idle", "done"].includes(s.step);
  const onKey = (e) => {
    if (e.key === "Escape" && !isBusy()) close(s.result ? { status: "paid", ...s.result } : { status: "closed" });
    if (e.key === "Tab") {
      const controls = [...box.querySelectorAll('button:not(:disabled), a[href]')];
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  };
  document.addEventListener("keydown", onKey);

  const STEPS = [["quote", "Preparing your payment"], ["sign", "Sign in MetaMask"], ["send", "Sending (PayKit pays the gas)"], ["settle", "Settling on Whitechain"]];

  function render() {
    if (closed) return;
    const inv = s.invoice;
    const accent = options.accent || inv?.merchant?.profile?.accent || "#0a0a0a";
    box.style.setProperty("--a", accent);
    const name = inv?.merchant?.name || "Merchant";
    const chosen = s.offers?.offers?.find((o) => o.id === s.reward && o.available);
    const due = inv ? inv.amountDue : "0";
    const pay = chosen?.payAfter ?? due;
    const busy = isBusy();
    const order = STEPS.map(([k]) => k);
    box.innerHTML = `
      <div class="pke-head">
        <span class="pke-mark" aria-hidden="true">${esc(name.slice(0, 1))}</span>
        <div class="pke-who"><b>${esc(name)}</b><span>Secure checkout by PayKit</span></div>
        <button class="pke-x" type="button" data-a="close" aria-label="Close" ${busy ? "disabled" : ""}>×</button>
      </div>
      <div class="pke-body">
        ${!inv ? `<p class="pke-desc">${s.error ? "Could not load your invoice." : "Loading your invoice…"}</p>${s.error ? `<p class="pke-err" role="alert">${esc(s.error)}</p>` : ""}` : `
        <p class="pke-amount">${esc(Number(s.result ? inv.amount : pay).toFixed(2))} <small>USDT</small>${chosen && !s.result ? `<span class="pke-was">${esc(Number(due).toFixed(2))}</span>` : ""}</p>
        ${inv.description ? `<p class="pke-desc">${esc(inv.description)}</p>` : ""}
        <dl class="pke-rows">
          ${inv.reference ? `<dt>Order</dt><dd>${esc(inv.reference)}</dd>` : ""}
          ${chosen ? `<dt>Points discount</dt><dd class="pke-good">−${esc(usdt(chosen.discount))}</dd>` : ""}
          <dt>Network fee</dt><dd>0 WBT, PayKit pays</dd>
          ${s.offers?.enabled && s.offers.willEarn > 0 && !s.result ? `<dt>You earn</dt><dd class="pke-good">+${chosen?.willEarn ?? s.offers.willEarn} points</dd>` : ""}
        </dl>
        ${s.result ? `
          <div class="pke-ok" role="status"><b>${options.demo ? "Payment complete." : "Paid. Settled on Whitechain."}</b>
            <span>${s.result.pointsEarned > 0 ? `You earned ${s.result.pointsEarned} PayKit points. ` : ""}${options.demo ? "Your receipt is saved with your order." : "Your receipt is saved in your PayKit wallet."}</span>
            ${options.demo ? "" : `<span>${s.result.txUrl ? `<a href="${esc(s.result.txUrl)}" target="_blank" rel="noreferrer">View transaction</a> · ` : ""}<a href="${esc(walletUrl)}" target="_blank" rel="noreferrer">Open PayKit wallet</a></span>`}
          </div>
          <button class="pke-btn" type="button" data-a="finish">Done</button>` : Number(due) <= 0 ? `
          <div class="pke-ok"><b>This order is already paid.</b></div>
          <button class="pke-btn" type="button" data-a="finish">Done</button>` : `
          ${s.account && s.offers?.enabled && s.offers.offers.length ? `
          <div class="pke-offers"><p>Use your points · you have ${s.offers.balance}</p>
            ${s.offers.offers.map((o) => `<button type="button" class="pke-offer" data-a="reward" data-id="${esc(o.id)}" aria-pressed="${s.reward === o.id}" ${!o.available || busy ? "disabled" : ""}><span>${esc(o.name)}</span><span>${o.available ? `−${esc(usdt(o.discount))} · ${o.pointsCost} pts` : esc(o.message || "")}</span></button>`).join("")}
          </div>` : ""}
          ${busy ? `<ol class="pke-steps">${STEPS.map(([k, label]) => `<li data-s="${order.indexOf(k) < order.indexOf(s.step) ? "done" : k === s.step ? "now" : "next"}">${label}</li>`).join("")}</ol>` : ""}
          ${!s.account
            ? `<button class="pke-btn" type="button" data-a="connect" ${busy ? "disabled" : ""}>${FOX} ${s.step === "connect" ? "Connecting…" : "Connect MetaMask"}</button>`
            : `<div class="pke-who-acct"><i></i>Paying from ${esc(short(s.account))} on Whitechain</div>
               <button class="pke-btn" type="button" data-a="pay" ${busy ? "disabled" : ""}>${busy ? "Working…" : `Pay ${esc(usdt(pay))}`}</button>`}
          ${s.error ? `<p class="pke-err" role="alert">${esc(s.error)}</p>` : ""}
          <p class="pke-fine">One signature, no gas. USDT goes straight to ${esc(name)}.</p>`}`}
      </div>`;
  }

  async function loadOffers() {
    if (options.demo) return;
    try { s.offers = await api(`/v1/public/invoices/${encodeURIComponent(options.invoiceId)}/offers?payer=${s.account}`); } catch { s.offers = null; }
  }

  async function pay() {
    if (isBusy() || closed || !s.account) return;
    s.error = "";
    try {
      if (options.demo) {
        s.result = { paymentId: options.invoiceId, txUrl: null, pointsEarned: 0, demo: true };
        s.step = "done";
        try { options.onPaid?.({ status: "paid", ...s.result }); } catch { /* host callback */ }
        render();
        return;
      }
      s.step = "quote"; render();
      const q = await api(`/v1/public/invoices/${encodeURIComponent(options.invoiceId)}/quote`, { payer: s.account, ...(s.reward ? { rewardId: s.reward } : {}) });
      s.step = "sign"; render();
      const signature = await signTypedData(s.eth, s.account, q.typedData);
      s.step = "send"; render();
      let status = await api(`/v1/public/quotes/${q.quoteId}/authorize`, { signature });
      s.step = "settle"; render();
      for (let i = 0; i < 120; i++) {
        await sleep(i === 0 ? 1000 : 1500);
        const [st, rc] = await Promise.all([api(`/v1/public/quotes/${q.quoteId}`).catch(() => null), api(`/v1/public/receipts/${q.paymentId}`).catch(() => null)]);
        if (st) status = st;
        if (st?.status === "failed") throw new PayKitError(st.error || "The payment failed onchain.");
        if (rc?.onchain?.verified) {
          s.result = { paymentId: q.paymentId, txUrl: status?.txUrl ?? null, pointsEarned: rc.payment?.pointsEarned ?? q.points?.earned ?? 0 };
          s.step = "done";
          // Notify the shop immediately, even if the shopper reloads before pressing Done.
          try { options.onPaid?.({ status: "paid", ...s.result }); } catch { /* host callback must not change a settled payment */ }
          s.invoice = await api(`/v1/public/invoices/${encodeURIComponent(options.invoiceId)}`).catch(() => s.invoice);
          render();
          return;
        }
      }
      throw new PayKitError("Still waiting for the chain. It may settle in a moment; check your PayKit wallet.");
    } catch (e) {
      s.error = errorText(e);
      s.step = "idle";
      render();
    }
  }

  box.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-a]");
    if (!t) return;
    const a = t.dataset.a;
    if (isBusy() || closed) return;
    if (a === "close") close({ status: "closed" });
    if (a === "finish") close(s.result ? { status: "paid", ...s.result } : { status: "closed" });
    if (a === "reward") { s.reward = s.reward === t.dataset.id ? null : t.dataset.id; render(); }
    if (a === "pay") void pay();
    if (a === "connect") {
      s.error = "";
      if (!provider()) { window.open("https://metamask.io/download/", "_blank", "noopener"); s.error = "Install MetaMask, then reload this page to pay."; render(); return; }
      s.step = "connect"; render();
      try { const c = await connect(); s.eth = c.eth; s.account = c.account; await loadOffers(); }
      catch (err) { s.error = errorText(err); }
      s.step = "idle";
      render();
    }
  });
  scrim.addEventListener("click", (e) => { if (e.target === scrim && s.step === "idle") close(s.result ? { status: "paid", ...s.result } : { status: "closed" }); });

  render();
  box.querySelector("button")?.focus();
  (options.demo && options.demoInvoice ? Promise.resolve(options.demoInvoice) : api(`/v1/public/invoices/${encodeURIComponent(options.invoiceId)}`))
    .then(async (inv) => {
      s.invoice = inv;
      render();
      // Already connected earlier? Pick the account up silently.
      const eth = provider();
      if (eth) {
        try { const acc = await ask(eth, "eth_accounts", undefined, 3000); if (!closed && s.step === "idle" && acc?.[0]) { s.eth = eth; s.account = acc[0]; await loadOffers(); } } catch { /* stay disconnected */ }
      }
      render();
    })
    .catch((e) => { s.error = errorText(e); render(); });

  return done;
}

export default { openCheckout };
