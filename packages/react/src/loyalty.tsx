"use client";

import { displayUsdt, parseUsdt, type PointsEntry } from "@paykit/js";
import { useEffect, useState } from "react";
import { useMerchantLoyalty, usePoints } from "./hooks.ts";
import { SignInGate } from "./account.tsx";
import { Button, ErrorNotice, Field, Panel, QueryView, StateMessage, Tag, cx, formatDate } from "./ui.tsx";

const KIND_LABEL: Record<PointsEntry["kind"], string> = { earned: "Earned", redeemed: "Spent", reversed: "Refund: removed", restored: "Refund: returned" };

/**
 * The signed-in wallet's universal PayKit points: earned at any PayKit shop, spendable at any
 * other. Balance comes from PayKitPoints when deployed.
 */
export function PointsCard({ limit = 8 }: { limit?: number }) {
  return (
    <SignInGate title="Sign in to see your points.">
      <PointsCardInner limit={limit} />
    </SignInGate>
  );
}

function PointsCardInner({ limit }: { limit: number }) {
  const points = usePoints();
  return (
    <Panel className="pk-points">
      <QueryView query={points} loadingLabel="Counting points…">
        {(p) => (
          <>
            <div className="pk-points__head">
              <div>
                <p className="pk-points__label">PayKit points</p>
                <p className="pk-points__balance" aria-label={`${p.balance} points`}>
                  {p.balance}
                  <span>PKP</span>
                </p>
              </div>
              <Tag tone={p.source === "chain" ? "good" : "neutral"}>{p.source === "chain" ? "Onchain" : "Ledger"}</Tag>
            </div>
            <dl className="pk-points__stats">
              <div><dt>Earned</dt><dd>{p.lifetimeEarned}</dd></div>
              <div><dt>Spent</dt><dd>{p.lifetimeRedeemed}</dd></div>
            </dl>
            {p.history.length === 0 ? (
              <StateMessage kind="empty" title="No points yet.">Pay at any PayKit shop with a loyalty program to start earning.</StateMessage>
            ) : (
              <ul className="pk-list pk-list--compact">
                {p.history.slice(0, limit).map((h) => (
                  <li key={h.id} className="pk-row pk-row--static">
                    <span className="pk-row__main">
                      <span className="pk-row__title">{KIND_LABEL[h.kind]}{h.rewardName ? ` · ${h.rewardName}` : ""}</span>
                      <span className="pk-row__sub">{h.merchantName} · {formatDate(h.at)}</span>
                    </span>
                    <span className={cx("pk-points__delta", (h.kind === "earned" || h.kind === "restored") ? "pk-good" : "pk-muted")}>
                      {h.kind === "earned" || h.kind === "restored" ? "+" : "−"}{h.amount}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="pk-hint">Points can't be transferred. Refunds take back the share of points the refunded amount earned.</p>
          </>
        )}
      </QueryView>
    </Panel>
  );
}

type RewardDraft = { name: string; pointsCost: string; discount: string; active: boolean };

/** Merchant settings: turn the program on, set the earn rate, and offer rewards. */
export function LoyaltySettings() {
  const loyalty = useMerchantLoyalty();
  const [enabled, setEnabled] = useState(false);
  const [rate, setRate] = useState(0);
  const [rewards, setRewards] = useState<RewardDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const data = loyalty.data;
  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setRate(data.pointsPerUsdt);
    setRewards(data.rewards.map((r) => ({ name: r.name, pointsCost: r.pointsCost, discount: displayUsdt(r.discount).replace(/\s*USDT$/, ""), active: r.active })));
  }, [data]);

  let problem: string | null = null;
  try {
    for (const r of rewards) {
      if (!r.name.trim()) problem = "Name every reward";
      else if (!/^\d+$/.test(r.pointsCost) || BigInt(r.pointsCost) <= 0n) problem = "Rewards need a points cost";
      else if (parseUsdt(r.discount || "0") <= 0n) problem = "Rewards need a discount";
    }
  } catch {
    problem = "Enter discounts like 1.50";
  }

  const save = () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    void loyalty
      .save({ enabled, pointsPerUsdt: rate, rewards: rewards.map((r) => ({ name: r.name.trim(), pointsCost: r.pointsCost, discount: parseUsdt(r.discount).toString(), active: r.active })) })
      .then(() => setSaved(true))
      .catch(setError)
      .finally(() => setBusy(false));
  };

  return (
    <Panel className="pk-loyalty">
      <h3 className="pk-panel__title">Loyalty points</h3>
      <QueryView query={loyalty} loadingLabel="Loading program…">
        {(p) => (
          <>
            {!p.available && <StateMessage kind="info" title="Points need PaymentRouterV2.">Set POINTS_ADDRESS and ROUTER_VERSION=2 on the API to turn them on.</StateMessage>}
            <p className="pk-panel__lead">Customers earn universal PayKit points here and can spend them at any PayKit shop. Rewards are discounts you fund.</p>
            <label className="pk-switch-row">
              <input type="checkbox" role="switch" checked={enabled} disabled={!p.available} onChange={(e) => setEnabled(e.target.checked)} />
              <span>{enabled ? "Customers earn points" : "Program off"}</span>
            </label>
            <Field label={`Earn rate: ${rate} points per 1 USDT`} hint={`Platform cap: ${p.maxPointsPerUsdt}`}>
              <input className="pk-range" type="range" min={0} max={p.maxPointsPerUsdt} step={1} value={rate} disabled={!enabled} onChange={(e) => setRate(Number(e.target.value))} />
            </Field>
            <div className="pk-stack">
              <p className="pk-field__label">Rewards</p>
              {rewards.length === 0 && <p className="pk-hint">No rewards yet. Points still build up for use at other shops.</p>}
              {rewards.map((r, i) => (
                <div key={i} className={cx("pk-reward-edit", !r.active && "pk-row--off")}>
                  <input className="pk-input" aria-label="Reward name" placeholder="e.g. 1 USDT off" value={r.name} onChange={(e) => setRewards(rewards.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <input className="pk-input pk-input--qty" aria-label="Points cost" inputMode="numeric" placeholder="Points" value={r.pointsCost} onChange={(e) => setRewards(rewards.map((x, j) => (j === i ? { ...x, pointsCost: e.target.value.replace(/\D/g, "") } : x)))} />
                  <input className="pk-input pk-input--price" aria-label="Discount in USDT" inputMode="decimal" placeholder="USDT off" value={r.discount} onChange={(e) => setRewards(rewards.map((x, j) => (j === i ? { ...x, discount: e.target.value } : x)))} />
                  <button type="button" className="pk-link" onClick={() => setRewards(rewards.map((x, j) => (j === i ? { ...x, active: !x.active } : x)))}>{r.active ? "Pause" : "Offer"}</button>
                  <button type="button" className="pk-link pk-link--danger" onClick={() => setRewards(rewards.filter((_, j) => j !== i))}>Remove</button>
                </div>
              ))}
              {rewards.length < 12 && (
                <button type="button" className="pk-link" onClick={() => setRewards([...rewards, { name: "", pointsCost: "", discount: "", active: true }])}>
                  Add a reward
                </button>
              )}
            </div>
            {problem && <p className="pk-field__error">{problem}</p>}
            <ErrorNotice error={error} />
            <div className="pk-actions pk-actions--between">
              <span className="pk-hint" aria-live="polite">{saved ? "Saved." : ""}</span>
              <Button busy={busy} disabled={!!problem || !p.available} onClick={save}>Save program</Button>
            </div>
          </>
        )}
      </QueryView>
    </Panel>
  );
}
