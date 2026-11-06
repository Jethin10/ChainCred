import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Window } from "happy-dom";

const browser = new Window({ url: "http://localhost/" });
for (const key of ["window", "document", "Event", "KeyboardEvent"]) globalThis[key] = key === "window" ? browser : browser[key];
const { openCheckout } = await import("../src/index.js");
const invoice = { id: "inv_test", amount: "2.5", amountDue: "2.5", status: "open", merchant: { name: "Tea shop" } };
const account = "0x1111111111111111111111111111111111111111";
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const click = (action) => {
  const button = document.querySelector(`[data-a="${action}"]`);
  assert.ok(button, `${action} is available`);
  button.click();
};
afterEach(() => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  document.body.innerHTML = "";
  delete window.ethereum;
});

test("renders the invoice even when a wallet's silent account lookup hangs", async () => {
  window.ethereum = { request: () => new Promise(() => {}) };
  globalThis.fetch = async () => Response.json(invoice);
  const done = openCheckout({ invoiceId: invoice.id });
  await tick();
  assert.match(document.body.textContent, /2\.50/);
  click("close");
  assert.deepEqual(await done, { status: "closed" });
});

test("shows an invoice loading error without claiming it is paid", async () => {
  globalThis.fetch = async () => Response.json({ error: { message: "Invoice not found" } }, { status: 404 });
  const done = openCheckout({ invoiceId: invoice.id });
  await tick();
  assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /Invoice not found/);
  assert.doesNotMatch(document.body.textContent, /already paid/);
  click("close");
  await done;
});

test("signs on the shop and reports a verified receipt before closing", async () => {
  const calls = [];
  window.ethereum = { request: async ({ method, params }) => {
    calls.push(method);
    if (method === "eth_accounts") return [account];
    if (method === "eth_chainId") return "0x752";
    if (method === "eth_signTypedData_v4") {
      assert.equal(params[0], account);
      assert.ok(JSON.parse(params[1]).types.EIP712Domain);
      return "0xtestsignature";
    }
    throw new Error(`Unexpected wallet request ${method}`);
  } };
  let settled = false;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/offers?payer=" + account)) return Response.json({ enabled: false });
    if (url.endsWith("/quote")) return Response.json({ quoteId: "q_test", paymentId: "p_test", typedData: { domain: { name: "USDT", chainId: 1874 }, types: {}, primaryType: "ReceiveWithAuthorization", message: {} } });
    if (url.endsWith("/authorize")) {
      assert.equal(JSON.parse(options.body).signature, "0xtestsignature");
      settled = true;
      return Response.json({ status: "submitted" });
    }
    if (url.includes("/receipts/")) return Response.json({ onchain: { verified: true }, payment: { pointsEarned: 25 } });
    if (url.includes("/quotes/")) return Response.json({ status: "confirmed", txUrl: "https://example.com/tx/test" });
    return Response.json(settled ? { ...invoice, status: "paid", amountDue: "0" } : invoice);
  };
  let saved;
  const done = openCheckout({ invoiceId: invoice.id, onPaid: (result) => { saved = result; } });
  await tick();
  click("pay");
  for (let i = 0; i < 100 && !document.querySelector('[data-a="finish"]'); i++) await tick();
  assert.match(document.body.textContent, /receipt is saved/);
  assert.equal(saved?.paymentId, "p_test");
  assert.equal(calls.filter((m) => m === "eth_signTypedData_v4").length, 1);
  assert.equal(locationSafe(), "http://localhost/");
  click("finish");
  assert.equal((await done).status, "paid");
});

function locationSafe() { return window.location.href; }

test("demo connects the wallet and completes without authorizing or sending USDT", async () => {
  const methods = [];
  let connected = false;
  window.ethereum = { request: async ({ method }) => {
    methods.push(method);
    if (method === "eth_accounts") return connected ? [account] : [];
    if (method === "wallet_requestPermissions") { connected = true; return []; }
    if (method === "eth_chainId") return "0x752";
    throw new Error(`Demo must not call ${method}`);
  } };
  globalThis.fetch = async () => { assert.fail("Demo must not create invoices or submit payments"); };
  let saved;
  const done = openCheckout({ invoiceId: "local_order", demo: true, demoInvoice: invoice, onPaid: (result) => { saved = result; } });
  await tick();
  click("connect");
  await tick();
  assert.match(document.body.textContent, /Paying from 0x1111/);
  click("pay");
  assert.match(document.body.textContent, /Payment complete/);
  assert.equal(saved.status, "paid");
  assert.equal(saved.demo, true);
  assert.equal(saved.txUrl, null);
  assert.equal(methods.includes("wallet_requestPermissions"), true);
  assert.equal(methods.includes("eth_signTypedData_v4"), false);
  assert.doesNotMatch(document.body.textContent, /demo|Settled on Whitechain/i);
  click("finish");
  assert.equal((await done).status, "paid");
});

test("a rejected signature stays unpaid and allows a retry", async () => {
  window.ethereum = { request: async ({ method }) => {
    if (method === "eth_accounts") return [account];
    if (method === "eth_chainId") return "0x752";
    throw Object.assign(new Error("Rejected"), { code: 4001 });
  } };
  let authorized = false;
  globalThis.fetch = async (url) => {
    if (url.endsWith("/quote")) return Response.json({ quoteId: "q_test", typedData: { domain: {}, types: {} } });
    if (url.endsWith("/authorize")) authorized = true;
    if (url.includes("/offers?")) return Response.json({ enabled: false });
    return Response.json(invoice);
  };
  const done = openCheckout({ invoiceId: invoice.id });
  await tick();
  click("pay");
  await tick();
  assert.match(document.body.textContent, /You declined/);
  assert.equal(authorized, false);
  assert.equal(document.querySelector('[data-a="pay"]').disabled, false);
  click("close");
  await done;
});
