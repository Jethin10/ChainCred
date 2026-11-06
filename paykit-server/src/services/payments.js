// Invoices / payment links, checkout quotes, gasless settlement, refunds, receipts and CSV export.
const { ethers, T, routers, currentRouter, routerAt, usdt, domains, txUrl, reasonOf } = require("../chain");
const config = require("../config");
const { HttpError, uid, nowSec, parseUsdt, fmtUsdt, parseAddress, toJson } = require("../util");

const RWA_TYPES = T.types.ReceiveWithAuthorization;

function invoiceStatus(inv) {
  const total = BigInt(inv.amount);
  const paid = BigInt(inv.paidBase);
  let status = paid === 0n ? "open" : paid < total ? "partially_paid" : "paid";
  if (status !== "paid" && inv.dueDate && new Date(inv.dueDate).getTime() < Date.now()) status = "overdue";
  return status;
}

function publicInvoice(inv, merchant) {
  const total = BigInt(inv.amount);
  const paid = BigInt(inv.paidBase);
  return {
    id: inv.id,
    status: invoiceStatus(inv),
    merchant: merchant ? { id: merchant.id, name: merchant.name, profile: merchant.profile || null } : undefined,
    reference: inv.reference || null,
    description: inv.description || null,
    currency: "USDT",
    amount: fmtUsdt(total),
    amountPaid: fmtUsdt(paid),
    amountDue: fmtUsdt(total - paid),
    amountRefunded: fmtUsdt(inv.refundedBase),
    allowPartial: !!inv.allowPartial,
    payerAddress: inv.payerAddress || null,
    dueDate: inv.dueDate || null,
    payUrl: inv.payUrl,
    successUrl: inv.successUrl || null,
    paymentIds: inv.paymentIds || [],
    chain: { id: config.chainId, token: config.usdt, router: inv.router || config.router },
    createdAt: inv.createdAt,
  };
}

function publicPayment(p, refunds = []) {
  return {
    id: p.id,
    merchantId: p.merchantId,
    invoiceId: p.invoiceId || null,
    subscriptionId: p.subscriptionId || null,
    reference: p.reference || null,
    payer: p.payer,
    refundTo: p.refundTo,
    currency: "USDT",
    gross: fmtUsdt(p.gross),
    fee: fmtUsdt(p.fee),
    net: fmtUsdt(p.net),
    refunded: fmtUsdt(p.refunded),
    discount: fmtUsdt(p.discount || "0"),
    pointsEarned: p.pointsEarned || 0,
    pointsRedeemed: p.pointsRedeemed || 0,
    rewardId: p.rewardId || null,
    router: p.router || config.router,
    kind: p.kind,
    txHash: p.txHash,
    txUrl: p.txUrl,
    blockNumber: p.blockNumber,
    settledAt: p.settledAt,
    refunds: refunds.map(publicRefund),
  };
}

function publicRefund(r) {
  return {
    id: r.id,
    refundId: r.refundId,
    paymentId: r.paymentId,
    amount: fmtUsdt(r.amount),
    funder: r.funder,
    to: r.to || null,
    reason: r.reason || null,
    status: r.status,
    txHash: r.txHash || null,
    txUrl: r.txHash ? txUrl(r.txHash) : null,
    error: r.error || null,
    createdAt: r.createdAt,
  };
}

