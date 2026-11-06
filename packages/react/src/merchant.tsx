"use client";

import {
  displayUsdt,
  minimumTicket,
  parseUsdt,
  type ApiKey,
  type DomainChallenge,
  type Payment,
  type WalletSigner,
  type WebhookEndpoint,
} from "@paykit/js";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { getAddress, isAddress, isAddressEqual, type Address, type Chain } from "viem";
import { usePayKit } from "./context.tsx";
import {
  useMerchantAccount,
  useMerchantDomains,
  useMerchantInvoices,
  useMerchantPayments,
  useMerchantPlans,
  useMerchantProducts,
  useMerchantRefunds,
  useMerchantStats,
  useQuery,
  useRefund,
} from "./hooks.ts";
import { paymentLabel, paymentTone, SignInGate } from "./account.tsx";
import { periodLabel, statusLabel } from "./checkout.tsx";
import { MerchantBadge } from "./shop.tsx";
import { Address as AddressText, Amount, Button, ErrorNotice, Field, Modal, Panel, QueryView, StateMessage, Tag, cx, formatDate, shortAddress } from "./ui.tsx";

// ---------- access ----------

/** Merchant pages: sign in first, then sign-up if this wallet isn't a merchant yet. */
export function MerchantGate({ children }: { children: ReactNode }) {
  return (
    <SignInGate title="Sign in with your shop's owner wallet.">
      <MerchantGateInner>{children}</MerchantGateInner>
    </SignInGate>
  );
}

function MerchantGateInner({ children }: { children: ReactNode }) {
  const account = useMerchantAccount();
  return (
    <QueryView query={account} loadingLabel="Loading your shop…" isEmpty={(m) => m === null} empty={<MerchantSignup />}>
      {() => <>{children}</>}
    </QueryView>
  );
}

// ---------- sign-up ----------

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Register a shop: details, payout wallet, then one gasless signature from the owner wallet. */
export function MerchantSignup({ onDone }: { onDone?: () => void }) {
  const { wallet, session } = usePayKit();
  const account = useMerchantAccount();
  const ownerAddress = session?.address && session.address !== "0x0000000000000000000000000000000000000000" ? session.address : wallet.address;
  const [form, setForm] = useState({ name: "", slug: "", website: "", category: "", description: "", payout: "" });
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const payout = form.payout.trim() || ownerAddress || "";
  const differentPayout = !!ownerAddress && isAddress(payout) && !isAddressEqual(payout, ownerAddress);
  const switcher = useAccountSwitch();

  const problems = {
    name: form.name.trim() ? null : "Enter your shop's name",
    slug: SLUG_RE.test(form.slug) ? null : "3–40 lowercase letters, numbers and dashes",
    website: /\./.test(form.website) ? null : "Enter the domain your shop runs on, like myshop.in",
    payout: isAddress(payout) ? null : "Enter a wallet address starting with 0x",
  };
  const valid = Object.values(problems).every((p) => p === null);
  const [touched, setTouched] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const payoutSigner = differentPayout ? switcher.signerFor(getAddress(payout), "the payout wallet") : undefined;
      await account.signup(
        {
          name: form.name.trim(),
          slug: form.slug,
          website: form.website.trim(),
          category: form.category.trim() || undefined,
          description: form.description.trim() || undefined,
          payout: getAddress(payout),
        },
        { payoutSigner },
      );
      onDone?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      switcher.reset();
    }
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [k]: value, ...(k === "name" && !slugEdited ? { slug: slugify(value) } : {}) }));
  };

  return (
    <form className="pk-panel pk-signup" onSubmit={submit} noValidate>
      <h2 className="pk-panel__title">Set up your shop</h2>
      <p className="pk-panel__lead">Customers pay you in USDT straight to your payout wallet. You never handle gas.</p>
      <div className="pk-form-grid">
        <Field label="Shop name" error={touched ? problems.name : null}>
          <input className="pk-input" value={form.name} onChange={set("name")} autoComplete="organization" />
        </Field>
        <Field label="Shop link" hint={`Your page: /shops/${form.slug || "your-shop"}`} error={touched ? problems.slug : null}>
          <input
            className="pk-input"
            value={form.slug}
            onChange={(e) => {
              setSlugEdited(true);
              set("slug")(e);
            }}
          />
        </Field>
        <Field label="Website domain" hint="You'll prove you own it next." error={touched ? problems.website : null}>
          <input className="pk-input" value={form.website} onChange={set("website")} placeholder="myshop.in" inputMode="url" />
        </Field>
        <Field label="Category">
          <input className="pk-input" value={form.category} onChange={set("category")} placeholder="Food & drink" />
        </Field>
        <Field label="Payout wallet" hint={ownerAddress ? `Leave empty to use this wallet (${shortAddress(ownerAddress)}).` : undefined} error={touched ? problems.payout : null}>
          <input className="pk-input pk-input--mono" value={form.payout} onChange={set("payout")} placeholder={ownerAddress ?? "0x…"} spellCheck={false} />
        </Field>
        <Field label="Short description">
          <textarea className="pk-input" rows={2} value={form.description} onChange={set("description")} maxLength={500} />
        </Field>
      </div>
      {differentPayout && <p className="pk-hint">Your payout wallet will need to sign once to prove it's yours. We'll tell you when to switch accounts.</p>}
      {switcher.prompt}
      <ErrorNotice error={error} />
      <div className="pk-actions">
        <Button type="submit" busy={busy}>
          Register shop
        </Button>
      </div>
      <p className="pk-hint">Registration is free. You sign a message; PayKit pays the network fee.</p>
    </form>
  );
}

