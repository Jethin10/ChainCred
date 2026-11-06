// Client for the live PayKit server (paykit-server on Vercel) and the browser wallet that pays on
// Whitechain testnet. Pay links from the server open this app at #pay/<invoiceId>, plan links at
// #pay/subscribe/<planId>.

export const SERVER_URL = ((import.meta.env.VITE_PAYKIT_SERVER_URL as string | undefined) || 'https://paykit-server.vercel.app').replace(/\/$/, '')
export const EXPLORER = 'https://explorer.testnet.whitechain.io'

const CHAIN = {
  chainId: '0x752', // 1874
  chainName: 'Whitechain Testnet',
  nativeCurrency: { name: 'WBT', symbol: 'WBT', decimals: 18 },
  rpcUrls: ['https://rpc.testnet.whitechain.io'],
  blockExplorerUrls: [EXPLORER],
}

export class ServerError extends Error {
  code?: string
  status?: number
  constructor(message: string, code?: string, status?: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown; key?: string }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${SERVER_URL}${path}`, {
      method: init?.method ?? 'GET',
      headers: { ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(init?.key ? { authorization: `Bearer ${init.key}` } : {}) },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new ServerError('Could not reach the PayKit server. Check your connection and try again.')
  }
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const err = data?.error ?? {}
    throw new ServerError(err.message ?? `Request failed (${res.status})`, err.code, res.status)
  }
  return data as T
}

// ── server shapes (only the fields the pages use) ──

export type MerchantProfile = { website: string | null; category: string | null; tagline: string | null; accent: string | null }
export type Invoice = {
  id: string
  status: string
  merchant?: { id: string; name: string; profile?: MerchantProfile | null }
  reference: string | null
  description: string | null
  amount: string
  amountPaid: string
  amountDue: string
  payerAddress: string | null
  successUrl: string | null
}
export type Offer = { id: string; name: string; pointsCost: number; available: boolean; discount?: string; payAfter?: string; message?: string; willEarn?: number }
export type Offers = { enabled?: boolean; balance: number; willEarn: number; offers: Offer[] }
export type TypedData = { domain: Record<string, unknown>; types: Record<string, Array<{ name: string; type: string }>>; primaryType: string; message: Record<string, unknown> }
export type Quote = {
  quoteId: string
  amount: string
  discount: string
  gross: string
  paymentId: string
  points: { earned: number; redeemed: number; reward: { id: string; name: string } | null }
  typedData: TypedData
}
export type QuoteStatus = { quoteId: string; status: string; paymentId: string; txHash: string | null; txUrl: string | null; error: string | null }
export type Receipt = { merchant: { name?: string }; onchain: { verified: boolean; gross: string; fee: string; discount: string; settledAt: string | null; payer: string }; payment: { pointsEarned: number; pointsRedeemed: number; txHash?: string } | null }
export type Plan = { id: string; kind: string; merchant?: { name: string }; name: string; description: string | null; amount: string; interval: string; cycles: number; chargedAtSignup: string; scheduledCharges: number; total: string; active: boolean }
export type Subscribe = { subscriptionId: string; summary: { chargedNow: string; then: string; total: string; firstScheduledCharge: string; pointsPerCharge: number }; typedData: { permit: TypedData; consent: TypedData } }
export type Subscription = { id: string; status: string; amount: string; chargesPaid: number; amountPaid: string; nextChargeAt: string | null; scheduledChargesCollected: number; scheduledChargesTotal: number }

// ── browser wallet (EIP-1193) ──

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> }
type Announced = { info: { rdns?: string; name?: string }; provider: Eip1193 }

// EIP-6963: wallets announce themselves, so we can pick MetaMask even when another extension
// (or a browser's built-in wallet) has taken window.ethereum.
const announced: Announced[] = []
if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (e) => {
    const d = (e as CustomEvent<Announced>).detail
    if (d?.provider && !announced.some((a) => a.provider === d.provider)) announced.push(d)
  })
  window.dispatchEvent(new Event('eip6963:requestProvider'))
}
let chosen: Eip1193 | null = null
const provider = (): Eip1193 | null => {
  if (chosen) return chosen
  const mm = announced.find((a) => a.info.rdns === 'io.metamask') ?? announced[0]
  return mm?.provider ?? (window as { ethereum?: Eip1193 }).ethereum ?? null
}

export const hasWallet = () => provider() !== null
export const isMobileWallet = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const MINUTE = 60_000

/** A wallet request that can't hang the page: after `ms` it fails with a clear next step. */
async function ask<T>(eth: Eip1193, method: string, params?: unknown[], ms = 2 * MINUTE): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ServerError('MetaMask did not answer. Click the MetaMask icon in your toolbar to see the pending request, or press the button again.', 'wallet_timeout')), ms)
  })
  try {
    return (await Promise.race([eth.request({ method, params }), timeout])) as T
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Asks MetaMask for this site's permissions: the account, and Whitechain testnet as a permitted
 * network. MetaMask keeps both per site; without the network it answers signatures with 4100.
 */
async function grant(eth: Eip1193): Promise<string[]> {
  try {
    await ask(eth, 'wallet_requestPermissions', [
      { eth_accounts: {}, 'endowment:permitted-chains': { caveats: [{ type: 'restrictNetworkSwitching', value: [CHAIN.chainId] }] } },
    ])
  } catch (e) {
    const code = (e as { code?: number }).code
    if (code === 4001 || (e as { code?: string }).code === 'wallet_timeout') throw e
    // Older MetaMask (or another wallet) without per-site networks: accounts only.
    await ask(eth, 'wallet_requestPermissions', [{ eth_accounts: {} }])
  }
  return ask<string[]>(eth, 'eth_accounts')
}

/** The account this site may already use, without prompting (null when not connected). */
export async function knownAccount(): Promise<string | null> {
  const eth = provider()
  if (!eth) return null
  try {
    const accounts = (await eth.request({ method: 'eth_accounts' })) as string[]
    return accounts[0] ?? null
  } catch {
    return null
  }
}

export async function connectWallet(): Promise<string> {
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  const eth = provider()
  if (!eth) {
    if (isMobileWallet()) {
      window.location.href = `https://link.metamask.io/dapp/${location.host}${location.pathname}${location.search}${location.hash}`
      throw new ServerError('Continue in MetaMask to connect your wallet, then return to PayKit when you are done.')
    }
    window.open('https://metamask.io/download/', '_blank', 'noopener,noreferrer')
    throw new ServerError('Install MetaMask, then return here to connect your wallet.')
  }
  chosen = eth
  let accounts = await ask<string[]>(eth, 'eth_accounts')
  if (!accounts.length) accounts = await grant(eth)
  await switchToWhitechain(eth)
  if (!accounts[0]) throw new ServerError('MetaMask did not share an account.')
  return accounts[0]
}

