// Platform-hosted merchants: the platform wallet is the onchain owner, a per-merchant hosted key
// signs quotes, and the merchant's own wallet is the payout (and funds refunds).
const { ethers, registry, adminWallet, txUrl } = require("../chain");
const config = require("../config");
const crypto = require("crypto");
const { HttpError, randomToken, sha256, encrypt, decrypt, parseAddress } = require("../util");

// Wallet sign-in sessions: stateless HMAC tokens "ms_<payload>.<sig>". The key comes from
// SESSION_SECRET, or is derived from MASTER_KEY so no extra configuration is needed.
const SESSION_TTL_SEC = Number(process.env.SESSION_TTL_SEC || 7 * 24 * 3600);
const sessionKey = process.env.SESSION_SECRET
  ? Buffer.from(process.env.SESSION_SECRET, "utf8")
  : crypto.createHmac("sha256", config.masterKey).update("paykit:merchant-session:v1").digest();
const b64 = (buf) => Buffer.from(buf).toString("base64url");
const hmac = (data) => b64(crypto.createHmac("sha256", sessionKey).update(data).digest());

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

/** The exact text the payout wallet signs to open the merchant console (personal_sign). */
function loginMessage(payout, time) {
  return `PayKit merchant sign-in

Wallet: ${payout}
Time: ${time}

Sign in to my PayKit merchant console. This is free and moves no money.`;
}

function createMerchantService(store, relayer, webhooks) {
  /** Issues a session for a merchant. `sv` lets a key rotation or sign-out-everywhere revoke old ones. */
  function issueSession(m) {
    const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
    const payload = b64(JSON.stringify({ m: m.id, a: m.payoutAddress, sv: m.sessionVersion || 0, exp }));
    return { token: `ms_${payload}.${hmac(payload)}`, expiresAt: new Date(exp * 1000).toISOString(), address: m.payoutAddress };
  }

  /** Returns the merchant for a valid session token, else null. */
  async function bySession(token) {
    if (!token || !token.startsWith("ms_")) return null;
    const [payload, sig] = token.slice(3).split(".");
    if (!payload || !sig) return null;
    const want = hmac(payload);
    if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
    let p;
    try { p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return null; }
    if (!p || typeof p.exp !== "number" || p.exp * 1000 < Date.now()) return null;
    const m = await store.get("merchants", p.m);
    if (!m || m.payoutAddress !== p.a || (m.sessionVersion || 0) !== p.sv) return null;
    return m;
  }

  /** Is this wallet a merchant? Public, used to pick sign-in vs sign-up. */
  async function lookupWallet(address) {
    const payout = parseAddress(address, "address");
    const m = await store.findOne("merchants", { payoutAddress: payout });
    return m ? { merchant: true, name: m.name, accent: m.profile?.accent || null } : { merchant: false };
  }

  /** Wallet sign-in: the payout wallet signs a fresh, timestamped message. */
  async function login(body) {
    const payout = parseAddress(body.address, "address");
    const at = Date.parse(body.time);
    if (!Number.isFinite(at) || Math.abs(Date.now() - at) > 10 * 60_000) throw new HttpError(400, "stale_signature", "Signature expired, sign again");
    let signer;
    try { signer = ethers.verifyMessage(loginMessage(payout, body.time), String(body.signature || "")); } catch { signer = null; }
    if (!signer || signer !== payout) throw new HttpError(401, "invalid_signature", "The signature must come from this wallet");
    const m = await store.findOne("merchants", { payoutAddress: payout });
    if (!m) throw new HttpError(404, "not_a_merchant", "This wallet has no PayKit merchant account yet");
    return { merchant: publicMerchant(m), session: issueSession(m) };
  }

  /** New API key; the old one stops working immediately. Session-only (see api.js). */
  async function rotateApiKey(merchant) {
    const apiKey = randomToken("pk_test");
    await store.update("merchants", merchant.id, { apiKeyHash: sha256(apiKey) });
    return { apiKey };
  }

  /** Ends every session of this merchant (all devices). */
  async function signOutEverywhere(merchant) {
    await store.update("merchants", merchant.id, { sessionVersion: (merchant.sessionVersion || 0) + 1 });
    return { ok: true };
  }

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
    return { merchant: publicMerchant(m), apiKey, webhookSecret, session: issueSession(m) };
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

  return {
    create, onboard, byApiKey, update, signerOf, publicMerchant, sendTestWebhook,
    login, lookupWallet, bySession, issueSession, rotateApiKey, signOutEverywhere,
  };
}

module.exports = { onboardingMessage, loginMessage, createMerchantService };
