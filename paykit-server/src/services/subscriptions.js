// Subscriptions and installment plans on PaymentRouter's plan functions.
//
//   merchant  POST /v1/plans                      -> an offer with a subscribe link
//   customer  POST /v1/public/plans/:id/subscribe -> two things to sign (no gas):
//               1. USDT permit: lets the router pull up to the plan total, nothing more
//               2. PlanConsent: "I agree to exactly these terms" (bound to the merchant-signed terms hash)
//   customer  POST /v1/public/subscriptions/:id/authorize -> relayer calls createPlan (first charge happens now)
//   scheduler every SCHEDULER_POLL_MS: collectInstallment() when a charge is due; markDelinquent() after grace
//   either    cancel any time (payer: gasless signature; merchant: API call). Remaining allowance is released.
const { ethers, T, currentRouter, routerAt, usdt, domains, provider, txUrl, reasonOf } = require("../chain");
const config = require("../config");
const { HttpError, uid, parseUsdt, fmtUsdt, parseAddress, toJson } = require("../util");

const PLAN_ACTIVE = 1n;
const PLAN_DELINQUENT = 2n;
const KIND = { installments: 0, subscription: 1 };
const INTERVALS = { minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 };

function parseInterval(v) {
  if (v === undefined || v === null || v === "") throw new HttpError(400, "invalid_interval", "interval is required");
  const s = String(v).trim().toLowerCase();
  const sec = INTERVALS[s] ?? (/^\d+$/.test(s) ? Number(s) : NaN);
  if (!Number.isFinite(sec) || sec < 60 || sec > 4_000_000_000) {
    throw new HttpError(400, "invalid_interval", `interval must be one of ${Object.keys(INTERVALS).join(", ")} or seconds (>= 60)`);
  }
  return { periodSec: sec, label: INTERVALS[s] ? s : `${sec}s` };
}

function parseSeconds(v, field, fallback) {
  if (v === undefined || v === null || v === "") return fallback;
  if (!/^\d+$/.test(String(v))) throw new HttpError(400, "invalid_" + field, `${field} must be a whole number of seconds`);
  return Number(v);
}

async function chainNow() {
  return BigInt((await provider.getBlock("latest")).timestamp);
}
const iso = (sec) => new Date(Number(sec) * 1000).toISOString();