function createPaymentService(store, relayer, merchants, webhooks, points) {
  async function checkFee(merchant, gross, r = currentRouter()) {
    const fee = await r.contract.protocolFee(config.usdt, gross);
    if (fee > gross || fee * 10000n > gross * BigInt(merchant.maxFeeBps)) {
      // smallest amount whose fee fits under the merchant cap
      const minAmount = (fee * 10000n + BigInt(merchant.maxFeeBps) - 1n) / BigInt(merchant.maxFeeBps);
      throw new HttpError(400, "amount_too_small", `Amount too small: minimum is ${fmtUsdt(minAmount)} USDT`, {
        minAmount: fmtUsdt(minAmount),
      });
    }
    return fee;
  }

  // ───────────────────────── invoices / payment links ─────────────────────────

  async function createInvoice(merchant, body) {
    const amount = parseUsdt(body.amount);
    await checkFee(merchant, amount);
    const allowPartial = !!body.allowPartial;
    const payerAddress = body.payerAddress ? parseAddress(body.payerAddress, "payerAddress") : null;
    let dueDate = null;
    if (body.dueDate) {
      const d = new Date(body.dueDate);
      if (isNaN(d)) throw new HttpError(400, "invalid_due_date", "dueDate must be an ISO date");
      dueDate = d.toISOString();
    }
    const id = uid("inv");
    const invoiceIdHash = T.idFromUuid(id);
    const canonical = {
      id,
      merchantId: merchant.id,
      amount: amount.toString(),
      currency: "USDT",
      reference: body.reference || null,
      description: body.description || null,
      dueDate,
    };
    const inv = await store.insert("invoices", {
      id,
      merchantId: merchant.id,
      invoiceIdHash,
      invoiceKey: T.invoiceKeyOf(merchant.id, invoiceIdHash),
      invoiceDigest: ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(canonical))),
      reference: body.reference || null,
      description: body.description || null,
      amount: amount.toString(),
      paidBase: "0",
      refundedBase: "0",
      allowPartial,
      payerAddress,
      dueDate,
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
      successUrl: body.successUrl || null,
      payUrl: `${config.checkoutBaseUrl}/${id}`,
      paymentIds: [],
      router: currentRouter().address, // an invoice stays on the router its first payment used
    });
    return publicInvoice(inv, merchant);
  }

  async function getInvoiceFor(merchant, id) {
    const inv = await store.get("invoices", id);
    if (!inv || inv.merchantId !== merchant.id) throw new HttpError(404, "not_found", "Invoice not found");
    return publicInvoice(inv, merchant);
  }

  async function listInvoices(merchant, { limit = 50 } = {}) {
    return (await store.find("invoices", { merchantId: merchant.id }, { limit })).map((i) => publicInvoice(i, merchant));
  }

  async function getPublicInvoice(id) {
    const inv = await store.get("invoices", id);
    if (!inv) throw new HttpError(404, "not_found", "Invoice not found");
    const merchant = await store.get("merchants", inv.merchantId);
    return publicInvoice(inv, merchant);
  }

  // ───────────────────────── checkout: quote -> sign -> authorize ─────────────────────────

  async function createQuote(invoiceId, body) {
    const inv = await store.get("invoices", invoiceId);
    if (!inv) throw new HttpError(404, "not_found", "Invoice not found");
    const merchant = await store.get("merchants", inv.merchantId);
    const payer = parseAddress(body.payer, "payer");
    if (inv.payerAddress && inv.payerAddress !== payer) {
      throw new HttpError(400, "payer_mismatch", `This invoice can only be paid by ${inv.payerAddress}`);
    }
    const refundTo = body.refundTo ? parseAddress(body.refundTo, "refundTo") : null;

    const total = BigInt(inv.amount);
    const due = total - BigInt(inv.paidBase);
    if (due <= 0n) throw new HttpError(409, "already_paid", "Invoice is already fully paid");
    const amount = body.amount ? parseUsdt(body.amount) : due; // what this payment settles (USDT + discount)
    if (amount > due) throw new HttpError(400, "overpay", `Amount due is ${fmtUsdt(due)} USDT`);
    if (amount < due && !inv.allowPartial) throw new HttpError(400, "partial_not_allowed", "This invoice must be paid in full");
    const r = routerAt(inv.router);

    // points (v2 only): an optional reward the customer picked, and the shop's best earning campaign
    let discount = 0n;
    let pointsRedeemed = 0;
    let reward = null;
    if (body.rewardId) {
      if (r.version !== 2) throw new HttpError(400, "points_unavailable", "This invoice was started before points were enabled");
      ({ reward, discount, pointsRedeemed } = await points.applyReward(merchant, body.rewardId, payer, amount, chargeableFor(merchant, r)));
    }
    const gross = amount - discount;
    const fee = await checkFee(merchant, gross, r);
    const earn = r.version === 2 ? await points.bestCampaign(merchant.id, gross, payer, "payments") : { points: 0, campaign: null };

    const validUntil = BigInt(nowSec() + config.quoteTtlSec);
    const q = {
      merchantId: merchant.id,
      invoiceId: inv.invoiceIdHash,
      invoiceDigest: inv.invoiceDigest,
      paymentId: ethers.hexlify(ethers.randomBytes(32)),
      token: config.usdt,
      invoiceTotal: total,
      gross,
      fee,
      payer: inv.payerAddress || ethers.ZeroAddress,
      splitProfileId: 0,
      validUntil,
    };
    if (r.version === 2) {
      Object.assign(q, {
        discount,
        pointsEarned: BigInt(earn.points),
        campaignId: earn.campaign ? earn.campaign.idHash : ethers.ZeroHash,
        pointsRedeemed: BigInt(pointsRedeemed),
        rewardId: reward ? reward.idHash : ethers.ZeroHash,
      });
    }
    const quoteTypes = r.version === 2 ? T.types.PaymentQuoteV2 : T.types.PaymentQuote;
    const signer = merchants.signerOf(merchant);
    const merchantSig = await signer.signTypedData(r.domain, quoteTypes, q);
    const quoteHash = T.digest(r.domain, quoteTypes, q);
    const salt = ethers.hexlify(ethers.randomBytes(32));
    const nonce = T.payNonce(quoteHash, refundTo || payer, salt);

    const message = {
      from: payer,
      to: r.address,
      value: gross.toString(),
      validAfter: "0",
      validBefore: validUntil.toString(),
      nonce,
    };
    const quote = await store.insert("quotes", {
      id: uid("qt"),
      merchantId: merchant.id,
      invoiceId: inv.id,
      router: r.address,
      payer,
      refundTo: refundTo || ethers.ZeroAddress,
      q: toJson(q),
      merchantSig,
      quoteHash,
      salt,
      nonce,
      message,
      paymentKey: T.paymentKeyOf(merchant.id, q.paymentId),
      discount: discount.toString(),
      pointsEarned: earn.points,
      campaignDocId: earn.campaign ? earn.campaign.id : null,
      pointsRedeemed,
      rewardDocId: reward ? reward.id : null,
      status: "awaiting_signature",
      expiresAt: new Date(Number(validUntil) * 1000).toISOString(),
    });
    return {
      quoteId: quote.id,
      invoiceId: inv.id,
      status: quote.status,
      expiresAt: quote.expiresAt,
      amount: fmtUsdt(amount),
      discount: fmtUsdt(discount),
      gross: fmtUsdt(gross),
      fee: fmtUsdt(fee),
      net: fmtUsdt(gross - fee),
      points: {
        earned: earn.points,
        campaign: earn.campaign ? { id: earn.campaign.id, name: earn.campaign.name } : null,
        redeemed: pointsRedeemed,
        reward: reward ? { id: reward.id, name: reward.name } : null,
      },
      paymentId: quote.paymentKey,
      // the payer signs this with eth_signTypedData_v4 (add EIP712Domain to types for MetaMask)
      typedData: { domain: domains.usdt, types: RWA_TYPES, primaryType: "ReceiveWithAuthorization", message },
    };
  }

  /** For reward eligibility: null if `gross` can be charged, else the reason. */
  function chargeableFor(merchant, r) {
    return async (gross) => {
      try {
        await checkFee(merchant, gross, r);
        return null;
      } catch (e) {
        return e.message;
      }
    };
  }

  /** The checkout's offer list: every reward of this shop, unavailable ones greyed with a reason. */
  async function offersForInvoice(invoiceId, { payer, amount: amountStr } = {}) {
    const inv = await store.get("invoices", invoiceId);
    if (!inv) throw new HttpError(404, "not_found", "Invoice not found");
    const merchant = await store.get("merchants", inv.merchantId);
    const wallet = payer ? parseAddress(payer, "payer") : null;
    const due = BigInt(inv.amount) - BigInt(inv.paidBase);
    const amount = amountStr ? parseUsdt(amountStr) : due;
    const r = routerAt(inv.router);
    if (r.version !== 2 || !points.enabled) return { enabled: false, balance: 0, offers: [], willEarn: 0 };
    const res = await points.offersFor(merchant, wallet, amount, chargeableFor(merchant, r));
    const earn = await points.bestCampaign(merchant.id, amount, wallet, "payments");
    return {
      ...res,
      amount: fmtUsdt(amount),
      willEarn: earn.points,
      campaign: earn.campaign ? { id: earn.campaign.id, name: earn.campaign.name } : null,
      offers: await Promise.all(
        res.offers.map(async (o) => ({
          ...o,
          // points earned are based on what is actually paid, so they drop a little with a discount
          willEarn: o.available ? (await points.bestCampaign(merchant.id, ethers.parseUnits(o.payAfter, 6), wallet, "payments")).points : earn.points,
        }))
      ),
    };
  }

  function publicQuote(qt) {
    return {
      quoteId: qt.id,
      invoiceId: qt.invoiceId,
      status: qt.status,
      paymentId: qt.paymentKey,
      txHash: qt.txHash || null,
      txUrl: qt.txHash ? txUrl(qt.txHash) : null,
      error: qt.error || null,
      expiresAt: qt.expiresAt,
    };
  }

  async function getQuote(id) {
    const qt = await store.get("quotes", id);
    if (!qt) throw new HttpError(404, "not_found", "Quote not found");
    return publicQuote(qt);
  }

  async function authorizeQuote(id, { signature }) {
    const qt = await store.get("quotes", id);
    if (!qt) throw new HttpError(404, "not_found", "Quote not found");
    if (qt.status !== "awaiting_signature") return publicQuote(qt); // idempotent: already submitted
    if (new Date(qt.expiresAt).getTime() < Date.now() + 15_000) {
      await store.update("quotes", id, { status: "expired" });
      throw new HttpError(410, "quote_expired", "Quote expired, request a new one");
    }
    if (typeof signature !== "string") throw new HttpError(400, "invalid_signature", "signature is required");
    let recovered;
    try {
      recovered = ethers.verifyTypedData(domains.usdt, RWA_TYPES, qt.message, signature);
    } catch {
      throw new HttpError(400, "invalid_signature", "Signature could not be parsed");
    }
    if (recovered !== qt.payer) throw new HttpError(400, "invalid_signature", `Signature is from ${recovered}, expected ${qt.payer}`);

    const bal = await usdt.balanceOf(qt.payer);
    if (bal < BigInt(qt.q.gross)) {
      throw new HttpError(400, "insufficient_funds", `Payer has ${fmtUsdt(bal)} USDT, needs ${fmtUsdt(qt.q.gross)}`);
    }

    const a = {
      from: qt.payer,
      refundTo: qt.refundTo,
      salt: qt.salt,
      validAfter: qt.message.validAfter,
      validBefore: qt.message.validBefore,
      signature,
    };
    await store.update("quotes", id, { status: "submitting", signature });
    let sent;
    try {
      const rc = routerAt(qt.router).contract;
      sent = await relayer.submit(
        "router.pay",
        () => rc.pay.staticCall(qt.q, qt.merchantSig, a),
        () => rc.pay(qt.q, qt.merchantSig, a),
        { merchantId: qt.merchantId, quoteId: id, invoiceId: qt.invoiceId }
      );
    } catch (e) {
      await store.update("quotes", id, { status: "failed", error: e.message });
      throw new HttpError(400, "payment_rejected", `Payment rejected: ${e.message}`);
    }
    const updated = await store.update("quotes", id, { status: "submitted", txHash: sent.hash });
    sent.wait().then(
      async (rc) => {
        const cur = await store.get("quotes", id);
        if (cur.status === "submitted") await store.update("quotes", id, { status: rc.status === 1 ? "mined" : "failed" });
      },
      async (e) => store.update("quotes", id, { status: "failed", error: reasonOf(e) })
    );
    return publicQuote(updated);
  }

  // ───────────────────────── payments, receipts, refunds ─────────────────────────

  /** The router a payment lives on: from our records, else whichever router knows it. */
  async function locate(paymentId) {
    const p = await store.get("payments", paymentId);
    if (p && p.router) {
      const r = routerAt(p.router);
      return { r, onchain: await r.contract.payments(paymentId) };
    }
    for (const r of Object.values(routers).reverse()) {
      const onchain = await r.contract.payments(paymentId);
      if (onchain.settledAt !== 0n) return { r, onchain };
    }
    return { r: routers.v1, onchain: await routers.v1.contract.payments(paymentId) };
  }

  async function refundsOf(paymentId) {
    return store.find("refunds", { paymentId }, { limit: 100, order: "asc" });
  }

  async function listPayments(merchant, { limit = 100 } = {}) {
    const rows = await store.find("payments", { merchantId: merchant.id }, { limit });
    return Promise.all(rows.map(async (p) => publicPayment(p, await refundsOf(p.id))));
  }

  async function getPaymentFor(merchant, id) {
    const p = await store.get("payments", id);
    if (!p || p.merchantId !== merchant.id) throw new HttpError(404, "not_found", "Payment not found");
    return publicPayment(p, await refundsOf(id));
  }

  /** Public receipt: anyone with the payment id can check it, and it is cross-checked against the chain. */
  async function getReceipt(id) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(id)) throw new HttpError(400, "invalid_id", "Payment id must be 0x + 64 hex");
    const p = await store.get("payments", id);
    const { r, onchain } = await locate(id);
    if (!p && onchain.settledAt === 0n) throw new HttpError(404, "not_found", "No payment with this id");
    const merchant = await store.get("merchants", (p && p.merchantId) || onchain.merchantId);
    return {
      merchant: merchant ? { id: merchant.id, name: merchant.name } : { id: onchain.merchantId },
      payment: p ? publicPayment(p, await refundsOf(id)) : null,
      onchain: {
        verified: onchain.settledAt !== 0n,
        gross: fmtUsdt(onchain.gross),
        fee: fmtUsdt(onchain.fee),
        refunded: fmtUsdt(onchain.refunded),
        payer: onchain.payer,
        refundTo: onchain.refundTo,
        settledAt: onchain.settledAt ? new Date(Number(onchain.settledAt) * 1000).toISOString() : null,
        discount: onchain.discount !== undefined ? fmtUsdt(onchain.discount) : "0.0",
        router: r.address,
      },
    };
  }

  async function createRefund(merchant, paymentId, body) {
    const { r: rt, onchain } = await locate(paymentId);
    if (onchain.settledAt === 0n || onchain.merchantId !== merchant.id) throw new HttpError(404, "not_found", "Payment not found");
    const remaining = onchain.gross - onchain.refunded;
    if (remaining === 0n) throw new HttpError(409, "fully_refunded", "Payment is already fully refunded");
    const amount = body.amount ? parseUsdt(body.amount) : remaining;
    if (amount > remaining) throw new HttpError(400, "refund_too_large", `At most ${fmtUsdt(remaining)} USDT can still be refunded`);
    const funder = body.funder ? parseAddress(body.funder, "funder") : merchant.payoutAddress;

    const validUntil = BigInt(nowSec() + config.quoteTtlSec);
    const t = {
      paymentId,
      refundId: ethers.hexlify(ethers.randomBytes(32)),
      amount,
      fee: 0n,
      funder,
      validUntil,
    };
    const signer = merchants.signerOf(merchant);
    const merchantSig = await signer.signTypedData(rt.domain, T.types.RefundTerms, t);
    const termsHash = T.digest(rt.domain, T.types.RefundTerms, t);
    const message = {
      from: funder,
      to: rt.address,
      value: amount.toString(),
      validAfter: "0",
      validBefore: validUntil.toString(),
      nonce: T.refundNonce(termsHash),
    };
    const r = await store.insert("refunds", {
      id: uid("rf"),
      merchantId: merchant.id,
      paymentId,
      router: rt.address,
      refundId: t.refundId,
      amount: amount.toString(),
      funder,
      to: onchain.refundTo,
      reason: body.reason || null,
      t: toJson(t),
      merchantSig,
      message,
      status: "awaiting_signature",
      expiresAt: new Date(Number(validUntil) * 1000).toISOString(),
    });
    return {
      refund: publicRefund(r),
      // the FUNDER wallet (merchant payout by default) signs this; it needs USDT, not WBT
      typedData: { domain: domains.usdt, types: RWA_TYPES, primaryType: "ReceiveWithAuthorization", message },
    };
  }

  async function authorizeRefund(merchant, id, { signature }) {
    const r = await store.get("refunds", id);
    if (!r || r.merchantId !== merchant.id) throw new HttpError(404, "not_found", "Refund not found");
    if (r.status !== "awaiting_signature") return publicRefund(r);
    if (new Date(r.expiresAt).getTime() < Date.now() + 15_000) {
      await store.update("refunds", id, { status: "expired" });
      throw new HttpError(410, "refund_expired", "Refund request expired, create a new one");
    }
    let recovered;
    try {
      recovered = ethers.verifyTypedData(domains.usdt, RWA_TYPES, r.message, signature);
    } catch {
      throw new HttpError(400, "invalid_signature", "Signature could not be parsed");
    }
    if (recovered !== r.funder) throw new HttpError(400, "invalid_signature", `Signature is from ${recovered}, expected ${r.funder}`);
    const bal = await usdt.balanceOf(r.funder);
    if (bal < BigInt(r.amount)) throw new HttpError(400, "insufficient_funds", `Funder has ${fmtUsdt(bal)} USDT`);

    const f = { validAfter: r.message.validAfter, validBefore: r.message.validBefore, signature };
    await store.update("refunds", id, { status: "submitting" });
    let sent;
    try {
      const rc = routerAt(r.router).contract;
      sent = await relayer.submit(
        "router.refund",
        () => rc.refund.staticCall(r.t, r.merchantSig, f),
        () => rc.refund(r.t, r.merchantSig, f),
        { merchantId: merchant.id, refundId: id }
      );
    } catch (e) {
      const failed = await store.update("refunds", id, { status: "failed", error: e.message });
      throw new HttpError(400, "refund_rejected", `Refund rejected: ${e.message}`, { refund: publicRefund(failed) });
    }
    const updated = await store.update("refunds", id, { status: "submitted", txHash: sent.hash });
    sent.wait().catch(async (e) => store.update("refunds", id, { status: "failed", error: reasonOf(e) }));
    return publicRefund(updated);
  }

  // ───────────────────────── chain events (called by the observer) ─────────────────────────

  async function onPaymentSettled(ev) {
    if (await store.get("payments", ev.paymentId)) return; // already processed
    const merchant = await store.get("merchants", ev.merchantId);
    const quote = await store.findOne("quotes", { paymentKey: ev.paymentId });
    const inv = quote ? await store.get("invoices", quote.invoiceId) : null;
    const isPlan = ev.planId && ev.planId !== ethers.ZeroHash;
    const sub = isPlan ? await store.findOne("subscriptions", { planKey: ev.planId }) : null;

    const p = await store.insert("payments", {
      id: ev.paymentId,
      merchantId: ev.merchantId,
      invoiceId: inv ? inv.id : null,
      quoteId: quote ? quote.id : null,
      subscriptionId: sub ? sub.id : null,
      planKey: isPlan ? ev.planId : null,
      router: ev.router,
      discount: quote && quote.discount ? quote.discount : "0",
      reference: inv ? inv.reference : sub ? sub.id : null,
      payer: ev.payer,
      refundTo: ev.refundTo,
      token: ev.token,
      gross: ev.gross.toString(),
      fee: ev.fee.toString(),
      net: ev.net.toString(),
      refunded: "0",
      refundIds: [],
      kind: ["one_time", "installment", "down_payment"][Number(ev.kind)] || "one_time",
      txHash: ev.txHash,
      txUrl: txUrl(ev.txHash),
      blockNumber: ev.blockNumber,
      settledAt: ev.settledAt,
    });
    if (quote) await store.update("quotes", quote.id, { status: "confirmed", txHash: ev.txHash });
    if (sub) {
      await store.update("subscriptions", sub.id, {
        chargesPaid: (sub.chargesPaid || 0) + 1,
        amountPaid: (BigInt(sub.amountPaid || "0") + ev.gross).toString(),
      });
    }

    let invoicePaid = false;
    let updatedInv = inv;
    if (inv) {
      const paid = BigInt(inv.paidBase) + ev.gross + BigInt(quote.discount || "0"); // discounts count toward the total
      updatedInv = await store.update("invoices", inv.id, {
        paidBase: paid.toString(),
        paymentIds: [...(inv.paymentIds || []), ev.paymentId],
      });
      invoicePaid = paid >= BigInt(inv.amount);
    }
    console.log(`[observer] payment ${ev.paymentId.slice(0, 10)}… ${fmtUsdt(ev.gross)} USDT settled${inv ? ` for ${inv.id}` : ""}`);
    if (merchant) {
      await webhooks.enqueue(merchant, "payment.settled", {
        payment: publicPayment(p),
        invoice: updatedInv ? publicInvoice(updatedInv, merchant) : null,
        subscriptionId: sub ? sub.id : null,
      });
      if (invoicePaid) await webhooks.enqueue(merchant, "invoice.paid", { invoice: publicInvoice(updatedInv, merchant) });
    }
  }

  async function onRefundSettled(ev) {
    const p = await store.get("payments", ev.paymentId);
    if (p && (p.refundIds || []).includes(ev.refundId)) return; // already processed
    const merchant = p ? await store.get("merchants", p.merchantId) : null;
    let r = await store.findOne("refunds", { refundId: ev.refundId });
    if (r) {
      r = await store.update("refunds", r.id, { status: "confirmed", txHash: ev.txHash, to: ev.to });
    }
    if (p) {
      await store.update("payments", p.id, {
        refunded: ev.cumulativeRefunded.toString(),
        refundIds: [...(p.refundIds || []), ev.refundId],
      });
      if (p.invoiceId) {
        const inv = await store.get("invoices", p.invoiceId);
        if (inv) await store.update("invoices", inv.id, { refundedBase: (BigInt(inv.refundedBase) + ev.amount).toString() });
      }
    }
    console.log(`[observer] refund ${ev.refundId.slice(0, 10)}… ${fmtUsdt(ev.amount)} USDT settled`);
    if (merchant) {
      await webhooks.enqueue(merchant, "refund.settled", {
        refund: r
          ? publicRefund(r)
          : { refundId: ev.refundId, paymentId: ev.paymentId, amount: fmtUsdt(ev.amount), to: ev.to, txUrl: txUrl(ev.txHash) },
        paymentId: ev.paymentId,
        cumulativeRefunded: fmtUsdt(ev.cumulativeRefunded),
      });
    }
  }

  // ───────────────────────── accountant export ─────────────────────────

  async function exportCsv(merchant) {
    const payments = await store.find("payments", { merchantId: merchant.id }, { limit: 10000, order: "asc" });
    const refunds = await store.find("refunds", { merchantId: merchant.id }, { limit: 10000, order: "asc" });
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["type", "date_utc", "id", "invoice_id", "reference", "counterparty", "currency", "gross", "fee", "net", "discount", "points_earned", "points_redeemed", "tx_url"];
    const rows = [];
    for (const p of payments) {
      rows.push([p.subscriptionId ? "subscription_charge" : "payment", p.settledAt, p.id, p.invoiceId, p.reference, p.payer, "USDT", fmtUsdt(p.gross), fmtUsdt(p.fee), fmtUsdt(p.net), fmtUsdt(p.discount || "0"), p.pointsEarned || 0, p.pointsRedeemed || 0, p.txUrl]);
    }
    for (const r of refunds.filter((x) => x.status === "confirmed")) {
      const amt = fmtUsdt(r.amount);
      rows.push(["refund", r.updatedAt, r.refundId, null, r.paymentId, r.to, "USDT", `-${amt}`, "0", `-${amt}`, "0", 0, 0, txUrl(r.txHash)]);
    }
    rows.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    return [header, ...rows].map((row) => row.map(esc).join(",")).join("\n") + "\n";
  }

  /**
   * Everything a wallet paid, across every shop: the payment, its invoice and shop, and its points.
   * Public by design (the same data is onchain); powers the wallet page on the PayKit site.
   */
  async function walletActivity(address) {
    const payer = parseAddress(address, "address");
    const payments = await store.find("payments", { payer }, { limit: 100 });
    const merchantsById = new Map();
    const invoicesById = new Map();
    const out = [];
    for (const p of payments) {
      if (!merchantsById.has(p.merchantId)) merchantsById.set(p.merchantId, await store.get("merchants", p.merchantId));
      if (p.invoiceId && !invoicesById.has(p.invoiceId)) invoicesById.set(p.invoiceId, await store.get("invoices", p.invoiceId));
      const merchant = merchantsById.get(p.merchantId);
      const inv = p.invoiceId ? invoicesById.get(p.invoiceId) : null;
      out.push({
        ...publicPayment(p),
        merchant: merchant ? { id: merchant.id, name: merchant.name } : { id: p.merchantId },
        invoice: inv ? publicInvoice(inv, merchant) : null,
        txUrl: p.txUrl || null,
        settledAt: p.settledAt || p.createdAt || null,
      });
    }
    return { wallet: payer, data: out };
  }

  return {
    walletActivity,
    createInvoice,
    getInvoiceFor,
    listInvoices,
    getPublicInvoice,
    createQuote,
    offersForInvoice,
    getQuote,
    authorizeQuote,
    listPayments,
    getPaymentFor,
    getReceipt,
    createRefund,
    authorizeRefund,
    onPaymentSettled,
    onRefundSettled,
    exportCsv,
  };
}

module.exports = { createPaymentService };
