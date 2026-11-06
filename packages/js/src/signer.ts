import { PayKitError, type TypedDataPayload } from "@paykit/core";
import {
  createWalletClient,
  custom,
  getAddress,
  type Address,
  type Chain,
  type EIP1193Provider,
  type Hex,
  type LocalAccount,
  type WalletClient,
} from "viem";

/**
 * The only wallet capabilities PayKit needs. Adapters exist for any EIP-1193 provider
 * (MetaMask, Rabby, WalletConnect), a viem WalletClient (wagmi), a local account, and
 * any object with address + signTypedData (e.g. a thirdweb Account).
 */
export interface WalletSigner {
  getAddress(): Promise<Address>;
  getChainId(): Promise<number>;
  switchChain(chain: Chain): Promise<void>;
  signTypedData(typedData: TypedDataPayload): Promise<Hex>;
  signMessage(message: string): Promise<Hex>;
}

/** MetaMask & co. Pass `window.ethereum` or any EIP-1193 provider. */
export function fromEip1193(provider: EIP1193Provider): WalletSigner {
  return fromWalletClient(createWalletClient({ transport: custom(provider) }));
}

/** A viem WalletClient, e.g. from wagmi's `useWalletClient()`. */
export function fromWalletClient(client: WalletClient): WalletSigner {
  let cached: Address | undefined = client.account?.address;
  const address = async (): Promise<Address> => {
    if (cached) return cached;
    try {
      const accounts = await client.requestAddresses();
      const first = accounts[0];
      if (!first) throw new PayKitError("wallet_not_connected", "No wallet account is connected");
      cached = getAddress(first);
      return cached;
    } catch (cause) {
      throw toWalletError(cause, "Connect a wallet to continue");
    }
  };
  return {
    getAddress: address,
    getChainId: () => client.getChainId(),
    async switchChain(chain) {
      try {
        await client.switchChain({ id: chain.id });
      } catch (cause) {
        if (!isUnknownChain(cause)) throw toWalletError(cause, `Switch your wallet to ${chain.name}`);
        try {
          await client.addChain({ chain });
          await client.switchChain({ id: chain.id });
        } catch (addCause) {
          throw toWalletError(addCause, `Add ${chain.name} to your wallet`);
        }
      }
    },
    async signTypedData(typedData) {
      try {
        return await client.signTypedData({ ...typedData, account: client.account ?? (await address()) } as never);
      } catch (cause) {
        throw toWalletError(cause, "The wallet did not sign");
      }
    },
    async signMessage(message) {
      try {
        return await client.signMessage({ message, account: client.account ?? (await address()) });
      } catch (cause) {
        throw toWalletError(cause, "The wallet did not sign");
      }
    },
  };
}

/** A local private-key account (server scripts, tests). Never use this in a browser for real users. */
export function fromLocalAccount(account: LocalAccount, chainId: number): WalletSigner {
  let current = chainId;
  return {
    getAddress: async () => account.address,
    getChainId: async () => current,
    switchChain: async (chain) => {
      current = chain.id;
    },
    signTypedData: (typedData) => account.signTypedData(typedData as never),
    signMessage: (message) => account.signMessage({ message }),
  };
}

/** Anything shaped like a thirdweb Account / ethers-style signer. */
export interface SignerLike {
  address: string;
  signTypedData(typedData: never): Promise<Hex | string>;
  signMessage(args: { message: string }): Promise<Hex | string>;
  /** Current chain ID, if the wallet exposes it. */
  getChainId?(): Promise<number> | number;
  switchChain?(chain: Chain): Promise<void>;
}

export function fromSignerLike(signer: SignerLike): WalletSigner {
  return {
    getAddress: async () => getAddress(signer.address),
    getChainId: async () => {
      if (!signer.getChainId) return -1;
      return Number(await signer.getChainId());
    },
    switchChain: async (chain) => {
      if (signer.switchChain) await signer.switchChain(chain);
    },
    signTypedData: async (typedData) => {
      try {
        return (await signer.signTypedData(typedData as never)) as Hex;
      } catch (cause) {
        throw toWalletError(cause, "The wallet did not sign");
      }
    },
    signMessage: async (message) => {
      try {
        return (await signer.signMessage({ message })) as Hex;
      } catch (cause) {
        throw toWalletError(cause, "The wallet did not sign");
      }
    },
  };
}

/** Makes sure the wallet is on `chain` before asking for a signature (MetaMask requires it). */
export async function ensureChain(signer: WalletSigner, chain: Chain): Promise<void> {
  const current = await signer.getChainId();
  if (current === chain.id || current === -1) return;
  await signer.switchChain(chain);
  const after = await signer.getChainId();
  if (after !== chain.id && after !== -1) {
    throw new PayKitError("wrong_network", `Switch your wallet to ${chain.name} (chain ${chain.id})`);
  }
}

function errorCode(cause: unknown): number | undefined {
  let current: unknown = cause;
  for (let i = 0; i < 5 && current && typeof current === "object"; i++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "number") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function isUnknownChain(cause: unknown): boolean {
  const code = errorCode(cause);
  return code === 4902 || /unrecognized chain|unknown chain|not been added/i.test(String((cause as Error)?.message ?? ""));
}

export function toWalletError(cause: unknown, message: string): PayKitError {
  if (cause instanceof PayKitError) return cause;
  const code = errorCode(cause);
  if (code === 4001 || /user rejected|user denied|rejected the request/i.test(String((cause as Error)?.message ?? ""))) {
    return new PayKitError("user_rejected", "You cancelled the request in your wallet", { cause });
  }
  return new PayKitError("wallet_not_connected", message, { cause });
}
