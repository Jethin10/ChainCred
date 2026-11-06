import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { MobileContext, useMobile } from './context'
import { Mark, PixelSky } from '../theme/pixels'
import { deviceCredential, deviceError, enrollDevice, removeDeviceCredential, supportsDeviceUnlock, unlockDevice, type DeviceCredential } from './biometric'
import { Icon, type IconName } from './icons'
import { Sheet } from './Sheet'
import './mobile.css'

const Scanner = lazy(() => import('./Scanner'))
interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function MobileProvider({ children }: { children: ReactNode }) {
  const [credential, setCredential] = useState<DeviceCredential | null>(deviceCredential)
  const [locked, setLocked] = useState(() => !!deviceCredential())
  const [supported, setSupported] = useState<boolean | null>(null)
  const [scan, setScan] = useState(false)
  const [settings, setSettings] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [installed, setInstalled] = useState(() => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const [update, setUpdate] = useState(false)
  const applying = useRef(false)
  const hiddenAt = useRef<number | null>(null)
  useEffect(() => {
    void supportsDeviceUnlock().then(setSupported)
    const onlineChanged = () => setOnline(navigator.onLine)
    const installAvailable = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt) }
    const installedNow = () => { setInstalled(true); setPrompt(null) }
    const display = matchMedia('(display-mode: standalone)')
    const mode = () => setInstalled(display.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)
    window.addEventListener('online', onlineChanged); window.addEventListener('offline', onlineChanged)
    window.addEventListener('beforeinstallprompt', installAvailable); window.addEventListener('appinstalled', installedNow)
    display.addEventListener('change', mode)
    return () => { window.removeEventListener('online', onlineChanged); window.removeEventListener('offline', onlineChanged); window.removeEventListener('beforeinstallprompt', installAvailable); window.removeEventListener('appinstalled', installedNow); display.removeEventListener('change', mode) }
  }, [])
  useEffect(() => {
    if (!credential) return
    const visibility = () => {
      if (document.hidden) hiddenAt.current = Date.now()
      else if (hiddenAt.current !== null) {
        if (Date.now() - hiddenAt.current > 60_000) { setLocked(true); setScan(false); setSettings(false) }
        hiddenAt.current = null
      }
    }
    const sync = (event: StorageEvent) => { if (event.key === 'paykit:device-credential:v1' || event.key === null) { const value = deviceCredential(); setCredential(value); setLocked(!!value) } }
    document.addEventListener('visibilitychange', visibility); window.addEventListener('storage', sync)
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('storage', sync) }
  }, [credential])
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
    const lifecycle = new AbortController()
    const controllerChanged = () => { if (applying.current) location.reload() }
    navigator.serviceWorker.addEventListener('controllerchange', controllerChanged)
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then((reg) => {
      if (lifecycle.signal.aborted) return
      setRegistration(reg); setUpdate(!!reg.waiting)
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing
        worker?.addEventListener('statechange', () => { if (!lifecycle.signal.aborted && worker.state === 'installed' && navigator.serviceWorker.controller) setUpdate(true) })
      })
    }).catch(() => { /* App remains usable when service workers are restricted. */ })
    return () => { lifecycle.abort(); navigator.serviceWorker.removeEventListener('controllerchange', controllerChanged) }
  }, [])
  const act = async (action: 'enable' | 'disable' | 'unlock') => {
    if (busy) return
    setBusy(true); setError(''); setStatus('')
    try {
      if (action === 'enable') { setCredential(await enrollDevice()); setStatus('Device unlock is on. PayKit will lock when reopened or after a minute away.') }
      else if (credential) {
        await unlockDevice(credential)
        if (action === 'disable') { removeDeviceCredential(); setCredential(null); setStatus('Device unlock is off.') }
        setLocked(false)
      }
    } catch (e) { setError(deviceError(e)) }
    finally { setBusy(false) }
  }
  const install = async () => {
    if (!prompt) return
    try { await prompt.prompt(); await prompt.userChoice; setPrompt(null) }
    catch { setError('Installation did not open. Use your browser menu to add PayKit to your home screen.') }
  }
  const openScan = useCallback(() => setScan(true), [])
  const openSettings = useCallback(() => { setError(''); setStatus(''); setSettings(true) }, [])
  if (locked && credential) return <div className="device-lock">
    <PixelSky seed={4} />
    <a className="device-lock__brand" href="#wallet"><Mark /><span>PayKit</span></a>
    <div className="device-lock__body"><div className="device-lock__finger"><Icon name="fingerprint" size={66} /></div><p className="pixel">A little privacy, by design.</p><h1>Just for you.</h1><p>Unlock PayKit with your fingerprint, face, or device PIN.</p><button className="mobile-primary" disabled={busy} onClick={() => void act('unlock')}><Icon name="fingerprint" />{busy ? 'Verifying…' : 'Unlock PayKit'}</button>{error && <p className="mobile-error" role="alert">{error}</p>}<p className="device-lock__note">Your device verifies you. Your wallet stays in your control.</p><details><summary>Having trouble unlocking?</summary><p>Use your device’s PIN in the verification prompt. If the unlock key has been removed, reset this site’s data in browser settings and reconnect your wallet. This only resets PayKit on this device.</p></details></div>
    <span className="device-lock__footer pixel">Your wallet. Your world.</span>
  </div>
  return <MobileContext.Provider value={{ scan: openScan, settings: openSettings, installed, online }}>
    {children}
    {!online && <div className="mobile-network" role="status"><span /> You’re offline. Connect to refresh invoices or pay.</div>}
    {update && !scan && !settings && <div className="mobile-update" role="status"><span>A fresh PayKit is ready.</span><button onClick={() => { applying.current = true; registration?.waiting?.postMessage({ type: 'SKIP_WAITING' }) }}>Update app</button><button aria-label="Dismiss update" onClick={() => setUpdate(false)}><Icon name="close" size={16} /></button></div>}
    {scan && <Suspense fallback={<Sheet title="Scan to pay" onClose={() => setScan(false)}><p role="status">Preparing your scanner…</p></Sheet>}><Scanner onClose={() => setScan(false)} /></Suspense>}
    {settings && <Sheet title="Make it yours" onClose={() => setSettings(false)}>
      <p className="mobile-sheet__lead">PayKit, with the comforts of home.</p>
      <section className="device-setting device-setting--install"><span className="device-setting__icon"><Icon name="download" size={26} /></span><div><h3>{installed ? 'Right at home' : 'A home for your wallet'}</h3><p>{installed ? 'PayKit is installed on this device. Open it from your home screen, whenever you need it.' : 'Keep PayKit on your home screen. Open straight to your wallet, with more room and less browser.'}</p></div>{!installed && (prompt ? <button className="mobile-primary" onClick={() => void install()}>Install PayKit <Icon name="arrow" /></button> : <div className="install-instructions"><p><b>iPhone or iPad</b><br />Open in Safari, tap Share, then Add to Home Screen.</p><p><b>Android or desktop</b><br />Open your browser menu and choose Install app or Add to Home screen.</p></div>)}</section>
      <section className="device-setting"><span className="device-setting__icon"><Icon name="fingerprint" size={28} /></span><div><h3>Device unlock <span className={`setting-badge ${credential ? 'setting-badge--on' : ''}`}>{credential ? 'On' : 'Off'}</span></h3><p>Use your fingerprint, face, or device PIN to open PayKit. Your biometric data stays with your device.</p></div>
        {supported === false && !credential ? <p className="device-setting__hint">Device unlock isn’t available in this browser. Try an HTTPS connection in Safari, Chrome, or Edge on a device with a screen lock.</p> : <button className={credential ? 'mobile-secondary' : 'mobile-primary'} disabled={busy || supported === null} onClick={() => void act(credential ? 'disable' : 'enable')}><Icon name="fingerprint" />{busy ? 'Waiting for your device…' : supported === null ? 'Checking device…' : credential ? 'Turn off device unlock' : 'Enable device unlock'}</button>}
        {credential && <button className="mobile-text-button" onClick={() => { setSettings(false); setLocked(true) }}><Icon name="shield" size={18} /> Lock now</button>}
      </section>
      {error && <p className="mobile-error" role="alert">{error}</p>}{status && <p className="mobile-success" role="status"><Icon name="check" size={18} />{status}</p>}
      <p className="device-setting__hint">Device unlock protects this app’s view. Your wallet still approves payments.</p>
      <div className="mobile-settings-links"><a href="#components" onClick={() => setSettings(false)}><Icon name="code" size={20} /> Explore the SDK <Icon name="arrow" size={18} /></a><a href="#merchant" onClick={() => setSettings(false)}><Icon name="business" size={20} /> Your business <Icon name="arrow" size={18} /></a></div>
    </Sheet>}
  </MobileContext.Provider>
}

