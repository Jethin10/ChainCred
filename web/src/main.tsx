import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@paykit/react/styles.css'
import './index.css'
import App from './App.tsx'
import { MobileProvider } from './mobile/Mobile'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MobileProvider><App /></MobileProvider>
  </StrictMode>,
)
