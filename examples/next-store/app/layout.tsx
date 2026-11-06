import { PayKitProvider } from '@paykit/react';
import '@paykit/react/styles.css';
import type { ReactNode } from 'react';
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><PayKitProvider
    apiUrl={process.env.NEXT_PUBLIC_PAYKIT_API_URL ?? 'http://localhost:8787'}
    publishableKey={process.env.NEXT_PUBLIC_PAYKIT_PK ?? 'pk_configure_your_key'}
  >{children}</PayKitProvider></body></html>;
}
