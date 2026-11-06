#!/usr/bin/env node
// Prints a new merchant server signing key. The private key goes into your server
// secrets; register the address as a signer in the PayKit merchant dashboard.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const privateKey = generatePrivateKey();
const { address } = privateKeyToAccount(privateKey);

process.stdout.write(
  [
    "New PayKit merchant signing key",
    "",
    `Address (register this in the dashboard): ${address}`,
    "",
    "Add this to your server secrets (never commit it, never send it to a browser):",
    `MERCHANT_SIGNER_KEY=${privateKey}`,
    "",
  ].join("\n"),
);
