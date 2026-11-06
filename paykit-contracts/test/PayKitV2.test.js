// PaymentRouterV2 + PayKitPoints: universal points earned at one shop, spent at another.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const T = require("../scripts/lib/typedData");

const USDT = (n) => ethers.parseUnits(String(n), 6);
const MAX_U64 = 2n ** 63n;
const ZERO = ethers.ZeroAddress;
const ZERO32 = ethers.ZeroHash;
const rand32 = () => ethers.hexlify(ethers.randomBytes(32));
const tag = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

async function fixture() {
  const [admin, relayer, ownerA, signerA, payoutA, ownerB, signerB, payoutB, customer, other] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;

  const usdt = await ethers.deployContract("MockUSDT3009");
  const wwbt = await ethers.deployContract("MockWWBT");
  const swap = await ethers.deployContract("MockSwapRouter02", [ethers.parseEther("0.01345")]);
  const registry = await ethers.deployContract("MerchantRegistry", [admin.address, 0]);
  const treasury = await ethers.deployContract("FeeTreasury", [
    await usdt.getAddress(), await wwbt.getAddress(), await swap.getAddress(), 3000, admin.address,
  ]);
  const points = await ethers.deployContract("PayKitPoints", [admin.address, 100]); // max 100 points per USDT
  const router = await ethers.deployContract("PaymentRouterV2", [
    await registry.getAddress(), await treasury.getAddress(), await points.getAddress(), admin.address,
  ]);
  await points.setRouter(await router.getAddress());

  const usdtAddr = await usdt.getAddress();
  const routerAddr = await router.getAddress();
  await router.setAllowedToken(usdtAddr, true);
  await router.setFeeSchedule(usdtAddr, 100, USDT(0.05), USDT(25));
  await usdt.mint(customer.address, USDT(1000));
  await usdt.mint(payoutA.address, USDT(100)); // so shops can fund refunds larger than what one payment left them
  await usdt.mint(payoutB.address, USDT(100));

  async function merchant(owner, signer, payout) {
    const id = await registry.predictMerchantId(owner.address);
    await registry.connect(owner).register(payout.address, 1000, ZERO32, "");
    await registry.connect(owner).setSigner(id, signer.address, 0, true);
    return { id, signer, payout };
  }
  const shopA = await merchant(ownerA, signerA, payoutA); // t-shirt shop: issues points
  const shopB = await merchant(ownerB, signerB, payoutB); // jeans shop: honours them

  return {
    admin, relayer, customer, other, chainId, usdt, registry, treasury, points, router, usdtAddr, routerAddr,
    shopA, shopB,
    uDomain: T.usdtDomain(chainId, usdtAddr),
    rDomain: T.routerDomainV2(chainId, routerAddr),
  };
}

/** Build a v2 quote signed by `shop`, and the customer's USDT authorization for it. */
async function buildPay(f, shop, o = {}) {
  const invoiceTotal = o.invoiceTotal ?? USDT(20);
  const discount = o.discount ?? 0n;
  const gross = o.gross ?? invoiceTotal - discount;
  const q = {
    merchantId: shop.id,
    invoiceId: o.invoiceId ?? rand32(),
    invoiceDigest: ZERO32,
    paymentId: rand32(),
    token: f.usdtAddr,
    invoiceTotal,
    gross,
    fee: o.fee ?? (await f.router.protocolFee(f.usdtAddr, gross)),
    payer: ZERO,
    splitProfileId: 0,
    validUntil: BigInt(await time.latest()) + 600n,
    discount,
    pointsEarned: o.pointsEarned ?? 0n,
    campaignId: o.campaignId ?? ZERO32,
    pointsRedeemed: o.pointsRedeemed ?? 0n,
    rewardId: o.rewardId ?? ZERO32,
  };
  const sigQ = await shop.signer.signTypedData(f.rDomain, T.types.PaymentQuoteV2, q);
  const quoteHash = T.digest(f.rDomain, T.types.PaymentQuoteV2, q);
  const salt = rand32();
  const auth = {
    from: f.customer.address, to: f.routerAddr, value: gross, validAfter: 0n, validBefore: MAX_U64,
    nonce: T.payNonce(quoteHash, f.customer.address, salt),
  };
  const authSig = await f.customer.signTypedData(f.uDomain, T.types.ReceiveWithAuthorization, auth);
  const a = { from: f.customer.address, refundTo: ZERO, salt, validAfter: 0n, validBefore: MAX_U64, signature: authSig };
  return { q, sigQ, a, key: T.paymentKeyOf(shop.id, q.paymentId) };
}

