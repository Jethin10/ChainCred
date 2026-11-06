import assert from 'node:assert/strict'
import { test } from 'node:test'
import { paymentTarget } from '../src/mobile/payment-link.ts'
import { unlockDevice } from '../src/mobile/biometric.ts'

globalThis.location = { origin: 'https://paykit.example', hostname: 'paykit.example' }
test('QR input accepts PayKit invoices and rejects arbitrary navigation', () => {
  assert.equal(paymentTarget('inv_abc123'), 'pay/inv_abc123')
  assert.equal(paymentTarget('https://paykit-app.vercel.app/#pay/inv_123'), 'pay/inv_123')
  assert.equal(paymentTarget('https://paykit.example/#pay/subscribe/plan_123'), 'pay/subscribe/plan_123')
  for (const value of ['javascript:alert(1)', 'https://evil.example/#pay/inv_123', 'https://paykit-app.vercel.app.evil.example/#pay/inv_1', '#pay/../merchant', '0x123', 'https://paykit-app.vercel.app/evil#pay/inv_123']) assert.throws(() => paymentTarget(value))
})

const b64 = (bytes) => Buffer.from(bytes).toString('base64url')
const rawId = new Uint8Array([1, 2, 3, 4])
function derSignature(raw) {
  const integer = (part) => {
    while (part.length > 1 && part[0] === 0) part = part.slice(1)
    if (part[0] & 0x80) part = Buffer.concat([Buffer.from([0]), part])
    return Buffer.concat([Buffer.from([2, part.length]), part])
  }
  const r = integer(Buffer.from(raw).subarray(0, 32)), s = integer(Buffer.from(raw).subarray(32))
  return Buffer.concat([Buffer.from([0x30, r.length + s.length]), r, s])
}
test('device unlock verifies signature, origin, challenge and user verification', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const saved = { id: b64(rawId), publicKey: b64(await crypto.subtle.exportKey('spki', keys.publicKey)), createdAt: new Date().toISOString() }
  let failure = ''
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { credentials: { get: async ({ publicKey }) => {
    const client = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge: failure === 'challenge' ? 'wrong' : b64(publicKey.challenge), origin: failure === 'origin' ? 'https://evil.example' : location.origin }))
    const auth = new Uint8Array(37)
    auth.set(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(location.hostname))))
    auth[32] = failure === 'verification' ? 1 : 5
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', client))
    const signed = new Uint8Array(69); signed.set(auth); signed.set(hash, 37)
    const signature = derSignature(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, signed))
    if (failure === 'signature') signature[signature.length - 1] ^= 1
    return { rawId, response: { clientDataJSON: client.buffer, authenticatorData: auth.buffer, signature } }
  } } } })
  await unlockDevice(saved)
  for (const mode of ['challenge', 'origin', 'verification', 'signature']) { failure = mode; await assert.rejects(() => unlockDevice(saved), undefined, `${mode} must fail`) }
})
