import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Local stand-ins for the reference site's `/api/*` endpoints, so the landing page's
 * location line, view counts and "ask the cloud" panel work without a backend.
 * The ask endpoint streams a canned PayKit answer, then `§`, then follow-up questions split by `|`.
 */

const SEP = '§'

const answers: Array<{ match: RegExp; text: string; next: string[] }> = [
  {
    match: /gas|wbt|fee/i,
    text: 'Your customers never need WBT. They sign the payment, and the PayKit relayer submits it and pays the gas. The network fee is covered in USDT inside the same payment.',
    next: ['How do refunds work?', 'Where does the money go?'],
  },
  {
    match: /refund/i,
    text: 'A refund points at the original payment, so the USDT goes back to the wallet that paid. Merchants start it from their dashboard, and both sides see it in their history.',
    next: ['Can customers pay in parts?', 'Do my customers need WBT?'],
  },
  {
    match: /part|install|plan|subscri/i,
    text: 'Yes. A plan is agreed once onchain and each payment is collected on schedule. Customers see their upcoming payments in the app and can cancel what is left.',
    next: ['How do I add PayKit to my shop?', 'Where does the money go?'],
  },
  {
    match: /money|payout|wallet|merchant|domain/i,
    text: 'Straight to the merchant. USDT lands in a payout wallet that is verified against the merchant’s own domain, so a lookalike shop cannot redirect it.',
    next: ['How do refunds work?', 'How do I add PayKit to my shop?'],
  },
  {
    match: /react|next|npm|install|start|add|code|sdk/i,
    text: 'Run npm i @paykit/react, wrap your app in PayKitProvider, and drop in the components you need: a merchant grid, a cart, a checkout button or an invoice view. Next.js routes for webhooks come from @paykit/next.',
    next: ['Do my customers need WBT?', 'Can customers pay in parts?'],
  },
]

const fallback = {
  text: 'PayKit is an npm SDK and payment service for Whitechain. Customers pay in USDT with one signature and no gas, and merchants get paid straight to a verified wallet. Open the app from the bar to try a payment.',
  next: ['Do my customers need WBT?', 'How do I add PayKit to my shop?', 'Can customers pay in parts?'],
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => resolve(body))
    req.on('error', () => resolve(''))
  })
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}

/** Returns true when the request was an `/api/*` call it handled. */
export function handleApi(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? '/', 'http://local')
  if (!url.pathname.startsWith('/api/')) return false

  switch (url.pathname) {
    case '/api/where':
      json(res, 200, { city: 'Mumbai', country: 'IN', at: new Date().toISOString() })
      return true
    case '/api/session':
      json(res, 200, { signedIn: false })
      return true
    case '/api/views':
      json(res, 200, { views: 0 })
      return true
    case '/api/ask':
      void readBody(req).then(async (body) => {
        let question = ''
        try {
          question = String(JSON.parse(body).question ?? '')
        } catch {
          // empty question falls through to the general answer
        }
        const hit = answers.find((a) => a.match.test(question)) ?? fallback
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        for (const word of hit.text.split(/(?<= )/)) {
          res.write(word)
          await new Promise((r) => setTimeout(r, 18))
        }
        res.end(`${SEP}${hit.next.join('|')}`)
      })
      return true
    default:
      json(res, 404, { error: 'Not available in the local PayKit frontend.' })
      return true
  }
}
