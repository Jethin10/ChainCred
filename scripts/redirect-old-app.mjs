// The PayKit app now lives inside the landing site at /app/. This packages the old paykit-app
// project as a permanent redirect there; browsers keep the #fragment, so old pay links
// (…/#pay/<invoiceId>) and QR codes still open the right invoice.
//   node scripts/redirect-old-app.mjs && cd web && vercel deploy --prebuilt --prod
import fs from 'node:fs'
import path from 'node:path'

const SITE = process.env.PAYKIT_SITE_URL || 'https://paykit-landing-one.vercel.app'
const out = path.resolve(import.meta.dirname, '../web/.vercel/output')
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(path.join(out, 'static'), { recursive: true })
fs.writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify({ version: 3, routes: [{ src: '^/(.*)$', status: 308, headers: { Location: `${SITE}/app/` } }] }),
)
console.log(`paykit-app → ${SITE}/app/`)
