const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const T = require("../scripts/lib/typedData");

const USDT = (n) => ethers.parseUnits(String(n), 6);
const MAX_U64 = 2n ** 63n; // far-future timestamp that fits uint64
const ZERO = ethers.ZeroAddress;
const ZERO32 = ethers.ZeroHash;
const rand32 = () => ethers.hexlify(ethers.randomBytes(32));

async function deployFixture() {
  const [admin, relayer, mOwner, mSigner, payout, affiliate, payer, other] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;

  const usdt = await ethers.deployContract("MockUSDT3009");
  const wwbt = await ethers.deployContract("MockWWBT");
  // 0.01345 WBT per USDT, like the testnet snapshot
  const swap = await ethers.deployContract("MockSwapRouter02", [ethers.parseEther("0.01345")]);
  const registry = await ethers.deployContract("MerchantRegistry", [admin.address, 0]);
  const treasury = await ethers.deployContract("FeeTreasury", [
    await usdt.getAddress(),
    await wwbt.getAddress(),
    await swap.getAddress(),
    3000,
    admin.address,
  ]);
  const router = await ethers.deployContract("PaymentRouter", [
    await registry.getAddress(),
    await treasury.getAddress(),
    admin.address,
  ]);

  const usdtAddr = await usdt.getAddress();
  const routerAddr = await router.getAddress();
  const registryAddr = await registry.getAddress();
  const treasuryAddr = await treasury.getAddress();

  await router.setAllowedToken(usdtAddr, true);
  await router.setFeeSchedule(usdtAddr, 100, USDT(0.05), USDT(25)); // 1%, min 0.05, max 25

  // fund the mock DEX with WWBT
  await wwbt.deposit({ value: ethers.parseEther("10") });
  await wwbt.transfer(await swap.getAddress(), ethers.parseEther("10"));

  await usdt.mint(payer.address, USDT(1000));

  // ── gasless merchant registration: owner signs, relayer submits ──
  const uDomain = T.usdtDomain(chainId, usdtAddr);
  const rDomain = T.routerDomain(chainId, routerAddr);
  const gDomain = T.registryDomain(chainId, registryAddr);

  const reg = {
    owner: mOwner.address,
    payout: payout.address,
    maxFeeBps: 300,
    metadataHash: ethers.keccak256(ethers.toUtf8Bytes('{"name":"Demo Coffee"}')),
    metadataURI: "https://api.paykit.dev/merchants/demo-coffee/metadata.json",
    nonce: 0n,
    deadline: MAX_U64,
  };
  const regSig = await mOwner.signTypedData(gDomain, T.types.RegisterMerchant, reg);
  const merchantId = await registry.predictMerchantId(mOwner.address);
  await registry.connect(relayer).registerWithSig(reg, regSig);
  await registry.connect(mOwner).setSigner(merchantId, mSigner.address, 0, true);

  return {
    admin, relayer, mOwner, mSigner, payout, affiliate, payer, other,
    chainId, usdt, wwbt, swap, registry, treasury, router,
    usdtAddr, routerAddr, registryAddr, treasuryAddr, uDomain, rDomain, gDomain, merchantId,
  };
}

/** Build + sign a quote and the payer's 3009 authorization. Returns the args for router.pay. */
async function buildPayment(f, opts = {}) {
  const {
    invoiceId = T.idFromUuid("inv-1"),
    invoiceTotal = USDT(10),
    gross = invoiceTotal,
    fee,
    splitProfileId = 0,
    payerBinding = ZERO,
    signer = f.mSigner,
    payer = f.payer,
    refundTo = ZERO,
  } = opts;
  const q = {
    merchantId: f.merchantId,
    invoiceId,
    invoiceDigest: ethers.keccak256(ethers.toUtf8Bytes("line items")),
    paymentId: rand32(),
    token: f.usdtAddr,
    invoiceTotal,
    gross,
    fee: fee ?? (await f.router.protocolFee(f.usdtAddr, gross)),
    payer: payerBinding,
    splitProfileId,
    validUntil: BigInt(await time.latest()) + 600n,
  };
  const merchantSig = await signer.signTypedData(f.rDomain, T.types.PaymentQuote, q);
  const quoteHash = T.digest(f.rDomain, T.types.PaymentQuote, q);
  const effectiveRefundTo = refundTo === ZERO ? payer.address : refundTo;
  const salt = rand32();
  const auth = {
    from: payer.address,
    to: f.routerAddr,
    value: gross,
    validAfter: 0n,
    validBefore: MAX_U64,
    nonce: T.payNonce(quoteHash, effectiveRefundTo, salt),
  };
  const authSig = await payer.signTypedData(f.uDomain, T.types.ReceiveWithAuthorization, auth);
  const a = { from: payer.address, refundTo, salt, validAfter: 0n, validBefore: MAX_U64, signature: authSig };
  return { q, merchantSig, a, quoteHash, paymentKey: T.paymentKeyOf(f.merchantId, q.paymentId) };
}