function createSubscriptionService(store, relayer, merchants, webhooks, points) {
  async function feeFor(merchant, amount, r = currentRouter()) {
    if (amount === 0n) return 0n;
    const fee = await r.contract.protocolFee(config.usdt, amount);
    if (fee > amount || fee * 10000n > amount * BigInt(merchant.maxFeeBps)) {
      const min = (fee * 10000n + BigInt(merchant.maxFeeBps) - 1n) / BigInt(merchant.maxFeeBps);
      throw new HttpError(400, "amount_too_small", `Each charge must be at least ${fmtUsdt(min)} USDT`, { minAmount: fmtUsdt(min) });
    }
    return fee;
  }

  /** How a plan offer turns into onchain terms. */
  function shape(plan) {
    const amount = BigInt(plan.amount);
    if (plan.firstChargeNow) return { downPayment: amount, count: plan.cycles - 1 };
    return { downPayment: BigInt(plan.deposit), count: plan.cycles };
  }

  function publicPlan(plan, merchant) {
    const { downPayment, count } = shape(plan);
    const amount = BigInt(plan.amount);
    return {
      id: plan.id,
      kind: plan.kind,
      merchant: merchant ? { id: merchant.id, name: merchant.name } : undefined,
      name: plan.name,
      description: plan.description || null,
      currency: "USDT",
      amount: fmtUsdt(amount),
      interval: plan.interval,
      intervalSeconds: plan.periodSec,
      cycles: plan.cycles,
      firstChargeNow: plan.firstChargeNow,
      deposit: fmtUsdt(plan.deposit),
      graceSeconds: plan.graceSec,
      chargedAtSignup: fmtUsdt(downPayment),
      scheduledCharges: count,
      total: fmtUsdt(downPayment + amount * BigInt(count)),
      subscribeUrl: plan.subscribeUrl,
      active: plan.active,
      createdAt: plan.createdAt,
    };
  }

  function schedule(sub) {
    const rows = [];
    const t = sub.terms;
    if (BigInt(t.downPayment) > 0n) rows.push({ index: "signup", dueAt: sub.activatedAt || null, amount: fmtUsdt(t.downPayment) });
    for (let i = 0; i < Number(t.count); i++) {
      rows.push({
        index: i,
        dueAt: iso(BigInt(t.firstDue) + BigInt(i) * BigInt(t.period)),
        amount: fmtUsdt(t.installmentAmount),
        status: i < (sub.collected || 0) ? "paid" : "scheduled",
      });
    }
    return rows;
  }

  function publicSubscription(sub, payments = []) {
    const t = sub.terms;
    const collected = sub.collected || 0;
    const next = collected < Number(t.count) ? iso(BigInt(t.firstDue) + BigInt(collected) * BigInt(t.period)) : null;
    return {
      id: sub.id,
      planId: sub.planId,
      kind: sub.kind,
      merchantId: sub.merchantId,
      payer: sub.payer,
      status: sub.status,
      onchainPlanId: sub.planKey,
      currency: "USDT",
      amount: fmtUsdt(t.installmentAmount),
      chargesPaid: sub.chargesPaid || 0,
      amountPaid: fmtUsdt(sub.amountPaid || "0"),
      scheduledChargesCollected: collected,
      scheduledChargesTotal: Number(t.count),
      nextChargeAt: ["active", "past_due"].includes(sub.status) ? next : null,
      graceSeconds: Number(t.grace),
      pointsPerCharge: sub.pointsPerCharge || 0,
      pointsAtSignup: sub.downPaymentPoints || 0,
      schedule: schedule(sub),
      lastError: sub.lastError || null,
      createTxUrl: sub.createTx ? txUrl(sub.createTx) : null,
      cancelTxUrl: sub.cancelTx ? txUrl(sub.cancelTx) : null,
      cancelledBy: sub.cancelledBy || null,
      payments: payments.map((p) => ({ id: p.id, amount: fmtUsdt(p.gross), kind: p.kind, settledAt: p.settledAt, txUrl: p.txUrl })),
      createdAt: sub.createdAt,
    };
  }

  // ───────────────────────── merchant: plan offers ─────────────────────────

  async function createPlan(merchant, body) {
    if (!body.name || typeof body.name !== "string") throw new HttpError(400, "invalid_name", "name is required");
    const kind = body.kind || "subscription";
    if (!(kind in KIND)) throw new HttpError(400, "invalid_kind", 'kind must be "subscription" or "installments"');
    const amount = parseUsdt(body.amount);
    const { periodSec, label } = parseInterval(body.interval);
    const cycles = Number(body.cycles);
    if (!Number.isInteger(cycles) || cycles < 1 || cycles > 1000) throw new HttpError(400, "invalid_cycles", "cycles must be 1..1000");
    const deposit = body.deposit ? parseUsdt(body.deposit, "deposit") : 0n;
    const firstChargeNow = body.firstChargeNow !== undefined ? !!body.firstChargeNow : kind === "subscription" && deposit === 0n;
    if (firstChargeNow && deposit > 0n) throw new HttpError(400, "invalid_plan", "Use either firstChargeNow or deposit, not both");
    if (firstChargeNow && cycles < 2) throw new HttpError(400, "invalid_cycles", "With firstChargeNow, cycles must be at least 2");
    const graceSec = parseSeconds(body.graceSeconds, "graceSeconds", Math.min(config.subscriptions.defaultGraceSec, periodSec));

    await feeFor(merchant, amount);
    if (deposit > 0n) await feeFor(merchant, deposit);

    const id = uid("plan");
    const plan = await store.insert("plans", {
      id,
      merchantId: merchant.id,
      kind,
      name: body.name,
      description: body.description || null,
      amount: amount.toString(),
      deposit: deposit.toString(),
      interval: label,
      periodSec,
      cycles,
      firstChargeNow,
      graceSec,
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
      subscribeUrl: `${config.checkoutBaseUrl.replace(/\/pay$/, "")}/subscribe/${id}`,
      active: true,
    });
    return publicPlan(plan, merchant);
  }

  async function listPlans(merchant) {
    return (await store.find("plans", { merchantId: merchant.id }, { limit: 100 })).map((p) => publicPlan(p, merchant));
  }

  async function getPlanFor(merchant, id) {
    const p = await store.get("plans", id);
    if (!p || p.merchantId !== merchant.id) throw new HttpError(404, "not_found", "Plan not found");
    return publicPlan(p, merchant);
  }

  async function setPlanActive(merchant, id, active) {
    const p = await store.get("plans", id);
    if (!p || p.merchantId !== merchant.id) throw new HttpError(404, "not_found", "Plan not found");
    return publicPlan(await store.update("plans", id, { active: !!active }), merchant);
  }

  async function getPublicPlan(id) {
    const p = await store.get("plans", id);
    if (!p) throw new HttpError(404, "not_found", "Plan not found");
    return publicPlan(p, await store.get("merchants", p.merchantId));
  }

  // ───────────────────────── customer: subscribe ─────────────────────────

  async function subscribe(planId, body) {
    const plan = await store.get("plans", planId);
    if (!plan) throw new HttpError(404, "not_found", "Plan not found");
    if (!plan.active) throw new HttpError(409, "plan_inactive", "This plan is no longer offered");
    const merchant = await store.get("merchants", plan.merchantId);
    const payer = parseAddress(body.payer, "payer");

    const amount = BigInt(plan.amount);
    const { downPayment, count } = shape(plan);
    const r = currentRouter();
    const feePerInstallment = await feeFor(merchant, amount, r);
    const downPaymentFee = await feeFor(merchant, downPayment, r);
    const total = downPayment + amount * BigInt(count);

    const now = await chainNow();
    const validUntil = now + BigInt(config.quoteTtlSec);
    const localPlanId = ethers.hexlify(ethers.randomBytes(32));
    const terms = {
      merchantId: merchant.id,
      planId: localPlanId,
      invoiceDigest: ethers.keccak256(
        ethers.toUtf8Bytes(JSON.stringify({ plan: plan.id, amount: plan.amount, periodSec: plan.periodSec, cycles: plan.cycles, payer }))
      ),
      payer,
      token: config.usdt,
      downPayment,
      installmentAmount: amount,
      feePerInstallment,
      downPaymentFee,
      count,
      period: plan.periodSec,
      firstDue: now + BigInt(plan.periodSec),
      grace: plan.graceSec,
      splitProfileId: 0,
      kind: KIND[plan.kind],
      validUntil,
    };
    // v2: points on every charge, from the shop's best campaign that applies to subscriptions
    let perCharge = { points: 0, campaign: null };
    let atSignup = { points: 0, campaign: null };
    if (r.version === 2) {
      // one campaign per plan (it is one onchain campaignId): the best one for the recurring charge,
      // applied to the sign-up charge too; fall back to the best for the sign-up charge alone
      perCharge = await points.bestCampaign(merchant.id, amount, payer, "subscriptions");
      const campaign = perCharge.campaign || (downPayment > 0n ? (await points.bestCampaign(merchant.id, downPayment, payer, "subscriptions")).campaign : null);
      atSignup = { points: await points.campaignPoints(campaign, downPayment), campaign };
      Object.assign(terms, {
        pointsPerCharge: BigInt(perCharge.campaign ? perCharge.points : 0),
        downPaymentPoints: BigInt(atSignup.points),
        campaignId: campaign ? campaign.idHash : ethers.ZeroHash,
      });
    }
    const termsTypes = r.version === 2 ? T.types.PlanTermsV2 : T.types.PlanTerms;
    const signer = merchants.signerOf(merchant);
    const merchantSig = await signer.signTypedData(r.domain, termsTypes, terms);
    const termsHash = T.digest(r.domain, termsTypes, terms);

    // permit sets the allowance, so include what this payer already owes on other plans
    const committed = await r.contract.committed(payer, config.usdt);
    const permit = {
      owner: payer,
      spender: r.address,
      value: (committed + total).toString(),
      nonce: (await usdt.nonces(payer)).toString(),
      deadline: validUntil.toString(),
    };
    const consent = { termsHash, payer, deadline: validUntil.toString() };

    const sub = await store.insert("subscriptions", {
      id: uid("sub"),
      merchantId: merchant.id,
      planId: plan.id,
      kind: plan.kind,
      payer,
      planKey: T.planKeyOf(merchant.id, localPlanId),
      router: r.address,
      pointsPerCharge: Number(terms.pointsPerCharge || 0n),
      downPaymentPoints: Number(terms.downPaymentPoints || 0n),
      terms: toJson(terms),
      termsHash,
      merchantSig,
      permit,
      consent,
      status: "awaiting_signature",
      collected: 0,
      chargesPaid: 0,
      amountPaid: "0",
      expiresAt: iso(validUntil),
    });
    return {
      subscriptionId: sub.id,
      status: sub.status,
      expiresAt: sub.expiresAt,
      summary: {
        chargedNow: fmtUsdt(downPayment),
        then: `${fmtUsdt(amount)} USDT every ${plan.interval} x ${count}`,
        total: fmtUsdt(total),
        firstScheduledCharge: iso(terms.firstDue),
        pointsPerCharge: Number(terms.pointsPerCharge || 0n),
        pointsAtSignup: Number(terms.downPaymentPoints || 0n),
      },
      schedule: schedule(sub),
      // sign both with eth_signTypedData_v4 (add EIP712Domain to types for MetaMask). No gas.
      typedData: {
        permit: { domain: domains.usdt, types: T.types.Permit, primaryType: "Permit", message: permit },
        consent: { domain: r.domain, types: T.types.PlanConsent, primaryType: "PlanConsent", message: consent },
      },
    };
  }

  async function authorize(id, { permitSignature, consentSignature }) {
    const sub = await store.get("subscriptions", id);
    if (!sub) throw new HttpError(404, "not_found", "Subscription not found");
    if (sub.status !== "awaiting_signature") return publicSubscription(sub);
    if (new Date(sub.expiresAt).getTime() < Date.now() + 15_000) {
      await store.update("subscriptions", id, { status: "expired" });
      throw new HttpError(410, "subscription_expired", "Signing window expired, subscribe again");
    }
    const check = (domain, types, msg, sig, what) => {
      let who;
      try {
        who = ethers.verifyTypedData(domain, types, msg, sig);
      } catch {
        throw new HttpError(400, "invalid_signature", `${what} signature could not be parsed`);
      }
      if (who !== sub.payer) throw new HttpError(400, "invalid_signature", `${what} signed by ${who}, expected ${sub.payer}`);
    };
    check(domains.usdt, T.types.Permit, sub.permit, permitSignature, "Permit");
    const rt = routerAt(sub.router);
    check(rt.domain, T.types.PlanConsent, sub.consent, consentSignature, "Consent");

    const firstCharge = BigInt(sub.terms.downPayment);
    const bal = await usdt.balanceOf(sub.payer);
    if (bal < firstCharge) throw new HttpError(400, "insufficient_funds", `Payer has ${fmtUsdt(bal)} USDT, first charge is ${fmtUsdt(firstCharge)}`);

    const sig = ethers.Signature.from(permitSignature);
    const permitData = { value: sub.permit.value, deadline: sub.permit.deadline, v: sig.v, r: sig.r, s: sig.s };
    const consentData = { deadline: sub.consent.deadline, signature: consentSignature };

    await store.update("subscriptions", id, { status: "submitting" });
    let sent;
    try {
      sent = await relayer.submit(
        "router.createPlan",
        () => rt.contract.createPlan.staticCall(sub.terms, sub.merchantSig, consentData, permitData),
        () => rt.contract.createPlan(sub.terms, sub.merchantSig, consentData, permitData),
        { merchantId: sub.merchantId, subscriptionId: id }
      );
    } catch (e) {
      await store.update("subscriptions", id, { status: "failed", lastError: e.message });
      throw new HttpError(400, "subscription_rejected", `Subscription rejected: ${e.message}`);
    }
    const updated = await store.update("subscriptions", id, { status: "submitted", createTx: sent.hash });
    sent.wait().catch(async (e) => store.update("subscriptions", id, { status: "failed", lastError: reasonOf(e) }));
    return publicSubscription(updated);
  }

  // ───────────────────────── reads ─────────────────────────

  async function paymentsOf(sub) {
    return store.find("payments", { subscriptionId: sub.id }, { limit: 1000, order: "asc" });
  }

  async function getPublic(id) {
    const sub = await store.get("subscriptions", id);
    if (!sub) throw new HttpError(404, "not_found", "Subscription not found");
    return publicSubscription(sub, await paymentsOf(sub));
  }

  async function getFor(merchant, id) {
    const sub = await store.get("subscriptions", id);
    if (!sub || sub.merchantId !== merchant.id) throw new HttpError(404, "not_found", "Subscription not found");
    return publicSubscription(sub, await paymentsOf(sub));
  }

  async function listFor(merchant, { status } = {}) {
    const filter = { merchantId: merchant.id, ...(status ? { status } : {}) };
    const rows = await store.find("subscriptions", filter, { limit: 200 });
    return rows.filter((s) => !["awaiting_signature", "expired"].includes(s.status) || status).map((s) => publicSubscription(s));
  }

  // ───────────────────────── cancel (any time) ─────────────────────────

  async function relayCancel(sub, c, signature, by) {
    await store.update("subscriptions", sub.id, { cancelRequested: by });
    let sent;
    try {
      sent = await relayer.submit(
        "router.cancelPlan",
        () => routerAt(sub.router).contract.cancelPlan.staticCall(c, signature),
        () => routerAt(sub.router).contract.cancelPlan(c, signature),
        { merchantId: sub.merchantId, subscriptionId: sub.id }
      );
    } catch (e) {
      throw new HttpError(400, "cancel_rejected", `Cancel rejected: ${e.message}`);
    }
    return publicSubscription(await store.update("subscriptions", sub.id, { cancelTx: sent.hash }));
  }

  function assertCancellable(sub) {
    if (!["active", "past_due"].includes(sub.status)) {
      throw new HttpError(409, "not_cancellable", `Subscription is ${sub.status}`);
    }
  }

  async function cancelByMerchant(merchant, id) {
    const sub = await store.get("subscriptions", id);
    if (!sub || sub.merchantId !== merchant.id) throw new HttpError(404, "not_found", "Subscription not found");
    assertCancellable(sub);
    const signer = merchants.signerOf(merchant);
    const c = { planId: sub.planKey, signer: signer.address, deadline: (await chainNow()) + 600n };
    const signature = await signer.signTypedData(routerAt(sub.router).domain, T.types.CancelPlan, c);
    return relayCancel(sub, c, signature, "merchant");
  }

  /** Step 1 for the customer: get the CancelPlan message to sign. */
  async function cancelRequest(id) {
    const sub = await store.get("subscriptions", id);
    if (!sub) throw new HttpError(404, "not_found", "Subscription not found");
    assertCancellable(sub);
    const c = { planId: sub.planKey, signer: sub.payer, deadline: ((await chainNow()) + 600n).toString() };
    await store.update("subscriptions", id, { cancelMsg: c });
    return { subscriptionId: id, typedData: { domain: routerAt(sub.router).domain, types: T.types.CancelPlan, primaryType: "CancelPlan", message: c } };
  }

  /** Step 2: the customer's signature; the relayer pays the gas. */
  async function cancelByPayer(id, { signature }) {
    const sub = await store.get("subscriptions", id);
    if (!sub) throw new HttpError(404, "not_found", "Subscription not found");
    assertCancellable(sub);
    if (!sub.cancelMsg) throw new HttpError(400, "no_cancel_request", "Call cancel-request first");
    let who;
    try {
      who = ethers.verifyTypedData(routerAt(sub.router).domain, T.types.CancelPlan, sub.cancelMsg, signature);
    } catch {
      throw new HttpError(400, "invalid_signature", "Signature could not be parsed");
    }
    if (who !== sub.payer) throw new HttpError(400, "invalid_signature", `Signed by ${who}, expected ${sub.payer}`);
    return relayCancel(sub, sub.cancelMsg, signature, "payer");
  }

  // ───────────────────────── scheduler ─────────────────────────

  let ticking = false;
  let lastTick = null;

  async function processOne(sub, now) {
    const rt = routerAt(sub.router);
    const onchain = await rt.contract.plans(sub.planKey);
    if (onchain.status !== PLAN_ACTIVE && onchain.status !== PLAN_DELINQUENT) return;
    const collected = Number(onchain.collected);
    if (collected >= Number(onchain.count)) return;
    const due = onchain.firstDue + BigInt(collected) * onchain.period;
    if (now < due) return;
    if (sub.inFlight && sub.inFlight.index === collected) return; // a charge for this cycle is already on its way
    if (sub.lastAttemptAt && Date.now() - new Date(sub.lastAttemptAt).getTime() < config.subscriptions.retryAfterSec * 1000) return;

    const need = onchain.installmentAmount;
    const [bal, allowance] = await Promise.all([usdt.balanceOf(sub.payer), usdt.allowance(sub.payer, rt.address)]);
    if (bal >= need && allowance >= need) {
      try {
        const sent = await relayer.submit(
          "router.collectInstallment",
          () => rt.contract.collectInstallment.staticCall(sub.planKey),
          () => rt.contract.collectInstallment(sub.planKey),
          { merchantId: sub.merchantId, subscriptionId: sub.id, index: collected }
        );
        await store.update("subscriptions", sub.id, {
          inFlight: { index: collected, tx: sent.hash },
          lastAttemptAt: new Date().toISOString(),
          lastError: null,
        });
        sent.wait().catch(async (e) =>
          store.update("subscriptions", sub.id, { inFlight: null, lastError: `charge ${collected} failed: ${reasonOf(e)}` })
        );
        return;
      } catch (e) {
        await store.update("subscriptions", sub.id, { lastAttemptAt: new Date().toISOString(), lastError: e.message });
        return;
      }
    }

    // can't charge: tell the merchant once per cycle, and mark past due after the grace period
    const reason = bal < need ? `payer balance ${fmtUsdt(bal)} < ${fmtUsdt(need)} USDT` : "payer revoked the allowance";
    const patch = { lastAttemptAt: new Date().toISOString(), lastError: reason };
    const merchant = await store.get("merchants", sub.merchantId);
    if (sub.failNotifiedIndex !== collected && merchant) {
      await webhooks.enqueue(merchant, "subscription.charge_failed", {
        subscription: publicSubscription(sub),
        cycle: collected,
        reason,
        retryInSeconds: config.subscriptions.retryAfterSec,
      });
      patch.failNotifiedIndex = collected;
    }
    await store.update("subscriptions", sub.id, patch);
    if (onchain.status === PLAN_ACTIVE && now > due + onchain.grace) {
      try {
        await relayer.submit(
          "router.markDelinquent",
          () => rt.contract.markDelinquent.staticCall(sub.planKey),
          () => rt.contract.markDelinquent(sub.planKey),
          { merchantId: sub.merchantId, subscriptionId: sub.id }
        );
      } catch (e) {
        console.warn(`[scheduler] markDelinquent ${sub.id}: ${e.message}`);
      }
    }
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const now = await chainNow();
      const subs = [
        ...(await store.find("subscriptions", { status: "active" }, { limit: 500, order: "asc" })),
        ...(await store.find("subscriptions", { status: "past_due" }, { limit: 500, order: "asc" })),
      ];
      for (const sub of subs) {
        try {
          await processOne(sub, now);
        } catch (e) {
          console.error(`[scheduler] ${sub.id}: ${e.message}`);
        }
      }
      lastTick = { at: new Date().toISOString(), checked: subs.length };
    } catch (e) {
      console.error("[scheduler] tick error:", e.message);
    } finally {
      ticking = false;
    }
  }

  function start() {
    setInterval(tick, config.subscriptions.schedulerPollMs).unref();
    console.log(`[scheduler] checking due charges every ${config.subscriptions.schedulerPollMs / 1000}s`);
  }

  // ───────────────────────── chain events (from the observer) ─────────────────────────

  async function bySubKey(planKey) {
    return store.findOne("subscriptions", { planKey });
  }
  async function notify(sub, type, extra = {}) {
    const merchant = await store.get("merchants", sub.merchantId);
    if (merchant) await webhooks.enqueue(merchant, type, { subscription: publicSubscription(sub), ...extra });
  }

  async function onPlanCreated(ev) {
    const sub = await bySubKey(ev.planId);
    if (!sub || sub.status === "active") return;
    const s = await store.update("subscriptions", sub.id, { status: "active", activatedAt: ev.settledAt, createTx: ev.txHash });
    console.log(`[observer] subscription ${sub.id} active`);
    await notify(s, "subscription.activated");
  }

  async function onInstallmentCollected(ev) {
    const sub = await bySubKey(ev.planId);
    const index = Number(ev.index);
    if (!sub || (sub.collected || 0) > index) return;
    const s = await store.update("subscriptions", sub.id, {
      collected: index + 1,
      inFlight: null,
      lastError: null,
      status: sub.status === "past_due" ? "active" : sub.status,
    });
    console.log(`[observer] subscription ${sub.id} charge ${index + 1}/${sub.terms.count} collected`);
    await notify(s, "subscription.charged", { cycle: index, paymentId: ev.paymentId, amount: fmtUsdt(ev.amount), txUrl: txUrl(ev.txHash) });
  }

  async function onInstallmentMissed(ev) {
    const sub = await bySubKey(ev.planId);
    if (!sub || sub.status === "past_due") return;
    const s = await store.update("subscriptions", sub.id, { status: "past_due" });
    await notify(s, "subscription.past_due", { cycle: Number(ev.index) });
  }

  async function onPlanCancelled(ev) {
    const sub = await bySubKey(ev.planId);
    if (!sub || sub.status === "cancelled") return;
    const by = sub.payer === ev.by ? "payer" : "merchant";
    const s = await store.update("subscriptions", sub.id, { status: "cancelled", cancelledBy: by, cancelTx: ev.txHash, inFlight: null });
    console.log(`[observer] subscription ${sub.id} cancelled by ${by}`);
    await notify(s, "subscription.cancelled", { by });
  }

  async function onPlanCompleted(ev) {
    const sub = await bySubKey(ev.planId);
    if (!sub || sub.status === "completed") return;
    const s = await store.update("subscriptions", sub.id, { status: "completed", inFlight: null });
    await notify(s, "subscription.completed");
  }

  return {
    createPlan,
    listPlans,
    getPlanFor,
    setPlanActive,
    getPublicPlan,
    subscribe,
    authorize,
    getPublic,
    getFor,
    listFor,
    cancelByMerchant,
    cancelRequest,
    cancelByPayer,
    tick,
    start,
    status: () => lastTick,
    onPlanCreated,
    onInstallmentCollected,
    onInstallmentMissed,
    onPlanCancelled,
    onPlanCompleted,
  };
}

module.exports = { createSubscriptionService };
