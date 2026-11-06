/**
 * Proves the SDK and a PayKit deployment agree, before any real money moves.
 *
 *   RPC_URL=… ROUTER_ADDRESS=… REGISTRY_ADDRESS=… POINTS_ADDRESS=… TREASURY_ADDRESS=… \
 *     npm run contracts:check
 *
 * Read-only: only eth_call. It compares the SDK's EIP-712 digests with the router's own
 * quoteDigest / planDigest / refundDigest views (this settles the struct layouts declared in the
 * missing libraries/PayKitTypes*.sol), the registry's typehashes and domain separator, and the
 * wiring between router, points, registry and treasury. Exits 1 on any mismatch.
 */
import {
  feeTreasuryAbi,
  hashPaymentQuote,
  hashPlanTerms,
  hashRefundTerms,
  merchantRegistryAbi,
  payKitPointsAbi,
  paymentQuoteTypedData,
  paymentRouterV1Abi,
  paymentRouterV2Abi,
  planTermsTypedData,
  registerMerchantTypes,
  registryDomain,
  resolveNetwork,
  routerDomain,
  setMetadataTypes,
  setSignerTypes,
  usdtAbi,
  type NetworkKey,
  type PaymentQuoteMessage,
  type PlanTermsMessage,
  type RouterVersion,
} from "@paykit/core";
import { createPublicClient, domainSeparator, getAddress, http, keccak256, stringToBytes, zeroAddress, type Address, type Hex } from "viem";

const env = process.env;
const need = (name: string): Address => {
  const v = env[name];
  if (!v) { console.error(`Set ${name}.`); process.exit(2); }
  return getAddress(v);
};
const version: RouterVersion = env.ROUTER_VERSION === "1" ? "1" : "2";
const network = resolveNetwork((env.NETWORK ?? "whitechain-testnet") as NetworkKey, {
  router: need("ROUTER_ADDRESS"),
  registry: need("REGISTRY_ADDRESS"),
  treasury: env.TREASURY_ADDRESS ? getAddress(env.TREASURY_ADDRESS) : undefined,
  points: env.POINTS_ADDRESS ? getAddress(env.POINTS_ADDRESS) : undefined,
  routerVersion: version,
});
const client = createPublicClient({ chain: network.chain, transport: http(env.RPC_URL) });
const router = network.contracts.router!;
const registry = network.contracts.registry!;
const routerAbi = version === "2" ? paymentRouterV2Abi : paymentRouterV1Abi;
const usdt = network.usdt!.address;

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};
const read = <T>(address: Address, abi: readonly unknown[], functionName: string, args: unknown[] = []) =>
  client.readContract({ address, abi: abi as never, functionName, args } as never) as Promise<T>;
