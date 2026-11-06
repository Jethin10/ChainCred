import fs from "node:fs"
import type { Rewrite } from "./rewrites.ts"

/**
 * Footer: the big hatched horse is replaced by a giant "PayKit" wordmark in the same blue hatch,
 * with the scroll-driven rise-and-lock in `wordmark.js`.
 */
const FOOTER = "variant-c-v13-J5Qfn8TG.js"
const script = fs
  .readFileSync(new URL("./wordmark.js", import.meta.url), "utf8")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace("export default ", "")
  .trim()

const ease = "cubic-bezier(0.22, 1, 0.36, 1)"
const css = [
  "& .pk-mark{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:stretch;overflow:hidden;padding:0 var(--page-gutter);color:var(--ink);}",
  "& .pk-mark-meta{display:flex;justify-content:space-between;gap:24px;padding:16px 0 0;border-top:1px solid color-mix(in srgb, var(--ink) 14%, transparent);font-size:13px;font-weight:500;letter-spacing:0.01em;opacity:0.55;}",
  "& .pk-mark-word{display:flex;align-self:center;font-family:'Inter Tight', var(--font-site), sans-serif;font-style:normal;font-weight:800;font-size:26vw;line-height:0.96;letter-spacing:-0.02em;margin:0.02em 0 0.2em;white-space:nowrap;will-change:transform;user-select:none;font-kerning:normal;}",
  "& .pk-mark-mask{display:block;clip-path:inset(-0.3em -0.5em 0 -0.5em);padding-bottom:0.24em;margin-bottom:-0.24em;}",
  `& .pk-mark-letter{display:block;color:var(--ink);will-change:transform;translate:0 0;transition:color 420ms ${ease}, translate 420ms ${ease};}`,
  "& .pk-mark-letter[data-hot]{color:var(--palette-blue);translate:0 -4%;}",
].join("")

const mark = `function PkMark(){const r=O.useRef(null);O.useEffect(()=>r.current?pkWordmark(r.current):void 0,[]);return b.jsx("div",{ref:r,className:"pk-mark","aria-hidden":!0,children:[b.jsxs("div",{className:"pk-mark-meta",children:[b.jsx("span",{children:"© 2026 PayKit"}),b.jsx("span",{children:"Gasless USDT checkout for Whitechain"}),b.jsx("span",{children:"Built at ETHGlobal Mumbai"})]}),b.jsx("div",{className:"pk-mark-word","data-pk-word":!0,children:"PayKit".split("").map((c,i)=>b.jsx("span",{className:"pk-mark-mask",children:b.jsx("span",{className:"pk-mark-letter","data-pk-letter":!0,children:c})},i))})]})}`

export const footer: Rewrite[] = [
  {
    file: FOOTER,
    from: `const ge=.85,de=24;function ye(`,
    to: `const pkWordmark=${script};${mark}const ge=.85,de=24;function ye(`,
  },
  {
    file: FOOTER,
    from: `b.jsx("canvas",{ref:a,className:"site-footer-horse","aria-hidden":!0})`,
    to: `b.jsx(PkMark,{})`,
  },
  {
    file: FOOTER,
    from: `& .site-footer-horse{position:absolute;inset:0;width:100%;height:100%;}`,
    to: css,
  },
]
