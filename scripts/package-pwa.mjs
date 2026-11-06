// Build Output API v3 for deploying the PWA to its existing Vercel project.
import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '../web')
const output = path.join(root, '.vercel', 'output')
if (path.relative(root, output) !== path.join('.vercel', 'output')) throw new Error('Unexpected output directory')
fs.rmSync(output, { recursive: true, force: true })
fs.cpSync(path.join(root, 'dist'), path.join(output, 'static'), { recursive: true })
fs.writeFileSync(path.join(output, 'config.json'), JSON.stringify({ version: 3, routes: [
  { src: '^/sw\\.js$', headers: { 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' }, continue: true },
  { src: '^/manifest\\.webmanifest$', headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' }, continue: true },
  { src: '^/\\.well-known/assetlinks\\.json$', headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }, continue: true },
  { handle: 'filesystem' },
  { src: '/(.*)', dest: '/index.html' },
] }))
console.log('Packaged PayKit PWA')
