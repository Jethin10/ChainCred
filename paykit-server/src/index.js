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

async function main() {
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
  const points = createPointsService(store, relayer);
  const payments = createPaymentService(store, relayer, merchants, webhooks, points);
  const subscriptions = createSubscriptionService(store, relayer, merchants, webhooks, points);
  const observer = createObserver(store, payments, subscriptions, points);
  const refill = createRefill(store, relayer);

  webhooks.start();
  observer.start();
  subscriptions.start();
  refill.start();

  const app = createApi({ store, relayer, merchants, payments, subscriptions, points, webhooks, observer, refill });
  app.listen(config.port, () => {
    console.log(`\nPayKit server on http://localhost:${config.port}`);
    console.log(`  chain ${config.chainId}, router v1 ${config.router}`);
    if (config.routerV2) console.log(`  router v2 ${config.routerV2} (new invoices + subscriptions), points ${config.points}`);
    console.log(`  relayer ${adminWallet.address}${isOwner ? " (contract owner)" : ""}`);
    console.log(`  store ${store.kind}, observing from block ${config.deployBlock}\n`);
  });

  const shutdown = async () => {
    observer.stop();
    await store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
