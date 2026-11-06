import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './icons'

export function Sheet({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    return () => { dialog.close(); document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  return <dialog ref={ref} className={`mobile-sheet ${className}`} aria-label={title} onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="mobile-sheet__content">
      <div className="mobile-sheet__grip" aria-hidden="true" />
      <header className="mobile-sheet__head"><h2>{title}</h2><button className="mobile-icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></header>
      {children}
    </div>
  </dialog>
}
