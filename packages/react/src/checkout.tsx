"use client";

import { depositSchedule, installmentSplit, protocolFee, toBigInt, type CheckoutInput, type Payment, type PaymentStatus as Status, type PlanOption } from "@paykit/js";
import { useState } from "react";
import { usePayKit } from "./context.tsx";
import { TEXT } from "./copy.ts";
import { useCheckout, useInvoice, usePayment, usePlanCheckout } from "./hooks.ts";
import { Amount, Button, ErrorNotice, QueryView, StateMessage, Tag, cx, formatDate, shortAddress } from "./ui.tsx";

export interface CheckoutButtonProps {
  input: CheckoutInput;
  /** Amount shown on the button, in base units. */
  amount?: bigint | string;
  label?: string;
  /** Resolve once the payment is included (default), safe or final. */
  until?: "included" | "safe" | "finalized";
  onSuccess?: (payment: Payment) => void;
  block?: boolean;
  className?: string;
}

/** One button: connect if needed → one gasless signature → follow the payment. */
export function CheckoutButton({ input, amount, label, until, onSuccess, block = true, className }: CheckoutButtonProps) {
  const checkout = useCheckout();
  const text = label ?? (amount !== undefined ? TEXT.payLabel(formatShort(amount)) : TEXT.payGeneric);
  const phaseLabel = checkout.phase === "connecting" ? TEXT.connecting : checkout.phase === "signing" ? TEXT.phaseSigning : TEXT.phaseProcessing;
  return (
    <div className={cx("pk-checkout-button", className)}>
      <Button
        block={block}
        busy={checkout.busy}
        onClick={() => {
          checkout
            .pay(input, { until, expectedAmount: amount })
            .then((p) => onSuccess?.(p))
            .catch(() => undefined);
        }}
      >
        {checkout.busy ? phaseLabel : text}
      </Button>
      {checkout.busy && checkout.phase === "signing" && <p className="pk-hint">{TEXT.hintSigning}</p>}
      {checkout.phase === "error" && <ErrorNotice error={checkout.error} />}
      {checkout.payment && <PaymentStatus paymentId={checkout.payment.paymentId} />}
      {checkout.phase === "idle" && <p className="pk-hint">{TEXT.hintIdle}</p>}
    </div>
  );
}

function formatShort(amount: bigint | string): string {
  const v = toBigInt(amount);
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac.length < 2 ? frac.padEnd(2, "0") : frac}` : `${whole}.00`;
}

const STEPS: Array<{ key: string; label: string; reached: Status[] }> = [
  { key: "sent", label: "Sent", reached: ["queued", "submitted", "included", "safe", "finalized"] },
  { key: "chain", label: "On chain", reached: ["included", "safe", "finalized"] },
  { key: "safe", label: "Safe", reached: ["safe", "finalized"] },
  { key: "final", label: "Final", reached: ["finalized"] },
];

/** The settlement track: four segments fill as the payment moves from sent to final. */
export function PaymentStatus({ paymentId, payment: given }: { paymentId?: string; payment?: Payment }) {
  const q = usePayment(given ? null : (paymentId ?? null));
  const payment = given ?? q.data;
  if (!payment) return q.error ? <ErrorNotice error={q.error} onRetry={q.refetch} /> : <StateMessage kind="loading" title="Checking payment…" />;
  const failed = payment.status === "failed" || payment.status === "expired";
  const current = STEPS.filter((s) => s.reached.includes(payment.status)).length;
  return (
    <div className={cx("pk-track", failed && "pk-track--failed")}>
      <div className="pk-track__head">
        <Amount value={payment.gross} size="lg" />
        <span className="pk-track__to">to {payment.merchantName}</span>
      </div>
      {failed ? (
        <p className="pk-track__failed" role="alert">
          {payment.status === "expired" ? "This payment expired before it was sent. You weren't charged." : `This payment didn't go through. ${payment.error?.message ?? ""}`}
        </p>
      ) : (
        <ol className="pk-track__steps" aria-label="Payment progress">
          {STEPS.map((s, i) => {
            const state = i < current ? "done" : i === current ? "active" : "todo";
            return (
              <li key={s.key} className={cx("pk-track__step", `pk-track__step--${state}`)} aria-current={state === "active" ? "step" : undefined}>
                <span className="pk-track__bar" />
                <span className="pk-track__label">{s.label}</span>
              </li>
            );
          })}
        </ol>
      )}
      <div className="pk-track__foot">
        <span>
          {payment.status === "finalized"
            ? "Finalized, as observed by the RPC."
            : payment.status === "included" || payment.status === "safe"
              ? "Included onchain. Finality is reported by the Whitechain RPC."
              : failed
                ? ""
                : "Waiting for the network…"}
        </span>
        {payment.explorerUrl && (
          <a className="pk-link" href={payment.explorerUrl} target="_blank" rel="noreferrer">
            View on explorer
          </a>
        )}
      </div>
    </div>
  );
}

