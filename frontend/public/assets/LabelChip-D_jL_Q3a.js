import{bH as z,bI as q}from"./variant-a-v2-Dmg3yc2O.js";import{h as H,r as S,j as r,c as o}from"./site-Dg9eCcF_.js";import{u as F}from"./cardHover-B9pKjScF.js";import{m as K,y as D,Y as L}from"./breakpoints-SSnuvaoo.js";import O from"./Close-85Oo5fWc.js";function re(j){let e=H.c(38),{label:c,options:t,value:v,onChange:m,disabled:i}=j,s=S.useId(),x=S.useRef(null),u=F(),d;if(e[0]!==t||e[1]!==v){let a;e[3]===v?a=e[4]:(a=l=>l.value===v,e[3]=v,e[4]=a),d=t.findIndex(a),e[0]=t,e[1]=v,e[2]=d}else d=e[2];let n=Math.max(0,d),p;e[5]!==m||e[6]!==t?(p=a=>m(t[a].value),e[5]=m,e[6]=t,e[7]=p):p=e[7];let b=p,k;e[8]!==n||e[9]!==i||e[10]!==t.length||e[11]!==b?(k=a=>{var E,I;let l=t.length-1,h={ArrowRight:n===l?0:n+1,ArrowDown:n===l?0:n+1,ArrowLeft:n===0?l:n-1,ArrowUp:n===0?l:n-1,Home:0,End:l};if(i||!(a.key in h))return;a.preventDefault();let N=h[a.key];b(N),(I=(E=x.current)==null?void 0:E.querySelectorAll("button")[N])==null||I.focus()},e[8]=n,e[9]=i,e[10]=t.length,e[11]=b,e[12]=k):k=e[12];let $=k,R=!!i,f;e[13]===R?f=e[14]:(f=z({disabled:R}),e[13]=R,e[14]=f);let g;e[15]===c?g=e[16]:(g=r.jsx(T,{children:c}),e[15]=c,e[16]=g);let w;if(e[17]!==s||e[18]!==n||e[19]!==i||e[20]!==t||e[21]!==b||e[22]!==u){let a;e[24]!==s||e[25]!==n||e[26]!==i||e[27]!==b||e[28]!==u?(a=(l,h)=>r.jsxs(X,{type:"button",role:"radio","aria-checked":h===n,tabIndex:h===n?0:-1,disabled:i,className:z({picked:h===n}),"data-sound":"list",onClick:()=>b(h),children:[h===n&&r.jsx(Y,{layoutId:s,transition:u?{duration:0}:q.snap}),r.jsx("span",{children:l.label})]},l.value),e[24]=s,e[25]=n,e[26]=i,e[27]=b,e[28]=u,e[29]=a):a=e[29],w=t.map(a),e[17]=s,e[18]=n,e[19]=i,e[20]=t,e[21]=b,e[22]=u,e[23]=w}else w=e[23];let y;e[30]!==c||e[31]!==$||e[32]!==w?(y=r.jsx(U,{ref:x,role:"radiogroup","aria-label":c,onKeyDown:$,children:w}),e[30]=c,e[31]=$,e[32]=w,e[33]=y):y=e[33];let C;return e[34]!==f||e[35]!==g||e[36]!==y?(C=r.jsxs(P,{className:f,children:[g,y]}),e[34]=f,e[35]=g,e[36]=y,e[37]=C):C=e[37],C}var P=o("div",{target:"e1vjtdtd4"})({name:"oc7gi7",styles:"display:flex;align-items:center;justify-content:space-between;gap:var(--spacing-sm);height:36px;padding:0 4px 0 12px;border-radius:var(--radius-md);background:var(--tab-hover);color:var(--palette-b60);font-size:var(--font-size-md);font-weight:500;&.disabled{opacity:0.5;}"}),T=o("span",{target:"e1vjtdtd3"})({name:"vs3vs1",styles:"min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}),U=o("div",{target:"e1vjtdtd2"})({name:"edsg9b",styles:"display:flex;flex-shrink:0;gap:2px"}),X=o("button",{target:"e1vjtdtd1"})({name:"3aypnh",styles:"position:relative;height:28px;padding:0 10px;border:0;border-radius:calc(var(--radius-md) - 2px);background:transparent;color:inherit;font:inherit;cursor:pointer;outline:none;transition:color 0.15s;>span:last-child{position:relative;}&:hover:not(:disabled),&.picked{color:var(--palette-b100);}&:focus-visible{box-shadow:0 0 0 1.5px var(--line-active);}&:disabled{cursor:default;}"}),Y=o(K.span,{target:"e1vjtdtd0"})({name:"1um54uh",styles:"position:absolute;inset:0;border-radius:inherit;background:var(--line-hover)"});L({Close:O});function te({label:j,color:e="b60",size:c="sm",active:t,keepCase:v,swatch:m,icon:i,onClick:s,href:x,onRemove:u}){let d={"--label-color":`var(--palette-${e})`},n=z(c,{interactive:!!(s||x),active:!!t,"keep-case":!!v}),p=r.jsxs(r.Fragment,{children:[m&&r.jsx(J,{"aria-hidden":!0,style:{background:m}}),i&&r.jsx(D,{name:i,size:12,style:{position:"relative",flexShrink:0}}),j&&r.jsx(Q,{children:j})]});return u?r.jsxs(M,{className:z(n,"removable"),style:d,children:[p,r.jsx(V,{type:"button","aria-label":`Remove ${j}`,onClick:u,children:r.jsx(D,{name:"Close",size:10})})]}):x?r.jsx(G,{href:x,className:n,style:d,"aria-current":t?"page":void 0,onClick:s,children:p}):s?r.jsx(B,{type:"button",className:n,style:d,"aria-pressed":t,onClick:s,children:p}):r.jsx(M,{className:n,style:d,children:p})}var A=`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  max-width: 160px;
  padding: 0 6px;
  border: none;
  background: none;
  color: var(--label-color);
  font-size: 12px;
  font-weight: 500;
  text-transform: capitalize;
  user-select: none;
  &::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: var(--radius-xs);
    background: var(--label-color);
    opacity: 0.06;
    transition: opacity 0.1s ease;
  }
  &.md {
    gap: 6px;
    height: 24px;
    padding: 0 8px;
    font-size: 13px;
    &::before {
      border-radius: var(--radius-sm);
    }
  }
  &.lg {
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    font-size: 13px;
    &::before {
      border-radius: var(--radius-sm);
    }
  }
  &.interactive {
    cursor: pointer;
    &:hover::before,
    &:focus-visible::before,
    &:active::before {
      opacity: 0.15;
    }
    &:focus-visible {
      outline: 1.5px solid var(--line-active);
      outline-offset: 1px;
      border-radius: var(--radius-xs);
    }
  }
  &.active::before {
    opacity: 0.15;
  }
  /* Room for Close is always inside the tint, so the chip never changes width. At rest the
     label sits centred across it; on hover it slides back as Close scales in. */
  &.removable {
    padding-right: 4px;
    > span:not([aria-hidden]) {
      transform: translateX(7px);
      transition: transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);
    }
  }
  &.removable:hover,
  &.removable:focus-within {
    &::before {
      opacity: 0.15;
    }
    > span:not([aria-hidden]) {
      transform: none;
      transition-duration: 0.2s;
    }
  }
  &.keep-case {
    max-width: 100%;
    text-transform: none;
  }
