export type IconName = 'wallet' | 'shops' | 'scan' | 'settings' | 'fingerprint' | 'close' | 'download' | 'arrow' | 'shield' | 'camera' | 'image' | 'flash' | 'check' | 'code' | 'business'
const paths: Record<IconName, string> = {
  wallet: 'M20 8V5H5a2 2 0 0 0 0 4h15v11H5a3 3 0 0 1-3-3V7m18 5h-5v4h5',
  shops: 'M3 10v10h18V10M2 10l2-7h16l2 7M2 10q3 4 5 0 3 4 5 0 3 4 5 0 3 4 5 0M9 20v-6h6v6',
  scan: 'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M7 7h3v3H7zm7 0h3v3h-3zM7 14h3v3H7zm7 0h3v3h-3z',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z',
  fingerprint: 'M5 9a7 7 0 0 1 14 0m-17 2a10 10 0 0 1 20 0M8 12v3q0 5-3 6m7-14a4 4 0 0 0-4 4m4 0v5q0 4-2 6m6-10v4q0 3 2 5m2-8v3q0 3 1 4',
  close: 'm6 6 12 12M6 18 18 6', download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  arrow: 'M5 12h14m-6-6 6 6-6 6', shield: 'M12 2 3 6v6q0 7 9 10 9-3 9-10V6ZM8 12l3 3 5-6',
  camera: 'M8 5 6 8H2v13h20V8h-4l-2-3Zm4 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  image: 'M3 3h18v18H3ZM3 17l6-6 4 4 3-3 5 5M16 7h.01', flash: 'm13 2-9 12h7l-1 8 10-13h-8Z',
  check: 'm5 12 4 4L19 6', code: 'm8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18',
  business: 'M3 8h18v13H3ZM8 8V3h8v5M3 13h18M10 13v3h4v-3',
}
export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
