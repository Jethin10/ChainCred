/** QR input never navigates to an arbitrary site or initiates payment. */
export function paymentTarget(input: string): string {
  let value = input.trim()
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value)
    const allowed = new Set([location.origin, 'https://paykit-app.vercel.app'])
    if (!allowed.has(url.origin) || url.pathname !== '/') throw new Error('Scan a PayKit invoice QR or paste its invoice ID.')
    value = url.hash
  }
  value = value.replace(/^#?pay\//, '')
  if (/^inv_[a-zA-Z0-9_-]{1,128}$/.test(value)) return `pay/${value}`
  if (/^subscribe\/[a-zA-Z0-9_-]{1,128}$/.test(value)) return `pay/${value}`
  throw new Error('This is not a PayKit invoice. Try another QR or paste a payment link.')
}
