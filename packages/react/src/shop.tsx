"use client";

import { normalizeDomain, type Merchant, type Product } from "@paykit/js";
import { useMemo, useState } from "react";
import { usePayKit } from "./context.tsx";
import { TEXT } from "./copy.ts";
import { useCart, useMerchants, useProducts } from "./hooks.ts";
import { CheckoutButton, PaymentStatus } from "./checkout.tsx";
import { Address, Amount, Button, Modal, QueryView, StateMessage, Tag, cx, shortAddress } from "./ui.tsx";

/** Connect / account button. Shows the address and network once connected. */
export function ConnectWallet({ className }: { className?: string }) {
  const { wallet, connect, disconnect, switchNetwork, chain } = usePayKit();
  const [error, setError] = useState<string | null>(null);
  if (wallet.status !== "connected" || !wallet.address) {
    return (
      <span className={cx("pk-connect", className)}>
        <Button
          busy={wallet.status === "connecting"}
          onClick={() => {
            setError(null);
            connect().catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't connect"));
          }}
        >
          {TEXT.connect}
        </Button>
        {error && <span className="pk-connect__error" role="alert">{error}</span>}
      </span>
    );
  }
  return (
    <span className={cx("pk-connect", className)}>
      {wallet.wrongNetwork ? (
        <Button variant="secondary" onClick={() => void switchNetwork().catch(() => undefined)}>
          {TEXT.switchNetwork(chain.name)}
        </Button>
      ) : (
        <span className="pk-connect__account">
          <span className="pk-connect__dot" aria-hidden="true" />
          {shortAddress(wallet.address)}
        </span>
      )}
      <button type="button" className="pk-link" onClick={disconnect}>
        Disconnect
      </button>
    </span>
  );
}

/** Verified domain + payout wallet. Warns when the page isn't on a verified domain of this merchant. */
export function MerchantBadge({ merchant, checkHostname = false }: { merchant: Merchant; checkHostname?: boolean }) {
  const domains = merchant.verifiedDomains.filter((d) => new Date(d.expiresAt).getTime() > Date.now());
  const domain = domains[0];
  const host = typeof location !== "undefined" ? safeHost(location.hostname) : null;
  const mismatch = checkHostname && host !== null && domains.length > 0 && !domains.some((d) => d.domain === host || host.endsWith(`.${d.domain}`));
  return (
    <div className={cx("pk-badge", mismatch && "pk-badge--warn")}>
      {domain ? (
        <span className="pk-badge__line">
          <span className="pk-badge__check" aria-hidden="true">✓</span>
          Verified owner of <strong>{domain.domain}</strong>
        </span>
      ) : (
        <span className="pk-badge__line">Domain not verified yet</span>
      )}
      <span className="pk-badge__line pk-badge__muted">
        Pays to <Address value={merchant.payout} />
      </span>
      {mismatch && <span className="pk-badge__line pk-badge__alert">This page isn't on {merchant.name}'s verified domain. Check the address bar before paying.</span>}
    </div>
  );
}

