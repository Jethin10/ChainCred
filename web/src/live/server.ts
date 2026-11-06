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

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${SERVER_URL}${path}`, {
      method: init?.method ?? 'GET',
      headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
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

export type Invoice = {
  id: string
  status: string
  merchant?: { id: string; name: string }
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

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export async function connectWallet(): Promise<string> {
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  const eth = provider()
  if (!eth) throw new ServerError('No browser wallet found. Install MetaMask (or another wallet) to pay with USDT on Whitechain.')
  chosen = eth
  const [account] = (await eth.request({ method: 'eth_requestAccounts' })) as string[]
  if (!account) throw new ServerError('The wallet did not share an account.')
  await switchToWhitechain(eth)
  return account
}

/** Makes sure this site may use `account` right now (MetaMask answers 4100 otherwise). */
async function authorize(eth: Eip1193, account: string, force = false) {
  const allowed = force ? [] : ((await eth.request({ method: 'eth_accounts' })) as string[])
  if (allowed.some((a) => same(a, account))) return
  if (force) await eth.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] })
  const granted = (await eth.request({ method: 'eth_requestAccounts' })) as string[]
  if (!granted.some((a) => same(a, account))) {
    throw new ServerError(`Your wallet is now on ${granted[0] ?? 'another account'}. Reload the page and connect the account you want to pay from.`)
  }
}

async function switchToWhitechain(eth: Eip1193) {
  const current = (await eth.request({ method: 'eth_chainId' })) as string
  if (parseInt(current, 16) === 1874) return
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.chainId }] })
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw e
    await eth.request({ method: 'wallet_addEthereumChain', params: [CHAIN] })
  }
}

const DOMAIN_FIELDS: Array<[string, string]> = [['name', 'string'], ['version', 'string'], ['chainId', 'uint256'], ['verifyingContract', 'address'], ['salt', 'bytes32']]

/** eth_signTypedData_v4 with the EIP712Domain type the wallet needs. Free: no transaction, no gas. */
export async function signTypedData(account: string, data: TypedData): Promise<string> {
  const eth = provider()
  if (!eth) throw new ServerError('No browser wallet found.')
  await authorize(eth, account)
  await switchToWhitechain(eth)
  const EIP712Domain = DOMAIN_FIELDS.filter(([name]) => data.domain[name] !== undefined).map(([name, type]) => ({ name, type }))
  const params = [account.toLowerCase(), JSON.stringify({ ...data, types: { EIP712Domain, ...data.types } })]
  try {
    return (await eth.request({ method: 'eth_signTypedData_v4', params })) as string
  } catch (e) {
    if ((e as { code?: number }).code !== 4100) throw e
    await authorize(eth, account, true) // permission was lost: ask again, then retry once
    return (await eth.request({ method: 'eth_signTypedData_v4', params })) as string
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
