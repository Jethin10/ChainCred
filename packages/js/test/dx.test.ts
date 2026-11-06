import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPayKitClient, fromLocalAccount, parseUsdt } from "../src/index.ts";
import { createMockApi, MOCK_TEST_KEYS } from "../src/mock.ts";

const CHAIN = 1874;
const wallet = () => fromLocalAccount(privateKeyToAccount(generatePrivateKey()), CHAIN);

function setup() {
  const mock = createMockApi({ latencyMs: 0, stepMs: 5 });
  const c = createPayKitClient({ baseUrl: mock.baseUrl, fetch: mock.fetch, siwe: mock.siwe });
  return { mock, c };
}

describe("accountant export", () => {
  it("exports balanced double-entry journal lines", async () => {
    const { c } = setup();
    const [product] = await c.merchants.products("chai-co");
    await c.checkout.pay({ merchant: "chai-co", items: [{ productId: product!.id, quantity: 2 }] }, wallet(), { wait: { intervalMs: 5 } });
    const merchant = createPayKitClient({ baseUrl: c.options.baseUrl, fetch: c.options.fetch, siwe: c.options.siwe });
    await merchant.auth.login(fromLocalAccount(privateKeyToAccount(MOCK_TEST_KEYS.merchant), CHAIN));
    const csv = await merchant.merchant.exportJournal();
    const lines = csv.trim().split("\n");
    assert.equal(lines[0], "date,entry,reference,account,debit,credit,asset,tx_hash,mapping_version");
    assert.equal(lines.length, 4); // header + 3 lines for one payment
    let debit = 0;
    let credit = 0;
    for (const line of lines.slice(1)) {
      const cols = line.split(",");
      debit += Number(cols[4] || 0);
      credit += Number(cols[5] || 0);
    }
    assert.equal(debit.toFixed(6), credit.toFixed(6));
    assert.equal(credit, 5);
  });
});
