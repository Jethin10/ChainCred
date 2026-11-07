import { useMobile } from './context'
import { Icon } from './icons'

export function WalletQuickActions() {
  const mobile = useMobile()
  return <div className="wallet-mobile-actions"><button onClick={mobile.scan}><span><Icon name="scan" size={25} /></span><b>Scan & pay</b><small>Point. Review. Pay.</small><Icon name="arrow" size={21} /></button><button onClick={mobile.settings}><span><Icon name={mobile.installed ? 'fingerprint' : 'download'} size={25} /></span><b>{mobile.installed ? 'Your device' : 'Take ChainCred with you'}</b><small>{mobile.installed ? 'A little more privacy.' : 'Add to your home screen.'}</small><Icon name="arrow" size={21} /></button></div>
}