/** Re-grants the site's permissions after MetaMask refused one (error 4100). Call from a click. */
export async function reconnectWallet(): Promise<string> {
  const eth = provider()
  if (!eth) throw new ServerError('MetaMask not found.')
  chosen = eth
  const accounts = await grant(eth)
  await switchToWhitechain(eth)
  if (!accounts[0]) throw new ServerError('MetaMask did not share an account.')
  return accounts[0]
}

async function switchToWhitechain(eth: Eip1193) {
  const current = await ask<string>(eth, 'eth_chainId')
  if (parseInt(current, 16) === 1874) return
  try {
    await ask(eth, 'wallet_switchEthereumChain', [{ chainId: CHAIN.chainId }])
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw e
    await ask(eth, 'wallet_addEthereumChain', [CHAIN])
  }
}

/** personal_sign: a plain message the wallet shows as text. Free, no transaction. */
export async function signMessage(account: string, message: string): Promise<string> {
  const eth = provider()
  if (!eth) throw new ServerError('MetaMask not found.')
  const hex = '0x' + Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, '0')).join('')
  return ask<string>(eth, 'personal_sign', [hex, account], 5 * MINUTE)
}

const DOMAIN_FIELDS: Array<[string, string]> = [['name', 'string'], ['version', 'string'], ['chainId', 'uint256'], ['verifyingContract', 'address'], ['salt', 'bytes32']]

