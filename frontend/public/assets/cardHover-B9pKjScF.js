import{r as i}from"./site-Dg9eCcF_.js";import{a6 as s,a7 as a,a8 as c}from"./breakpoints-SSnuvaoo.js";function $(){!s.current&&a();const[e]=i.useState(c.current);return e}const r="cubic-bezier(0.77, 0, 0.175, 1)",t="@media (hover: hover) and (pointer: fine)",f=(e,o)=>`
  ${e} {
    position: relative;
    isolation: isolate;
    overflow: visible;
    background: none;
  }
  ${e}::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    background: ${o};
    transition: scale 300ms ${r};
  }
  ${t} {
    ${e}:hover:not(:active) {
      transform: none;
    }
    ${e}:hover::before {
      scale: 1.03;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    ${e}::before {
      transition: none;
    }
  }
`,m=(e,o,n)=>`
  ${o} {
    transition: scale 600ms ${r};
  }
  ${t} {
    ${e}:hover:not(:active)${n?` ${n}`:""} {
      transform: none;
    }
    ${e}:hover ${o} {
      scale: 1.06;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    ${o} {
      transition: none;
    }
  }
`;export{f,m,$ as u};
