"use client";

import {
  createPayKitClient,
  fromEip1193,
  isPayKitError,
  PayKitError,
  resolveNetwork,
  type CartItem,
  type NetworkKey,
  type PayKitClient,
  type Product,
  type WalletSession,
  type WalletSigner,
} from "@paykit/js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { getAddress, type Address, type Chain, type EIP1193Provider } from "viem";

export type WalletStatus = "disconnected" | "connecting" | "connected";

export interface WalletState {
  signer: WalletSigner | null;
  address: Address | null;
  chainId: number | null;
  status: WalletStatus;
  /** True when connected to a chain other than the one PayKit uses. */
  wrongNetwork: boolean;
}

export interface CartLine {
  product: Product;
  quantity: number;
}

export interface CartApi {
  /** Lines in the cart of one merchant (each shop has its own cart). */
  lines(merchantSlug: string): CartLine[];
  add(product: Product, quantity?: number): void;
  setQuantity(merchantSlug: string, productId: string, quantity: number): void;
  clear(merchantSlug: string): void;
  total(merchantSlug: string): bigint;
  count(merchantSlug: string): number;
  /** Items in API form, ready for checkout. */
  items(merchantSlug: string): CartItem[];
}

export interface PayKitContextValue {
  client: PayKitClient;
  chain: Chain;
  wallet: WalletState;
  connect(): Promise<WalletSigner>;
  disconnect(): void;
  switchNetwork(): Promise<void>;
  session: WalletSession | null;
  /** Signs in with the connected wallet (connecting it first if needed). */
  login(): Promise<WalletSession>;
  logout(): Promise<void>;
  cart: CartApi;
  /** Bumps when data changes (payment made, refund issued). Hooks refetch on it. */
  version: number;
  invalidate(): void;
  /** True when merchant data comes through the developer's backend instead of a wallet session. */
  merchantViaBackend: boolean;
}

const PayKitContext = createContext<PayKitContextValue | null>(null);

export const DEFAULT_API_URL = "https://api.paykit.app";

export interface PayKitProviderProps {
  /** Your publishable key (pk_…). */
  publishableKey?: string;
  /** PayKit API base URL. Default: https://api.paykit.app */
  apiUrl?: string;
  /** A client you created yourself, e.g. against the mock API (overrides publishableKey/apiUrl). */
  client?: PayKitClient;
  network?: NetworkKey;
  /** On your own site, merchant components fetch through this backend route (see @paykit/next). */
  merchantDataUrl?: string;
  /**
   * A wallet from your connect library (thirdweb, wagmi), wrapped with `fromSignerLike`,
   * `fromWalletClient` or `fromEip1193`. Leave undefined to let PayKit connect the browser
   * wallet (MetaMask, Rabby) itself. Pass null while disconnected.
   */
  wallet?: WalletSigner | null;
  /** Called when a component needs a wallet and `wallet` is controlled (e.g. open your connect modal). */
  onConnectRequest?: () => void | Promise<void>;
  /** Clear a controlled wallet in your connector when disconnect is requested. */
  onDisconnectRequest?: () => void;
  /** Force light or dark. Default follows the system. */
  theme?: "light" | "dark" | "system";
  children: ReactNode;
  className?: string;
  style?: CSSProperties & { [key: `--pk-${string}`]: string | number };
}

type Lines = Record<string, Record<string, CartLine>>;

function injectedProvider(): EIP1193Provider | undefined {
  return (globalThis as { ethereum?: EIP1193Provider }).ethereum;
}

