"use client";
import { useState } from 'react';
import { useWallet, errorMessage } from '@paykit/react';
import './paykit-ui.css';

export function WalletButton({ className = '' }: { className?: string }) {
  const wallet = useWallet();
  const [error, setError] = useState<unknown>(null);
  const run = (action: () => Promise<unknown>) => { setError(null); void action().catch(setError); };
  return <div className={`pkc-wallet ${className}`}>
    {wallet.status !== 'connected' ? <button className="pkc-button" disabled={wallet.status === 'connecting'} onClick={() => run(wallet.connect)}>{wallet.status === 'connecting' ? 'Connecting…' : 'Connect wallet'}</button>
      : <><span className="pkc-tag">{wallet.address?.slice(0, 6)}…{wallet.address?.slice(-4)}</span>
        {wallet.wrongNetwork ? <button className="pkc-button" onClick={() => run(wallet.switchNetwork)}>Switch network</button>
          : <button className="pkc-button pkc-button--quiet" onClick={wallet.disconnect}>Disconnect</button>}</>}
    {error != null && <p className="pkc-error" role="alert">{errorMessage(error)}</p>}
  </div>;
}
