"use client";
import { useEffect, useRef, useState } from 'react';
import { useWallet, errorMessage } from '@paykit/react';
import './paykit-ui.css';

export function WalletButton({ className = '' }: { className?: string }) {
  const wallet = useWallet();
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const run = (action: () => Promise<unknown>) => { setError(null); setOpen(false); void action().catch(setError); };

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  const address = wallet.address ?? '';
  return <div ref={root} className={`pkc-wallet ${className}`}>
    {wallet.status !== 'connected' || !address
      ? <button className="pkc-button pkc-connect" disabled={wallet.status === 'connecting'} onClick={() => run(wallet.connect)}>
        {wallet.status === 'connecting' ? <span className="pkc-dots">Connecting</span> : <><span className="pkc-plug" aria-hidden="true">⏻</span>Connect wallet</>}
      </button>
      : <>
        <button className="pkc-pill" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Face address={address} />
          <span className="pkc-mono">{address.slice(0, 6)}…{address.slice(-4)}</span>
          <span className="pkc-pill__dot" data-warn={wallet.wrongNetwork} aria-label={wallet.wrongNetwork ? 'Wrong network' : 'Connected'} />
          <span className="pkc-pill__chev" aria-hidden="true">▾</span>
        </button>
        {open && <div className="pkc-menu" role="menu">
          <button role="menuitem" onClick={() => { void navigator.clipboard?.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }}>
            {copied ? 'Copied ✓' : 'Copy address'}<span>⧉</span>
          </button>
          {wallet.wrongNetwork && <button role="menuitem" onClick={() => run(wallet.switchNetwork)}>Switch to Whitechain<span>⇄</span></button>}
          <button role="menuitem" className="pkc-menu__danger" onClick={() => { setOpen(false); wallet.disconnect(); }}>Disconnect<span>⏏</span></button>
        </div>}
      </>}
    {error != null && <p className="pkc-error" role="alert">{errorMessage(error)}</p>}
  </div>;
}

/** A 5×5 mirrored pixel face from the address, so people recognise their own wallet at a glance. */
function Face({ address }: { address: string }) {
  const bits = parseInt(address.slice(2, 10), 16) || 0;
  const hue = parseInt(address.slice(-4), 16) % 2 ? 'var(--pk-progress, #00a3ff)' : 'var(--pk-ink, #0a0a0a)';
  const cells = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) cells.push((bits >>> (y * 3 + Math.min(x, 4 - x))) & 1);
  return <span className="pkc-face" aria-hidden="true">{cells.map((on, i) => <i key={i} style={{ background: on ? hue : 'transparent' }} />)}</span>;
}