function safeHost(h: string): string | null {
  try {
    return normalizeDomain(h);
  } catch {
    return null;
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function MerchantCard({ merchant, onOpen }: { merchant: Merchant; onOpen?: (merchant: Merchant) => void }) {
  const verified = merchant.verifiedDomains.length > 0;
  return (
    <button type="button" className={"pk-merchant-card"} onClick={() => onOpen?.(merchant)}>
      <span className="pk-merchant-card__logo" aria-hidden="true">
        {merchant.logoUrl ? <img src={merchant.logoUrl} alt="" /> : initials(merchant.name)}
      </span>
      <span className="pk-merchant-card__text">
        <span className="pk-merchant-card__name">{merchant.name}</span>
        <span className="pk-merchant-card__meta">
          {merchant.category ?? "Shop"}
          {verified && <Tag tone="good">Verified</Tag>}
        </span>
        {merchant.description && <span className="pk-merchant-card__desc">{merchant.description}</span>}
      </span>
    </button>
  );
}

/** Searchable grid of verified shops. Clicking a shop opens it in a modal. */
export function MerchantGrid({ category, searchable = true }: { category?: string; searchable?: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Merchant | null>(null);
  const merchants = useMerchants({ q: q.trim() || undefined, category });
  return (
    <div className="pk-merchant-grid">
      {searchable && (
        <input className="pk-input pk-merchant-grid__search" type="search" placeholder="Search shops" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search shops" />
      )}
      <QueryView
        query={merchants}
        loadingLabel="Loading shops…"
        empty={<StateMessage kind="empty" title={q ? `No shops match "${q}".` : "No shops are listed yet."} />}
      >
        {(list) => (
          <div className="pk-grid">
            {list.map((m) => (
              <MerchantCard key={m.slug} merchant={m} onOpen={setOpen} />
            ))}
          </div>
        )}
      </QueryView>
      <MerchantModal merchant={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/** A shop as a popup: profile, verified domain, products, cart and pay. */
export function MerchantModal({ merchant, onClose }: { merchant: Merchant | null; onClose: () => void }) {
  return (
    <Modal open={!!merchant} onClose={onClose} title={merchant?.name ?? ""} wide>
      {merchant && (
        <div className="pk-shop">
          <div className="pk-shop__info">
            {merchant.description && <p className="pk-shop__desc">{merchant.description}</p>}
            <MerchantBadge merchant={merchant} />
          </div>
          <div className="pk-shop__main">
            <ProductGrid merchant={merchant.slug} />
            <Cart merchant={merchant.slug} />
          </div>
        </div>
      )}
    </Modal>
  );
}

export function ProductCard({ product, onAdd }: { product: Product; onAdd?: (product: Product) => void }) {
  return (
    <article className={"pk-product"}>
      {product.imageUrl && <img className="pk-product__img" src={product.imageUrl} alt="" />}
      <div className="pk-product__body">
        <h3 className="pk-product__name">{product.name}</h3>
        {product.description && <p className="pk-product__desc">{product.description}</p>}
      </div>
      <div className="pk-product__foot">
        <Amount value={product.price} />
        {onAdd && (
          <Button variant="secondary" onClick={() => onAdd(product)} aria-label={`Add ${product.name} to cart`}>
            Add
          </Button>
        )}
      </div>
    </article>
  );
}

export function ProductGrid({ merchant }: { merchant: string }) {
  const products = useProducts(merchant);
  const cart = useCart(merchant);
  return (
    <QueryView query={products} loadingLabel="Loading products…" empty={<StateMessage kind="empty" title="This shop has no products yet." />}>
      {(list) => (
        <div className="pk-products">
          {list.map((p) => (
            <ProductCard key={p.id} product={p} onAdd={cart.add} />
          ))}
        </div>
      )}
    </QueryView>
  );
}

/** Cart for one shop, with quantities, total and the pay button. */
export function Cart({ merchant, onPaid }: { merchant: string; onPaid?: (paymentId: string) => void }) {
  const cart = useCart(merchant);
  const items = useMemo(() => cart.items, [cart.items]);
  const [paid, setPaid] = useState<string | null>(null);
  if (paid) {
    return (
      <aside className={"pk-cart"} aria-label="Payment">
        <p className="pk-cart__done">Paid. Your receipt updates as the payment settles.</p>
        <PaymentStatus paymentId={paid} />
        <Button variant="secondary" block onClick={() => setPaid(null)}>
          Keep shopping
        </Button>
      </aside>
    );
  }
  if (cart.count === 0) {
    return (
      <aside className={"pk-cart pk-cart--empty"} aria-label="Cart">
        <p className="pk-cart__empty">Your cart is empty. Add something to pay with USDT.</p>
      </aside>
    );
  }
  return (
    <aside className={"pk-cart"} aria-label="Cart">
      <ul className="pk-cart__lines">
        {cart.lines.map((l) => (
          <li key={l.product.id} className="pk-cart__line">
            <span className="pk-cart__name">{l.product.name}</span>
            <span className="pk-qty">
              <button type="button" onClick={() => cart.setQuantity(l.product.id, l.quantity - 1)} aria-label={`One less ${l.product.name}`}>
                −
              </button>
              <span aria-live="polite">{l.quantity}</span>
              <button type="button" onClick={() => cart.setQuantity(l.product.id, l.quantity + 1)} aria-label={`One more ${l.product.name}`}>
                +
              </button>
            </span>
            <Amount value={BigInt(l.product.price) * BigInt(l.quantity)} size="sm" />
          </li>
        ))}
      </ul>
      <div className="pk-cart__total">
        <span>Total</span>
        <Amount value={cart.total} size="lg" />
      </div>
      <CheckoutButton
        input={{ merchant, items }}
        amount={cart.total}
        onSuccess={(p) => {
          setPaid(p.paymentId);
          cart.clear();
          onPaid?.(p.paymentId);
        }}
      />
    </aside>
  );
}
