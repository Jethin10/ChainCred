import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { PayKitProvider, createPayKitClient, fromLocalAccount, errorMessage, type PayKitClient } from '@paykit/react'
import { createMockApi, MOCK_TEST_KEYS } from '@paykit/testing'
import { privateKeyToAccount } from 'viem/accounts'
import type { Product } from '@paykit/js'
import catalog from '../../../packages/react/registry/catalog.json'
import { CustomCheckout } from '../../../packages/react/registry/checkout'
import { CustomPaymentStatus } from '../../../packages/react/registry/payment-status'
import { WalletButton } from '../../../packages/react/registry/wallet-button'
import { CustomProductCard } from '../../../packages/react/registry/product-card'
import { PaymentReceipt } from '../../../packages/react/registry/receipt'
import { CustomInstallmentPlan } from '../../../packages/react/registry/installment-plan'
import './components.css'

const sources = import.meta.glob('../../../packages/react/registry/*.{tsx,css}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const sourceFor = (file: string) => sources[`../../../packages/react/registry/${file}`] ?? ''
const testWallet = fromLocalAccount(privateKeyToAccount(MOCK_TEST_KEYS.customer), 1874)
const providerSource = `import { PayKitProvider } from '@paykit/react';
import '@paykit/react/styles.css';

<PayKitProvider publishableKey="pk_your_publishable_key" apiUrl="https://your-paykit-api">
  {/* Place your copied components here. */}
</PayKitProvider>`
const backendSource = `// Your existing authenticated backend. Prices come from your order database.
const session = await paykit.checkout.createSession({
  externalOrderId: order.id,
  lineItems: order.items.map(item => ({
    name: item.name, quantity: item.quantity, unitAmount: item.priceBaseUnits,
  })),
});
// Return session.id to the customer. Fulfill from verified payment.finalized webhooks.`

const ACCENTS: Array<[string, string]> = [['Ink', '#0a0a0a'], ['Sky', '#0077d9'], ['Chai', '#a3541d'], ['Mint', '#0f7a5a'], ['Berry', '#b4235a']]

// Clients that talk to the live PayKit API: poll gently and keep what the server already has.
const liveClients = new WeakSet<PayKitClient>()
const poll = (client: PayKitClient) => (liveClients.has(client) ? 750 : 25)

// The test wallet earns points the honest way: one earlier purchase (45 USDT → 450 PKP at Mumbai Chai Co.).
// On the live API points persist, so it only buys when the wallet can't afford a reward yet.
const earnedPoints = new WeakMap<PayKitClient, Promise<unknown>>()
function earnPreviewPoints(client: PayKitClient) {
  let job = earnedPoints.get(client)
  if (!job) {
    job = testWallet.getAddress().then((a) => client.merchants.points(a)).then((b) => Number(b.balance) >= 60, () => false).then((enough) => enough ? null : client.merchants.products('chai-co').then((list) => {
      const box = list.find((p) => p.name.includes('subscription'))
      return box ? client.checkout.pay({ merchant: 'chai-co', items: [{ productId: box.id, quantity: 1 }] }, testWallet, { wait: { until: 'included', intervalMs: poll(client) } }) : null
    })).catch(() => null)
    earnedPoints.set(client, job)
  }
  return job
}

function idFromHash() { return catalog.find((item) => item.id === location.hash.split('/')[1])?.id ?? 'checkout' }

/** `liveClient`: the app's client for the live PayKit API. Without it, previews run on an in-browser mock. */
export default function ComponentsPage({ liveClient }: { liveClient?: PayKitClient | null }) {
  const [client] = useState(() => {
    if (liveClient) { liveClients.add(liveClient); return liveClient }
    const mock = createMockApi({ stepMs: 200, latencyMs: 0 })
    return createPayKitClient({ baseUrl: mock.baseUrl, fetch: mock.fetch, siwe: mock.siwe })
  })
  const [connected, setConnected] = useState(true)
  return <PayKitProvider client={client} wallet={connected ? testWallet : null} onConnectRequest={() => setConnected(true)} onDisconnectRequest={() => setConnected(false)} theme="light">
    <ComponentWorkbench client={client} />
  </PayKitProvider>
}

function CodeBlock({ source, label }: { source: string; label: string }) {
  const [copyState, setCopyState] = useState<{ source: string; result: 'copied' | 'error' } | null>(null)
  const copied = copyState?.source === source && copyState.result === 'copied'
  const copyError = copyState?.source === source && copyState.result === 'error'
  return <div className="docs-code">
    <div className="docs-code__bar"><span>{label}</span><button type="button" data-copied={copied} onClick={async () => {
      try { await navigator.clipboard.writeText(source); setCopyState({ source, result: 'copied' }) }
      catch { setCopyState({ source, result: 'error' }) }
    }}>{copied ? 'Copied ✓' : 'Copy'}</button></div>
    <pre tabIndex={0} aria-label={label}><code>{source}</code></pre>
    {copyError && <p role="alert">Clipboard access was blocked. Select the code above and copy it manually.</p>}
  </div>
}

function ComponentWorkbench({ client }: { client: PayKitClient }) {
  const [selectedId, setSelectedId] = useState(idFromHash)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'preview' | 'code' | 'install'>('preview')
  const [file, setFile] = useState<'component' | 'styles' | 'usage'>('component')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [accent, setAccent] = useState('#0a0a0a')
  const [label, setLabel] = useState('Pay with USDT')
  const [reset, setReset] = useState(0)
  const [demo, setDemo] = useState<{ key: string; sessionId: string; product: Product; paymentId?: string } | null>(null)
  const [error, setError] = useState<{ key: string; cause: unknown } | null>(null)
  const paymentRef = useRef<string | null>(null)
  const selected = catalog.find((item) => item.id === selectedId) ?? catalog[0]
  const previewKey = `${selectedId}:${reset}`
  const activeDemo = demo?.key === previewKey ? demo : null
  const activeError = error?.key === previewKey ? error.cause : null
  const visible = catalog.filter((item) => `${item.title} ${item.description} ${item.hook}`.toLowerCase().includes(query.toLowerCase()))

  useEffect(() => {
    const update = () => { setSelectedId(idFromHash()); setTab('preview'); setFile('component') }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    async function prepare() {
      if (selectedId === 'checkout') await earnPreviewPoints(client)
      const [product] = await client.merchants.products('chai-co')
      if (controller.signal.aborted) return
      if (!product) throw new Error('Preview product unavailable')
      const session = await client.checkout.createSession({ merchant: 'chai-co', items: [{ productId: product.id, quantity: 4 }] })
      if (controller.signal.aborted) return
      let paymentId: string | undefined
      if (selectedId === 'payment-status' || selectedId === 'receipt') {
        if (paymentRef.current) paymentId = paymentRef.current
        else {
          const result = await client.checkout.pay({ sessionId: session.id }, testWallet, { expectedAmount: '10000000', wait: { until: 'included', intervalMs: poll(client) } })
          paymentId = result.payment.paymentId
          paymentRef.current = paymentId
        }
      }
      if (!controller.signal.aborted) setDemo({ key: previewKey, sessionId: session.id, product, paymentId })
    }
    void prepare().catch((cause) => !controller.signal.aborted && setError({ key: previewKey, cause }))
    return () => controller.abort()
  }, [client, selectedId, previewKey])

  const usage = `import { ${selected.exportName} } from './components/paykit/${selected.id}';\n\n${selected.id === 'checkout' ? `<CustomCheckout sessionId={session.id} amount="10000000" label={${JSON.stringify(label)}} />` : selected.usage}`
  const filename = file === 'component' ? `${selected.id}.tsx` : file === 'styles' ? 'paykit-ui.css' : 'Usage.tsx'
  const displayedSource = file === 'usage' ? usage : sourceFor(filename)
  const installCommand = `npm run ui:add -- ${selected.id} --cwd "../your-store"`
  const inverted = theme === 'dark' && accent === '#0a0a0a'
  const stageStyle = { '--pk-accent': inverted ? '#ffffff' : accent, '--pk-accent-ink': inverted ? '#0a0a0a' : '#ffffff' } as CSSProperties

  return <div className="docs-shell">
    <aside className="docs-sidebar" aria-label="Component library">
      <a className="docs-home" href="#components/checkout">Component library <span>{catalog.length}</span></a>
      <label className="docs-search"><span className="docs-sr">Search components</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search components…" /></label>
      {['Payments', 'Commerce', 'Wallet'].map((category) => <div className="docs-group" key={category}>
        <p>{category}</p>
        {visible.filter((item) => item.category === category).map((item) => <a key={item.id} href={`#components/${item.id}`} aria-current={selected.id === item.id ? 'page' : undefined}>{item.title}</a>)}
      </div>)}
      {!visible.length && <p className="docs-empty">No matching components. Try “payment” or “wallet”.</p>}
      <div className="docs-sidebar__note">Copy the view.<br />Keep the payment logic in the SDK.</div>
    </aside>

    <section className="docs-content" aria-label={`${selected.title} documentation`}>
      <header className="docs-heading"><p className="docs-breadcrumb">Components / {selected.category}</p><h1>{selected.title}</h1><p>{selected.description}</p><span className="docs-hook">Powered by {selected.hook}</span></header>
      <div className="docs-toolbar"><div className="docs-tabs" role="tablist" aria-label="Component view">
        {(['preview', 'code', 'install'] as const).map((value) => <button type="button" role="tab" key={value} aria-selected={tab === value} aria-controls={`component-${value}`} onClick={() => setTab(value)}>{value === 'preview' ? 'Preview' : value === 'code' ? 'Code' : 'Install'}</button>)}
      </div><a className="docs-permalink" href={`#components/${selected.id}`} onClick={() => setTab('preview')}>Permalink</a></div>

      {tab === 'preview' && <div id="component-preview" role="tabpanel" className="docs-panel">
        <div className="docs-demo-bar"><span><i /> Simulated payments. No real funds.</span><button type="button" onClick={() => { paymentRef.current = null; setReset((value) => value + 1) }}>Reset preview</button></div>
        <div className={`pk-root docs-stage docs-stage--${theme}`} data-pk-theme={theme} style={stageStyle}>
          <div className="docs-stage__component" key={`${selected.id}:${reset}`}>
            {activeError != null ? <p role="alert">{errorMessage(activeError)}</p> : !activeDemo ? <p role="status">Preparing preview…</p> : <>
              {selected.id === 'checkout' && <CustomCheckout sessionId={activeDemo.sessionId} amount="10000000" label={label} onPaid={(id) => { paymentRef.current = id }} />}
              {selected.id === 'payment-status' && activeDemo.paymentId && <CustomPaymentStatus paymentId={activeDemo.paymentId} />}
              {selected.id === 'wallet-button' && <WalletButton />}
              {selected.id === 'product-card' && <CustomProductCard product={activeDemo.product} />}
              {selected.id === 'receipt' && activeDemo.paymentId && <PaymentReceipt paymentId={activeDemo.paymentId} />}
              {selected.id === 'installment-plan' && <CustomInstallmentPlan input={{ sessionId: activeDemo.sessionId }} total="10000000" option={{ count: 2, periodSeconds: 120 }} />}
            </>}
          </div>
        </div>
        <div className="docs-controls">
          <div className="docs-control"><span>Theme</span>
            <button type="button" role="switch" aria-checked={theme === 'dark'} aria-label="Dark theme" className="docs-switch" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              <span className="docs-switch__knob" aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
            </button>
          </div>
          <div className="docs-control"><span>Accent</span>
            <div className="docs-swatches" role="radiogroup" aria-label="Accent colour">
              {ACCENTS.map(([name, color]) => <button key={color} type="button" role="radio" aria-checked={accent === color} aria-label={name} title={name} style={{ '--c': color } as CSSProperties} onClick={() => setAccent(color)} />)}
              <label className="docs-swatches__custom" title="Custom colour" data-on={!ACCENTS.some(([, c]) => c === accent)} style={{ '--c': accent } as CSSProperties}><span className="docs-sr">Custom accent</span><input type="color" value={accent} onChange={(event) => setAccent(event.target.value)} /></label>
            </div>
          </div>
          {selected.id === 'checkout' && <label className="docs-controls__label">Button label<input value={label} maxLength={60} onChange={(event) => setLabel(event.target.value)} /></label>}
          <button type="button" className="docs-link-button" onClick={() => { setFile('usage'); setTab('code') }}>View usage</button>
        </div>
      </div>}

      {tab === 'code' && <div id="component-code" role="tabpanel" className="docs-panel docs-panel--code">
        <div className="docs-file-tabs" aria-label="Source files">{(['component', 'styles', 'usage'] as const).map((value) => <button type="button" key={value} aria-pressed={file === value} onClick={() => setFile(value)}>{value === 'component' ? `${selected.id}.tsx` : value === 'styles' ? 'paykit-ui.css' : 'Usage'}</button>)}</div>
        <CodeBlock source={displayedSource} label={filename} />
        <p className="docs-footnote">Copy both the component and stylesheet into the same directory. Hooks stay in the SDK so fixes remain upgradeable.</p>
      </div>}

      {tab === 'install' && <div id="component-install" role="tabpanel" className="docs-install">
        <h2>Add it to your existing React app</h2>
        <p>From this PayKit checkout, run the installer with your app’s directory. It installs local SDK packages and copies the component and stylesheet. No npm publication is required.</p>
        <CodeBlock source={installCommand} label="From the PayKit repository" />
        <p className="docs-footnote">Use Node 24. Run <code>npm ci</code> and <code>npm run sdk:build</code> in PayKit first. Existing customized files are preserved unless you pass <code>--force</code>.</p>
        <h2>Wrap your components once</h2><CodeBlock source={providerSource} label="Provider.tsx" />
        <h2>Use the component</h2><CodeBlock source={usage} label="Your page" />
        {['checkout', 'installment-plan'].includes(selected.id) && <><h2>Keep order pricing on your server</h2><CodeBlock source={backendSource} label="Existing merchant backend" /></>}
        <details className="docs-registry"><summary>Already using shadcn?</summary><p>The registry endpoint includes the component and stylesheet. Install the SDK first using the local installer above. The npm packages are not published yet, so a registry dependency installation alone is not a supported first setup.</p><a href={`${import.meta.env.BASE_URL}r/${selected.id}.json`} target="_blank" rel="noreferrer">Inspect registry JSON</a></details>
      </div>}

      <section className="docs-props"><h2>Props</h2><div className="docs-props__scroll"><table><thead><tr><th scope="col">Prop</th><th scope="col">Type</th><th scope="col">Details</th></tr></thead><tbody>{selected.props.map((prop) => <tr key={prop.name}><th scope="row"><code>{prop.name}</code>{prop.required && <span className="docs-required">required</span>}</th><td><code>{prop.type}</code></td><td>{prop.description}</td></tr>)}</tbody></table></div></section>
      <footer className="docs-footer"><p>Your UI is yours to edit. Payment amounts, signing, retries and finality stay in PayKit’s hooks.</p><a href="https://github.com/Jethin10/PayKit" target="_blank" rel="noreferrer">View repository</a></footer>
    </section>
  </div>
}
