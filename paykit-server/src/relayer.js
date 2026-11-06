// One relayer wallet, one queue: transactions are simulated and sent strictly one after another,
// so nonces never collide. Receipts are awaited in the background.
const { relayerSigner, provider, txUrl, reasonOf } = require("./chain");

function createRelayer(store) {
  let tail = Promise.resolve();

  /**
   * @param {string} label     what this tx is, for logs
   * @param {() => Promise<any>} simulate  e.g. () => router.pay.staticCall(...)
   * @param {() => Promise<import('ethers').TransactionResponse>} send  e.g. () => router.pay(...)
   * @param {object} meta      stored with the tx record (merchantId, ref ids)
   * @returns {Promise<{hash, wait: () => Promise<receipt>}>}
   */
  function submit(label, simulate, send, meta = {}) {
    const job = tail.then(async () => {
      try {
        await simulate();
      } catch (e) {
        const err = new Error(reasonOf(e));
        err.simulation = true;
        throw err;
      }
      let tx;
      try {
        tx = await send();
      } catch (e) {
        relayerSigner.reset(); // re-read the nonce from the chain next time
        throw new Error(reasonOf(e));
      }
      console.log(`[relayer] ${label} sent ${tx.hash}`);
      await store.insert("txs", {
        id: tx.hash,
        merchantId: meta.merchantId,
        label,
        meta,
        status: "sent",
        nonce: tx.nonce,
        url: txUrl(tx.hash),
      });
      const receiptP = tx.wait().then(
        async (rc) => {
          const status = rc.status === 1 ? "mined" : "reverted";
          await store.update("txs", tx.hash, {
            status,
            blockNumber: rc.blockNumber,
            gasUsed: rc.gasUsed.toString(),
            feeWei: (rc.gasUsed * rc.gasPrice).toString(),
          });
          console.log(`[relayer] ${label} ${status} in block ${rc.blockNumber} (gas ${rc.gasUsed})`);
          return rc;
        },
        async (e) => {
          await store.update("txs", tx.hash, { status: "failed", error: reasonOf(e) });
          throw e;
        }
      );
      receiptP.catch(() => {});
      return { hash: tx.hash, wait: () => receiptP };
    });
    tail = job.catch(() => {}); // a failed job must not block the queue
    return job;
  }

  async function balance() {
    return provider.getBalance(await relayerSigner.getAddress());
  }

  return { submit, balance, address: () => relayerSigner.getAddress() };
}

module.exports = { createRelayer };
