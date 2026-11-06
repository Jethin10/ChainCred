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
    profile: m.profile || null,
    maxFeeBps: m.maxFeeBps,
    registerTx: m.registerTx,
    createdAt: m.createdAt,
  };
}

/** What a merchant shows customers on PayKit pages. Everything optional; unknown keys dropped. */
function cleanProfile(p) {
  if (!p || typeof p !== "object") return null;
  const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const website = str(p.website, 200);
  if (website && !/^https?:\/\//.test(website)) throw new HttpError(400, "invalid_website", "website must start with http(s)://");
  const accent = str(p.accent, 7);
  if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) throw new HttpError(400, "invalid_accent", "accent must be a hex colour like #1f3d2b");
  const out = { website, category: str(p.category, 40), tagline: str(p.tagline, 140), accent };
  return Object.values(out).some(Boolean) ? out : null;
}

/** The exact text the payout wallet signs to onboard (personal_sign). */
function onboardingMessage(name, payout, time) {
  return `PayKit merchant onboarding

Business: ${name}
Payout wallet: ${payout}
Time: ${time}

I control this wallet and want PayKit to send my sales to it.`;
}

function createMerchantService(store, relayer, webhooks) {
  async function create({ name, payoutAddress, webhookUrl, profile }) {
    if (!name || typeof name !== "string") throw new HttpError(400, "invalid_name", "name is required");
    profile = cleanProfile(profile);
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
      profile,
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

  async function update(merchant, { webhookUrl, profile }) {
    const patch = {};
    if (webhookUrl !== undefined) {
      if (webhookUrl && !/^https?:\/\//.test(webhookUrl)) throw new HttpError(400, "invalid_webhook", "webhookUrl must start with http(s)://");
      patch.webhookUrl = webhookUrl || null;
    }
    if (profile !== undefined) patch.profile = cleanProfile(profile);
    return publicMerchant(await store.update("merchants", merchant.id, patch));
  }

  function signerOf(merchant) {
    return new ethers.Wallet(decrypt(merchant.signerKeyEnc));
  }

  async function sendTestWebhook(merchant) {
    if (!merchant.webhookUrl) throw new HttpError(400, "no_webhook", "Set webhookUrl first");
    return webhooks.enqueue(merchant, "test.ping", { message: "Hello from PayKit" });
  }

  /**
   * Self-serve onboarding. The business proves it controls the payout wallet by signing a message
   * that names the business, the wallet and a fresh timestamp; one merchant per wallet, and a
   * platform-wide hourly cap (every registration costs the relayer gas).
   */
  async function onboard(body) {
    const payout = parseAddress(body.payoutAddress, "payoutAddress");
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    if (name.length < 2) throw new HttpError(400, "invalid_name", "Business name is required");
    const at = Date.parse(body.time);
    if (!Number.isFinite(at) || Math.abs(Date.now() - at) > 10 * 60_000) throw new HttpError(400, "stale_signature", "Signature expired, sign again");
    const message = onboardingMessage(name, payout, body.time);
    let signer;
    try { signer = ethers.verifyMessage(message, String(body.signature || "")); } catch { signer = null; }
    if (!signer || signer !== payout) throw new HttpError(401, "invalid_signature", "The signature must come from the payout wallet");
    if (await store.findOne("merchants", { payoutAddress: payout })) throw new HttpError(409, "already_onboarded", "This wallet already has a PayKit merchant account");
    const recent = (await store.find("merchants", {}, { limit: 25 })).filter((m) => Date.now() - Date.parse(m.createdAt) < 3600_000);
    if (recent.length >= 12) throw new HttpError(429, "busy", "Too many sign-ups this hour, try again soon");
    return create({ name, payoutAddress: payout, webhookUrl: body.webhookUrl, profile: body.profile });
  }

  return { create, onboard, byApiKey, update, signerOf, publicMerchant, sendTestWebhook };
}

module.exports = { onboardingMessage, createMerchantService };
