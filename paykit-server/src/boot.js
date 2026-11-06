// Builds every service and the Express app. Shared by the long-running server (src/index.js) and
// the serverless entry (api/index.js), which differ only in how the background work is driven.
const config = require("./config");
const { createStore } = require("./store");
const { provider, adminWallet, router } = require("./chain");
const { createRelayer } = require("./relayer");
const { createWebhooks } = require("./services/webhooks");
const { createMerchantService } = require("./services/merchants");
const { createPaymentService } = require("./services/payments");
const { createSubscriptionService } = require("./services/subscriptions");
const { createPointsService } = require("./services/points");
const { createObserver } = require("./observer");
const { createRefill } = require("./refill");
const { createApi } = require("./api");
const { createArkiv } = require("./arkiv");
const { createArkivSync } = require("./services/arkivSync");

async function boot() {
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== config.chainId) throw new Error(`RPC is chain ${net.chainId}, expected ${config.chainId}`);
  if ((await provider.getCode(config.router)) === "0x") throw new Error(`No contract at ROUTER_ADDRESS ${config.router}`);
  const isOwner = (await router.owner()) === adminWallet.address;
  if (config.routerV2) {
    if (!config.points) throw new Error("ROUTER_V2_ADDRESS is set but POINTS_ADDRESS is not");
    if ((await provider.getCode(config.routerV2)) === "0x") throw new Error(`No contract at ROUTER_V2_ADDRESS ${config.routerV2}`);
    if (!config.deployBlockV2) console.warn("[config] DEPLOY_BLOCK_V2 not set: v2 events before the observer's cursor may be missed");
  }

  const store = await createStore();
  const relayer = createRelayer(store);
  const webhooks = createWebhooks(store);
  const merchants = createMerchantService(store, relayer, webhooks);
  const arkiv = createArkiv();
  if (arkiv.enabled && !config.routerV2) throw new Error("POINTS_BACKEND=arkiv needs ROUTER_V2_ADDRESS (discounts settle through PaymentRouterV2)");
  const arkivSync = createArkivSync(store, arkiv);
  const points = createPointsService(store, relayer, arkiv, arkivSync);
  const payments = createPaymentService(store, relayer, merchants, webhooks, points);
  const subscriptions = createSubscriptionService(store, relayer, merchants, webhooks, points);
  const observer = createObserver(store, payments, subscriptions, points);
  const refill = createRefill(store, relayer);
  const app = createApi({ store, relayer, merchants, payments, subscriptions, points, webhooks, observer, refill, arkivSync });

  return { app, store, relayer, webhooks, merchants, points, payments, subscriptions, observer, refill, arkivSync, isOwner };
}

module.exports = { boot };