export function PayKitProvider({ network = "whitechain-testnet", wallet: controlled, onConnectRequest, onDisconnectRequest, theme = "system", children, className, style, ...props }: PayKitProviderProps) {
  const client = useMemo(() => {
    if (props.client) return props.client;
    if (!props.publishableKey) throw new Error("[paykit] <PayKitProvider> needs `publishableKey` (pk_…) or a `client`.");
    return createPayKitClient({ baseUrl: props.apiUrl ?? DEFAULT_API_URL, publishableKey: props.publishableKey, network, merchantDataUrl: props.merchantDataUrl });
    // Created once; remount (key prop) to change keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const chain = useMemo(() => resolveNetwork(network).chain, [network]);
  const isControlled = controlled !== undefined;
  const [own, setOwn] = useState<WalletState>({ signer: null, address: null, chainId: null, status: "disconnected", wrongNetwork: false });
  const [external, setExternal] = useState<{ address: Address | null; chainId: number | null }>({ address: null, chainId: null });
  const [session, setSession] = useState<WalletSession | null>(() => client.auth.get());
  const [lines, setLines] = useState<Lines>({});
  const [version, setVersion] = useState(0);
  const pendingConnect = useRef<((signer: WalletSigner) => void) | null>(null);

  // Track address/chain of a controlled wallet.
  useEffect(() => {
    let live = true;
    if (!controlled) {
      setExternal({ address: null, chainId: null });
      return;
    }
    Promise.all([controlled.getAddress(), controlled.getChainId()])
      .then(([address, chainId]) => {
        if (!live) return;
        setExternal({ address, chainId: chainId === -1 ? null : chainId });
        pendingConnect.current?.(controlled);
        pendingConnect.current = null;
      })
      .catch(() => live && setExternal({ address: null, chainId: null }));
    return () => {
      live = false;
    };
  }, [controlled]);

  // Follow account and network changes of the injected wallet.
  useEffect(() => {
    const provider = injectedProvider();
    if (isControlled || !provider?.on) return;
    const onAccounts = (accounts: unknown) => {
      const first = Array.isArray(accounts) ? (accounts[0] as string | undefined) : undefined;
      setOwn((w) => (first ? { ...w, address: getAddress(first), signer: fromEip1193(provider) } : { signer: null, address: null, chainId: null, status: "disconnected", wrongNetwork: false }));
      setSession(null);
      void client.auth.logout();
    };
    const onChain = (hex: unknown) => {
      const id = Number(hex);
      setOwn((w) => ({ ...w, chainId: id, wrongNetwork: w.status === "connected" && id !== chain.id }));
    };
    provider.on("accountsChanged", onAccounts as never);
    provider.on("chainChanged", onChain as never);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts as never);
      provider.removeListener?.("chainChanged", onChain as never);
    };
  }, [isControlled, chain.id, client]);

  const wallet: WalletState = isControlled
    ? {
        signer: controlled ?? null,
        address: external.address,
        chainId: external.chainId,
        status: controlled ? "connected" : "disconnected",
        wrongNetwork: !!controlled && external.chainId !== null && external.chainId !== chain.id,
      }
    : own;

  const connect = useCallback(async (): Promise<WalletSigner> => {
    if (wallet.signer) return wallet.signer;
    if (isControlled) {
      if (!onConnectRequest) throw new PayKitError("wallet_not_connected", "Connect a wallet to continue");
      return new Promise<WalletSigner>((resolve, reject) => {
        const timer = setTimeout(() => { pendingConnect.current = null; reject(new PayKitError("wallet_not_connected", "Wallet connection was cancelled or timed out")); }, 60_000);
        pendingConnect.current = (signer) => { clearTimeout(timer); resolve(signer); };
        Promise.resolve().then(onConnectRequest).catch((error) => { clearTimeout(timer); pendingConnect.current = null; reject(error); });
      });
    }
    const provider = injectedProvider();
    if (!provider) throw new PayKitError("wallet_not_connected", "No browser wallet found. Install MetaMask or another wallet to pay.");
    setOwn((w) => ({ ...w, status: "connecting" }));
    try {
      const signer = fromEip1193(provider);
      const [address, chainId] = await Promise.all([signer.getAddress(), signer.getChainId()]);
      setOwn({ signer, address, chainId, status: "connected", wrongNetwork: chainId !== chain.id });
      return signer;
    } catch (error) {
      setOwn({ signer: null, address: null, chainId: null, status: "disconnected", wrongNetwork: false });
      throw error;
    }
  }, [wallet.signer, isControlled, onConnectRequest, chain.id]);

  const disconnect = useCallback(() => {
    setOwn({ signer: null, address: null, chainId: null, status: "disconnected", wrongNetwork: false });
    setSession(null);
    void client.auth.logout();
    onDisconnectRequest?.();
  }, [client, onDisconnectRequest]);

  const switchNetwork = useCallback(async () => {
    const signer = wallet.signer;
    if (!signer) return;
    await signer.switchChain(chain);
    const id = await signer.getChainId();
    if (isControlled) setExternal((e) => ({ ...e, chainId: id }));
    else setOwn((w) => ({ ...w, chainId: id, wrongNetwork: id !== chain.id }));
  }, [wallet.signer, chain, isControlled]);

  const login = useCallback(async () => {
    const signer = await connect();
    const s = await client.auth.login(signer);
    setSession(s);
    return s;
  }, [client, connect]);

  const logout = useCallback(async () => {
    await client.auth.logout();
    setSession(null);
  }, [client]);

  // A different wallet must sign in again.
  useEffect(() => {
    if (session && wallet.address && session.address.toLowerCase() !== wallet.address.toLowerCase() && session.address !== "0x0000000000000000000000000000000000000000") {
      setSession(null);
      void client.auth.logout();
    }
  }, [wallet.address, session, client]);

  const cart = useMemo<CartApi>(() => {
    const of = (slug: string) => Object.values(lines[slug] ?? {});
    return {
      lines: of,
      add: (product, quantity = 1) =>
        setLines((all) => {
          const shop = { ...(all[product.merchantSlug] ?? {}) };
          const current = shop[product.id]?.quantity ?? 0;
          shop[product.id] = { product, quantity: Math.min(99, current + quantity) };
          return { ...all, [product.merchantSlug]: shop };
        }),
      setQuantity: (slug, productId, quantity) =>
        setLines((all) => {
          const shop = { ...(all[slug] ?? {}) };
          const line = shop[productId];
          if (!line) return all;
          if (quantity <= 0) delete shop[productId];
          else shop[productId] = { ...line, quantity: Math.min(99, quantity) };
          return { ...all, [slug]: shop };
        }),
      clear: (slug) => setLines((all) => ({ ...all, [slug]: {} })),
      total: (slug) => of(slug).reduce((sum, l) => sum + BigInt(l.product.price) * BigInt(l.quantity), 0n),
      count: (slug) => of(slug).reduce((sum, l) => sum + l.quantity, 0),
      items: (slug) => of(slug).map((l) => ({ productId: l.product.id, quantity: l.quantity })),
    };
  }, [lines]);

  const invalidate = useCallback(() => setVersion((v) => v + 1), []);

  const value: PayKitContextValue = {
    client,
    chain,
    wallet,
    connect,
    disconnect,
    switchNetwork,
    session,
    login,
    logout,
    cart,
    version,
    invalidate,
    merchantViaBackend: !!client.options.merchantDataUrl,
  };

  return (
    <PayKitContext.Provider value={value}>
      <div className={className ? `pk-root ${className}` : "pk-root"} style={style} data-pk-theme={theme === "system" ? undefined : theme}>
        {children}
      </div>
    </PayKitContext.Provider>
  );
}

