# PayKit on mobile

The existing app is also an installable PWA. It keeps the website's fonts and
pixel artwork, opens to the wallet on mobile, and adds bottom navigation,
QR scanning, installation controls, and a device privacy lock under Settings.

## Install and run

Build with `npm run build -w web`. Serve `web/dist` over HTTPS with the app at
the origin root. The existing app deployment can serve these files; there is
no separate mobile backend. For local testing, use
`npm run preview -w web -- --host 127.0.0.1 --port 4174` and open
`http://localhost:4174`. WebAuthn requires a hostname, rather than a numeric IP.

Android and supported desktop browsers offer Install app. On iPhone or iPad,
open the site in Safari, then Share → Add to Home Screen. Settings shows the
appropriate instructions when the browser does not expose an install prompt.

## Device unlock

Settings → Enable device unlock creates a platform WebAuthn credential with
required user verification. The device can use fingerprint, face recognition,
or its PIN. PayKit never receives biometric data. Unlock checks a fresh random
challenge, origin, RP ID hash, presence and verification flags, and an ECDSA
signature against the saved public key. The app locks on reload and after
more than a minute in the background. Disabling the lock requires verification.

This is a local privacy gate, not a wallet key vault or server authentication
mechanism. Wallet payment signatures and merchant authentication remain separate.
The public credential is stored in this origin's local storage. Clearing site
data resets the local lock and requires reconnecting the wallet. On mobile
browsers without an injected wallet, Connect opens the same page in MetaMask's
mobile browser; it does not silently sign or submit payments.

## QR and offline behavior

Scan accepts a camera feed, an uploaded QR image, or a pasted PayKit invoice ID
or link. Camera permission is requested only after Enable camera. Camera tracks
stop when the scanner closes or the page is hidden. Supported cameras offer a
flashlight control. Decoding runs locally, with a bundled worker fallback for
browsers without native barcode detection. A decoded QR opens a review step,
never a payment authorization or an arbitrary URL.

The build emits a versioned service worker containing the exact app assets,
fonts, manifest, and icons. This lets the app reopen offline. No API response,
merchant credential, payment write, or transaction queue is cached. Balances
and invoice status still require connectivity. An available update is applied
only after the user chooses Update app.

## Checks

- `npm run build -w web`
- `npm run lint -w web`
- `npm run test:mobile -w web`
- `node scripts/generate-pwa-icons.mjs` regenerates the native pixel icons.

Device-unlock tests sign real Web Crypto challenges and reject altered origins,
challenges, verification flags, and signatures. Browser QA uses a virtual
platform authenticator; fingerprint/face prompts and installation still depend
on the physical device and browser.

References: [WebAuthn](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API),
[QR scanner](https://github.com/nimiq/qr-scanner),
[PWA installation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable),
[MetaMask mobile links](https://github.com/MetaMask/metamask-docs/blob/main/metamask-connect/evm/guides/metamask-exclusive/use-deeplinks.md).