`,M=o("span",{target:"ebi1wwa0"})(A),B=o("button",{target:"ebi1wwa0"})(A),G=o("a",{target:"ebi1wwa0"})(A),J=o("span",{target:"e1h7jvwa1"})({name:"1y8pqns",styles:"position:relative;flex-shrink:0;width:8px;height:8px;border-radius:var(--radius-round);box-shadow:0 0 0 1px var(--line-faded)"}),Q=o("span",{target:"ebi1wwa1"})({name:"8wfnra",styles:"position:relative;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"}),V=o("button",{target:"e1h7jvwa0"})({name:"wvr98a",styles:"position:relative;display:grid;place-items:center;width:14px;height:14px;margin-left:-2px;padding:0;border:none;border-radius:var(--radius-xs);background:none;color:var(--label-color);opacity:0;transform:scale(0.6);cursor:pointer;transition:opacity 0.12s cubic-bezier(0.22, 1, 0.36, 1),transform 0.12s cubic-bezier(0.22, 1, 0.36, 1);.removable:hover>&,.removable:focus-within>&{opacity:1;transform:none;transition-duration:0.2s;}&:hover{background:color-mix(in srgb, var(--label-color) 15%, transparent);}&:focus-visible{outline:1.5px solid var(--line-active);}@media (prefers-reduced-motion: reduce){transform:none;transition:opacity 0.12s ease-out;.removable>span{transform:none;}}"});export{re as d,te as l};