/** eth_signTypedData_v4 with the EIP712Domain type the wallet needs. Free: no transaction, no gas. */
export async function signTypedData(account: string, data: TypedData): Promise<string> {
  const eth = provider()
  if (!eth) throw new ServerError('MetaMask not found.')
  const allowed = await ask<string[]>(eth, 'eth_accounts')
  if (!allowed.some((a) => same(a, account))) {
    throw new ServerError('MetaMask is not connected to this account any more. Reconnect MetaMask and try again.', 'wallet_unauthorized')
  }
  await switchToWhitechain(eth)
  const EIP712Domain = DOMAIN_FIELDS.filter(([name]) => data.domain[name] !== undefined).map(([name, type]) => ({ name, type }))
  const params = [account, JSON.stringify({ ...data, types: { EIP712Domain, ...data.types } })]
  try {
    return await ask<string>(eth, 'eth_signTypedData_v4', params, 5 * MINUTE)
  } catch (e) {
    if ((e as { code?: number }).code === 4100) {
      throw new ServerError('MetaMask has not allowed this site to sign on Whitechain yet. Press "Reconnect MetaMask", approve the account and the Whitechain network, then pay again.', 'wallet_unauthorized')
    }
    throw e
  }
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
export const usdt = (v: string) => `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDT`
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function errorText(e: unknown): string {
  const code = (e as { code?: number }).code
  if (code === 4001) return 'You declined the request in your wallet. Nothing was signed.'
  console.error('[paykit] payment error', e)
  if (e instanceof Error) return e.message
  // Wallets reject with plain objects: { code, message, data }.
  const o = e as { message?: unknown; data?: { message?: unknown }; error?: { message?: unknown } } | null
  const msg = o?.message ?? o?.data?.message ?? o?.error?.message
  if (typeof msg === 'string' && msg) return code !== undefined ? `${msg} (wallet error ${code})` : msg
  try { return JSON.stringify(e) } catch { return String(e) }
}

// ── wallet page shapes ──
export type Activity = {
  id: string
  merchant: { id: string; name?: string }
  invoice: { id: string; reference: string | null; description: string | null; amount: string; status: string } | null
  reference: string | null
  gross: string
  fee: string
  discount: string
  pointsEarned: number
  pointsRedeemed: number
  refunded: string
  kind: string
  txUrl: string | null
  settledAt: string | null
}
export type PointsWallet = {
  balance: number
  lifetimeEarned: number
  lifetimeRedeemed: number
  history: Array<{ type: string; amount: number; merchantName: string | null; at: string; txUrl: string | null }>
}
export type MarketReward = { id: string; merchant: { name: string }; name: string; label: string; pointsCost: number }

/** The demo companies that sell through PayKit (their own websites). */
export const COMPANIES = [
  {
    name: 'Kettle & Leaf',
    url: (import.meta.env.VITE_STORE_KETTLE_URL as string | undefined) || 'https://kettle-and-leaf-five.vercel.app',
    blurb: 'Single-estate teas from Assam to Kashmir, packed by hand in Mumbai.',
    kind: 'Tea house',
    reward: '20 points → 1 USDT off',
    tone: 'tea',
  },
  {
    name: 'Paper Lantern Books',
    url: (import.meta.env.VITE_STORE_LANTERN_URL as string | undefined) || 'https://paper-lantern-books.vercel.app',
    blurb: 'An independent bookshop for slow readers and night owls.',
    kind: 'Bookshop',
    reward: '25 points → 15% off',
    tone: 'books',
  },
] as const

// ── merchant onboarding + console ──
export type Merchant = { id: string; name: string; payoutAddress: string; webhookUrl: string | null; profile: MerchantProfile | null; registerTx: string | null; createdAt: string }
export type Onboarded = { merchant: Merchant; apiKey: string; webhookSecret: string; campaign: { id: string } | null; reward: { id: string } | null; warnings: string[] }
export type MerchantInvoice = Invoice & { payUrl: string; createdAt: string; amountDue: string }
export type Campaign = { id: string; name: string; pointsPerUsdt: number; issued: number; status?: string }
export type Reward = { id: string; name: string; label: string; pointsCost: number; redeemed: number; status?: string }

/** The exact text the payout wallet signs (must match paykit-server's onboardingMessage). */
export const onboardingMessage = (name: string, payout: string, time: string) =>
  `PayKit merchant onboarding

Business: ${name}
Payout wallet: ${payout}
Time: ${time}

I control this wallet and want PayKit to send my sales to it.`
