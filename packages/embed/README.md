# PayKit embed

`openCheckout({ invoiceId, server, onPaid })` opens checkout on the current page.
The shop creates its invoice on the server. MetaMask connects on the shop's
origin, signs the USDT authorization, and PayKit settles and saves the receipt.
`onPaid` receives the verified payment result before the dialog closes.

For a local presentation, pass `demo: true` and `demoInvoice` with `amount`,
`amountDue`, `reference`, and `merchant.name`. MetaMask still connects, but Pay
completes locally without signing or submitting a USDT authorization. The host
saves the result with its local order. This does not create an onchain payment,
award onchain points, or change a server invoice's payment status.

The example stores default to this presentation flow. You can also set
`VITE_PAYKIT_DEMO_MODE=true` in `stores/.env.local` explicitly.
Set it to `false` and rebuild to restore real invoice payment. The flag also
works as an environment variable for `node stores/build.mjs <store>`.

Run `npm test -w @paykit/embed` for checkout regression tests.