/** Printable receipt for one payment. */
export function ReceiptView({ payment }: { payment: Payment }) {
  return (
    <section className="pk-receipt" aria-label="Receipt">
      <header className="pk-receipt__head">
        <h3>{payment.merchantName}</h3>
        <span>{formatDate(payment.settledAt ?? payment.createdAt, true)}</span>
      </header>
      <dl className="pk-receipt__rows">
        <div>
          <dt>Amount paid</dt>
          <dd>
            <Amount value={payment.gross} />
          </dd>
        </div>
        {payment.refunded !== "0" && (
          <div>
            <dt>Refunded</dt>
            <dd>
              <Amount value={payment.refunded} />
            </dd>
          </div>
        )}
        <div>
          <dt>Paid from</dt>
          <dd>{shortAddress(payment.payer)}</dd>
        </div>
        <div>
          <dt>Reference</dt>
          <dd title={payment.paymentId}>{shortAddress(payment.paymentId)}</dd>
        </div>
        <div>
          <dt>Gas</dt>
          <dd>Paid by PayKit</dd>
        </div>
      </dl>
      {payment.explorerUrl && (
        <a className="pk-link" href={payment.explorerUrl} target="_blank" rel="noreferrer">
          View transaction
        </a>
      )}
    </section>
  );
}

