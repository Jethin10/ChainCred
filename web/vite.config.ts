import react from '@vitejs/plugin-react'
import { defaultClientConditions, defineConfig, loadEnv } from 'vite'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// "source" resolves the @paykit/* workspace packages to their TypeScript source,
// so edits to the SDK show up live in this preview.
// /v1 is proxied to the PayKit API server (`npm run server:demo`), so the app uses the real backend in dev.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.PAYKIT_API_PROXY || 'http://127.0.0.1:8787'
  // VITE_BASE=/app/ builds the app to live under the landing site's /app/ path.
  const base = env.VITE_BASE || '/'
  return {
    base,
    plugins: [react(), {
      name: 'paykit-offline-shell',
      apply: 'build',
      generateBundle(_options, bundle) {
        const publicDir = fileURLToPath(new URL('./public/', import.meta.url))
        const publicFiles = readdirSync(publicDir, { recursive: true, withFileTypes: true }).filter((item) => item.isFile()).map((item) => `${item.parentPath.slice(publicDir.length).replaceAll('\\', '/')}/${item.name}`.replace(/^\/*/, '/')).filter((name) => !name.startsWith('/r/'))
        const files = ['/index.html', ...Object.keys(bundle).filter((name) => !name.endsWith('.map')).map((name) => `/${name}`), ...publicFiles].map((name) => base.replace(/\/$/, '') + name)
        const precache = [...new Set(files)]
        const hash = createHash('sha256')
        for (const entry of Object.values(bundle)) hash.update(entry.type === 'chunk' ? entry.code : entry.source)
        for (const name of publicFiles) hash.update(readFileSync(`${publicDir}${name.slice(1)}`))
        const version = hash.digest('hex').slice(0, 16)
        const source = readFileSync(new URL('./pwa-worker.js', import.meta.url), 'utf8').replace('__PRECACHE__', JSON.stringify(precache)).replace('__VERSION__', JSON.stringify(version)).replace('__BASE__', JSON.stringify(base))
        this.emitFile({ type: 'asset', fileName: 'sw.js', source })
      },
    }],
    resolve: { conditions: ['source', ...defaultClientConditions] },
    server: { proxy: { '/v1': { target, changeOrigin: false } } },
    preview: { proxy: { '/v1': { target, changeOrigin: false } } },
  }
})
