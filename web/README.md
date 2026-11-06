# PayKit app

The SDK showcase and app pages: SDK components (`#components`), Shops, Invoice, Payments and Merchant.
It uses the landing page's design: pixel-dithered sky, Da Vinci italic headings, Geist text, Chicago pixel labels
and black pill buttons. The fonts are in `public/fonts`, the theme is in `src/index.css`, and the sky
canvas and page transition are in `src/theme/pixels.tsx`.

```sh
npm run server:demo   # PayKit API on :8787, simulated chain, demo shops
npm run dev           # this app on :5174; /v1 is proxied to the API
npm run frontend      # landing page on :5176; its CTAs open this app
```

When the API answers `/v1/status`, the app uses it and the top bar shows **Live API**. Otherwise it falls
back to an in-browser mock. Click the badge to switch. Set `VITE_PAYKIT_API_URL` to use another API, or
`PAYKIT_API_PROXY` to proxy somewhere other than `http://127.0.0.1:8787`. `VITE_PAYKIT_SITE_URL` sets
where Home links (default `http://127.0.0.1:5176`).
