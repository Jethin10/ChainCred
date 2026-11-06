// Fee refill loop: turn treasury USDT into WBT for the relayer, but only when it pays for itself
// (WBT received >= REFILL_PROFIT_MULTIPLE x the gas the refill costs).
const config = require("./config");
const { ethers, provider, treasury, usdt, quoter, txUrl, reasonOf } = require("./chain");
const { uid } = require("./util");

function createRefill(store, relayer) {
  let lastRun = null;

  async function evaluate() {
    const bal = await usdt.balanceOf(config.treasury);
    const limits = await treasury.limits();
    const spentToday = await treasury.spentToday();
    const dayStart = await treasury.dayStart();
    const now = BigInt((await provider.getBlock("latest")).timestamp);
    const spent = now >= dayStart + 86400n ? 0n : spentToday;
    const dayLeft = limits.maxUsdtPerDay > spent ? limits.maxUsdtPerDay - spent : 0n;
    const usdtIn = [bal, limits.maxUsdtPerRun, dayLeft].reduce((a, b) => (b < a ? b : a));
    const base = {
      treasuryUsdt: ethers.formatUnits(bal, 6),
      relayerWbt: ethers.formatEther(await relayer.balance()),
    };
    if (usdtIn < config.refill.minUsdt) {
      return { ...base, decision: "SKIP", reason: `treasury has ${base.treasuryUsdt} USDT usable, below REFILL_MIN_USDT ${ethers.formatUnits(config.refill.minUsdt, 6)}` };
    }
    const [quoted] = await quoter.quoteExactInputSingle.staticCall({
      tokenIn: config.usdt, tokenOut: config.wwbt, amountIn: usdtIn, fee: config.poolFee, sqrtPriceLimitX96: 0,
    });
    const slipMin = (quoted * (10000n - config.refill.slippageBps)) / 10000n;
    const floorMin = (usdtIn * limits.minWbtPerUsdt) / 1_000_000n;
    if (floorMin > quoted) {
      return { ...base, decision: "SKIP", reason: "live price is below the treasury price floor" };
    }
    const minOut = slipMin > floorMin ? slipMin : floorMin;
    const deadline = now + 90n;
    const gas = await treasury.refill.estimateGas(usdtIn, minOut, deadline);
    const { gasPrice } = await provider.getFeeData();
    const gasCost = gas * (gasPrice || 0n);
    const out = {
      ...base,
      usdtIn: ethers.formatUnits(usdtIn, 6),
      quotedWbt: ethers.formatEther(quoted),
      gasCostWbt: ethers.formatEther(gasCost),
      usdtInBase: usdtIn,
      minOut,
      deadline,
    };
    if (quoted < gasCost * config.refill.profitMultiple) {
      return { ...out, decision: "SKIP", reason: `would get ${out.quotedWbt} WBT for ${out.gasCostWbt} WBT gas (needs ${config.refill.profitMultiple}x)` };
    }
    return { ...out, decision: "RUN", reason: `${out.quotedWbt} WBT for ${out.gasCostWbt} WBT gas` };
  }

  /** @param {boolean} force  run even if not profitable (admin "run now") */
  async function run({ force = false } = {}) {
    let ev;
    try {
      ev = await evaluate();
    } catch (e) {
      ev = { decision: "ERROR", reason: reasonOf(e) };
    }
    const record = { id: uid("refill"), at: new Date().toISOString(), ...ev, forced: force };
    delete record.usdtInBase;
    delete record.minOut;
    delete record.deadline;

    const canRun = ev.decision === "RUN" || (force && ev.usdtInBase !== undefined);
    if (canRun) {
      try {
        const sent = await relayer.submit(
          "treasury.refill",
          () => treasury.refill.staticCall(ev.usdtInBase, ev.minOut, ev.deadline),
          () => treasury.refill(ev.usdtInBase, ev.minOut, ev.deadline),
          { kind: "refill" }
        );
        await sent.wait();
        record.decision = "RAN";
        record.txUrl = txUrl(sent.hash);
      } catch (e) {
        record.decision = "FAILED";
        record.reason = reasonOf(e);
      }
    }
    await store.insert("refill_runs", record);
    console.log(`[refill] ${record.decision}: ${record.reason || ""}${record.txUrl ? " " + record.txUrl : ""}`);
    lastRun = record;
    return record;
  }

  function start() {
    if (!config.refill.enabled) {
      console.log("[refill] disabled (REFILL_ENABLED=false)");
      return;
    }
    const ms = config.refill.intervalMin * 60_000;
    setTimeout(() => run().catch(() => {}), 20_000).unref(); // first check shortly after boot
    setInterval(() => run().catch(() => {}), ms).unref();
  }

  return { start, run, evaluate, last: () => lastRun };
}

module.exports = { createRefill };