describe("PayKit", function () {
  describe("MerchantRegistry", function () {
    it("registers gaslessly and computes the predicted id", async function () {
      const f = await loadFixture(deployFixture);
      const m = await f.registry.getMerchant(f.merchantId);
      expect(m.owner).to.equal(f.mOwner.address);
      expect(m.payout).to.equal(f.payout.address);
      expect(await f.registry.isActive(f.merchantId)).to.equal(true);
      expect(f.merchantId).to.equal(T.merchantIdOf(f.chainId, f.mOwner.address, 0));
    });

    it("rejects a replayed registration signature", async function () {
      const f = await loadFixture(deployFixture);
      const reg = {
        owner: f.mOwner.address, payout: f.payout.address, maxFeeBps: 300,
        metadataHash: ZERO32, metadataURI: "", nonce: 0n, deadline: MAX_U64,
      };
      const sig = await f.mOwner.signTypedData(f.gDomain, T.types.RegisterMerchant, reg);
      await expect(f.registry.registerWithSig(reg, sig)).to.be.revertedWithCustomError(f.registry, "InvalidNonce");
    });

    it("sets a split profile with the owner's signature", async function () {
      const f = await loadFixture(deployFixture);
      const recipients = [f.payout.address, f.affiliate.address];
      const bps = [9000, 1000];
      const nonce = await f.registry.ownerNonces(f.mOwner.address);
      const msg = {
        merchantId: f.merchantId, profileId: 1, splitHash: T.splitHash(recipients, bps), nonce, deadline: MAX_U64,
      };
      const sig = await f.mOwner.signTypedData(f.gDomain, T.types.SetSplitProfile, msg);
      await f.registry
        .connect(f.relayer)
        .setSplitProfileWithSig({ merchantId: f.merchantId, profileId: 1, recipients, bps, nonce, deadline: MAX_U64 }, sig);
      const [r, b] = await f.registry.getSplit(f.merchantId, 1);
      expect([...r]).to.deep.equal(recipients);
      expect([...b].map(Number)).to.deep.equal(bps);
    });

    it("rejects splits that do not sum to 100%", async function () {
      const f = await loadFixture(deployFixture);
      await expect(
        f.registry.connect(f.mOwner).setSplitProfile(f.merchantId, 1, [f.payout.address], [9999])
      ).to.be.revertedWithCustomError(f.registry, "InvalidSplit");
    });

    it("attests and revokes a domain", async function () {
      const f = await loadFixture(deployFixture);
      const dh = ethers.keccak256(ethers.toUtf8Bytes("democoffee.example"));
      const exp = BigInt(await time.latest()) + 30n * 86400n;
      await f.registry.setAttestor(f.other.address, true);
      await f.registry.connect(f.other).attestDomain(f.merchantId, dh, exp);
      expect(await f.registry.isDomainVerified(f.merchantId, dh)).to.equal(true);
      await f.registry.connect(f.mOwner).revokeDomain(f.merchantId, dh);
      expect(await f.registry.isDomainVerified(f.merchantId, dh)).to.equal(false);
      await expect(
        f.registry.connect(f.payer).attestDomain(f.merchantId, dh, exp)
      ).to.be.revertedWithCustomError(f.registry, "NotAttestor");
    });
  });

  describe("PaymentRouter.pay", function () {
    it("settles a gasless payment: net to payout, fee to treasury, router keeps 0", async function () {
      const f = await loadFixture(deployFixture);
      const p = await buildPayment(f);
      const fee = p.q.fee; // 1% of 10 = 0.10
      const tx = f.router.connect(f.relayer).pay(p.q, p.merchantSig, p.a);
      await expect(tx).to.emit(f.router, "PaymentSettled");
      await expect(tx).to.changeTokenBalances(
          f.usdt,
          [f.payer, f.payout, f.treasury, f.router],
          [-USDT(10), USDT(10) - fee, fee, 0n]
        );
      const pay = await f.router.payments(p.paymentKey);
      expect(pay.gross).to.equal(USDT(10));
      expect(pay.refundTo).to.equal(f.payer.address);
    });

    it("refuses a duplicate charge", async function () {
      const f = await loadFixture(deployFixture);
      const p = await buildPayment(f);
      await f.router.connect(f.relayer).pay(p.q, p.merchantSig, p.a);
      await expect(f.router.connect(f.relayer).pay(p.q, p.merchantSig, p.a)).to.be.revertedWithCustomError(
        f.router,
        "PaymentAlreadySettled"
      );
    });

    it("reverts if the relayer tampers with the refund address", async function () {
      const f = await loadFixture(deployFixture);
      const p = await buildPayment(f);
      const tampered = { ...p.a, refundTo: f.other.address };
      await expect(f.router.connect(f.relayer).pay(p.q, p.merchantSig, tampered)).to.be.revertedWith(
        "invalid signature"
      );
    });

    it("reverts if the quote is changed after signing", async function () {
      const f = await loadFixture(deployFixture);
      const p = await buildPayment(f);
      const tampered = { ...p.q, splitProfileId: 7 };
      await expect(f.router.pay(tampered, p.merchantSig, p.a)).to.be.revertedWithCustomError(
        f.router,
        "InvalidMerchantSignature"
      );
    });

    it("rejects quotes signed by someone who is not the merchant", async function () {
      const f = await loadFixture(deployFixture);
      const p = await buildPayment(f, { signer: f.other });
      await expect(f.router.pay(p.q, p.merchantSig, p.a)).to.be.revertedWithCustomError(
        f.router,
        "InvalidMerchantSignature"
      );
    });

    it("pays in parts (30% / 70%) and blocks overpayment", async function () {
      const f = await loadFixture(deployFixture);
      const invoiceId = T.idFromUuid("inv-parts");
      const total = USDT(100);
      const deposit = await buildPayment(f, { invoiceId, invoiceTotal: total, gross: USDT(30) });
      await f.router.pay(deposit.q, deposit.merchantSig, deposit.a);
      const rest = await buildPayment(f, { invoiceId, invoiceTotal: total, gross: USDT(70) });
      await f.router.pay(rest.q, rest.merchantSig, rest.a);

      const key = T.invoiceKeyOf(f.merchantId, invoiceId);
      const inv = await f.router.invoices(key);
      expect(inv.paid).to.equal(total);

      const extra = await buildPayment(f, { invoiceId, invoiceTotal: total, gross: USDT(5) });
      await expect(f.router.pay(extra.q, extra.merchantSig, extra.a)).to.be.revertedWithCustomError(
        f.router,
        "InvoiceOverpaid"
      );
    });

    it("rejects a different total for an invoice already started", async function () {
      const f = await loadFixture(deployFixture);
      const invoiceId = T.idFromUuid("inv-total");
      const a = await buildPayment(f, { invoiceId, invoiceTotal: USDT(100), gross: USDT(30) });
      await f.router.pay(a.q, a.merchantSig, a.a);
      const b = await buildPayment(f, { invoiceId, invoiceTotal: USDT(200), gross: USDT(30) });
      await expect(f.router.pay(b.q, b.merchantSig, b.a)).to.be.revertedWithCustomError(
        f.router,
        "InvoiceTotalMismatch"
      );
    });

    it("splits the net amount 90/10", async function () {
      const f = await loadFixture(deployFixture);
      await f.registry
        .connect(f.mOwner)
        .setSplitProfile(f.merchantId, 1, [f.payout.address, f.affiliate.address], [9000, 1000]);
      const p = await buildPayment(f, { invoiceTotal: USDT(50), splitProfileId: 1 });
      const fee = p.q.fee; // 0.50
      const net = USDT(50) - fee;
      const toPayout = (net * 9000n) / 10000n;
      await expect(f.router.pay(p.q, p.merchantSig, p.a)).to.changeTokenBalances(
        f.usdt,
        [f.payout, f.affiliate, f.treasury],
        [toPayout, net - toPayout, fee]
      );
    });

    it("enforces the fee floor and the merchant's fee cap", async function () {
      const f = await loadFixture(deployFixture);
      const low = await buildPayment(f, { fee: USDT(0.01) });
      await expect(f.router.pay(low.q, low.merchantSig, low.a)).to.be.revertedWithCustomError(
        f.router,
        "FeeBelowProtocolFloor"
      );
      // 1 USDT ticket: floor 0.05 = 5% > 3% cap
      const small = await buildPayment(f, { invoiceId: T.idFromUuid("small"), invoiceTotal: USDT(1) });
      await expect(f.router.pay(small.q, small.merchantSig, small.a)).to.be.revertedWithCustomError(
        f.router,
        "FeeAboveMerchantCap"
      );
    });

    it("honours payer binding", async function () {
      const f = await loadFixture(deployFixture);
      const p = await buildPayment(f, { payerBinding: f.other.address });
      await expect(f.router.pay(p.q, p.merchantSig, p.a)).to.be.revertedWithCustomError(f.router, "PayerMismatch");
    });

    it("blocks new payments while paused and for suspended merchants", async function () {
      const f = await loadFixture(deployFixture);
      const p = await buildPayment(f);
      await f.router.pause();
      await expect(f.router.pay(p.q, p.merchantSig, p.a)).to.be.revertedWithCustomError(f.router, "EnforcedPause");
      await f.router.unpause();
      await f.registry.setStatus(f.merchantId, 2);
      await expect(f.router.pay(p.q, p.merchantSig, p.a)).to.be.revertedWithCustomError(f.router, "MerchantInactive");
    });
  });

  describe("PaymentRouter.refund", function () {
    async function paidFixture() {
      const f = await deployFixture();
      const p = await buildPayment(f, { invoiceTotal: USDT(20) });
      await f.router.pay(p.q, p.merchantSig, p.a);
      return { ...f, paid: p };
    }

    async function buildRefund(f, amount, { refundId = rand32(), funder = f.payout, signer = f.mSigner } = {}) {
      const t = {
        paymentId: f.paid.paymentKey,
        refundId,
        amount,
        fee: 0n,
        funder: funder.address,
        validUntil: BigInt(await time.latest()) + 600n,
      };
      const merchantSig = await signer.signTypedData(f.rDomain, T.types.RefundTerms, t);
      const termsHash = T.digest(f.rDomain, T.types.RefundTerms, t);
      const auth = {
        from: funder.address, to: f.routerAddr, value: amount + t.fee,
        validAfter: 0n, validBefore: MAX_U64, nonce: T.refundNonce(termsHash),
      };
      const sig = await funder.signTypedData(f.uDomain, T.types.ReceiveWithAuthorization, auth);
      return { t, merchantSig, fa: { validAfter: 0n, validBefore: MAX_U64, signature: sig } };
    }

    it("refunds partially, respects the cap, and works while paused", async function () {
      const f = await loadFixture(paidFixture);
      await f.router.pause();
      const r1 = await buildRefund(f, USDT(5));
      const tx = f.router.connect(f.relayer).refund(r1.t, r1.merchantSig, r1.fa);
      await expect(tx).to.emit(f.router, "RefundSettled");
      await expect(tx).to.changeTokenBalances(f.usdt, [f.payer, f.payout], [USDT(5), -USDT(5)]);

      const r2 = await buildRefund(f, USDT(16)); // 5 + 16 > 20
      await expect(f.router.refund(r2.t, r2.merchantSig, r2.fa)).to.be.revertedWithCustomError(
        f.router,
        "RefundExceedsPayment"
      );
      const pay = await f.router.payments(f.paid.paymentKey);
      expect(pay.refunded).to.equal(USDT(5));
    });

    it("rejects a reused refund id", async function () {
      const f = await loadFixture(paidFixture);
      const refundId = rand32();
      const r1 = await buildRefund(f, USDT(1), { refundId });
      await f.router.refund(r1.t, r1.merchantSig, r1.fa);
      const r2 = await buildRefund(f, USDT(1), { refundId });
      await expect(f.router.refund(r2.t, r2.merchantSig, r2.fa)).to.be.revertedWithCustomError(
        f.router,
        "RefundIdUsed"
      );
    });
  });

  describe("PaymentRouter installments", function () {
    async function buildPlan(f, { downPayment = USDT(10), installment = USDT(30), count = 3, period = 120 } = {}) {
      const now = BigInt(await time.latest());
      const t = {
        merchantId: f.merchantId,
        planId: T.idFromUuid("plan-1"),
        invoiceDigest: ZERO32,
        payer: f.payer.address,
        token: f.usdtAddr,
        downPayment,
        installmentAmount: installment,
        feePerInstallment: await f.router.protocolFee(f.usdtAddr, installment),
        downPaymentFee: downPayment > 0n ? await f.router.protocolFee(f.usdtAddr, downPayment) : 0n,
        count,
        period,
        firstDue: now + 60n,
        grace: 30,
        splitProfileId: 0,
        kind: 0,
        validUntil: now + 600n,
      };
      const merchantSig = await f.mSigner.signTypedData(f.rDomain, T.types.PlanTerms, t);
      const termsHash = T.digest(f.rDomain, T.types.PlanTerms, t);
      const consentDeadline = now + 600n;
      const consentSig = await f.payer.signTypedData(f.rDomain, T.types.PlanConsent, {
        termsHash, payer: f.payer.address, deadline: consentDeadline,
      });
      const committed = await f.router.committed(f.payer.address, f.usdtAddr);
      const total = downPayment + installment * BigInt(count);
      const permitMsg = {
        owner: f.payer.address, spender: f.routerAddr, value: committed + total,
        nonce: await f.usdt.nonces(f.payer.address), deadline: now + 600n,
      };
      const sig = ethers.Signature.from(await f.payer.signTypedData(f.uDomain, T.types.Permit, permitMsg));
      return {
        t,
        merchantSig,
        consent: { deadline: consentDeadline, signature: consentSig },
        permit: { value: permitMsg.value, deadline: permitMsg.deadline, v: sig.v, r: sig.r, s: sig.s },
        planKey: T.planKeyOf(f.merchantId, t.planId),
      };
    }

    it("creates a plan with a down payment, collects when due, then completes", async function () {
      const f = await loadFixture(deployFixture);
      const pl = await buildPlan(f, { count: 2 });
      const tx = f.router.connect(f.relayer).createPlan(pl.t, pl.merchantSig, pl.consent, pl.permit);
      await expect(tx).to.emit(f.router, "PlanCreated");
      await expect(tx).to.changeTokenBalance(f.usdt, f.payer, -USDT(10));
      expect(await f.router.committed(f.payer.address, f.usdtAddr)).to.equal(USDT(60));

      await expect(f.router.collectInstallment(pl.planKey)).to.be.revertedWithCustomError(
        f.router,
        "InstallmentNotDue"
      );
      await time.increase(61);
      await expect(f.router.collectInstallment(pl.planKey)).to.emit(f.router, "InstallmentCollected");
      await time.increase(120);
      await expect(f.router.collectInstallment(pl.planKey)).to.emit(f.router, "PlanCompleted");
      expect(await f.router.committed(f.payer.address, f.usdtAddr)).to.equal(0n);
      expect((await f.router.plans(pl.planKey)).status).to.equal(4);
    });

    it("marks a missed installment delinquent, then allows catch-up", async function () {
      const f = await loadFixture(deployFixture);
      const pl = await buildPlan(f, { downPayment: 0n });
      await f.router.createPlan(pl.t, pl.merchantSig, pl.consent, pl.permit);
      await time.increase(60 + 30 + 5);
      await expect(f.router.markDelinquent(pl.planKey)).to.emit(f.router, "InstallmentMissed");
      await f.router.collectInstallment(pl.planKey);
      expect((await f.router.plans(pl.planKey)).status).to.equal(1);
    });

    it("lets the payer cancel and releases the commitment", async function () {
      const f = await loadFixture(deployFixture);
      const pl = await buildPlan(f);
      await f.router.createPlan(pl.t, pl.merchantSig, pl.consent, pl.permit);
      const c = { planId: pl.planKey, signer: f.payer.address, deadline: MAX_U64 };
      const sig = await f.payer.signTypedData(f.rDomain, T.types.CancelPlan, c);
      await f.router.pause(); // cancel still works while paused
      await expect(f.router.cancelPlan(c, sig)).to.emit(f.router, "PlanCancelled");
      expect(await f.router.committed(f.payer.address, f.usdtAddr)).to.equal(0n);
    });

    it("rejects a cancel from a stranger", async function () {
      const f = await loadFixture(deployFixture);
      const pl = await buildPlan(f);
      await f.router.createPlan(pl.t, pl.merchantSig, pl.consent, pl.permit);
      const c = { planId: pl.planKey, signer: f.other.address, deadline: MAX_U64 };
      const sig = await f.other.signTypedData(f.rDomain, T.types.CancelPlan, c);
      await expect(f.router.cancelPlan(c, sig)).to.be.revertedWithCustomError(f.router, "InvalidCancelSigner");
    });
  });

  describe("FeeTreasury", function () {
    async function fundedFixture() {
      const f = await deployFixture();
      await f.usdt.mint(f.treasuryAddr, USDT(50));
      await f.treasury.setRelayer(f.relayer.address, true);
      await f.treasury.setLimits({
        maxUsdtPerRun: USDT(20),
        maxUsdtPerDay: USDT(30),
        minWbtPerUsdt: ethers.parseEther("0.01076"), // 80% of 0.01345
        maxDeadlineWindow: 120,
      });
      return f;
    }

    it("swaps fees to native WBT for the relayer", async function () {
      const f = await loadFixture(fundedFixture);
      const usdtIn = USDT(10);
      const expected = ethers.parseEther("0.1345");
      const deadline = BigInt(await time.latest()) + 60n;
      const tx = f.treasury.connect(f.relayer).refill(usdtIn, (expected * 99n) / 100n, deadline);
      await expect(tx).to.emit(f.treasury, "Refill");
      await expect(tx).to.changeEtherBalance(f.relayer, expected, { includeFee: false });
      expect(await f.usdt.balanceOf(f.treasuryAddr)).to.equal(USDT(40));
    });

    it("enforces the price floor, caps, deadline and relayer list", async function () {
      const f = await loadFixture(fundedFixture);
      const dl = BigInt(await time.latest()) + 60n;
      await expect(f.treasury.connect(f.relayer).refill(USDT(10), 1n, dl)).to.be.revertedWithCustomError(
        f.treasury,
        "BelowPriceFloor"
      );
      await expect(
        f.treasury.connect(f.relayer).refill(USDT(21), ethers.parseEther("1"), dl)
      ).to.be.revertedWithCustomError(f.treasury, "AboveRunCap");
      await expect(
        f.treasury.connect(f.relayer).refill(USDT(1), ethers.parseEther("0.011"), dl + 3600n)
      ).to.be.revertedWithCustomError(f.treasury, "BadDeadline");
      await expect(
        f.treasury.connect(f.other).refill(USDT(1), ethers.parseEther("0.011"), dl)
      ).to.be.revertedWithCustomError(f.treasury, "NotRelayer");

      await f.treasury.connect(f.relayer).refill(USDT(20), ethers.parseEther("0.22"), dl);
      await expect(
        f.treasury.connect(f.relayer).refill(USDT(15), ethers.parseEther("0.17"), dl)
      ).to.be.revertedWithCustomError(f.treasury, "AboveDailyCap");
    });

    it("lets the admin withdraw only above the reserve", async function () {
      const f = await loadFixture(fundedFixture);
      await f.treasury.setReservedUsdt(USDT(40));
      await expect(f.treasury.withdraw(f.admin.address, USDT(11))).to.be.revertedWithCustomError(
        f.treasury,
        "AboveWithdrawable"
      );
      await f.treasury.withdraw(f.admin.address, USDT(10));
    });
  });
});
