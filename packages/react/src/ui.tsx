"use client";

import { displayUsdt, formatUsdt } from "@paykit/js";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { errorMessage, usePayKit } from "./context.tsx";
import { TEXT } from "./copy.ts";

export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

/** A USDT amount in base units, shown with tabular figures. */
export function Amount({ value, size = "md", className }: { value: bigint | string; size?: "sm" | "md" | "lg" | "xl"; className?: string }) {
  const text = displayUsdt(value, { symbol: false });
  return (
    <span className={cx("pk-amount", `pk-amount--${size}`, className)} aria-label={`${formatUsdt(value)} USDT`}>
      {text}
      <span className="pk-amount__unit">USDT</span>
    </span>
  );
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function Address({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cx("pk-address", className)} title={value}>
      {shortAddress(value)}
    </span>
  );
}

export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, withTime ? { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short", year: "numeric" });
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" | "danger"; busy?: boolean; block?: boolean };

export function Button({ variant = "primary", busy, block, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx("pk-button", `pk-button--${variant}`, block && "pk-button--block", className)}
    >
      {busy && <span className="pk-spinner" aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}

/** Loading, empty and error states share one look. */
export function StateMessage({
  kind,
  title,
  children,
  action,
}: {
  kind: "loading" | "empty" | "error" | "info";
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={cx("pk-state", `pk-state--${kind}`)} role={kind === "error" ? "alert" : kind === "loading" ? "status" : undefined}>
      {kind === "loading" && <span className="pk-spinner pk-spinner--lg" aria-hidden="true" />}
      {title && <p className="pk-state__title">{title}</p>}
      {children && <div className="pk-state__body">{children}</div>}
      {action && <div className="pk-state__action">{action}</div>}
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <p className="pk-error" role="alert">
      {errorMessage(error)}
      {onRetry && (
        <button type="button" className="pk-link" onClick={onRetry}>
          Try again
        </button>
      )}
    </p>
  );
}

/** Renders a query's loading/error/empty states, or the children with data. */
export function QueryView<T>({
  query,
  empty,
  isEmpty,
  loadingLabel = "Loading…",
  children,
}: {
  query: { data: T | undefined; error: unknown; loading: boolean; refetch(): void };
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  loadingLabel?: string;
  children: (data: T) => ReactNode;
}) {
  if (query.error && query.data === undefined) {
    return <StateMessage kind="error" title={errorMessage(query.error)} action={<Button variant="secondary" onClick={query.refetch}>Try again</Button>} />;
  }
  if (query.data === undefined) return <StateMessage kind="loading" title={loadingLabel} />;
  const emptyCheck = isEmpty ?? ((d: T) => Array.isArray(d) && d.length === 0);
  if (empty && emptyCheck(query.data)) return <>{empty}</>;
  return <>{children(query.data)}</>;
}

/** Shows a prompt when no wallet is connected or it's on the wrong network. */
export function WalletRequired({ children, label }: { children: ReactNode; label?: string }) {
  const { wallet, connect, switchNetwork, chain } = usePayKit();
  if (wallet.status !== "connected") {
    return (
      <StateMessage kind="info" title={label ?? TEXT.connectPrompt} action={<Button busy={wallet.status === "connecting"} onClick={() => void connect().catch(() => undefined)}>{TEXT.connect}</Button>}>
        {TEXT.connectHint}
      </StateMessage>
    );
  }
  if (wallet.wrongNetwork) {
    return <StateMessage kind="info" title={TEXT.wrongNetwork} action={<Button onClick={() => void switchNetwork().catch(() => undefined)}>{TEXT.switchNetwork(chain.name)}</Button>} />;
  }
  return <>{children}</>;
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={cx("pk-modal", wide && "pk-modal--wide")}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="pk-modal__inner">
          <header className="pk-modal__head">
            <h2 id={titleId} className="pk-modal__title">
              {title}
            </h2>
            <button type="button" className="pk-modal__close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </header>
          <div className="pk-modal__body">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className={"pk-field"}>
      <span className="pk-field__label">{label}</span>
      {children}
      {hint && !error && <span className="pk-field__hint">{hint}</span>}
      {error && <span className="pk-field__error">{error}</span>}
    </label>
  );
}

export function Tag({ tone = "neutral", children }: { tone?: "neutral" | "good" | "progress" | "bad"; children: ReactNode }) {
  return <span className={cx("pk-tag", `pk-tag--${tone}`)}>{children}</span>;
}

/** The card surface every dashboard section sits on. Use it to build your own sections. */
export function Panel({ as: As = "section", className, children, ...rest }: { as?: "section" | "div" | "aside" | "article"; className?: string; children: ReactNode } & HTMLAttributes<HTMLElement>) {
  return (
    <As className={cx("pk-panel", className)} {...rest}>
      {children}
    </As>
  );
}
