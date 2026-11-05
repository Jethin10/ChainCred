var v=Object.defineProperty;var g=(l,e,t)=>e in l?v(l,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):l[e]=t;var r=(l,e,t)=>g(l,typeof e!="symbol"?e+"":e,t);import{W as m,S as w,V as p,M as x,a as b,O as y,P as M,I as k,T as L,L as q,b as z}from"./three.module-C5p5fRFw.js";const C=6,O=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,P=`
uniform sampler2D map;
uniform float opacity;
uniform vec2 size;
uniform float corner;
uniform vec2 crop;
uniform float blur;
varying vec2 vUv;
void main() {
  vec2 q = abs((vUv - 0.5) * size) - size * 0.5 + corner;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
  float edge = fwidth(d) * 0.5;
  vec2 uv = (vUv - 0.5) * crop + 0.5;
  vec4 colour = texture2D(map, uv);
  if (blur > 0.01) {
    vec2 step = blur / size * crop;
    float bias = log2(1.0 + blur);
    colour = colour * 0.2;
    for (int k = 0; k < 8; k++) {
      float a = float(k) * 0.785398;
      colour += texture2D(map, uv + vec2(cos(a), sin(a)) * step, bias) * 0.1;
    }
  }
  gl_FragColor = vec4(colour.rgb, opacity * (1.0 - smoothstep(-edge, edge, d)));
}`;class f{constructor(e,t,i,s){r(this,"renderer");r(this,"scene",new b);r(this,"camera",new y(-1,1,1,-1,-10,10));r(this,"plane",new M(1,1));r(this,"copy");r(this,"cards");r(this,"room",{width:0,height:0});r(this,"queue");r(this,"loading",0);r(this,"failed",!1);r(this,"lost",!1);r(this,"gone",!1);r(this,"loader",new k().setOptions({imageOrientation:"flipY",premultiplyAlpha:"none"}));r(this,"loseContext",e=>{e.preventDefault(),this.lost=!0});this.back=e,this.front=t,this.photos=i,this.options=s;const h=e.getContext("2d");if(!h)throw new Error("No 2D context");this.copy=h,this.renderer=new m({canvas:t,antialias:!1,alpha:!0,powerPreference:"high-performance"}),this.renderer.setClearColor(0,0),this.cards=i.map(()=>{const n=new w({vertexShader:O,fragmentShader:P,transparent:!0,depthTest:!1,depthWrite:!1,uniforms:{map:{value:null},opacity:{value:0},size:{value:new p(1,1)},corner:{value:0},crop:{value:new p(1,1)},blur:{value:0}}}),o=new x(this.plane,n);return o.visible=!1,this.scene.add(o),{mesh:o,texture:null,aspect:1}}),this.queue=i.map((n,o)=>o),this.load(),t.addEventListener("webglcontextlost",this.loseContext)}static create(e,t,i,s){try{return new f(e,t,i,s)}catch{return null}}paint(e,t){if(this.lost)return!1;(t.width!==this.room.width||t.height!==this.room.height)&&this.resize(t);const i=this.options.corner();return e.map((h,n)=>n).sort((h,n)=>e[h].depth-e[n].depth).forEach((h,n)=>{const o=this.cards[h],a=e[h],{mesh:d}=o;d.position.set(a.x,-a.y,0),d.scale.set(a.width*a.scale,a.height*a.scale,1),d.renderOrder=n;const{uniforms:c}=d.material;c.opacity.value=o.texture?a.opacity:0,c.size.value.set(a.width*a.scale,a.height*a.scale),c.corner.value=i*a.scale,c.blur.value=a.blur;const u=a.width/a.height;c.crop.value.set(Math.min(1,u/o.aspect),Math.min(1,o.aspect/u))}),this.draw(e,!1),this.copy.clearRect(0,0,this.back.width,this.back.height),this.copy.drawImage(this.front,0,0),this.draw(e,!0),!0}dispose(){this.gone=!0,this.front.removeEventListener("webglcontextlost",this.loseContext),this.cards.forEach(e=>{var t,i,s;(t=e.texture)==null||t.dispose(),(s=(i=e.texture)==null?void 0:i.image)==null||s.close(),e.mesh.material.dispose()}),this.plane.dispose(),this.renderer.dispose()}draw(e,t){this.cards.forEach((i,s)=>i.mesh.visible=e[s].front===t&&e[s].opacity>.01),this.renderer.render(this.scene,this.camera)}resize(e){this.room=e;const t=Math.min(devicePixelRatio,2);this.renderer.setPixelRatio(t),this.renderer.setSize(e.width,e.height,!1),this.back.width=Math.round(e.width*t),this.back.height=Math.round(e.height*t),Object.assign(this.camera,{left:-e.width/2,right:e.width/2,top:e.height/2,bottom:-e.height/2}),this.camera.updateProjectionMatrix()}load(){for(;this.loading<C&&this.queue.length&&!this.gone;){const e=this.queue.shift();this.loading+=1;const t=()=>{this.loading-=1,!this.loading&&!this.queue.length&&!this.gone&&!this.failed&&this.options.onLoaded(),this.load()};this.loader.load(this.photos[e],i=>{if(this.gone)return i.close();const s=new L(i);s.minFilter=q,s.magFilter=z,s.flipY=!1,s.needsUpdate=!0,this.cards[e].texture=s,this.cards[e].mesh.material.uniforms.map.value=s,this.cards[e].aspect=i.width/i.height,t()},void 0,()=>{this.failed=!0,t()})}}}export{f as Ring};
