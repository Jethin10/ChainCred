// Packages the built landing page for `vercel deploy --prebuilt` (Build Output API v3):
// dist/ as static files, and copy/api.ts as one Node function behind /api/*.
//   VITE_PAYKIT_APP_URL=https://… npm run build && node scripts/vercel-output.mjs && vercel deploy --prebuilt --prod
import fs from 'node:fs'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, '.vercel', 'output')
const fn = path.join(out, 'functions', 'api.func')

fs.rmSync(out, { recursive: true, force: true })
fs.cpSync(path.join(root, 'dist'), path.join(out, 'static'), { recursive: true })

// The PayKit app ships inside the same site at /app/ (built with VITE_BASE=/app/ into web/dist-app).
const appDist = path.resolve(root, '..', 'web', 'dist-app')
const withApp = fs.existsSync(path.join(appDist, 'index.html'))
if (withApp) fs.cpSync(appDist, path.join(out, 'static', 'app'), { recursive: true })
else console.warn('web/dist-app not found: deploying the landing page without the app')

const source = fs.readFileSync(path.join(root, 'copy', 'api.ts'), 'utf8')
fs.mkdirSync(fn, { recursive: true })
fs.writeFileSync(path.join(fn, 'api.mjs'), stripTypeScriptTypes(source))
fs.writeFileSync(
  path.join(fn, 'index.mjs'),
  [
    "import { handleApi } from './api.mjs'",
    "export default (req, res) => { if (!handleApi(req, res)) { res.statusCode = 404; res.end('Not found') } }",
    '',
  ].join('\n'),
)
fs.writeFileSync(path.join(fn, '.vc-config.json'), JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs' }))
fs.writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify({
    version: 3,
    routes: [
      { src: '^/api/(.*)$', dest: '/api' },
      ...(withApp ? [{ src: '^/app/?$', dest: '/app/index.html' }, { src: '^/app/sw\.js$', headers: { 'cache-control': 'no-cache', 'service-worker-allowed': '/app/' }, continue: true }] : []),
      { handle: 'filesystem' },
      { src: '/(.*)', dest: '/index.html' },
    ],
  }),
)
console.log('Wrote .vercel/output')
