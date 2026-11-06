import react from '@vitejs/plugin-react'
import { defaultClientConditions, defineConfig, loadEnv } from 'vite'

// "source" resolves the @paykit/* workspace packages to their TypeScript source,
// so edits to the SDK show up live in this preview.
// /v1 is proxied to the PayKit API server (`npm run server:demo`), so the app uses the real backend in dev.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.PAYKIT_API_PROXY || 'http://127.0.0.1:8787'
  return {
    plugins: [react()],
    resolve: { conditions: ['source', ...defaultClientConditions] },
    server: { proxy: { '/v1': { target, changeOrigin: false } } },
    preview: { proxy: { '/v1': { target, changeOrigin: false } } },
  }
})
