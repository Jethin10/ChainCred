import { useSyncExternalStore } from 'react'
import DesktopApp from './DesktopApp'
import MobileApp from './MobileApp'

const mobileViewport = window.matchMedia('(max-width: 760px)')
const subscribe = (onChange: () => void) => {
  mobileViewport.addEventListener('change', onChange)
  return () => mobileViewport.removeEventListener('change', onChange)
}
const isMobile = () => mobileViewport.matches

export default function App() {
  const mobile = useSyncExternalStore(subscribe, isMobile, () => false)
  return mobile ? <MobileApp /> : <DesktopApp />
}