const tryRead = async <T>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
  try { return await fn(); } catch (error) { check(label, false, (error as Error).message.split("\n")[0]); return undefined; }
};
const H = (s: string): Hex => keccak256(stringToBytes(s));
const encodeType = (name: string, fields: readonly { name: string; type: string }[]) => `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;

console.log(`Chain ${network.chain.id}, router v${version} ${router}, registry ${registry}\n`);
check("RPC chain id", (await client.getChainId()) === network.chain.id);
for (const [name, address] of Object.entries({ router, registry, ...network.contracts })) {
  if (typeof address !== "string" || !address.startsWith("0x")) continue;
  const code = await client.getCode({ address: address as Address });
  check(`${name} has code`, !!code && code !== "0x");
}

// ── domains ──
const routerSep = await tryRead<Hex>("router DOMAIN_SEPARATOR", () => read(router, routerAbi, "DOMAIN_SEPARATOR"));
if (routerSep) check("router EIP-712 domain", routerSep === domainSeparator({ domain: routerDomain(network) }), `name "PayKit Router" version "${version}"`);
const registrySep = await tryRead<Hex>("registry DOMAIN_SEPARATOR", () => read(registry, merchantRegistryAbi, "DOMAIN_SEPARATOR"));
if (registrySep) check("registry EIP-712 domain", registrySep === domainSeparator({ domain: registryDomain(network) }));
const usdtSep = await tryRead<Hex>("USDT DOMAIN_SEPARATOR", () => read(usdt, usdtAbi, "DOMAIN_SEPARATOR"));
if (usdtSep) check("USDT EIP-712 domain", usdtSep === domainSeparator({ domain: { name: network.usdt!.eip712Name, version: network.usdt!.eip712Version, chainId: network.chain.id, verifyingContract: usdt } }));

// ── registry typehashes (exact) ──
for (const [fn, name, types] of [["REGISTER_TYPEHASH", "RegisterMerchant", registerMerchantTypes.RegisterMerchant], ["SET_SIGNER_TYPEHASH", "SetSigner", setSignerTypes.SetSigner], ["SET_METADATA_TYPEHASH", "SetMetadata", setMetadataTypes.SetMetadata]] as const) {
  const onchain = await tryRead<Hex>(fn, () => read(registry, merchantRegistryAbi, fn));
  if (onchain) check(`registry ${name} typehash`, onchain === H(encodeType(name, types)));
}

// ── router struct layouts: SDK digest vs the router's own digest views ──
const H32 = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const quote: PaymentQuoteMessage = {
  merchantId: H32(1), invoiceId: H32(2), invoiceDigest: H32(3), paymentId: H32(4), token: usdt,
  invoiceTotal: 10_000_000n, gross: 9_000_000n, fee: 90_000n, payer: zeroAddress, splitProfileId: 0, validUntil: 2_000_000_000n,
  ...(version === "2" ? { discount: 1_000_000n, pointsEarned: 9n, campaignId: H32(7), pointsRedeemed: 5n, rewardId: H32(8) } : {}),
};
const onchainQuote = await tryRead<Hex>("router.quoteDigest", () => read(router, routerAbi, "quoteDigest", [paymentQuoteTypedData(network, quote).message]));
if (onchainQuote) check("PaymentQuote layout + typehash", onchainQuote === hashPaymentQuote(network, quote));
const terms: PlanTermsMessage = {
  merchantId: H32(1), planId: H32(5), invoiceDigest: H32(3), payer: "0x0000000000000000000000000000000000000001", token: usdt, downPayment: 1_000_000n,
  installmentAmount: 3_000_000n, feePerInstallment: 30_000n, downPaymentFee: 10_000n, count: 3, period: 2_592_000, firstDue: 1_900_000_000n, grace: 86_400,
  splitProfileId: 0, kind: 0, validUntil: 2_000_000_000n, ...(version === "2" ? { pointsPerCharge: 3n, campaignId: H32(7), downPaymentPoints: 1n } : {}),
};
const onchainPlan = await tryRead<Hex>("router.planDigest", () => read(router, routerAbi, "planDigest", [planTermsTypedData(network, terms).message]));
if (onchainPlan) check("PlanTerms layout + typehash", onchainPlan === hashPlanTerms(network, terms));
const refund = { paymentId: H32(4), refundId: H32(6), amount: 1_000_000n, fee: 0n, funder: "0x0000000000000000000000000000000000000002" as Address, validUntil: 2_000_000_000n };
const onchainRefund = await tryRead<Hex>("router.refundDigest", () => read(router, routerAbi, "refundDigest", [refund]));
if (onchainRefund) check("RefundTerms layout + typehash", onchainRefund === hashRefundTerms(network, refund));

// ── wiring ──
const routerRegistry = await tryRead<Address>("router.registry", () => read(router, routerAbi, "registry"));
if (routerRegistry) check("router → registry", getAddress(routerRegistry) === registry);
const routerTreasury = await tryRead<Address>("router.treasury", () => read(router, routerAbi, "treasury"));
if (routerTreasury && network.contracts.treasury) check("router → treasury", getAddress(routerTreasury) === network.contracts.treasury);
const allowed = await tryRead<boolean>("router.allowedToken", () => read(router, routerAbi, "allowedToken", [usdt]));
check("USDT allowed on the router (setAllowedToken)", allowed === true);
const fee = await tryRead<readonly [number, bigint, bigint]>("router.feeSchedule", () => read(router, routerAbi, "feeSchedule", [usdt]));
if (fee) console.log(`INFO  fee schedule: ${fee[0]} bps, min ${fee[1]}, max ${fee[2]} (base units)`);
check("router not paused", (await tryRead<boolean>("router.paused", () => read(router, routerAbi, "paused"))) === false);

if (version === "2") {
  const points = network.contracts.points;
  const routerPoints = await tryRead<Address>("router.points", () => read(router, routerAbi, "points"));
  if (routerPoints && points) check("router → points", getAddress(routerPoints) === points);
  else if (routerPoints) console.log(`INFO  router.points = ${routerPoints} (set POINTS_ADDRESS to check it)`);
  const target = points ?? (routerPoints ? getAddress(routerPoints) : undefined);
  if (target) {
    const pointsRouter = await tryRead<Address>("points.router", () => read(target, payKitPointsAbi, "router"));
    if (pointsRouter) check("points → router (setRouter)", getAddress(pointsRouter) === router);
    const rate = await tryRead<bigint>("points.maxPointsPerUsdt", () => read(target, payKitPointsAbi, "maxPointsPerUsdt"));
    if (rate !== undefined) check("points earn cap set (maxPointsPerUsdt > 0)", rate > 0n, `${rate} points per USDT`);
  }
}

const relayer = env.RELAYER_ADDRESS ? getAddress(env.RELAYER_ADDRESS) : undefined;
if (network.contracts.treasury && relayer) {
  check("relayer allowed on treasury (setRelayer)", (await tryRead<boolean>("treasury.isRelayer", () => read(network.contracts.treasury!, feeTreasuryAbi, "isRelayer", [relayer]))) === true);
}
const attestor = env.ADMIN_ADDRESS ? getAddress(env.ADMIN_ADDRESS) : relayer;
if (attestor) {
  const isAttestor = await tryRead<boolean>("registry.isAttestor", () => read(registry, merchantRegistryAbi, "isAttestor", [attestor]));
  const owner = await tryRead<Address>("registry.owner", () => read(registry, [...merchantRegistryAbi, { type: "function", name: "owner", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }], "owner"));
  check("domain attestor configured (setAttestor or owner)", isAttestor === true || (!!owner && getAddress(owner) === attestor));
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed. The SDK matches this deployment.");
process.exit(failures ? 1 : 0);