/** Choose how much of a total to pay now: a deposit percentage or everything. */
export function DepositPicker({
  total,
  percentOptions = [30, 50, 100],
  value,
  onChange,
}: {
  total: bigint | string;
  percentOptions?: number[];
  value: number;
  onChange: (percent: number) => void;
}) {
  const t = toBigInt(total);
  return (
    <fieldset className="pk-choice">
      <legend className="pk-choice__legend">How much to pay now</legend>
      {percentOptions.map((pct) => {
        const [now, later] = depositSchedule(t, pct);
        return (
          <label key={pct} className={cx("pk-choice__option", value === pct && "pk-choice__option--on")}>
            <input type="radio" name="pk-deposit" checked={value === pct} onChange={() => onChange(pct)} />
            <span className="pk-choice__main">{pct === 100 ? "Pay in full" : `${pct}% now`}</span>
            <span className="pk-choice__side">
              <Amount value={now!} size="sm" />
              {later !== undefined && <span className="pk-choice__later">then {formatShort(later)} later</span>}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

const DAY = 86_400;

/** Pick an installment plan and sign it (one consent + one permit, both gasless). */
export function InstallmentPlanPicker({
  input,
  total,
  options = [
    { count: 3, periodSeconds: 30 * DAY },
    { count: 6, periodSeconds: 30 * DAY },
  ],
  onCreated,
}: {
  input: CheckoutInput;
  total: bigint | string;
  options?: PlanOption[];
  onCreated?: (planId: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const plan = usePlanCheckout();
  const t = toBigInt(total);
  if (plan.phase === "done" && plan.plan) {
    return (
      <StateMessage kind="info" title="Plan set up">
        {plan.plan.count} payments of {formatShort(plan.plan.installmentAmount)} USDT. The first is due {formatDate(plan.plan.nextDueAt)}. You can cancel any time from your payments page.
      </StateMessage>
    );
  }
  return (
    <div className="pk-plan-picker">
      <fieldset className="pk-choice">
        <legend className="pk-choice__legend">Pay in installments</legend>
        {options.map((o, i) => {
          const split = installmentSplit(t, o.count, o.downPaymentPercent ?? 0);
          return (
            <label key={i} className={cx("pk-choice__option", index === i && "pk-choice__option--on")}>
              <input type="radio" name="pk-plan" checked={index === i} onChange={() => setIndex(i)} />
              <span className="pk-choice__main">
                {o.count} × every {periodLabel(o.periodSeconds)}
              </span>
              <span className="pk-choice__side">
                <Amount value={split.installmentAmount} size="sm" />
                {split.downPayment > 0n && <span className="pk-choice__later">+ {formatShort(split.downPayment)} today</span>}
              </span>
            </label>
          );
        })}
      </fieldset>
      <p className="pk-hint">{TEXT.planHint}</p>
      <Button block busy={plan.busy} onClick={() => void plan.start(input, options[index]!, total).then((p) => onCreated?.(p.planId)).catch(() => undefined)}>
        {plan.busy ? (plan.phase === "signing" ? TEXT.planSigning : TEXT.connecting) : "Set up plan"}
      </Button>
      {plan.phase === "error" && <ErrorNotice error={plan.error} />}
    </div>
  );
}

export function periodLabel(seconds: number): string {
  if (seconds % (30 * DAY) === 0) return seconds === 30 * DAY ? "month" : `${seconds / (30 * DAY)} months`;
  if (seconds % (7 * DAY) === 0) return seconds === 7 * DAY ? "week" : `${seconds / (7 * DAY)} weeks`;
  if (seconds % DAY === 0) return seconds === DAY ? "day" : `${seconds / DAY} days`;
  if (seconds % 3600 === 0) return seconds === 3600 ? "hour" : `${seconds / 3600} hours`;
  return `${Math.round(seconds / 60)} min`;
}

/** An invoice sent as a link: what's paid, what's left, and the next payment. */
export function InvoiceView({ invoiceId, onPaid }: { invoiceId: string; onPaid?: (payment: Payment) => void }) {
  const invoice = useInvoice(invoiceId);
  const { invalidate } = usePayKit();
  return (
    <QueryView query={invoice} loadingLabel="Loading invoice…">
      {(inv) => {
        const total = BigInt(inv.total);
        const paid = BigInt(inv.paid);
        const remaining = total - paid;
        const pct = total > 0n ? Number((paid * 1000n) / total) / 10 : 0;
        const next = nextPart(inv.schedule, paid, remaining);
        return (
          <section className="pk-invoice">
            <header className="pk-invoice__head">
              <div>
                <h3 className="pk-invoice__number">Invoice {inv.number}</h3>
                <span className="pk-invoice__date">Due by {formatDate(inv.validUntil)}</span>
              </div>
              <Tag tone={inv.status === "paid" ? "good" : inv.status === "partially_paid" ? "progress" : inv.status === "expired" || inv.status === "void" ? "bad" : "neutral"}>
                {statusLabel(inv.status)}
              </Tag>
            </header>
            <table className="pk-table pk-invoice__lines">
              <tbody>
                {inv.lineItems.map((li, i) => (
                  <tr key={i}>
                    <td>
                      {li.name}
                      {li.quantity > 1 && <span className="pk-muted"> × {li.quantity}</span>}
                    </td>
                    <td className="pk-num">
                      <Amount value={li.amount} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td className="pk-num">
                    <Amount value={total} />
                  </td>
                </tr>
              </tfoot>
            </table>
            <div className="pk-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Paid so far">
              <span className="pk-progress__fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="pk-invoice__paid">
              <Amount value={paid} size="sm" /> paid, <Amount value={remaining} size="sm" /> left to pay
            </p>
            {remaining > 0n && inv.status !== "expired" && inv.status !== "void" ? (
              <CheckoutButton
                input={{ invoiceId: inv.id }}
                amount={next}
                label={next < remaining ? `Pay ${formatShort(next)} USDT now` : undefined}
                onSuccess={(p) => {
                  invalidate();
                  onPaid?.(p);
                }}
              />
            ) : remaining === 0n ? (
              <p className="pk-invoice__done">Paid in full. Thank you.</p>
            ) : null}
          </section>
        );
      }}
    </QueryView>
  );
}

function nextPart(schedule: { type: string; parts?: string[] }, paid: bigint, remaining: bigint): bigint {
  if (schedule.type === "full" || !schedule.parts) return remaining;
  let left = paid;
  for (const part of schedule.parts.map(BigInt)) {
    if (left >= part) {
      left -= part;
      continue;
    }
    return part - left;
  }
  return remaining;
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    open: "Open",
    draft: "Draft",
    partially_paid: "Partly paid",
    paid: "Paid",
    partially_refunded: "Partly refunded",
    refunded: "Refunded",
    expired: "Expired",
    void: "Cancelled",
  };
  return map[status] ?? status;
}

/** Full checkout panel for an invoice link, with an optional deposit choice. */
export function Checkout({ invoiceId }: { invoiceId: string }) {
  return <InvoiceView invoiceId={invoiceId} />;
}

/** Fee the merchant pays on an amount (shown for transparency in merchant tools). */
export function merchantFee(amount: bigint | string): bigint {
  return protocolFee(toBigInt(amount));
}