export function usePayKit(): PayKitContextValue {
  const ctx = useContext(PayKitContext);
  if (!ctx) throw new Error("PayKit components must be inside <PayKitProvider>");
  return ctx;
}

/** Human message for any error a PayKit call can throw. */
export function errorMessage(error: unknown): string {
  if (isPayKitError(error)) {
    switch (error.code) {
      case "user_rejected":
        return "You cancelled in your wallet. Nothing was charged.";
      case "wallet_not_connected":
        return error.message || "Connect a wallet to continue.";
      case "wrong_network":
        return "Switch your wallet to Whitechain to continue.";
      case "unauthorized":
        return "Sign in with your wallet to see this.";
      case "quote_expired":
        return "This price expired. Try again to get a fresh one.";
      case "sponsorship_paused":
        return "Payments are paused for a moment. Try again shortly.";
      case "insufficient_usdt":
        return "Your wallet doesn't have enough USDT for this payment.";
      case "invoice_overpaid":
        return "This invoice is already paid.";
      case "refund_exceeds_payment":
        return "That's more than is left to refund on this payment.";
      case "quote_mismatch":
        return "The payment details didn't check out, so nothing was signed. Refresh and try again.";
      case "rate_limited":
        return "Too many attempts. Wait a minute and try again.";
      case "network_error":
      case "timeout":
        return "Can't reach PayKit right now. Check your connection and try again.";
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}
