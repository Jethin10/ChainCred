"use client";
import { useCart } from '@paykit/react';
import { formatUsdt, type Product } from '@paykit/js';
import './paykit-ui.css';

export function CustomProductCard({ product, className = '' }: { product: Product; className?: string }) {
  const cart = useCart(product.merchantSlug);
  return <article className={`pkc-card ${className}`}>
    {product.imageUrl && <img className="pkc-product-image" src={product.imageUrl} alt="" />}
    <h3 className="pkc-title">{product.name}</h3>
    {product.description && <p className="pkc-muted">{product.description}</p>}
    <div className="pkc-row"><strong>{formatUsdt(product.price)} USDT</strong><span className="pkc-muted" aria-live="polite">{cart.count} in cart</span></div>
    <button className="pkc-button" disabled={!product.active} onClick={() => cart.add(product)}>{product.active ? 'Add to cart' : 'Unavailable'}</button>
  </article>;
}
