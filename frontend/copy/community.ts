import fs from "node:fs"
import type { Rewrite } from "./rewrites.ts"

/**
 * Landing page layout changes:
 * - "Writing" (the stamp notes, "Build notes") and "Work" (product cards and clips) swap places.
 * - "Beyond code" drops the photo ring for a 3D pixel swarm (`swarm.js`) behind the same title,
 *   text and button.
 */
const LANDING = "landing-v73-iTotTP7r.js"
const swarm = fs.readFileSync(new URL("./swarm.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "")
  .replace("export default ", "")
  .trim()

export const community: Rewrite[] = [
  {
    file: LANDING,
    from: `const qn=[{id:"work",label:"Work"},{id:"values",label:"Values"},{id:"community",label:"Community"},{id:"writing",label:"Writing"},{id:"talk",label:"Small talk"}]`,
    to: `const qn=[{id:"writing",label:"Writing"},{id:"values",label:"Values"},{id:"work",label:"Work"},{id:"community",label:"Community"},{id:"talk",label:"Small talk"}]`,
  },
  {
    file: LANDING,
    from: `function ga(){return i.jsx(la,{id:"community-b-v9",panel:"Community B v9",layout:pe,engine:ma,photos:YA.photos,title:YA.title,dek:YA.dek,still:!0,action:yt,arrow:"swap",defaults:{drift:.16,spreadX:.9,spreadY:.66,blur:3,fade:.45}})}`,
    to: `const pkSwarm=${swarm};function ga(){const A="community-b-v9",d=YA.title,l=yt,f=j.useRef(null);j.useEffect(()=>f.current?pkSwarm(f.current):void 0,[]);return i.jsxs(ca,{className:"swap","aria-labelledby":A,children:[i.jsx("canvas",{ref:f,"aria-hidden":!0,style:{position:"absolute",inset:0,width:"100%",height:"100%",display:"block"}}),i.jsx("div",{className:"stage",style:{cursor:"default"},children:i.jsxs("div",{className:"centre",children:[i.jsxs("h2",{id:A,children:[i.jsx("span",{children:d[0]}),i.jsx("span",{children:d[1]})]}),i.jsx("p",{children:YA.dek}),i.jsxs("a",{className:"pills",href:de()&&l.route||l.href,children:[i.jsx("span",{className:"pill",children:l.label}),i.jsx("span",{className:"pill round","aria-hidden":!0,children:i.jsx(_A,{})})]})]})})]})}`,
  },
]
