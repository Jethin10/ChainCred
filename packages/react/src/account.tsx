"use client";

import type { Payment, Plan } from "@paykit/js";
import { useState, type ReactNode } from "react";
import { errorMessage, usePayKit } from "./context.tsx";
import { TEXT } from "./copy.ts";
import { isProcessing, useCancelPlan, useMyPayments, useMyPlans, useMyRefunds } from "./hooks.ts";
import { PaymentStatus, ReceiptView, periodLabel } from "./checkout.tsx";
import { Amount, Button, Modal, QueryView, StateMessage, Tag, formatDate } from "./ui.tsx";

/** Shows children only after the wallet signs in. Otherwise: connect / sign in prompt. */
export function SignInGate({ children, title }: { children: ReactNode; title?: string }) {
  const { session, login, wallet, merchantViaBackend } = usePayKit();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (session || merchantViaBackend) return <>{children}</>;
  return (
    <StateMessage
      kind="info"
      title={title ?? TEXT.signInTitle}
      action={
        <Button
          busy={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            login()
              .catch(setError)
              .finally(() => setBusy(false));
          }}
        >
          {wallet.status === "connected" ? TEXT.signInButton : TEXT.signInConnectButton}
        </Button>
      }
    >
      {TEXT.signInHint}
      {error ? <span className="pk-error-inline">{errorMessage(error)}</span> : null}
    </StateMessage>
  );
}

export function paymentTone(p: Payment): "good" | "progress" | "bad" | "neutral" {
  if (p.status === "failed" || p.status === "expired") return "bad";
  if (p.refunded !== "0") return "neutral";
  if (p.status === "included" || p.status === "safe" || p.status === "finalized") return "good";
  return "progress";
}

export function paymentLabel(p: Payment): string {
  if (p.status === "failed") return "Failed";
  if (p.status === "expired") return "Expired";
  if (BigInt(p.refunded) >= BigInt(p.gross)) return "Refunded";
  if (p.refunded !== "0") return "Partly refunded";
  if (p.status === "finalized") return "Final";
  if (p.status === "included" || p.status === "safe") return "Paid";
  return "Processing";
}

function PaymentRow({ payment, onOpen }: { payment: Payment; onOpen: (p: Payment) => void }) {
  return (
    <li>
      <button type="button" className="pk-row" onClick={() => onOpen(payment)}>
        <span className="pk-row__main">
          <span className="pk-row__title">{payment.merchantName}</span>
          <span className="pk-row__sub">
            {formatDate(payment.settledAt ?? payment.createdAt, true)}
            {payment.kind !== "one_time" && ", installment"}
          </span>
        </span>
        <span className="pk-row__side">
          <Amount value={payment.gross} size="sm" />
          <Tag tone={paymentTone(payment)}>{paymentLabel(payment)}</Tag>
        </span>
      </button>
    </li>
  );
}

/** The signed-in user's payments. Click one for its receipt. */
export function PaymentHistory({ status = "all", limit }: { status?: "pending" | "settled" | "all"; limit?: number }) {
  const payments = useMyPayments(status);
  const [open, setOpen] = useState<Payment | null>(null);
  return (
    <SignInGate>
      <QueryView
        query={payments}
        loadingLabel="Loading payments…"
        empty={<StateMessage kind="empty" title={status === "pending" ? "Nothing in progress." : "No payments yet."}>Payments you make with this wallet show up here.</StateMessage>}
      >
        {(list) => (
          <ul className="pk-list">
            {list.slice(0, limit).map((p) => (
              <PaymentRow key={p.paymentId} payment={p} onOpen={setOpen} />
            ))}
          </ul>
        )}
      </QueryView>
      <Modal open={!!open} onClose={() => setOpen(null)} title="Receipt">
        {open && (isProcessing(open.status) ? <PaymentStatus paymentId={open.paymentId} /> : <ReceiptView payment={open} />)}
      </Modal>
    </SignInGate>
  );
}

