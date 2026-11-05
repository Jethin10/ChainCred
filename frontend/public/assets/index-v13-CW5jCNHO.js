import{h as O,j as a,c as x,r as h,b as z}from"./site-Dg9eCcF_.js";import{V as A}from"./variant-c-v13-J5Qfn8TG.js";import{S as q}from"./nav-DNMzDr7r.js";import{N as M,s as V,a as D,n as F}from"./NoteStamp-DKHLVncr.js";import{ao as S,k as j}from"./variant-a-v2-Dmg3yc2O.js";import{a as w}from"./breakpoints-SSnuvaoo.js";import{B as I,a as T}from"./FieldStamp-WjoJZ0I3.js";import{c as W}from"./Popup-DYx9dekJ.js";import"./Sky-WzjW9JnK.js";import"./spread-LUUylR44.js";import"./CheckSmall-0qgsQKsx.js";import"./Sub-DeIb32jX.js";import"./leave-Bibdy01e.js";function B(i){let e=O.c(10),{message:c,action:d,onAction:o}=i,s;e[0]===c?s=e[1]:(s=a.jsx("p",{children:c}),e[0]=c,e[1]=s);let r;e[2]===d?r=e[3]:(r=a.jsx(S.Label,{children:d}),e[2]=d,e[3]=r);let p;e[4]!==o||e[5]!==r?(p=a.jsx(S,{kind:"faded",size:"sm",onClick:o,children:r}),e[4]=o,e[5]=r,e[6]=p):p=e[6];let f;return e[7]!==s||e[8]!==p?(f=a.jsxs(P,{children:[s,p]}),e[7]=s,e[8]=p,e[9]=f):f=e[9],f}var P=x("div",{target:"e1n6vrkj0"})({name:"11dqplc",styles:"margin:auto;display:grid;justify-items:center;gap:12px;p{color:var(--palette-b40);text-wrap:balance;text-align:center;}"});const Y=`
  --ink: var(--palette-b100);
  --paper: var(--palette-b0);
  --pill: var(--palette-b10);
  --pill-hover: color-mix(in srgb, var(--palette-b20) 45%, var(--pill));
  --rule: color-mix(in srgb, var(--ink) 15%, transparent);
  --muted: color-mix(in srgb, var(--ink) 45%, transparent);
  --ease: cubic-bezier(0.2, 0.715, 0.205, 0.99);
  --open: 500ms;
  --close: 260ms;
  --dim: 0.18;
  --screen: max(640px, 100svh);
  --card: color-mix(in srgb, var(--ink) 3%, var(--paper));

  position: relative;
  overflow-x: clip;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-site);

  & > header {
    position: fixed;
    z-index: 100;
    transition:
      opacity 200ms ease-out,
      transform 200ms ease-out;
  }
  &.bar-away > header:not(:focus-within) {
    visibility: hidden;
    opacity: 0;
    transform: translateY(-12px);
    pointer-events: none;
    transition:
      opacity 150ms ease-out,
      transform 150ms ease-out,
      visibility 0s 150ms;
  }
  & > .scrim {
    position: fixed;
    z-index: 99;
    inset: 0;
    background: var(--palette-b100);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--close) ease-out;
    &.open {
      opacity: var(--dim);
      transition-duration: var(--open);
    }
  }

  .footer {
    position: relative;
    height: var(--screen);
  }

  @media (prefers-reduced-motion: reduce) {
    & > header,
    &.bar-away > header:not(:focus-within) {
      transform: none;
    }
  }
`,m={desktop:4,tablet:3,mobile:2},_=3,E=(i,e)=>Math.max(_,Math.ceil(i/e))*e;function $(i){const e=Object.values(m),c=Math.max(...e.map(d=>E(i,d)));return Array.from({length:c-i},(d,o)=>e.filter(s=>i+o<E(i,s)))}function G({look:i,blank:e,children:c}){const d=h.useRef(null),o=h.Children.toArray(c);return h.useLayoutEffect(()=>{const s=d.current;if(!s)return;const r=()=>s.style.setProperty("--w",`${s.clientWidth/Number(getComputedStyle(s).getPropertyValue("--cols"))}px`),p=new ResizeObserver(r);return p.observe(s),()=>p.disconnect()},[]),a.jsxs(H,{ref:d,className:"sheet",children:[o.map((s,r)=>a.jsx("li",{className:"slot",children:s},r)),$(o.length).map((s,r)=>a.jsx("li",{className:"slot blank","data-cols":s.join(" "),"aria-hidden":!0,children:e??a.jsx(I,{look:i})},`blank-${r}`))]})}const H=x("ul",{target:"ej2s6le0"})("--cols:",m.desktop,';display:grid;grid-template-columns:repeat(var(--cols), minmax(0, 1fr));margin:0;padding:0;list-style:none;.slot{position:relative;}&>.blank:not([data-cols~="',m.desktop,'"]){display:none;}',w.tablet,"{--cols:",m.tablet,';&>.blank[data-cols~="',m.tablet,'"]{display:block;}&>.blank:not([data-cols~="',m.tablet,'"]){display:none;}}',w.mobile,"{--cols:",m.mobile,';&>.blank[data-cols~="',m.mobile,'"]{display:block;}&>.blank:not([data-cols~="',m.mobile,'"]){display:none;}}'),g=T,K={spread:0,speckle:0},U={pixel:24,revealMs:520,steps:6,wind:2};function J({notes:i,noteHref:e}){const c=h.useRef(null),d=h.useRef(!1),[o,s]=h.useState(null),r=t=>j.notes.findIndex(n=>n.slug===t),p=[...i].sort((t,n)=>t.date.localeCompare(n.date)),f=()=>{var t;return(t=c.current)==null?void 0:t.querySelectorAll("[data-armed]").forEach(n=>delete n.dataset.armed)};h.useEffect(()=>{const t=n=>{var l,u;(u=(l=n.target).closest)!=null&&u.call(l,".note")||f()};return document.addEventListener("pointerdown",t),()=>document.removeEventListener("pointerdown",t)},[]);const C=t=>{d.current=t.pointerType==="touch"},R=(t,n)=>{const l=n.currentTarget;if(d.current&&n.detail>0&&l.dataset.armed===void 0){n.preventDefault(),f(),l.dataset.armed="";return}if(r(t)<0)return;n.preventDefault();const u=l.querySelector(".stamp"),v=c.current;if(!u||!v)return;const k=v.getBoundingClientRect(),N=k.width/v.offsetWidth||1,b=u.getBoundingClientRect();f(),s({slug:t,pointer:n.detail>0,origin:{x:(b.left+b.width/2-k.left)/N,y:(b.top+b.height/2-k.top)/N,width:u.offsetWidth,turn:0}})},L=()=>{var u;const t=o==null?void 0:o.slug,n=o==null?void 0:o.pointer;z.flushSync(()=>s(null));const l=(u=c.current)==null?void 0:u.querySelector(`.note[data-slug="${t}"]`);if(l){if(n){l.dataset.quiet="";const v=()=>delete l.dataset.quiet;l.addEventListener("blur",v,{once:!0}),l.addEventListener("keydown",v,{once:!0})}l.focus({preventScroll:!0})}},y=o?r(o.slug):-1;return a.jsxs(Q,{ref:c,children:[a.jsx("h1",{className:"heading",children:"Taste Notes"}),a.jsx("div",{className:"content",inert:o!==null,children:i.length===0?a.jsx("div",{className:"empty",children:a.jsx(B,{message:"No notes published yet.",action:"Check again",onAction:()=>location.reload()})}):a.jsx(G,{look:g,children:p.map(t=>a.jsx("a",{className:"note",href:e(t.slug),"data-slug":t.slug,"data-open":(o==null?void 0:o.slug)===t.slug?"":void 0,"aria-haspopup":r(t.slug)<0?void 0:"dialog","aria-label":t.title,onPointerDown:C,onClick:n=>R(t.slug,n),children:a.jsx("span",{className:"lift",children:a.jsx(M,{slug:t.slug})})},t.slug))})}),o&&y>=0&&a.jsx(W,{note:j.notes[y],number:j.number(y),origin:o.origin,grain:K,look:g,dials:U,arrow:"swap",dateOnly:!0,href:e(o.slug),onClosed:L})]})}const Q=x("main",{target:"eyffkfw0"})("--section-bg:var(--palette-b0);--ink:var(--palette-b100);background:var(--palette-b0);&>.content{padding:128px var(--page-gutter) 120px;}.heading{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}.note{position:relative;display:block;color:inherit;text-decoration:none;-webkit-tap-highlight-color:transparent;}",V," .stamp.horse{aspect-ratio:",g.across,"/",g.down,';}.lift{display:block;transition:transform 100ms ease-out;}.note[data-open]{visibility:hidden;}ul.sheet>.slot>*{transition:filter 200ms ease-out,opacity 200ms ease-out;}ul.sheet:has(.note:is(:focus-visible, [data-armed]))>.slot:not(:has(.note:is(:focus-visible, [data-armed])))>*{filter:blur(4px);opacity:0.5;}.slot:has(.note:is(:hover, :focus-visible, [data-armed])){z-index:1;}.note:focus-visible,.note[data-armed]{outline:none;}.note:is(:focus-visible, [data-armed]) .lift{transform:translateY(-8px) scale(1.03);}.note:focus-visible .lift{outline:2px solid var(--ink);outline-offset:4px;}.note[data-quiet] .lift{outline:none;}@media (hover: hover) and (pointer: fine){.note:hover .lift{transform:translateY(-8px) scale(1.03);}.note:active .lift{transform:translateY(-4px) scale(0.99);}ul.sheet:has(.note:hover)>.slot:not(:has(.note:hover))>*{filter:blur(4px);opacity:0.5;}}&>[role="dialog"]{position:fixed;inset:0;z-index:200;}.empty{padding:48px 0 0;}@media (prefers-reduced-motion: reduce){.lift,ul.sheet>.slot>*{transition:none;}.note:is(:hover, :focus-visible, [data-armed]) .lift{transform:none;}}',w.mobile,"{&>.content{padding-top:96px;}}");function ue({noteHref:i=D}){return a.jsxs(X,{children:[a.jsx(J,{notes:F.map(e=>e.meta),noteHref:i}),a.jsx("div",{id:"contact",className:"footer",children:a.jsx(A,{})}),a.jsx(q,{current:"Writing"})]})}const X=x("div",{target:"e12ox6op0"})(Y,";");export{ue as default};
