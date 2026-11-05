import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite'
import { rewrites, type Rewrite } from './copy/rewrites.ts'
import { perf } from './copy/perf.ts'
import { handleApi } from './copy/api.ts'

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))
const publicDir = path.join(root, 'public')
const distDir = path.join(root, 'dist')

const allRewrites: Rewrite[] = [...rewrites, ...perf]
const rewrittenFiles = [...new Set(allRewrites.map((r) => r.file))]

/** Applies the copy and performance rewrites to a bundle. Throws if one no longer matches. */
function rewriteFile(file: string): string {
  let text = fs.readFileSync(path.join(publicDir, 'assets', file), 'utf8')
  for (const r of allRewrites.filter((x) => x.file === file)) {
    const count = text.split(r.from).length - 1
    if (count === 0 || (!r.all && count !== 1)) {
      throw new Error(`[paykit-copy] ${file}: expected ${r.all ? 'at least one' : 'exactly one'} match, found ${count} for: ${r.from.slice(0, 80)}…`)
    }
    text = text.split(r.from).join(r.to)
  }
  return text
}

// ── Static serving: compression and caching ──────────────────────────────────

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
}
const compressible = (file: string) => path.extname(file) in TYPES

type Entry = { key: string; body: Buffer; br?: Buffer; gz?: Buffer; etag: string }
const memo = new Map<string, Entry>()

/** Reads (and for the rewritten bundles, rewrites) a file once per change, compressing lazily. */
function load(dir: string, url: string, rewrite: boolean): Entry | null {
  const file = path.join(dir, url)
  if (!file.startsWith(dir)) return null
  let stat: fs.Stats
  try {
    stat = fs.statSync(file)
  } catch {
    return null
  }
  if (!stat.isFile()) return null
  const name = url.slice('/assets/'.length)
  const isRewritten = rewrite && rewrittenFiles.includes(name)
  const key = `${stat.mtimeMs}:${stat.size}`
  const hit = memo.get(file)
  if (hit && hit.key === key) return hit
  const body = isRewritten ? Buffer.from(rewriteFile(name)) : fs.readFileSync(file)
  const entry = { key, body, etag: `"${createHash('sha1').update(body).digest('base64url')}"` }
  memo.set(file, entry)
  return entry
}
function brotli(buf: Buffer, quality: number) {
  return zlib.brotliCompressSync(buf, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
  })
}

/**
 * Serves `/assets/*` scripts, styles, fonts and SVGs with Brotli or gzip, an ETag, and (for the
 * content-hashed files) a one-year immutable cache. Images and video fall through to Vite, which
 * handles range requests.
 */
function assetServer(dir: string, opts: { rewrite: boolean; precompressed: boolean }): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    const url = decodeURIComponent((req.url ?? '').split('?')[0])
    if (!url.startsWith('/assets/')) return next()
    const name = url.slice('/assets/'.length)
    const hashed = !(opts.rewrite && rewrittenFiles.includes(name))
    if (!compressible(url)) {
      if (hashed) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      return next()
    }
    const entry = load(dir, url, opts.rewrite)
    if (!entry) return next()

    res.setHeader('Content-Type', TYPES[path.extname(url)])
    res.setHeader('Vary', 'Accept-Encoding')
    res.setHeader('ETag', entry.etag)
    res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache')
    if (req.headers['if-none-match'] === entry.etag) {
      res.statusCode = 304
      return res.end()
    }
    const accept = String(req.headers['accept-encoding'] ?? '')
    let body = entry.body
    if (/\bbr\b/.test(accept)) {
      if (!entry.br) {
        const pre = path.join(dir, url + '.br')
        entry.br = opts.precompressed && fs.existsSync(pre) ? fs.readFileSync(pre) : brotli(entry.body, 5)
      }
      body = entry.br
      res.setHeader('Content-Encoding', 'br')
    } else if (/\bgzip\b/.test(accept)) {
      if (!entry.gz) {
        const pre = path.join(dir, url + '.gz')
        entry.gz = opts.precompressed && fs.existsSync(pre) ? fs.readFileSync(pre) : zlib.gzipSync(entry.body, { level: 6 })
      }
      body = entry.gz
      res.setHeader('Content-Encoding', 'gzip')
    }
    res.setHeader('Content-Length', body.length)
    res.end(req.method === 'HEAD' ? undefined : body)
  }
}

/** Writes `.br` (max quality) and `.gz` next to every compressible file in the build. */
function precompress(dir: string) {
  const walk = (d: string): string[] =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
  for (const file of walk(dir)) {
    if (!compressible(file) || file.endsWith('.map')) continue
    const buf = fs.readFileSync(file)
    if (buf.length < 1024) continue
    fs.writeFileSync(file + '.br', brotli(buf, 11))
    fs.writeFileSync(file + '.gz', zlib.gzipSync(buf, { level: 9 }))
  }
}

function paykit(appUrl: string): Plugin {
  const api = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!handleApi(req, res)) next()
  }
  return {
    name: 'paykit',
    configureServer(server) {
      server.middlewares.use(assetServer(publicDir, { rewrite: true, precompressed: false }))
      server.middlewares.use(api)
    },
    configurePreviewServer(server) {
      server.middlewares.use(assetServer(distDir, { rewrite: false, precompressed: true }))
      server.middlewares.use(api)
    },
    transformIndexHtml(html) {
      return html.replaceAll('__PAYKIT_APP_URL__', appUrl)
    },
    buildStart() {
      // Fail the build early if any rewrite no longer matches its bundle.
      for (const file of rewrittenFiles) rewriteFile(file)
    },
    closeBundle() {
      const out = path.join(distDir, 'assets')
      if (!fs.existsSync(out)) return
      for (const file of rewrittenFiles) fs.writeFileSync(path.join(out, file), rewriteFile(file))
      precompress(distDir)
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, 'VITE_')
  const appUrl = (env.VITE_PAYKIT_APP_URL || 'http://127.0.0.1:5174').replace(/\/$/, '')
  return {
    plugins: [paykit(appUrl)],
    build: {
      // The prebuilt bundles live in public/assets; keep Vite's own output apart.
      assetsDir: '_paykit',
      modulePreload: { polyfill: false },
      chunkSizeWarningLimit: 4096,
    },
    server: { host: '127.0.0.1', port: 5176, strictPort: true },
    preview: { host: '127.0.0.1', port: 5176, strictPort: true },
  }
})
