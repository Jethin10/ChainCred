import type { Rewrite } from "./rewrites.ts"

/**
 * Performance patches on the reference bundles. Each one removes work the page throws away
 * and leaves every animation's timing and every pixel unchanged.
 */
export const perf: Rewrite[] = [
  // The router warms every route of the reference site once the page goes idle: Notes (1.3 MB),
  // About, Play and the case studies. Here those routes redirect into the PayKit app, so the
  // download and parse were pure waste. Only the landing page is kept.
  {
    file: "site-Dg9eCcF_.js",
    from: "const q=Object.keys(Yn).filter(M=>!hi.has(M))",
    to: 'const q=Object.keys(Yn).filter(M=>M==="/"&&!hi.has(M))',
  },
]
