import { createContext, useContext } from 'react'
export type MobileState = { scan: () => void; settings: () => void; installed: boolean; online: boolean }
export const MobileContext = createContext<MobileState | null>(null)
export function useMobile() { const context = useContext(MobileContext); if (!context) throw new Error('MobileProvider is missing'); return context }
