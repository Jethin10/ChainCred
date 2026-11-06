// Renders every component to HTML (built dist) to catch runtime errors and check copy.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { privateKeyToAccount } from "viem/accounts";
import * as PK from "../dist/index.js";
import { createMockApi } from "@paykit/testing";

const mock = createMockApi({ latencyMs: 0, stepMs: 5 });
const client = PK.createPayKitClient({ baseUrl: mock.baseUrl, fetch: mock.fetch, siwe: mock.siwe });
const wallet = PK.fromLocalAccount(privateKeyToAccount("0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e"), 1874);

// React separates adjacent text with <!-- --> markers; drop them so assertions read naturally.
const render = (node, props = {}) => renderToString(h(PK.PayKitProvider, { client, wallet, ...props }, node)).replace(/<!-- -->/g, "");

const sampleMerchant = mock.db.merchants[0];
const samplePayment = {
  paymentId: `0x${"ab".repeat(32)}`, merchantSlug: "chai-co", merchantName: "Mumbai Chai Co.", invoiceId: null, planId: null, kind: "one_time",
  payer: wallet ? "0x976EA74026E726554dB657fA54763abd0C3a0aa9" : "", refundTo: "0x976EA74026E726554dB657fA54763abd0C3a0aa9", token: "USDT",
  gross: "2500000", fee: "50000", net: "2450000", refunded: "0", status: "included", txHash: `0x${"cd".repeat(32)}`, blockNumber: "1",
  explorerUrl: "https://explorer.testnet.whitechain.io/tx/0x1", error: null, createdAt: "2026-11-06T10:00:00Z", settledAt: "2026-11-06T10:00:05Z",
};

describe("component render", () => {
  const cases = {
    ConnectWallet: [PK.ConnectWallet, {}],
    MerchantGrid: [PK.MerchantGrid, {}],
    MerchantCard: [PK.MerchantCard, { merchant: sampleMerchant }],
    MerchantBadge: [PK.MerchantBadge, { merchant: sampleMerchant }],
    MerchantModal: [PK.MerchantModal, { merchant: null, onClose() {} }],
    ProductGrid: [PK.ProductGrid, { merchant: "chai-co" }],
    ProductCard: [PK.ProductCard, { product: mock.db.products[0], onAdd() {} }],
    Cart: [PK.Cart, { merchant: "chai-co" }],
    CheckoutButton: [PK.CheckoutButton, { input: { merchant: "chai-co", items: [] }, amount: "2500000" }],
    PaymentStatus: [PK.PaymentStatus, { payment: samplePayment }],
    ReceiptView: [PK.ReceiptView, { payment: samplePayment }],
    DepositPicker: [PK.DepositPicker, { total: "100000000", value: 30, onChange() {} }],
    InstallmentPlanPicker: [PK.InstallmentPlanPicker, { input: { invoiceId: "x" }, total: "45000000" }],
    InvoiceView: [PK.InvoiceView, { invoiceId: "inv_x" }],
    SignInGate: [PK.SignInGate, { children: "secret" }],
    PaymentHistory: [PK.PaymentHistory, {}],
    UpcomingPayments: [PK.UpcomingPayments, {}],
    PlanList: [PK.PlanList, {}],
    RefundList: [PK.RefundList, {}],
    MerchantGate: [PK.MerchantGate, { children: "dash" }],
    MerchantSignup: [PK.MerchantSignup, {}],
    SalesSummary: [PK.SalesSummary, {}],
    PaymentsTable: [PK.PaymentsTable, {}],
    RefundButton: [PK.RefundButton, { payment: samplePayment }],
    RefundsTable: [PK.RefundsTable, {}],
    PlansTable: [PK.PlansTable, {}],
    InvoiceCreator: [PK.InvoiceCreator, {}],
    ProductManager: [PK.ProductManager, {}],
    ApiKeys: [PK.ApiKeys, {}],
    WebhookSettings: [PK.WebhookSettings, {}],
    DomainSettings: [PK.DomainSettings, {}],
    PayoutSettings: [PK.PayoutSettings, {}],
    SignerSettings: [PK.SignerSettings, {}],
    SplitSettings: [PK.SplitSettings, {}],
  };
  for (const [name, [Component, props]] of Object.entries(cases)) {
    it(`renders ${name}`, () => {
      assert.equal(typeof Component, "function", `${name} is exported`);
      const html = render(h(Component, props));
      assert.ok(html.includes("pk-root"));
    });
  }

  it("shows the settlement track with the right step active", () => {
    const html = render(h(PK.PaymentStatus, { payment: samplePayment }));
    assert.match(html, /pk-track__step--done[^>]*>.*Sent/s);
    assert.match(html, /aria-current="step"/);
    assert.match(html, /2\.50/);
  });

  it("asks dashboards to sign in before showing data", () => {
    const html = render(h(PK.SignInGate, { children: "secret" }));
    assert.ok(!html.includes("secret"));
    assert.match(html, /Sign in with wallet/);
  });

  it("offers deposit options with exact amounts", () => {
    const html = render(h(PK.DepositPicker, { total: "100000000", value: 30, onChange() {} }));
    assert.match(html, /30% now/);
    assert.match(html, /30\.00/);
    assert.match(html, /then 70\.00 later/);
  });

  it("prompts for a wallet when none is connected", () => {
    const html = render(h(PK.WalletRequired, { children: "paid" }), { wallet: null });
    assert.match(html, /Connect wallet/);
    assert.match(html, /No gas or WBT needed/);
  });

  it("refuses to render outside the provider", () => {
    assert.throws(() => renderToString(h(PK.ConnectWallet)), /inside <PayKitProvider>/);
  });
});

describe("merchant export", () => {
  it("renders the accounting export button", () => {
    assert.match(render(h(PK.ExportButton, {})), /Download accounting export/);
  });
});
