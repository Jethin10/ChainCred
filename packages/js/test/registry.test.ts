import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPayKitClient, fromLocalAccount, isPayKitError, splitByBps } from "../src/index.ts";
import { createMockApi } from "../src/mock.ts";

const CHAIN = 1874;
const owner = fromLocalAccount(privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"), CHAIN);
const wallet = () => fromLocalAccount(privateKeyToAccount(generatePrivateKey()), CHAIN);

async function signedInMerchant() {
  const mock = createMockApi({ latencyMs: 0, stepMs: 10 });
  const c = createPayKitClient({ baseUrl: mock.baseUrl, fetch: mock.fetch, siwe: mock.siwe });
  await c.auth.login(owner);
  return { c, mock };
}

describe("merchant registry changes", () => {
  it("registers and disables a server key", async () => {
    const { c } = await signedInMerchant();
    const key = privateKeyToAccount(generatePrivateKey()).address;
    const added = await c.merchant.signers.add(key, owner);
    assert.equal(added.status, "included");
    assert.equal((await c.merchant.signers.list())[0]?.status, "active");
    await c.merchant.signers.disable(key, owner);
    assert.equal((await c.merchant.signers.list())[0]?.status, "disabled");
  });

  it("only the owner wallet can sign registry changes", async () => {
    const { c } = await signedInMerchant();
    await assert.rejects(
      () => c.merchant.signers.add(privateKeyToAccount(generatePrivateKey()).address, wallet()),
      (e: unknown) => isPayKitError(e) && e.code === "signature_invalid",
    );
  });

  it("creates a 90/8/2 split profile", async () => {
    const { c } = await signedInMerchant();
    const [a, b, d] = [wallet(), wallet(), wallet()];
    const recipients = [
      { address: await a.getAddress(), bps: 9000, label: "Seller" },
      { address: await b.getAddress(), bps: 800, label: "Platform" },
      { address: await d.getAddress(), bps: 200, label: "Affiliate" },
    ];
    await c.merchant.splits.create("Marketplace", recipients, owner);
    const profiles = await c.merchant.splits.list();
    assert.equal(profiles.length, 2); // default + new
    assert.equal(profiles[1]!.name, "Marketplace");
    assert.deepEqual(splitByBps(10_000_000n, profiles[1]!.recipients.map((r) => r.bps)), [9_000_000n, 800_000n, 200_000n]);
    await assert.rejects(() => c.merchant.splits.create("Bad", [{ address: recipients[0]!.address, bps: 5000 }], owner), /100%/);
  });

  it("changes the payout wallet with a proof from the new wallet", async () => {
    const { c } = await signedInMerchant();
    const next = wallet();
    const nextAddress = await next.getAddress();
    await assert.rejects(() => c.merchant.changePayout(nextAddress, owner, wallet()), /new payout wallet/);
    const result = await c.merchant.changePayout(nextAddress, owner, next);
    assert.equal(result.action, "queue_payout");
    assert.equal((await c.merchant.get())?.pendingPayout?.address, await next.getAddress());
    assert.equal((await c.merchant.get())?.payout, await owner.getAddress());
  });

  it("signs the well-known domain file with the owner wallet", async () => {
    const { c } = await signedInMerchant();
    const challenge = await c.merchant.domains.start("chai.example");
    const file = await c.merchant.domains.signWellKnownFile(challenge, owner);
    const parsed = JSON.parse(file);
    assert.match(parsed.ownerSignature, /^0x[0-9a-f]+$/);
    assert.equal(parsed.merchantId, challenge.wellKnownBody.merchantId);
  });
});
