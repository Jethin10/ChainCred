# PayKit landing page

The PayKit landing page: sky hero, product cards, the "how it works" globe story, build notes, FAQ with
"ask the cloud", and calls to action that open the PayKit app.

```bash
cd frontend
npm install
npm run dev        # http://127.0.0.1:5176
npm run build      # builds to frontend/dist (with .br and .gz precompressed)
npm run preview    # serves the build
```

| Path | What |
|---|---|
| `copy/rewrites.ts` | Every word, link and brand change, as exact replacements on the bundles. The build fails if one stops matching. |
| `copy/perf.ts` | Performance patches that change no pixel or timing. |
| `copy/api.ts` | Local stand-ins for the page's `/api/*` calls (location, views, a canned PayKit "ask the cloud"). |
| `index.html` | PayKit meta, and the script that sends `/app/<page>` links into the PayKit app. |
| `public/` | Fonts, images, videos, prebuilt JS chunks, PayKit icons and OG image. |

CTAs open the PayKit app at `VITE_PAYKIT_APP_URL` (default `http://127.0.0.1:5174`), on the page in the
hash: `/#components`, `/#shops`, `/#invoice`, `/#me` or `/#merchant`. Set it in `frontend/.env` for another host.
