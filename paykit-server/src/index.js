const config = require("./config");
const { adminWallet } = require("./chain");
const { boot } = require("./boot");

async function main() {
  const { app, store, webhooks, observer, subscriptions, refill, isOwner } = await boot();

  webhooks.start();
  observer.start();
  subscriptions.start();
  refill.start();

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
