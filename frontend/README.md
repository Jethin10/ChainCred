# PayKit landing page

A 1:1 clone of [andreas.vision](https://andreas.vision/) with PayKit's copy. It runs on the reference site's
original production bundles, so the layout, sky canvas, globe, scroll motion, hovers and the "ask the cloud"
panel are the real thing. Only the words, links and brand change.

```bash
cd frontend
npm install
npm run dev        # http://127.0.0.1:5176
npm run build      # builds to frontend/dist (with .br and .gz precompressed)
npm run preview    # serves the build
```

| Path | What |
|---|---|
| `copy/rewrites.ts` | Every copy, link and brand change, as exact replacements on the bundles. The build fails if one stops matching. |
| `copy/perf.ts` | Performance patches that change no pixel or timing (the landing page no longer prefetches the reference site's other pages). |
| `copy/api.ts` | Local stand-ins for the site's `/api/*` calls (location, views, a canned PayKit "ask the cloud"). |
| `index.html` | PayKit meta, and the script that sends `/app/<page>` links into the PayKit app. |
| `public/` | The reference's assets (fonts, images, videos, JS chunks) mirrored from the live site, plus PayKit icons and OG image. |

CTAs open the PayKit app at `VITE_PAYKIT_APP_URL` (default `http://127.0.0.1:5174`), on the page in the
hash: `/#shops`, `/#invoice`, `/#me` or `/#merchant`. Set it in `frontend/.env` for another host.