export function MobileChrome({ page }: { page: string }) {
  const mobile = useMobile()
  const { scan, settings } = mobile
  useEffect(() => {
    const route = () => { if (location.hash === '#scan') scan(); if (location.hash === '#settings') settings() }
    route(); window.addEventListener('hashchange', route)
    return () => window.removeEventListener('hashchange', route)
  }, [scan, settings])
  const nav: Array<{ page: string; label: string; icon: IconName }> = [{ page: 'wallet', label: 'Wallet', icon: 'wallet' }, { page: 'shops', label: 'Shops', icon: 'shops' }]
  return <>
    <div className="mobile-desktop-tools"><button onClick={mobile.scan}><Icon name="scan" size={18} /> Scan QR</button><button onClick={mobile.settings}><Icon name="settings" size={18} /> App & device</button></div>
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {nav.map((item) => <a key={item.page} href={`#${item.page}`} aria-current={page === item.page ? 'page' : undefined}><Icon name={item.icon} /><span>{item.label}</span></a>)}
      <button className="mobile-nav__scan" onClick={mobile.scan} aria-label="Scan a payment QR"><span><Icon name="scan" size={26} /></span><b>Scan</b></button>
      <a href="#merchant" aria-current={page === 'merchant' ? 'page' : undefined}><Icon name="business" /><span>Business</span></a>
      <button onClick={mobile.settings}><Icon name="settings" /><span>Settings</span></button>
    </nav>
  </>
}

export function WalletQuickActions() {
  const mobile = useMobile()
  return <div className="wallet-mobile-actions"><button onClick={mobile.scan}><span><Icon name="scan" size={25} /></span><b>Scan & pay</b><small>Point. Review. Pay.</small><Icon name="arrow" size={21} /></button><button onClick={mobile.settings}><span><Icon name={mobile.installed ? 'fingerprint' : 'download'} size={25} /></span><b>{mobile.installed ? 'Your device' : 'Take PayKit with you'}</b><small>{mobile.installed ? 'A little more privacy.' : 'Add to your home screen.'}</small><Icon name="arrow" size={21} /></button></div>
}
