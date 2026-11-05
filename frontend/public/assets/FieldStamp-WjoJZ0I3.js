import{j as a,r as v,w as O,c as P}from"./site-Dg9eCcF_.js";import{m as le,h as _,f as R,i as j,t as S,l as B,n as ce,s as A,g as oe,j as I}from"./spread-LUUylR44.js";const T={hues:{wayfinding:"teal",interaction:"blue",culture:"orange",pen:"purple"},ink:72,ground:38},pe={across:16,down:23,border:1.25,hole:.38,cellsPerPitch:3,lettering:"sans",shadow:"paper",print:"halftone",inks:T},de={...pe,shadow:"none",paper:"flat",title:.32,inks:{hues:{wayfinding:"orange",interaction:"blue",culture:"pink",pen:"purple"},ink:100,ground:30}},G={...de,lettering:"davinci",titleSize:11},Oe={...G,print:"field",field:{words:"tab",graphic:"bleed",icon:!1},inks:{...G.inks,rotation:["blue","orange","pink","green"]}},Pe=e=>({...e,down:e.across}),K={masthead:{share:.8,cap:24},split:{share:.74,cap:26},band:{share:.62,cap:17}};function Ae({note:e,layout:n,tucked:t=!1,bare:s=!1}){const i=e.date.slice(0,4),l=a.jsx("span",{className:"title","data-fit":K[n].share,"data-cap":K[n].cap,children:e.legend.lines.map(o=>a.jsx("span",{className:"line",children:o},o))});return s?n==="band"?a.jsx("span",{className:"band",children:l}):t?a.jsx("span",{className:"head",children:l}):l:n==="band"?a.jsxs(a.Fragment,{children:[a.jsx("span",{className:"small kicker",children:e.legend.kicker}),a.jsx("span",{className:"small year",children:i}),a.jsx("span",{className:"band",children:l})]}):n==="masthead"&&t?a.jsxs("span",{className:"head",children:[l,a.jsxs("span",{className:"small under",children:[a.jsx("span",{children:e.legend.kicker}),a.jsx("span",{children:i})]})]}):a.jsxs(a.Fragment,{children:[l,n==="masthead"?a.jsxs("span",{className:"small foot",children:[a.jsx("span",{className:"line",children:e.legend.kicker}),a.jsx("span",{className:"line",children:i})]}):a.jsxs(a.Fragment,{children:[a.jsx("span",{className:"small kicker",children:e.legend.kicker}),a.jsx("span",{className:"small year",children:i})]})]})}function J(e){for(const n of e.querySelectorAll("[data-fit]")){n.style.fontSize="100px";const t=Math.max(...[...n.querySelectorAll(".line")].map(s=>s.offsetWidth));n.style.fontSize=`${Math.min(1e4*Number(n.dataset.fit)/t,Number(n.dataset.cap))}cqi`}e.dataset.fitted=""}function Ie(e,n){const t=e.offsetWidth/n;return[...e.querySelectorAll(".title .line, .small")].filter(s=>!s.closest(".band")).map(s=>{let i=s.offsetLeft,l=s.offsetTop;for(let o=s.offsetParent;o&&o!==e;o=o.offsetParent)i+=o.offsetLeft,l+=o.offsetTop;return{x:i/t,y:l/t,w:s.offsetWidth/t,h:s.offsetHeight/t}})}const Te=`
  .art {
    container-type: inline-size;
  }
  .legend {
    visibility: hidden;
  }
  .art[data-fitted] .legend {
    visibility: visible;
  }
  .title {
    position: absolute;
    left: 7cqi;
    font-family: var(--font-site-highlight);
    font-style: italic;
    font-weight: 400;
    font-size: 16cqi;
    line-height: 0.9;
  }
  .line {
    display: block;
    width: fit-content;
    white-space: nowrap;
  }
  .small {
    position: absolute;
    font-size: 5.4cqi;
    font-weight: 500;
    line-height: 1.15;
    text-transform: uppercase;
    font-variant-numeric: tabular-nums;
  }
  .kicker {
    top: 6cqi;
    left: 7cqi;
  }
  .year {
    top: 6cqi;
    right: 7cqi;
  }

  &.legend-masthead .title {
    top: 6cqi;
  }
  &.legend-masthead .foot {
    right: 7cqi;
    bottom: 6cqi;
    text-align: right;
  }
  &.legend-masthead .foot .line {
    margin-left: auto;
  }

  &.legend-masthead .head {
    position: absolute;
    top: 6cqi;
    left: 7cqi;
  }
  &.legend-masthead .head .title {
    position: static;
  }
  .under {
    position: static;
    display: flex;
    gap: 3.2cqi;
    width: fit-content;
    margin-top: 3cqi;
  }

  &.legend-split .title {
    bottom: 7cqi;
  }

  /* The band is the stamp's own paper showing through, with its tooth. */
  &.legend-band .band {
    position: absolute;
    inset: auto 0 0;
    padding: 5cqi 7cqi 6cqi;
    background: var(--postal-paper) var(--postal-grain) center / 180px;
  }
  &.legend-band .band .title {
    position: static;
  }
`,m=(e,n,t="b0")=>`color-mix(in srgb, var(--palette-${e}) ${n}%, var(--palette-${t}))`,M=m("yellow-light",14),Q={dusk:{paper:M,deep:m("blue",46,"b60"),mid:m("blue-light",58),pale:M,warm:m("pink-light",62),fresh:m("green",38),ink:m("blue",50,"b80")},sage:{paper:M,deep:m("green",30,"b60"),mid:m("blue-light",44),pale:M,warm:m("red-light",58),fresh:m("orange-light",48),ink:m("green",34,"b80")}},he={dusk:{paper:"var(--palette-b0)",deep:"var(--palette-blue)",mid:"var(--palette-blue-light)",pale:"var(--palette-b0)",warm:m("red-light",72),fresh:m("yellow",42),ink:m("blue",45,"b80")},sage:{paper:"var(--palette-b0)",deep:"var(--palette-blue)",mid:"var(--palette-blue-light)",pale:"var(--palette-b0)",warm:m("orange-light",70),fresh:m("yellow-light",55),ink:m("blue",45,"b80")}},fe=Object.keys(Q.dusk),D=(e,n)=>Object.keys(e).map(t=>`&${n}.tone-${t} { ${fe.map(s=>`--postal-${s}: ${e[t][s]};`).join(" ")} }`).join(`
  `),ge=["--postal-deep","--postal-mid","--postal-pale","--postal-warm","--postal-fresh"],ue=`
  ${D(Q,"")}
  ${D(he,".sky")}
  &.riso {
    --postal-mid: color-mix(in srgb, var(--postal-deep) 42%, var(--postal-paper));
    --postal-fresh: color-mix(in srgb, var(--postal-warm) 60%, var(--postal-paper));
    --postal-ink: var(--postal-deep);
  }
`,C=["--ink-paper","--ink-night","--ink-blue","--ink-sky","--ink-mist","--ink-red","--ink-coral","--ink-blush","--ink-leaf"],Z=C.map(e=>e.replace("--ink-","--paint-")),u=(e,n,t)=>`color-mix(in srgb, var(--palette-${e}) ${n}%, var(--palette-${t}))`,me=`
  --ink-paper: var(--palette-b0);
  --ink-night: ${u("blue",30,"b80")};
  --ink-blue: color-mix(in srgb, ${u("blue",70,"purple")} 72%, var(--palette-b80));
  --ink-sky: ${u("blue",74,"b40")};
  --ink-mist: ${u("blue-light",55,"b0")};
  --ink-red: ${u("red",82,"b80")};
  --ink-coral: var(--palette-red-light);
  --ink-blush: ${u("red-light",45,"b0")};
  --ink-leaf: ${u("green",30,"b80")};
  --sky-deep: var(--palette-blue);
  --sky-mid: var(--palette-blue-light);
  --sky-pale: var(--palette-b0);
  --sky-pink: var(--palette-pink-light);
  --sky-yellow: var(--palette-yellow);
  ${Z.map((e,n)=>`${e}: var(${C[n]});`).join(`
  `)}
  ${ue}

  /* Yellow and orange carry the print, with the blue kept for the darks so it sits beside the hero. */
  &.palette-sun {
    --paint-night: ${u("blue",40,"b80")};
    --paint-blue: ${u("orange",88,"b80")};
    --paint-sky: var(--palette-orange);
    --paint-mist: ${u("yellow",70,"b0")};
    --paint-red: var(--palette-blue);
    --paint-coral: var(--palette-yellow);
    --paint-blush: ${u("yellow",38,"b0")};
    --paint-leaf: ${u("orange",40,"b80")};
  }
  /* Green and yellow, with pink for the lights so the coral of the first stamp echoes. */
  &.palette-garden {
    --paint-night: ${u("green",35,"b80")};
    --paint-blue: ${u("green",80,"b80")};
    --paint-sky: var(--palette-green);
    --paint-mist: ${u("yellow",55,"b0")};
    --paint-red: ${u("pink",85,"b80")};
    --paint-coral: var(--palette-pink-light);
    --paint-blush: ${u("pink-light",45,"b0")};
    --paint-leaf: ${u("blue",35,"b80")};
  }
`,be=2.2,ve=e=>({cols:Math.round((e.across-2*e.border)*e.cellsPerPitch),rows:Math.round((e.down-2*e.border)*e.cellsPerPitch)}),Y=new Map;function xe(e){let n=Y.get(e);if(!n){const t=new Image;t.fetchPriority="low",t.src=e,n=t.decode().then(()=>t),Y.set(e,n)}return n}function F(e){const[n,t]=v.useState(null);return v.useEffect(()=>{let s=!0;return xe(e).then(i=>s&&t(i)),()=>{s=!1}},[e]),n}function we(e,n,t,s,i,l,o=!1,p="dither"){const d=o?le(_(n,s,i),s,i):_(n,s,i),f=o?s*2:s,c={seed:R(t),...l};if(p==="sky"||p==="halftone"||p==="field")return{printed:S(d,f,i,c),colours:j(e,["--sky-deep","--sky-mid","--sky-pale"]).map(r=>r.colour),sky:!0};if(p==="postal")return{printed:B(d,S(d,f,i,c)),colours:j(e,ge).map(r=>r.colour),sky:!0};if(p==="accent")return{printed:B(d,S(d,f,i,c)),colours:j(e,["--sky-deep","--sky-mid","--sky-pale","--sky-pink","--sky-yellow"]).map(r=>r.colour),sky:!0};const g=j(e,C);return{printed:ce(d,f,i,g.map(r=>r.rgb),c),colours:j(e,Z).map(r=>r.colour),sky:!1}}function ye(e,{colours:n,sky:t},s){if(!t)return n;const[i,l,o,...p]=n;return[...A(e,{deep:i,mid:l,pale:o},s),...p]}function ke(e,n){const t=e.offsetWidth/n,s=(c,g,r,h)=>({x:c/t,y:g/t,w:r/t,h:h/t}),i=[...e.querySelectorAll(".number, .date")].map(c=>s(c.offsetLeft,c.offsetTop,c.offsetWidth,c.offsetHeight)),l=e.querySelector(".lettering");if(!l)return i;const o=document.createRange();o.selectNodeContents(l);const p=l.getBoundingClientRect(),d=[];for(const c of[...o.getClientRects()].sort((g,r)=>g.top-r.top)){const g=c.top+c.height/2,r=d[d.length-1];r&&g-r.middle<c.height/2?r.right=Math.max(r.right,c.right):d.push({middle:g,right:c.right})}const f=l.offsetHeight/Math.max(1,d.length);return d.forEach((c,g)=>i.push(s(l.offsetLeft,l.offsetTop+g*f,(c.right-p.left)/p.width*l.offsetWidth,f))),i}function Ce({note:e,number:n,grain:t,look:s,cover:i=e.cover,palette:l="coral"}){const o=v.useRef(null),p=v.useRef(null),d=v.useRef(null),f=F(i),[c,g]=v.useState(null);return v.useEffect(()=>{const r=o.current,h=p.current;if(!f||!r||!h)return;let b=!0,y=()=>{};const w=ve(s);return document.fonts.ready.then(()=>{b&&(y=O(()=>{const x=we(r,f,e.slug,w.cols,w.rows,t,!1,s.print);g(x.sky?{...x,printed:oe(x.printed,ke(h,w.cols),1,R(e.slug))}:x)}))}),()=>{b=!1,y()}},[f,e.slug,t.spread,t.speckle,s,l]),v.useEffect(()=>{const r=d.current;if(!r||!c)return;const h=()=>{const y=Math.max(1,Math.round(r.clientWidth*devicePixelRatio/c.printed.cols));r.width=c.printed.cols*y,r.height=c.printed.rows*y;const w=r.getContext("2d");I(w,c.printed,ye(w,c,Math.max(1,Math.round(be*devicePixelRatio))),y)},b=new ResizeObserver(h);return b.observe(r),()=>b.disconnect()},[c]),a.jsxs(L,{ref:o,className:`lettering-${s.lettering} shadow-${s.shadow} palette-${l} print-${s.print??"dither"}`,style:{"--across":s.across,"--down":s.down,"--border":s.border,"--hole":s.hole},"aria-hidden":!0,children:[a.jsx("span",{className:"sheet",children:a.jsx("span",{className:"paper"})}),a.jsxs("span",{ref:p,className:"art",children:[a.jsx("canvas",{ref:d}),a.jsx("span",{className:"lettering",children:s.lettering==="line"?e.stamp:e.title}),a.jsx("span",{className:"number",children:String(n).padStart(2,"0")}),a.jsxs("span",{className:"date",children:[e.date.slice(5,7),"/",e.date.slice(0,4)]})]})]})}const U=`
      radial-gradient(circle at center, transparent calc(var(--pitch) * var(--hole)), black calc(var(--pitch) * var(--hole) + 0.5px)) calc(var(--pitch) / -2) calc(var(--pitch) / -2) / var(--pitch) var(--pitch) repeat,
      linear-gradient(black, black) center / calc(100% - var(--pitch)) calc(100% - var(--pitch)) no-repeat`,L=P("span",{target:"etlsmr50"})(me," --pitch:calc(var(--w, 280px) / var(--across));position:relative;display:block;width:var(--w, 280px);height:calc(var(--pitch) * var(--down));font-size:calc(var(--w, 280px) * 0.046);text-align:left;.sheet{position:absolute;inset:0;filter:drop-shadow(0 1px 1px color-mix(in srgb, var(--palette-b100) 10%, transparent)) drop-shadow(0 10px 20px color-mix(in srgb, var(--palette-b100) 10%, transparent));}.paper{position:absolute;inset:0;background:var(--ink-paper);mask:",U,";}.art{position:absolute;inset:calc(var(--pitch) * var(--border));overflow:hidden;background:var(--paint-blush);color:var(--ink-paper);}&.print-sky .art,&.print-accent .art{background:var(--sky-mid);color:var(--palette-b100);}canvas{display:block;width:100%;height:100%;image-rendering:pixelated;}.lettering{position:absolute;top:0.8em;left:0.85em;right:2.6em;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;font-weight:500;line-height:1.15;text-wrap:balance;}&.lettering-davinci .lettering,&.lettering-line .lettering{top:0.7em;left:0.8em;right:2.4em;font-family:var(--font-site-highlight);font-style:italic;font-weight:400;font-size:1.6em;line-height:1;-webkit-line-clamp:4;}&.lettering-sans .lettering{font-size:1.45em;line-height:1.08;-webkit-line-clamp:2;}&.lettering-line .lettering{font-size:2.2em;line-height:0.95;-webkit-line-clamp:2;}&.shadow-stamp{filter:drop-shadow(0 1px 1px color-mix(in srgb, var(--palette-b100) 10%, transparent)) drop-shadow(0 10px 20px color-mix(in srgb, var(--palette-b100) 10%, transparent));}&.shadow-stamp .sheet{filter:none;}.number,.date{position:absolute;font-weight:500;font-variant-numeric:tabular-nums;}.number{top:0.8em;right:0.85em;}.date{right:0.85em;bottom:0.7em;}"),W={wayfinding:{shape:"tiles"},interaction:{shape:"ring"},culture:{shape:"bars"},pen:{shape:"plus"}},je=e=>e in W,X=e=>{const n=e.legend.kicker.toLowerCase();return je(n)?n:"interaction"},ee=(e,n,t)=>{const i=`var(--palette-${e.rotation&&t?e.rotation[(t-1)%e.rotation.length]:e.hues[n]})`;return{ground:`color-mix(in srgb, ${i} ${e.ground}%, var(--palette-b0))`,ink:e.ink===100?i:`color-mix(in srgb, ${i} ${e.ink}%, var(--palette-b100))`}};function te(e,n,t){const s=document.createElement("canvas");s.width=s.height=n;const i=s.getContext("2d",{willReadFrequently:!0}),l=Math.min(e.naturalWidth,e.naturalHeight),o=(e.naturalWidth-l)/2,p=Math.min(e.naturalHeight-l,Math.max(0,t*e.naturalHeight-l/2));return i.imageSmoothingQuality="high",i.drawImage(e,o,p,l,l,0,0,n,n),i.getImageData(0,0,n,n).data}const Ne="/assets/paper-DJqsFqdZ.webp",$e=e=>Math.round((e.across-2*e.border)*e.cellsPerPitch),Se=.3,qe=13,E={tiles:"M0 0h4.4v4.4H0zM5.6 0H10v4.4H5.6zM0 5.6h4.4V10H0zM5.6 5.6H10V10H5.6z",ring:"M5 0a5 5 0 1 1 0 10A5 5 0 0 1 5 0zm0 2.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z",bars:"M0 0h2.2v10H0zM3.9 0h2.2v10H3.9zM7.8 0H10v10H7.8z",plus:"M3.6 0h2.8v3.6H10v2.8H6.4V10H3.6V6.4H0V3.6h3.6z"};function Fe({look:e}){return a.jsxs(ae,{className:`blank shadow-${e.shadow} paper-${e.paper??"grain"}`,style:{"--across":e.across,"--down":e.down,"--border":e.border,"--hole":e.hole},"aria-hidden":!0,children:[a.jsx("span",{className:"sheet",children:a.jsx("span",{className:"paper"})}),e.paper==="flat"?null:a.jsx("span",{className:"grain"})]})}function Le({note:e,number:n,look:t,cover:s=e.cover}){const i=v.useRef(null),l=v.useRef(null),o=F(s),p=X(e),{shape:d}=W[p],f=e.legend.lines.join(" ").split(/\s+/);v.useEffect(()=>{let r=!0;return document.fonts.ready.then(()=>r&&i.current&&J(i.current)),()=>{r=!1}},[e.slug]),v.useEffect(()=>{const r=i.current,h=l.current;if(!o||!r||!h)return;let b;const y=O(()=>{const[,w,,x]=e.subject,k=$e(t),q=S(te(o,k,w+x/2),k,k,{seed:R(e.slug),spread:0,speckle:0}),[N,H,z]=j(r,["--halftone-ink","--halftone-ground","--halftone-paper"]).map($=>$.colour),re=()=>{const $=Math.max(1,Math.round(h.clientWidth*devicePixelRatio/k));if(h.width===k*$)return;h.width=h.height=k*$;const V=h.getContext("2d");I(V,q,A(V,{deep:N,mid:H,pale:z},Math.max(1,Math.round($/3))),$),r.dataset.printed=""};b=new ResizeObserver(re),b.observe(h)});return()=>{y(),b==null||b.disconnect()}},[o,e.slug,e.subject,t]);const{ground:c,ink:g}=ee(t.inks??T,p,n);return a.jsxs(ae,{ref:i,className:`category-${p} shadow-${t.shadow} paper-${t.paper??"grain"} lettering-${t.lettering}`,style:{"--across":t.across,"--down":t.down,"--border":t.border,"--hole":t.hole,"--halftone-ground":c,"--halftone-ink":g},"aria-hidden":!0,children:[a.jsx("span",{className:"sheet",children:a.jsx("span",{className:"paper"})}),a.jsx("span",{className:"title","data-fit":t.title??Se,"data-cap":t.titleSize??qe,children:f.map((r,h)=>a.jsx("span",{className:"line",children:r},h))}),a.jsx("span",{className:"issued",children:e.date.slice(0,7)}),a.jsx("svg",{className:"shape",viewBox:"0 0 10 10","data-shape":d,children:a.jsx("path",{d:E[d],fillRule:"evenodd"})}),a.jsx("span",{className:"count",children:String(n).padStart(2,"0")}),a.jsx("span",{className:"art",children:a.jsx("canvas",{ref:l})}),t.paper==="flat"?null:a.jsx("span",{className:"grain"})]})}const ze=.9,ae=P(L,{target:"e15e2a7e0"})("container-type:inline-size;font-family:var(--font-site);&>*{--pitch:calc(100cqi / var(--across));--edge:calc(var(--pitch) * var(--border));}--halftone-paper:var(--palette-b0);&.paper-flat{--halftone-paper:var(--palette-b10);}.paper{background:var(--halftone-paper);}.title{position:absolute;top:calc(var(--edge) + var(--pitch) * 0.2);left:calc(var(--edge) + var(--pitch) * 0.1);display:flex;flex-direction:column;align-items:flex-start;font-size:8cqi;font-weight:500;line-height:0.92;text-transform:uppercase;color:var(--palette-b100);}&.lettering-davinci .title{font-family:var(--font-site-highlight);font-style:italic;font-weight:400;line-height:0.9;text-transform:none;}.line{display:inline-block;white-space:nowrap;}.issued{position:absolute;top:calc(var(--edge) + var(--pitch) * 0.2);left:50%;translate:-50% 0;font-size:2.6cqi;line-height:1;color:var(--palette-b40);font-variant-numeric:tabular-nums;}.shape{position:absolute;top:calc(var(--edge) + var(--pitch) * 0.2);right:var(--edge);width:9cqi;height:9cqi;fill:var(--halftone-ink);}.count{position:absolute;right:calc(var(--edge) - 0.04em);bottom:calc(var(--edge) + 100cqi - var(--edge) * 2 + var(--pitch) * 0.35);font-size:15cqi;font-weight:500;line-height:0.74;color:var(--halftone-ink);font-variant-numeric:tabular-nums;}.art{inset:auto var(--edge) var(--edge);aspect-ratio:1;background:var(--halftone-ground);}&.shadow-none .sheet{filter:none;}.grain{position:absolute;inset:0;background:url(",Ne,") 0 0/",ze*100,"cqi;mix-blend-mode:multiply;pointer-events:none;mask:",U,";}");function Me(e,n,t,s,i,l){v.useEffect(()=>{const o=e.current,p=n.current;if(!t||!o||!p)return;let d;const f=O(()=>{const[,c,,g]=s.subject,r=S(te(t,i,c+g/2),i,i,{seed:R(s.slug),spread:0,speckle:0}),[h,b,y]=j(o,["--halftone-ink","--halftone-ground","--halftone-paper"]).map(x=>x.colour),w=()=>{const x=Math.max(1,Math.round(p.clientWidth*devicePixelRatio/i));if(p.width===i*x)return;p.width=p.height=i*x;const k=p.getContext("2d");I(k,r,A(k,{deep:h,mid:b,pale:y},Math.max(1,Math.round(x/3))),x),o.dataset.printed=""};d=new ResizeObserver(w),d.observe(p)});return()=>{f(),d==null||d.disconnect()}},[e,n,t,s.slug,s.subject,i,l])}const ne=e=>e.across,Re={field:.6,tab:.78},se=e=>({"--across":e.across,"--down":e.down,"--border":e.border,"--hole":e.hole});function We({look:e}){return a.jsx(ie,{className:`blank${e.down>ne(e)?" tab":""}`,style:se(e),"aria-hidden":!0,children:a.jsx("span",{className:"sheet",children:a.jsx("span",{className:"paper"})})})}function Ve({note:e,number:n,look:t,words:s=(o=>(o=t.field)==null?void 0:o.words)()??"field",graphic:i=(p=>(p=t.field)==null?void 0:p.graphic)()??"sign",icon:l=(d=>(d=t.field)==null?void 0:d.icon)()??!0}){const f=v.useRef(null),c=v.useRef(null),g=F(e.cover),r=X(e),{shape:h}=W[r],b=i==="bleed"?1:Re[s],y=Math.round((t.across-2*t.border)*b*t.cellsPerPitch),w=t.down>ne(t);Me(f,c,g,e,y,t),v.useEffect(()=>{let N=!0;return document.fonts.ready.then(()=>N&&f.current&&J(f.current)),()=>{N=!1}},[e.slug]);const{ground:x,ink:k}=ee(t.inks??T,r,n),q=(N,H)=>a.jsx("span",{className:"title","data-fit":N,"data-cap":H,children:e.legend.lines.map(z=>a.jsx("span",{className:"line",children:z},z))});return a.jsxs(ie,{ref:f,className:`category-${r}${w?" tab":""} words-${s}`,style:{...se(t),"--halftone-ground":x,"--halftone-ink":k,"--sign":b},"aria-hidden":!0,children:[a.jsx("span",{className:"sheet",children:a.jsx("span",{className:"paper"})}),a.jsxs("span",{className:"field",children:[a.jsx("span",{className:"sign",children:a.jsx("canvas",{ref:c})}),s==="field"?a.jsxs(a.Fragment,{children:[q(.6,t.titleSize??11),a.jsx("span",{className:"count",children:String(n).padStart(2,"0")}),a.jsx("span",{className:"issued",children:e.date.slice(0,7)})]}):null]}),w&&s==="tab"?a.jsxs("span",{className:"words",children:[a.jsxs("span",{className:"told",children:[a.jsx("span",{className:"issued",children:e.date.slice(0,7)}),q(.42,8)]}),a.jsx("span",{className:"count",children:String(n).padStart(2,"0")}),l?a.jsx("svg",{className:"shape",viewBox:"0 0 10 10","data-shape":h,children:a.jsx("path",{d:E[h],fillRule:"evenodd"})}):null]}):null,w&&s==="field"?a.jsxs("span",{className:"legend",children:[a.jsx("span",{className:"kicker",children:e.legend.kicker}),a.jsx("svg",{className:"shape",viewBox:"0 0 10 10","data-shape":h,children:a.jsx("path",{d:E[h],fillRule:"evenodd"})})]}):null]})}const ie=P(L,{target:"e1i53wnt0"})({name:"1egyfri",styles:"container-type:inline-size;font-family:var(--font-site);--halftone-paper:var(--palette-b10);&>*{--pitch:calc(100cqi / var(--across));--edge:calc(var(--pitch) * var(--border));}.sheet{filter:none;}.paper{background:var(--halftone-paper);}&.tab .sheet{--row:calc(var(--pitch) * var(--across));mask:linear-gradient(black, black) top/100% calc(var(--row) - var(--pitch) / 2) no-repeat,linear-gradient(black, black) bottom/100% calc(100% - var(--row) - var(--pitch) / 2) no-repeat,radial-gradient(circle at center, transparent calc(var(--pitch) * var(--hole)), black calc(var(--pitch) * var(--hole) + 0.5px)) calc(var(--pitch) / -2) calc(var(--row) - var(--pitch) / 2)/var(--pitch) var(--pitch) repeat-x;}.field{position:absolute;top:var(--edge);left:var(--edge);right:var(--edge);aspect-ratio:1;background:var(--halftone-ink);color:var(--halftone-paper);}.sign{position:absolute;bottom:0;left:calc((1 - var(--sign)) * 50%);width:calc(var(--sign) * 100%);aspect-ratio:1;background:var(--halftone-ground);}.field .title{position:absolute;top:calc(var(--pitch) * 0.6);left:calc(var(--pitch) * 0.7);display:flex;flex-direction:column;align-items:flex-start;font-family:var(--font-site-highlight);font-style:italic;font-size:11cqi;line-height:0.9;}.line{display:inline-block;white-space:nowrap;}.field .count{position:absolute;left:calc(var(--pitch) * 0.6);bottom:calc(var(--pitch) * 0.6);font-size:10cqi;font-weight:400;letter-spacing:-0.03em;line-height:0.74;font-variant-numeric:tabular-nums;}.field .issued{position:absolute;left:calc(100% - var(--pitch) * 0.7 - 1em);top:calc(100% - var(--pitch) * 0.6);transform-origin:0 0;rotate:-90deg;white-space:nowrap;font-size:3.6cqi;font-weight:500;line-height:1;font-variant-numeric:tabular-nums;}.title{display:flex;flex-direction:column;align-items:flex-start;font-family:var(--font-site-highlight);font-style:italic;line-height:0.9;}.words{position:absolute;left:var(--edge);right:var(--edge);bottom:var(--edge);display:flex;align-items:flex-end;gap:calc(var(--pitch) * 0.5);color:var(--halftone-ink);}.told{display:flex;flex-direction:column;gap:calc(var(--pitch) * 0.35);margin-right:auto;}.words .issued{font-size:3.2cqi;font-weight:500;line-height:1;font-variant-numeric:tabular-nums;}.words .title{font-size:9cqi;}.words .count{font-size:12cqi;font-weight:400;letter-spacing:-0.03em;line-height:0.74;font-variant-numeric:tabular-nums;}.legend{position:absolute;right:var(--edge);bottom:var(--edge);display:flex;align-items:flex-end;gap:calc(var(--pitch) * 0.5);}.kicker{font-size:5.5cqi;font-weight:500;line-height:0.74;color:var(--halftone-ink);}.shape{flex:none;width:calc(var(--pitch) * 3.5);height:calc(var(--pitch) * 3.5);fill:var(--halftone-ink);}"});export{Fe as B,Ve as F,Le as H,T as I,Ce as S,Oe as a,Pe as b,ke as c,Ae as d,ye as e,J as f,ve as g,L as h,Te as i,be as j,ee as k,Ie as l,X as m,xe as n,me as o,we as p,We as q,je as r,ue as t,F as u};
