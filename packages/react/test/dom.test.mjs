// Runtime tests: real React rendering, effects and clicks in a fake DOM (happy-dom).
import "./dom-setup.mjs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { act, createElement as h, useState as PK_TEST_USE_STATE } from "react";
import { createRoot } from "react-dom/client";
import { privateKeyToAccount } from "viem/accounts";
import { createMockApi, MOCK_TEST_KEYS } from "@paykit/testing";
import * as PK from "../dist/index.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mount(node) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(node));
  return {
    el,
    text: () => el.textContent,
    button: (label) => [...el.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(label)),
    async click(target) {
      assert.ok(target, "element to click exists");
      await act(async () => target.click());
    },
    async until(check, ms = 4000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (check()) return;
        await act(async () => sleep(20));
      }
      assert.fail(`Timed out waiting. Page text: ${el.textContent.slice(0, 300)}`);
    },
    unmount: () => act(async () => root.unmount()),
  };
}

function setup(key = MOCK_TEST_KEYS.customer) {
  const mock = createMockApi({ latencyMs: 0, stepMs: 5 });
  const client = PK.createPayKitClient({ baseUrl: mock.baseUrl, fetch: mock.fetch, siwe: mock.siwe });
  const wallet = PK.fromLocalAccount(privateKeyToAccount(key), 1874);
  return { mock, client, wallet };
}

describe("runtime", () => {
  it("adds to cart and pays with one signature", async () => {
    const { mock, client, wallet } = setup();
    const ui = await mount(h(PK.PayKitProvider, { client, wallet }, h(PK.ProductGrid, { merchant: "chai-co" }), h(PK.Cart, { merchant: "chai-co" })));
    await ui.until(() => !!ui.el.querySelector('button[aria-label="Add Masala chai to cart"]'));
    await ui.click(ui.el.querySelector('button[aria-label="Add Masala chai to cart"]'));
    await ui.click(ui.button("Pay 2.50 USDT"));
    await ui.until(() => ui.text().includes("Keep shopping"));
    assert.equal(mock.db.payments.length, 1);
    assert.equal(mock.db.payments[0].gross, "2500000");
    await ui.unmount();
  });

  it("merchant signs in and sees the payment", async () => {
    const { mock, client, wallet } = setup(MOCK_TEST_KEYS.merchant);
    const product = mock.db.products[0];
    await client.checkout.pay({ merchant: "chai-co", items: [{ productId: product.id, quantity: 1 }] }, PK.fromLocalAccount(privateKeyToAccount(MOCK_TEST_KEYS.customer), 1874), { wait: { intervalMs: 5 } });
    const ui = await mount(h(PK.PayKitProvider, { client, wallet }, h(PK.MerchantGate, null, h(PK.SalesSummary), h(PK.PaymentsTable))));
    await ui.click(ui.button("Sign in with wallet"));
    await ui.until(() => ui.text().includes("You received") && ui.text().includes("2.45"));
    await ui.unmount();
  });
});

it("keeps polling when the viewed payment changes after a terminal result", async () => {
  const { client, wallet } = setup();
  const calls = [];
  const states = { A: "finalized", B: "queued" };
  client.payments.get = async (id) => { calls.push(id); return { status: states[id] }; };
  let change;
  function Probe() { const [id, setId] = PK_TEST_USE_STATE("A"); change = setId; const q = PK.usePayment(id); return h("span", null, q.data?.status ?? "loading"); }
  const ui = await mount(h(PK.PayKitProvider, { client, wallet }, h(Probe)));
  await ui.until(() => ui.text().includes("finalized"));
  await act(async () => change("B"));
  await ui.until(() => ui.text().includes("queued"));
  states.B = "finalized";
  await ui.until(() => calls.filter((id) => id === "B").length >= 2, 3500);
  assert.ok(ui.text().includes("finalized"));
  await ui.unmount();
});
it("controlled wallet disconnect requests update the connector and allow reconnect", async () => {
  const { client, wallet } = setup();
  function ControlledWallet() {
    const [connected, setConnected] = PK_TEST_USE_STATE(true);
    return h(PK.PayKitProvider, { client, wallet: connected ? wallet : null, onConnectRequest: () => setConnected(true), onDisconnectRequest: () => setConnected(false) }, h(PK.ConnectWallet));
  }
  const ui = await mount(h(ControlledWallet));
  await ui.until(() => !!ui.button("Disconnect"));
  await ui.click(ui.button("Disconnect"));
  await ui.until(() => !!ui.button("Connect wallet"));
  await ui.click(ui.button("Connect wallet"));
  await ui.until(() => !!ui.button("Disconnect"));
  await ui.unmount();
});
