// Follows PaymentRouter events from DEPLOY_BLOCK onward and feeds them to the payment service.
// The chain is the source of truth: an invoice is only "paid" once its PaymentSettled event is read here,
// and a subscription only changes state (active / charged / past due / cancelled / completed) from its plan events.
const config = require("./config");
const { provider, router, routerV2, points } = require("./chain");

const PLAN_EVENTS = ["PlanCreated", "InstallmentCollected", "InstallmentMissed", "PlanCancelled", "PlanCompleted"];

const POINT_EVENTS = ["PointsEarned", "PointsRedeemed", "PointsReversed"];

function createObserver(store, payments, subscriptions, pointsService) {
  const CURSOR = "observer.cursor";
  // v1 and v2 routers emit the same PaymentSettled / RefundSettled / plan event signatures
  const routerTopics = ["PaymentSettled", "RefundSettled", ...PLAN_EVENTS].map((n) => router.interface.getEvent(n).topicHash);
  const pointTopics = points ? POINT_EVENTS.map((n) => points.interface.getEvent(n).topicHash) : [];
  const topics = [...routerTopics, ...pointTopics];
  const addresses = [config.router, ...(routerV2 ? [config.routerV2] : []), ...(points ? [config.points] : [])];
  const ifaceFor = (address) => {
    const a = address.toLowerCase();
    if (points && a === config.points.toLowerCase()) return points.interface;
    if (routerV2 && a === config.routerV2.toLowerCase()) return routerV2.interface;
    return router.interface;
  };
  const blockTimes = new Map();
  let lastHead = null;
  let lastError = null;

  async function blockTime(n) {
    if (!blockTimes.has(n)) {
      const b = await provider.getBlock(n);
      blockTimes.set(n, new Date(b.timestamp * 1000).toISOString());
      if (blockTimes.size > 500) blockTimes.delete(blockTimes.keys().next().value);
    }
    return blockTimes.get(n);
  }

  async function getCursor() {
    const c = await store.get("kv", CURSOR);
    return c ? c.block : config.deployBlock - 1;
  }

  /** First start with v2 configured: rewind once to the v2 deploy block so nothing from v2 is missed.
   *  Re-reading v1 events in that range is harmless (every handler is idempotent). */
  async function rewindForV2() {
    if (!routerV2 || !config.deployBlockV2) return;
    if (await store.get("kv", "observer.v2.started")) return;
    const cur = await getCursor();
    if (cur >= config.deployBlockV2) await store.upsert("kv", { id: CURSOR, block: config.deployBlockV2 - 1 });
    await store.upsert("kv", { id: "observer.v2.started", block: config.deployBlockV2 });
  }

  async function step() {
    const head = (await provider.getBlockNumber()) - config.confirmations;
    lastHead = head;
    const from = (await getCursor()) + 1;
    if (from > head) return 0;
    const to = Math.min(head, from + config.observerChunk - 1);

    const logs = await provider.getLogs({ address: addresses, topics: [topics], fromBlock: from, toBlock: to });
    logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
    for (const log of logs) {
      const parsed = ifaceFor(log.address).parseLog(log);
      if (!parsed) continue;
      const base = {
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.index,
        router: log.address,
        settledAt: await blockTime(log.blockNumber),
      };
      if (parsed.name === "PaymentSettled") {
        const a = parsed.args;
        await payments.onPaymentSettled({
          ...base,
          paymentId: a.paymentId,
          merchantId: a.merchantId,
          invoiceKey: a.invoiceKey,
          planId: a.planId,
          payer: a.payer,
          refundTo: a.refundTo,
          token: a.token,
          gross: a.gross,
          fee: a.fee,
          net: a.net,
          splitProfileId: a.splitProfileId,
          quoteHash: a.quoteHash,
          kind: a.kind,
        });
      } else if (parsed.name === "RefundSettled") {
        const a = parsed.args;
        await payments.onRefundSettled({
          ...base,
          refundId: a.refundId,
          paymentId: a.paymentId,
          to: a.to,
          amount: a.amount,
          fee: a.fee,
          cumulativeRefunded: a.cumulativeRefunded,
          funder: a.funder,
        });
      } else if (PLAN_EVENTS.includes(parsed.name)) {
        const a = parsed.args;
        const ev = { ...base, planId: a.planId };
        if (parsed.name === "PlanCreated") await subscriptions.onPlanCreated({ ...ev, payer: a.payer, firstDue: a.firstDue });
        else if (parsed.name === "InstallmentCollected")
          await subscriptions.onInstallmentCollected({ ...ev, index: a.index, paymentId: a.paymentId, amount: a.amount, fee: a.fee });
        else if (parsed.name === "InstallmentMissed") await subscriptions.onInstallmentMissed({ ...ev, index: a.index });
        else if (parsed.name === "PlanCancelled") await subscriptions.onPlanCancelled({ ...ev, by: a.by });
        else if (parsed.name === "PlanCompleted") await subscriptions.onPlanCompleted(ev);
      } else if (POINT_EVENTS.includes(parsed.name) && pointsService) {
        const a = parsed.args;
        if (parsed.name === "PointsEarned")
          await pointsService.onPointsEarned({ ...base, wallet: a.wallet, merchantId: a.merchantId, paymentId: a.paymentId, campaignId: a.campaignId, amount: a.amount });
        else if (parsed.name === "PointsRedeemed")
          await pointsService.onPointsRedeemed({ ...base, wallet: a.wallet, merchantId: a.merchantId, paymentId: a.paymentId, rewardId: a.rewardId, amount: a.amount });
        else
          await pointsService.onPointsReversed({
            ...base, wallet: a.wallet, paymentId: a.paymentId, earnedRemoved: a.earnedRemoved, redeemedRestored: a.redeemedRestored, shortfall: a.shortfall,
          });
      }
    }
    await store.upsert("kv", { id: CURSOR, block: to });
    return to - from + 1;
  }

  let stopped = false;
  async function loop() {
    try {
      await rewindForV2();
    } catch (e) {
      console.error("[observer] rewind:", e.message);
    }
    while (!stopped) {
      let scanned = 0;
      try {
        scanned = await step();
        lastError = null;
      } catch (e) {
        lastError = e.shortMessage || e.message;
        console.error("[observer]", lastError);
      }
      // catch up quickly when behind, otherwise poll
      await new Promise((r) => setTimeout(r, scanned >= config.observerChunk ? 50 : config.observerPollMs));
    }
  }

  // Serverless (Vercel): no long-running loop, so each invocation catches up for a bounded time.
  let rewound = false;
  async function catchUp(budgetMs = 8000) {
    if (!rewound) {
      rewound = true;
      try {
        await rewindForV2();
      } catch (e) {
        console.error("[observer] rewind:", e.message);
      }
    }
    const until = Date.now() + budgetMs;
    let total = 0;
    while (Date.now() < until) {
      let scanned = 0;
      try {
        scanned = await step();
        lastError = null;
      } catch (e) {
        lastError = e.shortMessage || e.message;
        console.error("[observer]", lastError);
        break;
      }
      total += scanned;
      if (scanned < config.observerChunk) break;
    }
    return total;
  }

  return {
    catchUp,
    start() {
      loop();
    },
    stop() {
      stopped = true;
    },
    async status() {
      return { cursor: await getCursor(), head: lastHead, lastError };
    },
  };
}

module.exports = { createObserver };