/** Pending payments plus the next due installment of every active plan. */
export function UpcomingPayments() {
  const plans = useMyPlans();
  const pending = useMyPayments("pending");
  return (
    <SignInGate>
      <QueryView query={plans} loadingLabel="Loading…">
        {(planList) => {
          const due = planList.filter((p) => (p.status === "active" || p.status === "delinquent") && p.nextDueAt);
          const inFlight = pending.data ?? [];
          if (due.length === 0 && inFlight.length === 0) return <StateMessage kind="empty" title="Nothing coming up." />;
          return (
            <ul className="pk-list">
              {inFlight.map((p) => (
                <li key={p.paymentId} className="pk-row pk-row--static">
                  <span className="pk-row__main">
                    <span className="pk-row__title">{p.merchantName}</span>
                    <span className="pk-row__sub">Sending now</span>
                  </span>
                  <span className="pk-row__side">
                    <Amount value={p.gross} size="sm" />
                    <Tag tone="progress">Processing</Tag>
                  </span>
                </li>
              ))}
              {due.map((p) => (
                <li key={p.planId} className="pk-row pk-row--static">
                  <span className="pk-row__main">
                    <span className="pk-row__title">{p.merchantName}</span>
                    <span className="pk-row__sub">
                      Payment {p.collected + 1} of {p.count}, due {formatDate(p.nextDueAt)}
                    </span>
                  </span>
                  <span className="pk-row__side">
                    <Amount value={p.installmentAmount} size="sm" />
                    {p.status === "delinquent" ? <Tag tone="bad">Overdue</Tag> : <Tag>Scheduled</Tag>}
                  </span>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryView>
    </SignInGate>
  );
}

function planStatus(plan: Plan): { label: string; tone: "good" | "progress" | "bad" | "neutral" } {
  switch (plan.status) {
    case "active":
      return { label: "Active", tone: "progress" };
    case "delinquent":
      return { label: "Overdue", tone: "bad" };
    case "completed":
      return { label: "Paid off", tone: "good" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    default:
      return { label: "Starting", tone: "neutral" };
  }
}

/** The user's installment plans, with cancel. */
export function PlanList() {
  const plans = useMyPlans();
  const cancel = useCancelPlan();
  const [confirm, setConfirm] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <SignInGate>
      <QueryView query={plans} loadingLabel="Loading plans…" empty={<StateMessage kind="empty" title="No installment plans." />}>
        {(list) => (
          <ul className="pk-list">
            {list.map((p) => {
              const s = planStatus(p);
              return (
                <li key={p.planId} className="pk-plan">
                  <div className="pk-plan__head">
                    <span className="pk-row__title">{p.merchantName}</span>
                    <Tag tone={s.tone}>{s.label}</Tag>
                  </div>
                  <p className="pk-plan__terms">
                    <Amount value={p.installmentAmount} size="sm" /> every {periodLabel(p.periodSeconds)}, {p.collected} of {p.count} paid
                  </p>
                  <div className="pk-plan__dots" aria-hidden="true">
                    {p.installments.map((i) => (
                      <span key={i.index} className={`pk-plan__dot pk-plan__dot--${i.status}`} />
                    ))}
                  </div>
                  {(p.status === "active" || p.status === "delinquent") && (
                    <div className="pk-plan__foot">
                      <span className="pk-muted">Next: {formatDate(p.nextDueAt)}</span>
                      <button type="button" className="pk-link pk-link--danger" onClick={() => setConfirm(p)}>
                        Cancel plan
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </QueryView>
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Cancel this plan?">
        {confirm && (
          <div className="pk-stack">
            <p>
              No more payments will be taken for {confirm.merchantName}. Payments already made stay with the merchant; ask them if you need a refund.
            </p>
            {error ? <p className="pk-error">{errorMessage(error)}</p> : null}
            <div className="pk-actions">
              <Button variant="secondary" onClick={() => setConfirm(null)}>
                Keep plan
              </Button>
              <Button
                variant="danger"
                busy={busy}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  cancel(confirm.planId)
                    .then(() => setConfirm(null))
                    .catch(setError)
                    .finally(() => setBusy(false));
                }}
              >
                Cancel plan
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </SignInGate>
  );
}

/** Refunds the user has received. */
export function RefundList() {
  const refunds = useMyRefunds();
  return (
    <SignInGate>
      <QueryView query={refunds} loadingLabel="Loading refunds…" empty={<StateMessage kind="empty" title="No refunds." />}>
        {(list) => (
          <ul className="pk-list">
            {list.map((r) => (
              <li key={r.refundId} className="pk-row pk-row--static">
                <span className="pk-row__main">
                  <span className="pk-row__title">{r.merchantName}</span>
                  <span className="pk-row__sub">{r.reason ?? formatDate(r.settledAt ?? r.createdAt, true)}</span>
                </span>
                <span className="pk-row__side">
                  <Amount value={r.amount} size="sm" />
                  <Tag tone={r.status === "settled" ? "good" : r.status === "failed" ? "bad" : "progress"}>{r.status === "settled" ? "Refunded" : r.status === "failed" ? "Failed" : "On its way"}</Tag>
                </span>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </SignInGate>
  );
}
