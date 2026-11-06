"use client";

/** Payer-facing text used by the components. */
export const TEXT = {
  connect: "Connect wallet",
  connecting: "Connecting your wallet…",
  connectPrompt: "Connect a wallet to continue.",
  connectHint: "You'll only sign. No gas or WBT needed.",
  wrongNetwork: "Your wallet is on another network.",
  switchNetwork: (chain: string) => `Switch to ${chain}`,
  payLabel: (amount: string) => `Pay ${amount} USDT`,
  payGeneric: "Pay with USDT",
  phaseSigning: "Confirm in your wallet. It's a signature, not a transaction.",
  phaseProcessing: "Sending your payment…",
  hintIdle: "You only sign. No WBT or gas needed.",
  hintSigning: "No gas needed. PayKit sends the transaction for you.",
  signInTitle: "Sign in to see your payments.",
  signInButton: "Sign in with wallet",
  signInConnectButton: "Connect and sign in",
  signInHint: "Signing in is free and doesn't move any funds.",
  planHint: "You approve this plan once. Each payment is collected on its due date from your USDT balance. You can cancel future payments any time.",
  planSigning: "Confirm both signatures in your wallet…",
} as const;
