import type { Rewrite } from "./rewrites.ts"

/**
 * Performance patches on the page bundles. Each one removes work the page throws away
 * and leaves every animation's timing and every pixel unchanged.
 */
export const perf: Rewrite[] = [
  // The router warmed every route once the page went idle, about 1.6 MB of JavaScript for pages
  // that redirect into the ChainCred app. Only the landing page is warmed now.
  {
    file: "site-Dg9eCcF_.js",
    from: "const q=Object.keys(Yn).filter(M=>!hi.has(M))",
    to: 'const q=Object.keys(Yn).filter(M=>M==="/"&&!hi.has(M))',
  },
]
