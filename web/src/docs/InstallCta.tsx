import { useState } from 'react'

const COMMAND = 'npx usepaykit@latest init'

/** One-click copy of the install command, plus the npm page. Sits under the SDK hero. */
export function InstallCta() {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(COMMAND)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard blocked: the command is visible to copy by hand */ }
  }
  return (
    <div className="install-cta">
      <button type="button" className="install-cta__cmd" onClick={copy} aria-label={`Copy install command: ${COMMAND}`}>
        <span aria-hidden="true">$</span>
        <code>{COMMAND}</code>
        <b data-copied={copied}>{copied ? 'Copied' : 'Copy'}</b>
      </button>
      <a className="install-cta__npm" href="https://www.npmjs.com/package/usepaykit" target="_blank" rel="noreferrer">View on npm ↗</a>
    </div>
  )
}
