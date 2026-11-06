const crypto = require("crypto");
const { ethers } = require("ethers");
const config = require("./config");

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const uid = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
const randomToken = (prefix) => `${prefix}_${crypto.randomBytes(24).toString("base64url")}`;
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const nowSec = () => Math.floor(Date.now() / 1000);

/** "12.5" -> 12500000n. Rejects more than 6 decimals, negatives, junk. */
function parseUsdt(v, field = "amount") {
  const s = String(v ?? "").trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new HttpError(400, "invalid_amount", `${field} must be a USDT amount like "12.50" (max 6 decimals)`);
  const n = ethers.parseUnits(s, 6);
  if (n <= 0n) throw new HttpError(400, "invalid_amount", `${field} must be greater than 0`);
  return n;
}
const fmtUsdt = (n) => ethers.formatUnits(BigInt(n), 6);

function parseAddress(v, field) {
  if (!v || !ethers.isAddress(v)) throw new HttpError(400, "invalid_address", `${field} must be a valid 0x address`);
  return ethers.getAddress(v);
}

// AES-256-GCM for hosted signer keys at rest
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", config.masterKey, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
function decrypt(blob) {
  const [iv, tag, enc] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", config.masterKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

/** JSON.stringify that turns BigInt into strings. */
const toJson = (o) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

module.exports = { HttpError, uid, randomToken, sha256, nowSec, parseUsdt, fmtUsdt, parseAddress, encrypt, decrypt, toJson };
