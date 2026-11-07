// Local privacy lock. Wallet/server authorization remains separate.
export type DeviceCredential = { id: string; publicKey: string; createdAt: string }
const KEY = 'paykit:device-credential:v1'
const encode = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const decode = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
export function deviceCredential(): DeviceCredential | null {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || 'null') as DeviceCredential | null
    return data?.id && data.publicKey ? data : null
  } catch { return null }
}
export async function supportsDeviceUnlock() {
  const validHost = location.hostname === 'localhost' || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(location.hostname) && !location.hostname.includes(':')
  return validHost && window.isSecureContext && typeof PublicKeyCredential !== 'undefined' && typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function' && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false)
}
function checkClient(data: ArrayBuffer, challenge: Uint8Array, type: string) {
  const client = JSON.parse(new TextDecoder().decode(data))
  if (client.type !== type || client.challenge !== encode(challenge) || client.origin !== location.origin || client.crossOrigin === true) throw new Error('Device verification did not match this app. Try again.')
}
export async function enrollDevice(): Promise<DeviceCredential> {
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const credential = await navigator.credentials.create({ publicKey: {
    challenge, rp: { name: 'ChainCred', id: location.hostname },
    user: { id: crypto.getRandomValues(new Uint8Array(32)), name: 'paykit-device', displayName: 'ChainCred on this device' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    attestation: 'none', timeout: 60_000,
    ...(deviceCredential() ? { excludeCredentials: [{ type: 'public-key' as const, id: decode(deviceCredential()!.id) }] } : {}),
  } }) as PublicKeyCredential | null
  if (!credential) throw new Error('Device unlock was not set up. Try again when you are ready.')
  const response = credential.response as AuthenticatorAttestationResponse
  checkClient(response.clientDataJSON, challenge, 'webauthn.create')
  const publicKey = response.getPublicKey?.()
  if (!publicKey || response.getPublicKeyAlgorithm() !== -7) throw new Error('This device cannot create a compatible unlock key.')
  const auth = new Uint8Array(response.getAuthenticatorData())
  if ((auth[32] & 5) !== 5) throw new Error('Verify with your fingerprint, face, or device PIN to continue.')
  const saved = { id: encode(credential.rawId), publicKey: encode(publicKey), createdAt: new Date().toISOString() }
  // Throws in storage-restricted browsers, so the UI never claims an unsaved lock is enabled.
  localStorage.setItem(KEY, JSON.stringify(saved))
  return saved
}
/** WebAuthn uses DER ECDSA signatures; Web Crypto expects IEEE P1363. */
export function signatureBytes(der: Uint8Array): Uint8Array<ArrayBuffer> {
  if (der[0] !== 0x30 || der[1] !== der.length - 2 || der[2] !== 2) throw new Error('Invalid device signature')
  const rLength = der[3], sStart = 4 + rLength
  if (der[sStart] !== 2 || sStart + 2 + der[sStart + 1] !== der.length) throw new Error('Invalid device signature')
  const result = new Uint8Array(64)
  const parts = [der.slice(4, sStart), der.slice(sStart + 2)]
  parts.forEach((part, index) => {
    if (part.length === 33 && part[0] === 0) part = part.slice(1)
    if (!part.length || part.length > 32) throw new Error('Invalid device signature')
    result.set(part, index * 32 + 32 - part.length)
  })
  return result
}
export async function unlockDevice(saved: DeviceCredential) {
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const credential = await navigator.credentials.get({ publicKey: {
    challenge, rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: decode(saved.id) }], userVerification: 'required', timeout: 60_000,
  } }) as PublicKeyCredential | null
  if (!credential || encode(credential.rawId) !== saved.id) throw new Error('Unlock was cancelled. Try again.')
  const response = credential.response as AuthenticatorAssertionResponse
  checkClient(response.clientDataJSON, challenge, 'webauthn.get')
  const auth = new Uint8Array(response.authenticatorData)
  const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(location.hostname)))
  if (auth.length < 37 || (auth[32] & 5) !== 5 || !rpHash.every((byte, i) => auth[i] === byte)) throw new Error('Device verification failed. Try again.')
  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', response.clientDataJSON))
  const signed = new Uint8Array(auth.length + clientHash.length)
  signed.set(auth); signed.set(clientHash, auth.length)
  const key = await crypto.subtle.importKey('spki', decode(saved.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signatureBytes(new Uint8Array(response.signature)), signed)) throw new Error('Device verification failed. Try again.')
}
export function removeDeviceCredential() { localStorage.removeItem(KEY) }
export function deviceError(error: unknown) {
  if (error instanceof DOMException && error.name === 'SecurityError') return 'Device unlock needs an HTTPS hostname or localhost. Open ChainCred at its secure website address.'
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'The request was cancelled or timed out. Try again when you are ready.'
  return error instanceof Error ? error.message : 'Could not verify this device. Try again.'
}
