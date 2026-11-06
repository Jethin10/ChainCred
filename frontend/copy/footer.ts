import type { Rewrite } from "./rewrites.ts"

/**
 * Footer: just the links and clocks. The template's big hatched horse (and the full-screen
 * area it filled) is removed, so the page ends where the footer content ends.
 */
const FOOTER = "variant-c-v13-J5Qfn8TG.js"

export const footer: Rewrite[] = [
  {
    file: FOOTER,
    from: `b.jsx("canvas",{ref:a,className:"site-footer-horse","aria-hidden":!0})`,
    to: `null`,
  },
]