/**
 * Some actions need a second wallet to sign (e.g. a new payout wallet). This shows a
 * "switch accounts" prompt and resolves with the wallet the user switched to.
 */
function useAccountSwitch() {
  const { wallet } = usePayKit();
  const latest = useRef(wallet);
  latest.current = wallet;
  const [ask, setAsk] = useState<{ who: string; address: Address; resolve: () => void; reject: (e: unknown) => void } | null>(null);

  const waitFor = (address: Address, who: string) =>
    new Promise<WalletSigner>((resolve, reject) => {
      const check = async () => {
        const signer = latest.current.signer;
        if (signer && isAddressEqual(await signer.getAddress(), address)) return resolve(signer);
        setAsk({
          who,
          address,
          resolve: () => {
            setAsk(null);
            void check();
          },
          reject: (e) => {
            setAsk(null);
            reject(e);
          },
        });
      };
      void check();
    });

  /** A signer for `address` that asks the user to switch accounts when it's needed. */
  const signerFor = (address: Address, who: string): WalletSigner => ({
    getAddress: async () => address,
    getChainId: async () => (await waitFor(address, who)).getChainId(),
    switchChain: async (chain: Chain) => (await waitFor(address, who)).switchChain(chain),
    signMessage: async (message: string) => (await waitFor(address, who)).signMessage(message),
    signTypedData: async (typed) => (await waitFor(address, who)).signTypedData(typed),
  });

  const prompt = ask ? (
    <div className="pk-switch" role="alert">
      <p>
        Switch your wallet to {ask.who} <strong>{shortAddress(ask.address)}</strong>, then continue.
      </p>
      <div className="pk-actions">
        <Button variant="secondary" onClick={() => ask.reject(new Error("Cancelled"))}>
          Cancel
        </Button>
        <Button onClick={ask.resolve}>I've switched, continue</Button>
      </div>
    </div>
  ) : null;

  return { signerFor, prompt, reset: () => setAsk(null) };
}

// ---------- overview ----------

/** Gross, fees, net and refunds for the merchant. */
export function SalesSummary() {
  const stats = useMerchantStats();
  return (
    <QueryView query={stats} loadingLabel="Loading sales…">
      {(s) => (
        <section className="pk-summary" aria-label="Sales summary">
          <div className="pk-summary__main">
            <span className="pk-summary__label">You received</span>
            <Amount value={s.net} size="xl" />
            <span className="pk-summary__sub">
              from {s.paymentCount} {s.paymentCount === 1 ? "payment" : "payments"} since {formatDate(s.from)}
            </span>
          </div>
          <dl className="pk-summary__rows">
            <div>
              <dt>Customers paid</dt>
              <dd>
                <Amount value={s.gross} size="sm" />
              </dd>
            </div>
            <div>
              <dt>PayKit fees</dt>
              <dd>
                <Amount value={s.fees} size="sm" />
              </dd>
            </div>
            <div>
              <dt>Refunded</dt>
              <dd>
                <Amount value={s.refunded} size="sm" />
              </dd>
            </div>
            <div>
              <dt>In progress</dt>
              <dd>{s.pendingCount}</dd>
            </div>
            <div>
              <dt>Active plans</dt>
              <dd>{s.activePlans}</dd>
            </div>
          </dl>
        </section>
      )}
    </QueryView>
  );
}

// ---------- payments and refunds ----------

