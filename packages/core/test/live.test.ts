/**
 * Live checks against Whitechain Sepolia. Read-only: uses eth_call, never broadcasts.
 * Run with: npm run test:live -w @paykit/core
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPublicClient, encodeFunctionData, http, keccak256, stringToBytes, zeroAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  hashPaymentQuote,
  payNonce,
  randomBytes32,
  receiveWithAuthorizationTypedData,
  resolveNetwork,
  TESTNET_USDT_DOMAIN_SEPARATOR,
  usdtAbi,
} from "../src/index.ts";

const network = resolveNetwork("whitechain-testnet", { router: "0x1111111111111111111111111111111111111111" });
const usdt = network.usdt!.address;
const client = createPublicClient({ chain: network.chain, transport: http() });

describe("live Whitechain USDT", { timeout: 60_000 }, () => {
  it("has the DOMAIN_SEPARATOR and typehash our SDK signs against", async () => {
    const [separator, typehash, decimals] = await Promise.all([
      client.readContract({ address: usdt, abi: usdtAbi, functionName: "DOMAIN_SEPARATOR" }),
      client.readContract({ address: usdt, abi: usdtAbi, functionName: "RECEIVE_WITH_AUTHORIZATION_TYPEHASH" }),
      client.readContract({ address: usdt, abi: usdtAbi, functionName: "decimals" }),
    ]);
    assert.equal(separator, TESTNET_USDT_DOMAIN_SEPARATOR);
    assert.equal(
      typehash,
      keccak256(stringToBytes("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")),
    );
    assert.equal(decimals, 6);
  });

  it("accepts a payer authorization built by the SDK (simulated, zero value)", async () => {
    // A fresh key with no funds signs a 0-USDT authorization to `receiver`.
    // Simulating the call from `receiver` proves our typed data and signature encoding
    // are what the real token verifies. Nothing is broadcast.
    const payer = privateKeyToAccount(generatePrivateKey());
    const receiver = privateKeyToAccount(generatePrivateKey()).address;
    const quoteHash = hashPaymentQuote(network, {
      merchantId: randomBytes32(),
      invoiceId: randomBytes32(),
      invoiceDigest: randomBytes32(),
      paymentId: randomBytes32(),
      token: usdt,
      invoiceTotal: 0n,
      gross: 0n,
      fee: 0n,
      payer: zeroAddress,
      splitProfileId: 0,
      validUntil: 2_000_000_000n,
    });
    const nonce = payNonce(quoteHash, payer.address, randomBytes32());
    const message = { from: payer.address, to: receiver, value: 0n, validAfter: 0n, validBefore: 2_000_000_000n, nonce };
    const signature = await payer.signTypedData(receiveWithAuthorizationTypedData(network, message));
    const call = (account: `0x${string}`) =>
      client.call({
        account,
        to: usdt,
        data: encodeFunctionData({
          abi: usdtAbi,
          functionName: "receiveWithAuthorization",
          args: [message.from, message.to, message.value, message.validAfter, message.validBefore, message.nonce, signature],
        }),
      });

    await call(receiver); // succeeds: valid signature, caller is the recipient

    // A different caller must be rejected (the front-running protection we rely on).
    await assert.rejects(() => call(privateKeyToAccount(generatePrivateKey()).address));

    // A tampered nonce (e.g. a relayer changing the refund address) must be rejected.
    const tampered = { ...message, nonce: payNonce(quoteHash, receiver, randomBytes32()) };
    await assert.rejects(() =>
      client.call({
        account: receiver,
        to: usdt,
        data: encodeFunctionData({
          abi: usdtAbi,
          functionName: "receiveWithAuthorization",
          args: [tampered.from, tampered.to, tampered.value, tampered.validAfter, tampered.validBefore, tampered.nonce, signature],
        }),
      }),
    );
  });
});
