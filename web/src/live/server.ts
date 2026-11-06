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
const provider = (): Eip1193 | null => (window as { ethereum?: Eip1193 }).ethereum ?? null

export const hasWallet = () => provider() !== null

export async function connectWallet(): Promise<string> {
  const eth = provider()
  if (!eth) throw new ServerError('No browser wallet found. Install MetaMask (or another wallet) to pay with USDT on Whitechain.')
  const [account] = (await eth.request({ method: 'eth_requestAccounts' })) as string[]
  if (!account) throw new ServerError('The wallet did not share an account.')
  await switchToWhitechain(eth)
  return account
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
  await switchToWhitechain(eth)
  const EIP712Domain = DOMAIN_FIELDS.filter(([name]) => data.domain[name] !== undefined).map(([name, type]) => ({ name, type }))
  const payload = { ...data, types: { EIP712Domain, ...data.types } }
  return (await eth.request({ method: 'eth_signTypedData_v4', params: [account, JSON.stringify(payload)] })) as string
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
export const usdt = (v: string) => `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDT`
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function errorText(e: unknown): string {
  const code = (e as { code?: number }).code
  if (code === 4001) return 'You declined the request in your wallet. Nothing was signed.'
  return e instanceof Error ? e.message : String(e)
}