/** Payments to the merchant. Tabs for in progress / received / all. */
export function PaymentsTable({ initial = "all" }: { initial?: "pending" | "settled" | "all" }) {
  const [tab, setTab] = useState(initial);
  const payments = useMerchantPayments(tab);
  return (
    <Panel>
      <div className="pk-tabs" role="tablist" aria-label="Payment filter">
        {(
          [
            ["pending", "In progress"],
            ["settled", "Received"],
            ["all", "All"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={cx("pk-tab", tab === key && "pk-tab--on")} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      <QueryView query={payments} loadingLabel="Loading payments…" empty={<StateMessage kind="empty" title={tab === "pending" ? "Nothing in progress." : "No payments yet."}>Share your shop link to get your first payment.</StateMessage>}>
        {(list) => (
          <div className="pk-table-wrap">
            <table className="pk-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">From</th>
                  <th scope="col" className="pk-num">
                    Amount
                  </th>
                  <th scope="col" className="pk-num">
                    You get
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="pk-sr">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.paymentId}>
                    <td>{formatDate(p.settledAt ?? p.createdAt, true)}</td>
                    <td>
                      <AddressText value={p.payer} />
                    </td>
                    <td className="pk-num">
                      <Amount value={p.gross} size="sm" />
                    </td>
                    <td className="pk-num">
                      <Amount value={p.net} size="sm" />
                    </td>
                    <td>
                      <Tag tone={paymentTone(p)}>{paymentLabel(p)}</Tag>
                    </td>
                    <td className="pk-table__actions">
                      {p.explorerUrl && (
                        <a className="pk-link" href={p.explorerUrl} target="_blank" rel="noreferrer">
                          Explorer
                        </a>
                      )}
                      <RefundButton payment={p} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
    </Panel>
  );
}

/** Refund part or all of a payment. The payout wallet signs; PayKit pays the gas. */
export function RefundButton({ payment, funder }: { payment: Payment; funder?: import("@paykit/js").WalletSigner }) {
  const settled = payment.status === "included" || payment.status === "safe" || payment.status === "finalized";
  const left = BigInt(payment.gross) - BigInt(payment.refunded);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const { refund, busy } = useRefund({ funder });
  if (!settled || left <= 0n) return null;

  let amount: bigint | null = null;
  let problem: string | null = null;
  try {
    amount = value ? parseUsdt(value) : null;
    if (amount !== null && (amount <= 0n || amount > left)) problem = `Enter up to ${displayUsdt(left)}`;
  } catch {
    problem = "Enter an amount like 5 or 2.50";
  }

  return (
    <>
      <button type="button" className="pk-link" onClick={() => (setOpen(true), setDone(false), setError(null), setValue(""))}>
        Refund
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Refund payment">
        {done ? (
          <StateMessage kind="info" title="Refund sent" action={<Button onClick={() => setOpen(false)}>Done</Button>}>
            The customer gets the USDT back at the wallet they paid from.
          </StateMessage>
        ) : (
          <form
            className="pk-stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (!amount || problem) return;
              setError(null);
              refund(payment.paymentId, amount, reason || undefined)
                .then(() => setDone(true))
                .catch(setError);
            }}
          >
            <p>
              Paid <Amount value={payment.gross} size="sm" /> by <AddressText value={payment.payer} />. Up to <Amount value={left} size="sm" /> can be refunded.
            </p>
            <Field label="Amount to refund (USDT)" error={problem}>
              <div className="pk-input-row">
                <input className="pk-input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" autoFocus />
                <Button variant="quiet" onClick={() => setValue(displayUsdt(left, { symbol: false }).replace(/,/g, ""))}>
                  Full amount
                </Button>
              </div>
            </Field>
            <Field label="Reason (optional)">
              <input className="pk-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Item out of stock" />
            </Field>
            <p className="pk-hint">The refund comes from your payout wallet. The PayKit fee on the original payment isn't returned.</p>
            <ErrorNotice error={error} />
            <div className="pk-actions">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" busy={busy} disabled={!amount || !!problem}>
                {amount && !problem ? `Refund ${displayUsdt(amount)}` : "Refund"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

export function RefundsTable() {
  const refunds = useMerchantRefunds();
  return (
    <Panel>
      <h3 className="pk-panel__title">Refunds</h3>
      <QueryView query={refunds} loadingLabel="Loading refunds…" empty={<StateMessage kind="empty" title="No refunds yet." />}>
        {(list) => (
          <ul className="pk-list">
            {list.map((r) => (
              <li key={r.refundId} className="pk-row pk-row--static">
                <span className="pk-row__main">
                  <span className="pk-row__title">
                    To <AddressText value={r.to} />
                  </span>
                  <span className="pk-row__sub">{r.reason ?? formatDate(r.createdAt, true)}</span>
                </span>
                <span className="pk-row__side">
                  <Amount value={r.amount} size="sm" />
                  <Tag tone={r.status === "settled" ? "good" : r.status === "failed" ? "bad" : "progress"}>{r.status === "settled" ? "Sent" : r.status === "failed" ? "Failed" : "Sending"}</Tag>
                </span>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Panel>
  );
}

export function PlansTable() {
  const plans = useMerchantPlans();
  return (
    <Panel>
      <h3 className="pk-panel__title">Installment plans</h3>
      <QueryView query={plans} loadingLabel="Loading plans…" empty={<StateMessage kind="empty" title="No installment plans yet." />}>
        {(list) => (
          <div className="pk-table-wrap">
            <table className="pk-table">
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Progress</th>
                  <th scope="col">Next due</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.planId}>
                    <td>
                      <AddressText value={p.payer} />
                    </td>
                    <td>
                      <Amount value={p.installmentAmount} size="sm" /> / {periodLabel(p.periodSeconds)}
                    </td>
                    <td>
                      {p.collected} of {p.count}
                    </td>
                    <td>{formatDate(p.nextDueAt)}</td>
                    <td>
                      <Tag tone={p.status === "delinquent" ? "bad" : p.status === "completed" ? "good" : p.status === "active" ? "progress" : "neutral"}>
                        {p.status === "delinquent" ? "Overdue" : p.status === "completed" ? "Paid off" : p.status === "active" ? "Active" : "Cancelled"}
                      </Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
    </Panel>
  );
}

// ---------- invoices and products ----------

/** Create an invoice to send as a link, optionally with a deposit. */
export function InvoiceCreator({ onCreated }: { onCreated?: (invoiceId: string) => void }) {
  const { client, invalidate } = usePayKit();
  const [lines, setLines] = useState([{ name: "", quantity: "1", price: "" }]);
  const [deposit, setDeposit] = useState<number>(100);
  const [wallet, setWallet] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const invoices = useMerchantInvoices();

  let total = 0n;
  let problem: string | null = null;
  for (const l of lines) {
    try {
      const q = Number(l.quantity);
      if (!l.name.trim() || !Number.isInteger(q) || q < 1) throw new Error();
      total += parseUsdt(l.price || "0") * BigInt(q);
    } catch {
      problem = "Each line needs a name, a whole quantity and a price.";
    }
  }
  const min = minimumTicket();
  if (!problem && total < min) problem = `The minimum is ${displayUsdt(min)}.`;
  if (wallet && !isAddress(wallet)) problem = "The customer wallet must be a 0x address.";

  return (
    <Panel>
      <h3 className="pk-panel__title">New invoice</h3>
      <form
        className="pk-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (problem) return;
          setBusy(true);
          setError(null);
          client.merchant
            .createInvoice({
              lineItems: lines.map((l) => ({ name: l.name.trim(), quantity: Number(l.quantity), unitAmount: parseUsdt(l.price).toString() })),
              schedule: deposit === 100 ? { type: "full" } : { type: "deposit", depositPercent: deposit },
              customerWallet: wallet ? getAddress(wallet) : undefined,
            })
            .then((inv) => {
              setCreated(inv.id);
              setLines([{ name: "", quantity: "1", price: "" }]);
              invalidate();
              onCreated?.(inv.id);
            })
            .catch(setError)
            .finally(() => setBusy(false));
        }}
      >
        {lines.map((l, i) => (
          <div key={i} className="pk-line-edit">
            <input className="pk-input" aria-label={`Item ${i + 1}`} placeholder="Item" value={l.name} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input className="pk-input pk-input--qty" aria-label={`Quantity ${i + 1}`} inputMode="numeric" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
            <input className="pk-input pk-input--price" aria-label={`Price ${i + 1} in USDT`} inputMode="decimal" placeholder="Price" value={l.price} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
            {lines.length > 1 && (
              <button type="button" className="pk-link" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove item ${i + 1}`}>
                Remove
              </button>
            )}
          </div>
        ))}
        <button type="button" className="pk-link" onClick={() => setLines((ls) => [...ls, { name: "", quantity: "1", price: "" }])}>
          Add another item
        </button>
        <Field label="Payment">
          <select className="pk-input" value={deposit} onChange={(e) => setDeposit(Number(e.target.value))}>
            <option value={100}>Pay in full</option>
            <option value={30}>30% deposit, rest later</option>
            <option value={50}>50% deposit, rest later</option>
          </select>
        </Field>
        <Field label="Only this wallet can pay (optional)">
          <input className="pk-input pk-input--mono" value={wallet} onChange={(e) => setWallet(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
        </Field>
        <div className="pk-cart__total">
          <span>Total</span>
          <Amount value={total} size="lg" />
        </div>
        {problem && lines.some((l) => l.name || l.price) && <p className="pk-field__error">{problem}</p>}
        <ErrorNotice error={error} />
        <Button type="submit" busy={busy} disabled={!!problem}>
          Create invoice
        </Button>
        {created && (
          <p className="pk-hint" role="status">
            Invoice created. Send the customer this link: <code>/pay/{created}</code>
          </p>
        )}
      </form>
      <QueryView query={invoices} empty={null}>
        {(list) =>
          list.length > 0 ? (
            <ul className="pk-list pk-list--compact">
              {list.slice(0, 5).map((inv) => (
                <li key={inv.id} className="pk-row pk-row--static">
                  <span className="pk-row__main">
                    <span className="pk-row__title">{inv.number}</span>
                    <span className="pk-row__sub">
                      <code>/pay/{inv.id}</code>
                    </span>
                  </span>
                  <span className="pk-row__side">
                    <Amount value={inv.total} size="sm" />
                    <Tag tone={inv.status === "paid" ? "good" : inv.status === "partially_paid" ? "progress" : "neutral"}>{statusLabel(inv.status)}</Tag>
                  </span>
                </li>
              ))}
            </ul>
          ) : null
        }
      </QueryView>
    </Panel>
  );
}

export function ProductManager() {
  const { client, invalidate } = usePayKit();
  const products = useMerchantProducts();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  let problem: string | null = null;
  try {
    if (!name.trim()) problem = "Name the product";
    else if (parseUsdt(price || "0") < minimumTicket()) problem = `Price must be at least ${displayUsdt(minimumTicket())}`;
  } catch {
    problem = "Enter a price like 2.50";
  }
  const act = (p: Promise<unknown>) => {
    setError(null);
    return p.then(invalidate).catch(setError);
  };
  return (
    <Panel>
      <h3 className="pk-panel__title">Products</h3>
      <form
        className="pk-line-edit"
        onSubmit={(e) => {
          e.preventDefault();
          if (problem) return;
          setBusy(true);
          void act(client.merchant.products.create({ name: name.trim(), price: parseUsdt(price).toString() }).then(() => (setName(""), setPrice("")))).finally(() => setBusy(false));
        }}
      >
        <input className="pk-input" placeholder="Product name" aria-label="Product name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="pk-input pk-input--price" placeholder="Price" aria-label="Price in USDT" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        <Button type="submit" busy={busy} disabled={!!problem}>
          Add product
        </Button>
      </form>
      {(name || price) && problem && <p className="pk-field__error">{problem}</p>}
      <ErrorNotice error={error} />
      <QueryView query={products} loadingLabel="Loading products…" empty={<StateMessage kind="empty" title="No products yet. Add your first one above." />}>
        {(list) => (
          <ul className="pk-list">
            {list.map((p) => (
              <li key={p.id} className={cx("pk-row pk-row--static", !p.active && "pk-row--off")}>
                <span className="pk-row__main">
                  <span className="pk-row__title">{p.name}</span>
                  <span className="pk-row__sub">{p.active ? "On sale" : "Hidden from your shop"}</span>
                </span>
                <span className="pk-row__side">
                  <Amount value={p.price} size="sm" />
                  <button type="button" className="pk-link" onClick={() => void act(client.merchant.products.update(p.id, { active: !p.active }))}>
                    {p.active ? "Hide" : "Show"}
                  </button>
                  <button type="button" className="pk-link pk-link--danger" onClick={() => void act(client.merchant.products.remove(p.id))}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Panel>
  );
}

// ---------- settings ----------

function CopyText({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="pk-link"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/** API keys for the merchant's website and backend. Secret keys are shown once. */
export function ApiKeys() {
  const { client, invalidate } = usePayKit();
  const keys = useQuery<ApiKey[]>("merchant-keys", () => client.merchant.apiKeys.list());
  const [fresh, setFresh] = useState<ApiKey | null>(null);
  const [error, setError] = useState<unknown>(null);
  const create = (kind: "publishable" | "secret") => {
    setError(null);
    client.merchant.apiKeys
      .create({ kind })
      .then((k) => {
        setFresh(k);
        invalidate();
        keys.refetch();
      })
      .catch(setError);
  };
  return (
    <Panel>
      <h3 className="pk-panel__title">API keys</h3>
      <p className="pk-panel__lead">The publishable key goes in your website. The secret key stays on your server and is shown only once.</p>
      <div className="pk-actions pk-actions--start">
        <Button variant="secondary" onClick={() => create("publishable")}>
          New publishable key
        </Button>
        <Button variant="secondary" onClick={() => create("secret")}>
          New secret key
        </Button>
      </div>
      {fresh?.key && (
        <div className="pk-secret" role="status">
          <p>{fresh.kind === "secret" ? "Copy your secret key now. You won't see it again." : "Your publishable key:"}</p>
          <code className="pk-secret__value">{fresh.key}</code>
          <CopyText text={fresh.key} />
        </div>
      )}
      <ErrorNotice error={error} />
      <QueryView query={keys} empty={<StateMessage kind="empty" title="No keys yet." />}>
        {(list) => (
          <ul className="pk-list">
            {list.map((k) => (
              <li key={k.id} className={cx("pk-row pk-row--static", k.revokedAt && "pk-row--off")}>
                <span className="pk-row__main">
                  <span className="pk-row__title">
                    <code>{k.prefix}…</code>
                  </span>
                  <span className="pk-row__sub">
                    {k.kind === "secret" ? "Secret" : "Publishable"}, created {formatDate(k.createdAt)}
                  </span>
                </span>
                <span className="pk-row__side">
                  {k.revokedAt ? (
                    <Tag tone="neutral">Revoked</Tag>
                  ) : (
                    <button type="button" className="pk-link pk-link--danger" onClick={() => void client.merchant.apiKeys.revoke(k.id).then(() => keys.refetch()).catch(setError)}>
                      Revoke
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Panel>
  );
}

const DEFAULT_EVENTS = ["payment.confirmed", "payment.finalized", "payment.failed", "refund.succeeded", "plan.installment_collected", "plan.cancelled"];

/** Where PayKit sends payment events (your order fulfilment). */
export function WebhookSettings() {
  const { client } = usePayKit();
  const hooks = useQuery<WebhookEndpoint[]>("merchant-webhooks", () => client.merchant.webhooks.list());
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const validUrl = /^https:\/\/[^\s]+$/.test(url);
  return (
    <Panel>
      <h3 className="pk-panel__title">Payment notifications</h3>
      <p className="pk-panel__lead">PayKit tells your server when a payment arrives, settles, is refunded or a plan payment is collected.</p>
      <form
        className="pk-line-edit"
        onSubmit={(e) => {
          e.preventDefault();
          if (!validUrl) return;
          setError(null);
          client.merchant.webhooks
            .create({ url, events: DEFAULT_EVENTS })
            .then((w) => {
              setSecret(w.secret ?? null);
              setUrl("");
              hooks.refetch();
            })
            .catch(setError);
        }}
      >
        <input className="pk-input" placeholder="https://myshop.in/api/paykit/webhook" aria-label="Notification URL" value={url} onChange={(e) => setUrl(e.target.value.trim())} inputMode="url" />
        <Button type="submit" disabled={!validUrl}>
          Add URL
        </Button>
      </form>
      {url && !validUrl && <p className="pk-field__error">Use a full https:// address.</p>}
      {secret && (
        <div className="pk-secret" role="status">
          <p>Signing secret for this URL. Put it in your server env as PAYKIT_WEBHOOK_SECRET. It's shown once.</p>
          <code className="pk-secret__value">{secret}</code>
          <CopyText text={secret} />
        </div>
      )}
      <ErrorNotice error={error} />
      <QueryView query={hooks} empty={<StateMessage kind="empty" title="No notification URLs yet." />}>
        {(list) => (
          <ul className="pk-list">
            {list.map((w) => (
              <li key={w.id} className="pk-row pk-row--static">
                <span className="pk-row__main">
                  <span className="pk-row__title">{w.url}</span>
                  <span className="pk-row__sub">{w.events.length} event types</span>
                </span>
                <span className="pk-row__side">
                  <button type="button" className="pk-link" onClick={() => void client.merchant.webhooks.replay(w.id).then(() => hooks.refetch()).catch(setError)}>Retry failed</button>
                  <button type="button" className="pk-link pk-link--danger" onClick={() => void client.merchant.webhooks.remove(w.id).then(() => hooks.refetch()).catch(setError)}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Panel>
  );
}

/** Prove domain ownership: DNS record or a signed file on the website. */
export function DomainSettings() {
  const { client, connect, invalidate } = usePayKit();
  const account = useMerchantAccount();
  const domains = useMerchantDomains();
  const [domain, setDomain] = useState("");
  const [challenge, setChallenge] = useState<DomainChallenge | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<"start" | "sign" | "check" | null>(null);

  useEffect(() => {
    if (!domain && account.data?.website) setDomain(account.data.website);
  }, [account.data?.website, domain]);

  const run = async (kind: "start" | "sign" | "check", fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel>
      <h3 className="pk-panel__title">Your domain</h3>
      <p className="pk-panel__lead">Verified shops get a badge, appear on the shops page, and customers see a warning if a page isn't really yours.</p>
      {account.data && <MerchantBadge merchant={account.data} />}
      <form className="pk-line-edit" onSubmit={(e) => (e.preventDefault(), void run("start", async () => setChallenge(await client.merchant.domains.start(domain, "wellknown"))))}>
        <input className="pk-input" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="myshop.in" aria-label="Domain" />
        <Button type="submit" variant="secondary" busy={busy === "start"} disabled={!domain.includes(".")}>
          Start verification
        </Button>
      </form>
      {challenge && (
        <ol className="pk-steps">
          <li>
            <p>
              Sign the verification file with your owner wallet, then upload it to <code>{challenge.wellKnownUrl}</code>.
            </p>
            <div className="pk-actions pk-actions--start">
              <Button
                variant="secondary"
                busy={busy === "sign"}
                onClick={() =>
                  void run("sign", async () => {
                    const owner = await connect();
                    setFile(await client.merchant.domains.signWellKnownFile(challenge, owner));
                  })
                }
              >
                Sign file
              </Button>
              {file && (
                <a className="pk-link" download="paykit.json" href={`data:application/json;charset=utf-8,${encodeURIComponent(file)}`}>
                  Download paykit.json
                </a>
              )}
            </div>
            <p className="pk-hint">
              Or add a DNS TXT record instead: <code>{challenge.dnsName}</code> with value <code>{challenge.dnsValue}</code>
            </p>
          </li>
          <li>
            <p>When it's live, check it.</p>
            <Button
              busy={busy === "check"}
              onClick={() =>
                void run("check", async () => {
                  const result = await client.merchant.domains.check(challenge.domain);
                  setChallenge(result);
                  invalidate();
                })
              }
            >
              Check now
            </Button>
            {challenge.status === "verified" && <p className="pk-good">Verified. Your badge is live.</p>}
            {challenge.status === "failed" && <p className="pk-field__error">{challenge.error ?? "We couldn't find the file or record yet."}</p>}
          </li>
        </ol>
      )}
      <ErrorNotice error={error} />
      <QueryView query={domains} empty={null}>
        {(list) =>
          list.length ? (
            <ul className="pk-list pk-list--compact">
              {list.map((d) => (
                <li key={d.domain} className="pk-row pk-row--static">
                  <span className="pk-row__main">
                    <span className="pk-row__title">{d.domain}</span>
                  </span>
                  <Tag tone={d.status === "verified" ? "good" : d.status === "failed" ? "bad" : "progress"}>{d.status === "verified" ? "Verified" : d.status === "failed" ? "Not found" : "Waiting"}</Tag>
                </li>
              ))}
            </ul>
          ) : null
        }
      </QueryView>
    </Panel>
  );
}

/** Shows where money goes and changes the payout wallet (needs a signature from the new wallet). */
export function PayoutSettings() {
  const { client, connect, invalidate } = usePayKit();
  const account = useMerchantAccount();
  const switcher = useAccountSwitch();
  const [next, setNext] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const m = account.data;
  if (!m) return null;
  const valid = isAddress(next) && !isAddressEqual(next, m.payout);
  return (
    <Panel>
      <h3 className="pk-panel__title">Payout wallet</h3>
      <p className="pk-panel__lead">
        Every payment goes straight to <AddressText value={m.payout} />. Your website can't change this; only your owner wallet can.
      </p>
      <form
        className="pk-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          setBusy(true);
          setError(null);
          (async () => {
            const owner = await connect();
            const ownerAddress = await owner.getAddress();
            const target = getAddress(next);
            await client.merchant.changePayout(target, switcher.signerFor(ownerAddress, "your owner wallet"), switcher.signerFor(target, "the new payout wallet"));
          })()
            .then(() => {
              setQueued(true);
              setNext("");
              invalidate();
            })
            .catch((err: unknown) => setError(err instanceof Error && err.message === "Cancelled" ? null : err))
            .finally(() => {
              setBusy(false);
              switcher.reset();
            });
        }}
      >
        <Field label="New payout wallet" hint="The new wallet signs once to prove it's yours. The change takes effect after a 24-hour safety delay.">
          <input className="pk-input pk-input--mono" value={next} onChange={(e) => setNext(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
        </Field>
        {switcher.prompt}
        <ErrorNotice error={error} />
        {queued && <p className="pk-good">Payout change scheduled.</p>}
        <div className="pk-actions pk-actions--start">
          <Button type="submit" variant="secondary" busy={busy} disabled={!valid}>
            Change payout wallet
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** Register the address of your server signing key (from `npx paykit-keygen`). */
export function SignerSettings() {
  const { client, connect } = usePayKit();
  const signers = useQuery("merchant-signers", () => client.merchant.signers.list());
  const [address, setAddress] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = (fn: (owner: WalletSigner) => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    connect()
      .then(fn)
      .then(() => signers.refetch())
      .catch(setError)
      .finally(() => setBusy(false));
  };
  return (
    <Panel>
      <h3 className="pk-panel__title">Server signing key</h3>
      <p className="pk-panel__lead">
        Lets your backend create payment offers itself. Run <code>npx paykit-keygen</code> on your server and paste the address here. The key can't move or redirect money.
      </p>
      <form className="pk-line-edit" onSubmit={(e) => (e.preventDefault(), isAddress(address) && run((owner) => client.merchant.signers.add(getAddress(address), owner).then(() => setAddress(""))))}>
        <input className="pk-input pk-input--mono" value={address} onChange={(e) => setAddress(e.target.value.trim())} placeholder="0x…" aria-label="Server key address" spellCheck={false} />
        <Button type="submit" busy={busy} disabled={!isAddress(address)}>
          Add key
        </Button>
      </form>
      <ErrorNotice error={error} />
      <QueryView query={signers} empty={<StateMessage kind="empty" title="No server keys. PayKit signs offers for you until you add one." />}>
        {(list) => (
          <ul className="pk-list">
            {list.map((s) => (
              <li key={s.address} className={cx("pk-row pk-row--static", s.status === "disabled" && "pk-row--off")}>
                <span className="pk-row__main">
                  <span className="pk-row__title">
                    <AddressText value={s.address} />
                  </span>
                  <span className="pk-row__sub">{s.expiresAt ? `Expires ${formatDate(s.expiresAt)}` : "No expiry"}</span>
                </span>
                <span className="pk-row__side">
                  <Tag tone={s.status === "active" ? "good" : "neutral"}>{s.status === "active" ? "Active" : s.status === "pending" ? "Adding" : "Off"}</Tag>
                  {s.status === "active" && (
                    <button type="button" className="pk-link pk-link--danger" onClick={() => run((owner) => client.merchant.signers.disable(s.address as Address, owner))}>
                      Turn off
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Panel>
  );
}

/** Split each payment between wallets by percentage. */
export function SplitSettings() {
  const { client, connect } = usePayKit();
  const splits = useQuery("merchant-splits", () => client.merchant.splits.list());
  const [name, setName] = useState("");
  const [rows, setRows] = useState([
    { label: "", address: "", percent: "" },
    { label: "", address: "", percent: "" },
  ]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const bps = rows.map((r) => Math.round(Number(r.percent) * 100));
  const sum = bps.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const valid = !!name.trim() && rows.every((r, i) => isAddress(r.address) && bps[i]! > 0) && sum === 10_000;
  return (
    <Panel>
      <h3 className="pk-panel__title">Revenue splits</h3>
      <p className="pk-panel__lead">Share each payment automatically, for example with a platform or an affiliate. Shares are of the amount after fees.</p>
      <QueryView query={splits} empty={null}>
        {(list) => (
          <ul className="pk-list pk-list--compact">
            {list.map((p) => (
              <li key={p.profileId} className="pk-split">
                <span className="pk-row__title">
                  {p.name} <span className="pk-muted">#{p.profileId}</span>
                </span>
                <span className="pk-split__bar" aria-hidden="true">
                  {p.recipients.map((r, i) => (
                    <span key={i} style={{ flexGrow: r.bps }} />
                  ))}
                </span>
                <span className="pk-split__legend">
                  {p.recipients.map((r, i) => (
                    <span key={i}>
                      {r.label ?? shortAddress(r.address)} {r.bps / 100}%
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
      <form
        className="pk-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          setBusy(true);
          setError(null);
          connect()
            .then((owner) =>
              client.merchant.splits.create(
                name.trim(),
                rows.map((r, i) => ({ address: getAddress(r.address), bps: bps[i]!, label: r.label || undefined })),
                owner,
              ),
            )
            .then(() => {
              setName("");
              splits.refetch();
            })
            .catch(setError)
            .finally(() => setBusy(false));
        }}
      >
        <Field label="Split name">
          <input className="pk-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Marketplace" />
        </Field>
        {rows.map((r, i) => (
          <div key={i} className="pk-line-edit">
            <input className="pk-input" aria-label={`Who ${i + 1}`} placeholder="Who (optional)" value={r.label} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input className="pk-input pk-input--mono" aria-label={`Wallet ${i + 1}`} placeholder="0x…" value={r.address} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, address: e.target.value.trim() } : x)))} spellCheck={false} />
            <input className="pk-input pk-input--qty" aria-label={`Percent ${i + 1}`} placeholder="%" inputMode="decimal" value={r.percent} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} />
          </div>
        ))}
        <div className="pk-actions pk-actions--between">
          {rows.length < 5 ? (
            <button type="button" className="pk-link" onClick={() => setRows((rs) => [...rs, { label: "", address: "", percent: "" }])}>
              Add a wallet
            </button>
          ) : (
            <span />
          )}
          <span className={cx("pk-muted", sum !== 10_000 && sum > 0 && "pk-field__error")}>{sum / 100}% of 100%</span>
        </div>
        <ErrorNotice error={error} />
        <Button type="submit" busy={busy} disabled={!valid}>
          Save split
        </Button>
      </form>
    </Panel>
  );
}


/**
 * Accountant export: downloads double-entry journal lines (CSV) for a date range.
 * Gross, fee, net and refunds land in separate accounts (mapping v1).
 */
export function ExportButton({ from, to, label = "Download accounting export" }: { from?: string; to?: string; label?: string }) {
  const { client } = usePayKit();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="pk-export">
      <Button
        variant="secondary"
        busy={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          client.merchant
            .exportJournal({ from, to })
            .then((csv) => {
              const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = `paykit-journal-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            })
            .catch(setError)
            .finally(() => setBusy(false));
        }}
      >
        {label}
      </Button>
      <p className="pk-hint">One line per account per payment and refund, ready for your bookkeeping tool.</p>
      <ErrorNotice error={error} />
    </div>
  );
}
