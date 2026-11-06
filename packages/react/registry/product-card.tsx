"use client";
import { useState } from 'react';
import { useCart } from '@paykit/react';
import { formatUsdt, type Product } from '@paykit/js';
import './paykit-ui.css';

export function CustomProductCard({ product, className = '' }: { product: Product; className?: string }) {
  const cart = useCart(product.merchantSlug);
  const quantity = cart.items.find((item) => item.productId === product.id)?.quantity ?? 0;
  const [bumps, setBumps] = useState(0);
  const add = () => { cart.add(product); setBumps((n) => n + 1); };
  return <article className={`pkc-card pkc-product ${className}`}>
    <div className="pkc-product__art">
      {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <Sprite seed={product.name} />}
      {!product.active && <span className="pkc-soldout">Sold out</span>}
    </div>
    <div className="pkc-product__body">
      <h3 className="pkc-title">{product.name}</h3>
      {product.description && <p className="pkc-muted">{product.description}</p>}
    </div>
    <div className="pkc-product__foot">
      <span className="pkc-product__price">{formatUsdt(product.price)} <small>USDT</small></span>
      {quantity === 0
        ? <button className="pkc-button" disabled={!product.active} onClick={add}>{product.active ? 'Add to cart' : 'Unavailable'}</button>
        : <span className="pkc-stepper" role="group" aria-label={`${product.name} quantity`}>
          <button type="button" aria-label="Remove one" onClick={() => cart.setQuantity(product.id, quantity - 1)}>−</button>
          <output aria-live="polite"><span key={quantity}>{quantity}</span></output>
          <button type="button" aria-label="Add one" disabled={quantity >= 99} onClick={add}>+</button>
        </span>}
    </div>
    {bumps > 0 && <span key={bumps} className="pkc-plus" aria-hidden="true">+1</span>}
  </article>;
}

/** A symmetric pixel sprite drawn from the product name, for products without a photo. */
function Sprite({ seed }: { seed: string }) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const palette = ['transparent', 'var(--pk-progress, #00a3ff)', 'var(--pk-progress-soft, #7ccfff)', 'var(--pk-ink, #0a0a0a)'];
  const cells: string[] = [];
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    const m = Math.min(x, 6 - x);
    const v = (h >>> ((y * 4 + m) % 29)) & 3;
    cells.push(palette[y === 0 || y === 6 ? (v === 3 ? 0 : v & 1) : v]);
  }
  return <span className="pkc-sprite" aria-hidden="true">{cells.map((color, i) => <i key={i} style={{ background: color }} />)}</span>;
}
