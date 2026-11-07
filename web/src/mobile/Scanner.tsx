import { useEffect, useRef, useState } from 'react'
import type QrScanner from 'qr-scanner'
import { Icon } from './icons'
import { Sheet } from './Sheet'
import { paymentTarget } from './payment-link'

export default function Scanner({ onClose }: { onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const scanner = useRef<QrScanner | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const [running, setRunning] = useState(false)
  const [ready, setReady] = useState(false)
  const [torch, setTorch] = useState(false)
  const [flash, setFlash] = useState(false)
  const [manual, setManual] = useState('')
  const [target, setTarget] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const startCamera = () => { setReady(false); setFlash(false); setTorch(false); setError(''); setRunning(true) }
  const accept = (value: string) => {
    try {
      setTarget(paymentTarget(value)); setRunning(false); setError('')
      navigator.vibrate?.(35)
    } catch (e) { setError((e as Error).message) }
  }
  useEffect(() => {
    if (!running) return
    const lifecycle = new AbortController()
    const start = async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Camera scanning needs HTTPS and a supported browser. Upload a QR image or paste the link below.')
        const { default: QR } = await import('qr-scanner')
        if (lifecycle.signal.aborted || !video.current) return
        const instance = new QR(video.current, (result) => { if (!lifecycle.signal.aborted) accept(result.data) }, { preferredCamera: 'environment', maxScansPerSecond: 8, returnDetailedScanResult: true, onDecodeError: () => {} })
        lifecycle.signal.addEventListener('abort', () => instance.destroy(), { once: true })
        scanner.current = instance
        await instance.start()
        if (lifecycle.signal.aborted) { instance.destroy(); return }
        setReady(true)
        setFlash(await instance.hasFlash().catch(() => false))
      } catch (e) {
        if (lifecycle.signal.aborted) return
        setRunning(false)
        setError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Camera access is off. Allow it in browser settings, upload a QR image, or paste your link.' : e instanceof Error ? e.message : 'Could not start the camera. Try uploading a QR image instead.')
      }
    }
    void start()
    const visibility = () => { if (document.hidden) setRunning(false) }
    document.addEventListener('visibilitychange', visibility)
    return () => { lifecycle.abort(); scanner.current = null; document.removeEventListener('visibilitychange', visibility) }
  }, [running])
  const fromImage = async (file?: File) => {
    if (!file) return
    setRunning(false); setReading(true); setError('')
    try {
      const { default: QR } = await import('qr-scanner')
      const result = await QR.scanImage(file, { returnDetailedScanResult: true })
      accept(result.data)
    } catch { setError('No readable QR found in this image. Try a clearer image or paste the link.') }
    finally { setReading(false); if (input.current) input.current.value = '' }
  }
  return <Sheet title="Scan to pay" onClose={onClose} className="scanner-sheet">
    <p className="mobile-sheet__lead">Point your camera at a ChainCred QR. You’ll review the invoice before paying.</p>
    {target ? <div className="scan-result">
      <span className="scan-result__check"><Icon name="check" size={30} /></span><h3>Invoice found</h3><p>Ready for a closer look.</p><code>{target.replace(/^pay\//, '')}</code>
      <button className="mobile-primary" onClick={() => { location.hash = target; onClose() }}>Review invoice <Icon name="arrow" /></button>
      <button className="mobile-text-button" onClick={() => setTarget(null)}>Scan another QR</button>
    </div> : <>
      <div className={`scan-view ${ready && running ? 'scan-view--live' : ''}`}>
        <video ref={video} muted playsInline aria-label="QR camera preview" />
        <div className="scan-view__frame" aria-hidden="true"><i /><i /><i /><i />{ready && running && <span />}</div>
        {!running && <div className="scan-view__empty"><Icon name="scan" size={46} /><span>Your next checkout,<br />one scan away.</span><button className="scan-start" onClick={startCamera}><Icon name="camera" size={18} /> Enable camera</button></div>}
        {running && !ready && <p className="scan-view__loading" role="status">Opening camera…</p>}
        {running && ready && <span className="scan-view__status"><i /> Looking for a ChainCred QR</span>}
      </div>
      <div className="scan-tools"><button onClick={() => input.current?.click()} disabled={reading}><Icon name="image" size={19} />{reading ? 'Reading image…' : 'Upload QR image'}</button>
        {running && flash && <button aria-pressed={torch} onClick={() => void scanner.current?.toggleFlash().then(() => setTorch(scanner.current?.isFlashOn() ?? false)).catch(() => setError('Flashlight unavailable on this camera.'))}><Icon name="flash" size={18} /> Light</button>}
        {running && <button onClick={() => setRunning(false)}>Stop camera</button>}
      </div>
      <input type="file" accept="image/*" ref={input} hidden onChange={(e) => void fromImage(e.target.files?.[0])} />
      <div className="scan-divider"><span>or use a payment link</span></div>
      <form className="scan-manual" onSubmit={(e) => { e.preventDefault(); accept(manual) }}><label htmlFor="scan-link">Invoice link or ID</label><div><input id="scan-link" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Paste a ChainCred link or inv_…" value={manual} onChange={(e) => setManual(e.target.value)} /><button className="mobile-icon-button" aria-label="Review pasted invoice" disabled={!manual.trim()}><Icon name="arrow" /></button></div></form>
    </>}
    {error && <p className="mobile-error" role="alert">{error}</p>}
    <p className="scan-privacy"><Icon name="shield" size={16} /> Your camera stays on your device.</p>
  </Sheet>
}