async function refund(f, shop, paymentKey, amount) {
  const t = { paymentId: paymentKey, refundId: rand32(), amount, fee: 0n, funder: shop.payout.address, validUntil: MAX_U64 };
  const sig = await shop.signer.signTypedData(f.rDomain, T.types.RefundTerms, t);
  const h = T.digest(f.rDomain, T.types.RefundTerms, t);
  const auth = { from: shop.payout.address, to: f.routerAddr, value: amount, validAfter: 0n, validBefore: MAX_U64, nonce: T.refundNonce(h) };
  const fsig = await shop.payout.signTypedData(f.uDomain, T.types.ReceiveWithAuthorization, auth);
  return f.router.refund(t, sig, { validAfter: 0n, validBefore: MAX_U64, signature: fsig });
}

describe("PayKit v2: universal points", function () {
  it("earns points at shop A inside the payment", async function () {
    const f = await loadFixture(fixture);
    const campaign = tag("camp-tshirts");
    const p = await buildPay(f, f.shopA, { invoiceTotal: USDT(20), pointsEarned: 200n, campaignId: campaign });
    const tx = f.router.connect(f.relayer).pay(p.q, p.sigQ, p.a);
    await expect(tx).to.emit(f.points, "PointsEarned").withArgs(f.customer.address, f.shopA.id, p.key, campaign, 200n);
    await expect(tx).to.emit(f.router, "PaymentSettled");
    expect(await f.points.balanceOf(f.customer.address)).to.equal(200n);
    expect(await f.points.lifetimeEarned(f.customer.address)).to.equal(200n);
    expect(await f.points.totalSupply()).to.equal(200n);
  });

  it("caps points per USDT platform-wide", async function () {
    const f = await loadFixture(fixture);
    const p = await buildPay(f, f.shopA, { invoiceTotal: USDT(20), pointsEarned: 2001n }); // max is 100 x 20
    await expect(f.router.pay(p.q, p.sigQ, p.a)).to.be.revertedWithCustomError(f.points, "EarnRateTooHigh");
  });

  it("spends shop A points at shop B for a discount the redeeming shop pays", async function () {
    const f = await loadFixture(fixture);
    const earn = await buildPay(f, f.shopA, { invoiceTotal: USDT(20), pointsEarned: 200n });
    await f.router.pay(earn.q, earn.sigQ, earn.a);

    // jeans: 10 USDT, reward "100 points = 10% off"
    const reward = tag("reward-10pct");
    const invoiceId = rand32();
    const p = await buildPay(f, f.shopB, {
      invoiceId, invoiceTotal: USDT(10), discount: USDT(1), pointsRedeemed: 100n, rewardId: reward,
    });
    const fee = p.q.fee;
    const tx = f.router.pay(p.q, p.sigQ, p.a);
    await expect(tx).to.emit(f.points, "PointsRedeemed").withArgs(f.customer.address, f.shopB.id, p.key, reward, 100n);
    await expect(tx).to.emit(f.router, "DiscountApplied").withArgs(p.key, reward, USDT(1), 100n);
    await expect(tx).to.changeTokenBalances(f.usdt, [f.customer, f.shopB.payout], [-USDT(9), USDT(9) - fee]);

    expect(await f.points.balanceOf(f.customer.address)).to.equal(100n);
    const inv = await f.router.invoices(T.invoiceKeyOf(f.shopB.id, invoiceId));
    expect(inv.paid).to.equal(USDT(10)); // 9 paid + 1 discount = fully paid
  });

  it("can't spend more points than the wallet has", async function () {
    const f = await loadFixture(fixture);
    const p = await buildPay(f, f.shopB, { invoiceTotal: USDT(10), discount: USDT(1), pointsRedeemed: 1n });
    await expect(f.router.pay(p.q, p.sigQ, p.a)).to.be.revertedWithCustomError(f.points, "InsufficientPoints");
  });

  it("a shop can't burn more points than the customer agreed to", async function () {
    const f = await loadFixture(fixture);
    const earn = await buildPay(f, f.shopA, { invoiceTotal: USDT(20), pointsEarned: 500n });
    await f.router.pay(earn.q, earn.sigQ, earn.a);
    const p = await buildPay(f, f.shopB, { invoiceTotal: USDT(10), discount: USDT(1), pointsRedeemed: 100n });
    const greedy = { ...p.q, pointsRedeemed: 500n };
    const greedySig = await f.shopB.signer.signTypedData(f.rDomain, T.types.PaymentQuoteV2, greedy);
    // the customer's USDT signature commits to the original quote hash, so this fails
    await expect(f.router.pay(greedy, greedySig, p.a)).to.be.revertedWith("invalid signature");
  });

  it("blocks overpaying an invoice with discount + payment", async function () {
    const f = await loadFixture(fixture);
    const p = await buildPay(f, f.shopB, { invoiceTotal: USDT(10), discount: USDT(2), gross: USDT(9) });
    await expect(f.router.pay(p.q, p.sigQ, p.a)).to.be.revertedWithCustomError(f.router, "InvoiceOverpaid");
  });

  it("refunds reverse earned points and give back redeemed points proportionally", async function () {
    const f = await loadFixture(fixture);
    const earn = await buildPay(f, f.shopA, { invoiceTotal: USDT(20), pointsEarned: 200n });
    await f.router.pay(earn.q, earn.sigQ, earn.a);

    await expect(refund(f, f.shopA, earn.key, USDT(10))) // half
      .to.emit(f.points, "PointsReversed")
      .withArgs(f.customer.address, earn.key, 100n, 0n, 0n);
    expect(await f.points.balanceOf(f.customer.address)).to.equal(100n);

    const spend = await buildPay(f, f.shopB, { invoiceTotal: USDT(10), discount: USDT(1), pointsRedeemed: 100n });
    await f.router.pay(spend.q, spend.sigQ, spend.a);
    expect(await f.points.balanceOf(f.customer.address)).to.equal(0n);

    await refund(f, f.shopB, spend.key, USDT(9)); // full refund of the jeans: 100 points come back
    expect(await f.points.balanceOf(f.customer.address)).to.equal(100n);

    // the rest of shop A's refund removes the last 100 earned points
    await refund(f, f.shopA, earn.key, USDT(10));
    expect(await f.points.balanceOf(f.customer.address)).to.equal(0n);
  });

  it("records a shortfall when refunded points were already spent", async function () {
    const f = await loadFixture(fixture);
    const earn = await buildPay(f, f.shopA, { invoiceTotal: USDT(20), pointsEarned: 200n });
    await f.router.pay(earn.q, earn.sigQ, earn.a);
    const spend = await buildPay(f, f.shopB, { invoiceTotal: USDT(10), discount: USDT(1), pointsRedeemed: 200n });
    await f.router.pay(spend.q, spend.sigQ, spend.a);
    await expect(refund(f, f.shopA, earn.key, USDT(20)))
      .to.emit(f.points, "PointsReversed")
      .withArgs(f.customer.address, earn.key, 0n, 0n, 200n);
  });

  it("only the router mints, and points can't be transferred", async function () {
    const f = await loadFixture(fixture);
    await expect(
      f.points.connect(f.other).earn(f.other.address, f.shopA.id, rand32(), ZERO32, 1n, USDT(1))
    ).to.be.revertedWithCustomError(f.points, "NotRouter");
    await expect(f.points.connect(f.customer).transfer(f.other.address, 1n)).to.be.revertedWithCustomError(
      f.points,
      "NonTransferable"
    );
    expect(await f.points.decimals()).to.equal(0n);
    expect(await f.points.symbol()).to.equal("PKP");
  });

  it("subscriptions earn points on the sign-up charge and every scheduled charge", async function () {
    const f = await loadFixture(fixture);
    const now = BigInt(await time.latest());
    const amount = USDT(5);
    const fee = await f.router.protocolFee(f.usdtAddr, amount);
    const t = {
      merchantId: f.shopA.id, planId: rand32(), invoiceDigest: ZERO32, payer: f.customer.address, token: f.usdtAddr,
      downPayment: amount, installmentAmount: amount, feePerInstallment: fee, downPaymentFee: fee,
      count: 2, period: 120, firstDue: now + 120n, grace: 60, splitProfileId: 0, kind: 1, validUntil: now + 600n,
      pointsPerCharge: 50n, downPaymentPoints: 50n, campaignId: tag("camp-sub"),
    };
    const sigT = await f.shopA.signer.signTypedData(f.rDomain, T.types.PlanTermsV2, t);
    const termsHash = T.digest(f.rDomain, T.types.PlanTermsV2, t);
    const consentSig = await f.customer.signTypedData(f.rDomain, T.types.PlanConsent, {
      termsHash, payer: f.customer.address, deadline: now + 600n,
    });
    const permitMsg = {
      owner: f.customer.address, spender: f.routerAddr, value: USDT(15),
      nonce: await f.usdt.nonces(f.customer.address), deadline: now + 600n,
    };
    const ps = ethers.Signature.from(await f.customer.signTypedData(f.uDomain, T.types.Permit, permitMsg));
    await f.router.createPlan(t, sigT, { deadline: now + 600n, signature: consentSig }, {
      value: permitMsg.value, deadline: permitMsg.deadline, v: ps.v, r: ps.r, s: ps.s,
    });
    expect(await f.points.balanceOf(f.customer.address)).to.equal(50n);

    await time.increase(125);
    await f.router.collectInstallment(T.planKeyOf(f.shopA.id, t.planId));
    expect(await f.points.balanceOf(f.customer.address)).to.equal(100n);
  });
});
