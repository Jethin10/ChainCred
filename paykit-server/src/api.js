const express = require("express");
const config = require("./config");
const { HttpError } = require("./util");

function createApi({ store, relayer, merchants, payments, subscriptions, points, webhooks, observer, refill, arkivSync }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  // Open CORS: the checkout runs on merchants' sites. Secret API keys must stay server-side anyway.
  app.use((req, res, next) => {
    res.set("access-control-allow-origin", "*");
    res.set("access-control-allow-headers", "authorization, content-type, idempotency-key");
    res.set("access-control-allow-methods", "GET, POST, PATCH, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const bearer = (req) => (req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();

  const requireAdmin = (req, res, next) => {
    if (bearer(req) !== config.adminToken) return next(new HttpError(401, "unauthorized", "Admin token required"));
    next();
  };
  const requireMerchant = wrap(async (req, res, next) => {
    const m = await merchants.byApiKey(bearer(req));
    if (!m) throw new HttpError(401, "unauthorized", "Valid merchant API key required (Authorization: Bearer pk_test_...)");
    req.merchant = m;
    next();
  });

  // ───────────── health ─────────────
  app.get(
    "/health",
    wrap(async (req, res) => {
      res.json({
        ok: true,
        chainId: config.chainId,
        store: store.kind,
        relayer: { address: await relayer.address(), wbt: (await relayer.balance()).toString() },
        observer: await observer.status(),
        scheduler: subscriptions.status(),
        contracts: {
          registry: config.registry,
          router: config.router,
          routerV2: config.routerV2,
          points: config.points,
          treasury: config.treasury,
          usdt: config.usdt,
        },
        pointsEnabled: points.enabled,
        points: { enabled: points.enabled, backend: points.backend },
        arkiv: await arkivSync.status().catch((e) => ({ enabled: true, error: e.message })),
      });
    })
  );

  // ───────────── admin ─────────────
  app.post(
    "/v1/merchants",
    requireAdmin,
    wrap(async (req, res) => res.status(201).json(await merchants.create(req.body || {})))
  );
  app.post("/v1/admin/refill/evaluate", requireAdmin, wrap(async (req, res) => {
    const ev = await refill.evaluate();
    delete ev.usdtInBase;
    delete ev.minOut;
    delete ev.deadline;
    res.json(ev);
  }));
  app.post("/v1/admin/refill/run", requireAdmin, wrap(async (req, res) => res.json(await refill.run({ force: !!req.body?.force }))));
  app.get("/v1/admin/arkiv", requireAdmin, wrap(async (req, res) => res.json(await arkivSync.status())));
  app.post("/v1/admin/points/resettle", requireAdmin, wrap(async (req, res) => res.json(await payments.resettlePoints({ limit: 500 }))));
  app.post("/v1/admin/arkiv/tick", requireAdmin, wrap(async (req, res) => res.json({ ...(await arkivSync.tick()), ...(await arkivSync.status()) })));
  app.get("/v1/admin/refill/runs", requireAdmin, wrap(async (req, res) => res.json(await store.find("refill_runs", {}, { limit: 50 }))));

  // ───────────── merchant (API key) ─────────────
  app.get("/v1/merchants/me", requireMerchant, (req, res) => res.json(merchants.publicMerchant(req.merchant)));
  app.patch("/v1/merchants/me", requireMerchant, wrap(async (req, res) => res.json(await merchants.update(req.merchant, req.body || {}))));

  app.post("/v1/invoices", requireMerchant, wrap(async (req, res) => res.status(201).json(await payments.createInvoice(req.merchant, req.body || {}))));
  app.get("/v1/invoices", requireMerchant, wrap(async (req, res) => res.json({ data: await payments.listInvoices(req.merchant) })));
  app.get("/v1/invoices/:id", requireMerchant, wrap(async (req, res) => res.json(await payments.getInvoiceFor(req.merchant, req.params.id))));

  app.get("/v1/payments", requireMerchant, wrap(async (req, res) => res.json({ data: await payments.listPayments(req.merchant) })));
  app.get("/v1/payments/:id", requireMerchant, wrap(async (req, res) => res.json(await payments.getPaymentFor(req.merchant, req.params.id))));
  app.post(
    "/v1/payments/:id/refunds",
    requireMerchant,
    wrap(async (req, res) => res.status(201).json(await payments.createRefund(req.merchant, req.params.id, req.body || {})))
  );
  app.post(
    "/v1/refunds/:id/authorize",
    requireMerchant,
    wrap(async (req, res) => res.status(202).json(await payments.authorizeRefund(req.merchant, req.params.id, req.body || {})))
  );

  // subscriptions & installment plans
  app.post("/v1/plans", requireMerchant, wrap(async (req, res) => res.status(201).json(await subscriptions.createPlan(req.merchant, req.body || {}))));
  app.get("/v1/plans", requireMerchant, wrap(async (req, res) => res.json({ data: await subscriptions.listPlans(req.merchant) })));
  app.get("/v1/plans/:id", requireMerchant, wrap(async (req, res) => res.json(await subscriptions.getPlanFor(req.merchant, req.params.id))));
  app.patch("/v1/plans/:id", requireMerchant, wrap(async (req, res) => res.json(await subscriptions.setPlanActive(req.merchant, req.params.id, req.body?.active))));
  app.get(
    "/v1/subscriptions",
    requireMerchant,
    wrap(async (req, res) => res.json({ data: await subscriptions.listFor(req.merchant, { status: req.query.status }) }))
  );
  app.get("/v1/subscriptions/:id", requireMerchant, wrap(async (req, res) => res.json(await subscriptions.getFor(req.merchant, req.params.id))));
  app.post("/v1/subscriptions/:id/cancel", requireMerchant, wrap(async (req, res) => res.status(202).json(await subscriptions.cancelByMerchant(req.merchant, req.params.id))));
  app.post("/v1/admin/scheduler/tick", requireAdmin, wrap(async (req, res) => {
    await subscriptions.tick();
    res.json(subscriptions.status());
  }));

  // universal points: issuer side (campaigns) and redeemer side (rewards)
  app.post("/v1/points/campaigns", requireMerchant, wrap(async (req, res) => res.status(201).json(await points.createCampaign(req.merchant, req.body || {}))));
  app.get("/v1/points/campaigns", requireMerchant, wrap(async (req, res) => res.json({ data: await points.listCampaigns(req.merchant) })));
  app.get("/v1/points/campaigns/:id", requireMerchant, wrap(async (req, res) => res.json(await points.getCampaign(req.merchant, req.params.id))));
  app.patch("/v1/points/campaigns/:id", requireMerchant, wrap(async (req, res) => res.json(await points.updateCampaign(req.merchant, req.params.id, req.body || {}))));
  app.post("/v1/points/rewards", requireMerchant, wrap(async (req, res) => res.status(201).json(await points.createReward(req.merchant, req.body || {}))));
  app.get("/v1/points/rewards", requireMerchant, wrap(async (req, res) => res.json({ data: await points.listRewards(req.merchant) })));
  app.get("/v1/points/rewards/:id", requireMerchant, wrap(async (req, res) => res.json(await points.getReward(req.merchant, req.params.id))));
  app.patch("/v1/points/rewards/:id", requireMerchant, wrap(async (req, res) => res.json(await points.updateReward(req.merchant, req.params.id, req.body || {}))));
  app.get("/v1/points/summary", requireMerchant, wrap(async (req, res) => res.json(await points.summary(req.merchant))));
  app.get(
    "/v1/points/ledger",
    requireMerchant,
    wrap(async (req, res) => res.json({ data: await points.ledgerFor(req.merchant, { wallet: req.query.wallet, type: req.query.type }) }))
  );
  app.get("/v1/points/customers/:wallet", requireMerchant, wrap(async (req, res) => res.json(await points.customer(req.merchant, req.params.wallet))));
  app.patch("/v1/admin/points/limits", requireAdmin, wrap(async (req, res) => res.json(await points.setPlatformMax(req.body?.maxPointsPerUsdt))));
  app.get("/v1/points/limits", wrap(async (req, res) => res.json({ enabled: points.enabled, maxPointsPerUsdt: points.enabled ? await points.platformMax() : null })));

  app.get(
    "/v1/exports/payments.csv",
    requireMerchant,
    wrap(async (req, res) => {
      res.set("content-type", "text/csv; charset=utf-8");
      res.set("content-disposition", `attachment; filename="paykit-${req.merchant.name.replace(/\W+/g, "-")}-payments.csv"`);
      res.send(await payments.exportCsv(req.merchant));
    })
  );

  app.get("/v1/webhooks/events", requireMerchant, wrap(async (req, res) => res.json({ data: await store.find("webhook_events", { merchantId: req.merchant.id }, { limit: 50 }) })));
  app.post("/v1/webhooks/test", requireMerchant, wrap(async (req, res) => res.status(202).json(await merchants.sendTestWebhook(req.merchant))));
  app.post(
    "/v1/webhooks/events/:id/redeliver",
    requireMerchant,
    wrap(async (req, res) => {
      const evt = await webhooks.redeliver(req.merchant, req.params.id);
      if (!evt) throw new HttpError(404, "not_found", "Event not found");
      res.status(202).json(evt);
    })
  );

  // ───────────── public (checkout + receipts, no auth) ─────────────
  app.get("/v1/public/invoices/:id", wrap(async (req, res) => res.json(await payments.getPublicInvoice(req.params.id))));
  app.get(
    "/v1/public/invoices/:id/offers",
    wrap(async (req, res) => res.json(await payments.offersForInvoice(req.params.id, { payer: req.query.payer, amount: req.query.amount })))
  );
  app.get("/v1/public/points/:wallet", wrap(async (req, res) => res.json(await points.publicWallet(req.params.wallet, { verify: req.query.verify === "1" }))));
  app.get("/v1/public/rewards", wrap(async (req, res) => res.json({ data: await points.marketplace({ maxPoints: req.query.maxPoints, source: req.query.source }) })));
  app.post("/v1/public/invoices/:id/quote", wrap(async (req, res) => res.status(201).json(await payments.createQuote(req.params.id, req.body || {}))));
  app.get("/v1/public/quotes/:id", wrap(async (req, res) => res.json(await payments.getQuote(req.params.id))));
  app.post("/v1/public/quotes/:id/authorize", wrap(async (req, res) => res.status(202).json(await payments.authorizeQuote(req.params.id, req.body || {}))));
  app.get("/v1/public/plans/:id", wrap(async (req, res) => res.json(await subscriptions.getPublicPlan(req.params.id))));
  app.post("/v1/public/plans/:id/subscribe", wrap(async (req, res) => res.status(201).json(await subscriptions.subscribe(req.params.id, req.body || {}))));
  app.get("/v1/public/subscriptions/:id", wrap(async (req, res) => res.json(await subscriptions.getPublic(req.params.id))));
  app.post("/v1/public/subscriptions/:id/authorize", wrap(async (req, res) => res.status(202).json(await subscriptions.authorize(req.params.id, req.body || {}))));
  app.post("/v1/public/subscriptions/:id/cancel-request", wrap(async (req, res) => res.json(await subscriptions.cancelRequest(req.params.id))));
  app.post("/v1/public/subscriptions/:id/cancel", wrap(async (req, res) => res.status(202).json(await subscriptions.cancelByPayer(req.params.id, req.body || {}))));
  app.get("/v1/public/receipts/:paymentId", wrap(async (req, res) => res.json(await payments.getReceipt(req.params.paymentId))));

  // ───────────── errors ─────────────
  app.use((req, res) => res.status(404).json({ error: { code: "not_found", message: `No route ${req.method} ${req.path}` } }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.extra || {}) } });
    }
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: { code: "invalid_json", message: "Body is not valid JSON" } });
    console.error("[api]", err);
    res.status(500).json({ error: { code: "internal", message: err.message } });
  });

  return app;
}

module.exports = { createApi };
