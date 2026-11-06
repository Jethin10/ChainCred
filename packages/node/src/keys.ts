import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * Creates a new merchant server signing key. Store the private key in your server's
 * secrets (MERCHANT_SIGNER_KEY), then register the ADDRESS as a signer from the
 * merchant dashboard. The key can sign payment terms but cannot move or redirect funds.
 */
export function generateMerchantSigner(): { privateKey: Hex; address: Address } {
  const privateKey = generatePrivateKey();
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}
