// Platform-hosted merchants: the platform wallet is the onchain owner, a per-merchant hosted key
// signs quotes, and the merchant's own wallet is the payout (and funds refunds).
const { ethers, registry, adminWallet, txUrl } = require("../chain");
const config = require("../config");
const { HttpError, randomToken, sha256, encrypt, decrypt, parseAddress } = require("../util");

function publicMerchant(m) {
  return {
    id: m.id,
    name: m.name,
    payoutAddress: m.payoutAddress,
    ownerAddress: m.ownerAddress,
    signerAddress: m.signerAddress,
    webhookUrl: m.webhookUrl || null,
    maxFeeBps: m.maxFeeBps,
    registerTx: m.registerTx,
    createdAt: m.createdAt,
  };
}

function createMerchantService(store, relayer, webhooks) {
  async function create({ name, payoutAddress, webhookUrl }) {
    if (!name || typeof name !== "string") throw new HttpError(400, "invalid_name", "name is required");
    const payout = parseAddress(payoutAddress, "payoutAddress");
    if (webhookUrl && !/^https?:\/\//.test(webhookUrl)) throw new HttpError(400, "invalid_webhook", "webhookUrl must start with http(s)://");

    const signer = ethers.Wallet.createRandom();
    const metadata = { name, payout };
    const metadataHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(metadata)));

    // 1. register onchain (platform wallet is the owner)
    const reg = await relayer.submit(
      "registry.register",
      () => registry.register.staticCall(payout, config.merchantMaxFeeBps, metadataHash, ""),
      () => registry.register(payout, config.merchantMaxFeeBps, metadataHash, ""),
      { payout }
    );
    const rc = await reg.wait();
    // read the id from the event (predicting it could race with another registration)
    const ev = rc.logs
      .map((l) => {
        try {
          return registry.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((p) => p && p.name === "MerchantRegistered");
    if (!ev) throw new HttpError(500, "register_failed", "MerchantRegistered event not found");
    const merchantId = ev.args.merchantId;

    // 2. allow the hosted signer to sign quotes for it
    const ss = await relayer.submit(
      "registry.setSigner",
      () => registry.setSigner.staticCall(merchantId, signer.address, 0, true),
      () => registry.setSigner(merchantId, signer.address, 0, true),
      { merchantId }
    );
    await ss.wait();

    const apiKey = randomToken("pk_test");
    const webhookSecret = randomToken("whsec");
    const m = await store.insert("merchants", {
      id: merchantId,
      merchantId,
      name,
      payoutAddress: payout,
      ownerAddress: adminWallet.address,
      signerAddress: signer.address,
      signerKeyEnc: encrypt(signer.privateKey),
      apiKeyHash: sha256(apiKey),
      webhookUrl: webhookUrl || null,
      webhookSecret,
      maxFeeBps: config.merchantMaxFeeBps,
      registerTx: txUrl(reg.hash),
      setSignerTx: txUrl(ss.hash),
    });
    return { merchant: publicMerchant(m), apiKey, webhookSecret };
  }

  async function byApiKey(apiKey) {
    if (!apiKey) return null;
    return store.findOne("merchants", { apiKeyHash: sha256(apiKey) });
  }

  async function update(merchant, { webhookUrl }) {
    const patch = {};
    if (webhookUrl !== undefined) {
      if (webhookUrl && !/^https?:\/\//.test(webhookUrl)) throw new HttpError(400, "invalid_webhook", "webhookUrl must start with http(s)://");
      patch.webhookUrl = webhookUrl || null;
    }
    return publicMerchant(await store.update("merchants", merchant.id, patch));
  }

  function signerOf(merchant) {
    return new ethers.Wallet(decrypt(merchant.signerKeyEnc));
  }

  async function sendTestWebhook(merchant) {
    if (!merchant.webhookUrl) throw new HttpError(400, "no_webhook", "Set webhookUrl first");
    return webhooks.enqueue(merchant, "test.ping", { message: "Hello from PayKit" });
  }

  return { create, byApiKey, update, signerOf, publicMerchant, sendTestWebhook };
}

module.exports = { createMerchantService };
