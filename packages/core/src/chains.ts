import { defineChain, getAddress, type Address, type Chain } from "viem";
import { PayKitError } from "./errors.ts";

/** Whitechain Sepolia (testnet). The build target. */
export const whitechainTestnet: Chain = defineChain({
  id: 1874,
  name: "Whitechain Sepolia",
  nativeCurrency: { name: "WhiteBIT Coin", symbol: "WBT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.whitechain.io"] } },
  blockExplorers: {
    default: { name: "Whitechain Explorer", url: "https://explorer.testnet.whitechain.io" },
  },
  testnet: true,
});

/** Whitechain Mainnet (L2). Not supported for payments yet: mainnet USDT lacks EIP-3009. */
export const whitechainMainnet: Chain = defineChain({
  id: 1875,
  name: "Whitechain",
  nativeCurrency: { name: "WhiteBIT Coin", symbol: "WBT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.whitechain.io"] } },
  blockExplorers: { default: { name: "Whitechain Explorer", url: "https://explorer.whitechain.io" } },
});

export type NetworkKey = "whitechain-testnet" | "whitechain-mainnet";

export interface TokenConfig {
  symbol: "USDT";
  address: Address;
  decimals: 6;
  /** EIP-712 domain name/version of the token, used for EIP-3009 and permit signatures. */
  eip712Name: string;
  eip712Version: string;
  /** Whether the token supports EIP-3009 receiveWithAuthorization. */
  supportsAuthorization: boolean;
}

/** Addresses of the PayKit contracts. Unknown until they are deployed, so they come from config. */
export interface PayKitContracts {
  registry?: Address;
  router?: Address;
  treasury?: Address;
  /** PayKitPoints (universal loyalty points). Only with PaymentRouterV2. */
  points?: Address;
  /**
   * EIP-712 domain version of the deployed router: "2" for PaymentRouterV2 (points and discounts),
   * "1" for the original PaymentRouter. Defaults to "2".
   */
  routerVersion?: RouterVersion;
}

export type RouterVersion = "1" | "2";
export type ContractName = "registry" | "router" | "treasury" | "points";

export interface NetworkConfig {
  key: NetworkKey;
  chain: Chain;
  usdt: TokenConfig | undefined;
  contracts: PayKitContracts;
  explorerUrl: string;
}

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  "whitechain-testnet": {
    key: "whitechain-testnet",
    chain: whitechainTestnet,
    usdt: {
      symbol: "USDT",
      // The sponsor/hackathon USDT (TetherTokenV2). NOT the token-list USDT.e at 0xaa79…8f46.
      address: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7",
      decimals: 6,
      eip712Name: "Tether USD",
      eip712Version: "1",
      supportsAuthorization: true,
    },
    contracts: {},
    explorerUrl: "https://explorer.testnet.whitechain.io",
  },
  "whitechain-mainnet": {
    key: "whitechain-mainnet",
    chain: whitechainMainnet,
    usdt: undefined,
    contracts: {},
    explorerUrl: "https://explorer.whitechain.io",
  },
};

/** Verified DOMAIN_SEPARATOR of the testnet USDT (name "Tether USD", version "1", chain 1874). */
export const TESTNET_USDT_DOMAIN_SEPARATOR =
  "0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25" as const;

/** Builds a network config, merging deployed contract addresses supplied by the app. */
export function resolveNetwork(
  key: NetworkKey = "whitechain-testnet",
  contracts: PayKitContracts = {},
): NetworkConfig {
  const base = NETWORKS[key];
  if (!base) throw new PayKitError("config_invalid", `Unknown network "${key}"`);
  const merged: PayKitContracts = { ...base.contracts };
  for (const name of ["registry", "router", "treasury", "points"] as const) {
    const value = contracts[name];
    if (value) merged[name] = getAddress(value);
  }
  if (contracts.routerVersion) merged.routerVersion = contracts.routerVersion;
  return { ...base, contracts: merged };
}

/** The router's EIP-712 domain version ("2" unless configured otherwise). */
export function routerVersionOf(network: NetworkConfig): RouterVersion {
  return network.contracts.routerVersion ?? "2";
}

/** Returns a required contract address or throws a clear configuration error. */
export function requireContract(network: NetworkConfig, name: ContractName): Address {
  const address = network.contracts[name];
  if (!address) {
    throw new PayKitError(
      "config_invalid",
      `The PayKit ${name} address for ${network.key} is not configured. Pass it in "contracts" or load it from the API config.`,
    );
  }
  return address;
}

export function requireUsdt(network: NetworkConfig): TokenConfig {
  if (!network.usdt) {
    throw new PayKitError(
      "config_invalid",
      `${network.key} has no supported USDT yet. Mainnet USDT has no EIP-3009 support.`,
    );
  }
  return network.usdt;
}

export function explorerTxUrl(network: NetworkConfig, txHash: string): string {
  return `${network.explorerUrl}/tx/${txHash}`;
}

export function explorerAddressUrl(network: NetworkConfig, address: string): string {
  return `${network.explorerUrl}/address/${address}`;
}
