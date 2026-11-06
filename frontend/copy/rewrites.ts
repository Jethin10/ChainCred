/**
 * PayKit copy for the landing page.
 *
 * The page runs on prebuilt production bundles (in `public/assets`). Every word, link and
 * brand change lives here. The Vite plugin in `vite.config.ts` applies these replacements
 * when it serves or builds the bundles, and fails loudly if a `from` string is missing, so a
 * rebuilt bundle can't silently drop our copy.
 *
 * Paths starting with `/app/` are routed into the PayKit app by the script in `index.html`
 * (`/app/shops` opens the app's Shops page, and so on).
 */

export type Rewrite = {
  file: string
  from: string
  to: string
  /** Replace every occurrence instead of requiring exactly one. */
  all?: boolean
}

const VA = "variant-a-v2-Dmg3yc2O.js"
const VC = "variant-c-v13-J5Qfn8TG.js"
const SITE = "site-Dg9eCcF_.js"
const LANDING = "landing-v73-iTotTP7r.js"
const COVER = "Cover-DFWfJMPG.js"
const ASK = "AskPanel-B56q9v-_.js"

const q = (s: string | readonly string[]) => JSON.stringify(s)

export const rewrites: Rewrite[] = [
  // ── Page title and description ───────────────────────────────────────────
  {
    file: SITE,
    from: `"/":{title:"Andreas Kruszakin, growth-focused design engineer in Europe",description:"I'm Andreas, a growth-focused design engineer who is design first and builds the system underneath. I make founders' products easy to get, so customers buy and investors say yes, which so far has meant £1.4M raised for Neos and $172M for Schneider Electric."`,
    to: `"/":{title:${q('PayKit, gasless USDT checkout for Whitechain')},description:${q('PayKit is an npm SDK and payment service for Whitechain. Customers pay in USDT with one signature and never need WBT for gas, and merchants get paid straight to a verified wallet.')}`,
  },

  // ── Hero ─────────────────────────────────────────────────────────────────
  {
    file: VA,
    from: `y3={before:"Designer who ships with vision",after:{lead:"Design",rest:"Engineer who ships growth"},bio:"I'm Andreas, making precise, joyful interfaces and the tools to build them, from first sketch to production so that your team ships and your business grows."}`,
    to: `y3={before:${q('Loyalty that ships with checkout')},after:{lead:${q('Gasless')},rest:${q('USDT checkout for shops')}},bio:${q('PayKit lets any shop take USDT on Whitechain in a few lines of React. Customers sign once, never need WBT for gas, and you get paid straight to your wallet.')}}`,
  },

  // ── Nav, footer links and the main call to action ───────────────────────
  { file: VA, from: `Ge={name:"Andreas",`, to: `Ge={name:"PayKit",` },
  // Navbar brand: the app's pixel PayKit mark and the wordmark (same as the app's navbar), not the horse.
  {
    file: VA,
    from: 't?k.jsx(F4,{size:22,beatMs:t}):k.jsx(Mi,{size:22}),!s&&k.jsx("span",{children:Ge.name})',
    to: 'k.jsxs("svg",{className:"pk-mark",viewBox:"0 0 8 8",width:22,height:22,"aria-hidden":!0,shapeRendering:"crispEdges",children:[k.jsx("path",{d:"M2 0h4v1h1v1h1v4h-1v1h-1v1h-4v-1h-1v-1h-1v-4h1v-1h1z",fill:"#0a0a0a"}),k.jsx("path",{d:"M3 2h2v1h1v1h-1v1h-1v1h-1z",fill:"#7ccfff"})]}),k.jsx("span",{className:"pk-word",children:Ge.name})',
  },
  {
    file: VA,
    from: `links:[{label:"Work",href:"#work",note:"Case studies, each naming a call"},{label:"About",href:"#about",route:"/about",note:"The story and four values"},{label:"Writing",href:"#writing",route:"/notes",note:"Taste notes"},{label:"Play",href:"#play",route:"/play",note:"Experiments and tools"}],email:{label:"Email",href:\`mailto:\${Nn}\`},action:{label:"Book a call",href:"https://i.cal.com/andreas/design-chat"},socials:[{label:"LinkedIn",href:"https://www.linkedin.com/in/andreaskruszakin/"},{label:"X",href:"https://x.com/andreaskruszaki"},{label:"GitHub",href:"https://github.com/andreaskruszakin"},{label:"Instagram",href:"https://www.instagram.com/andreas_kruszakin/"}]}`,
    to: `links:[{label:"SDK",href:"/app/components",route:"/app/components",note:${q('The SDK: copyable React components')}},{label:"Shops",href:"/app/shops",route:"/app/shops",note:${q('Verified merchants, paid in USDT')}},{label:"Wallet",href:"/app/wallet",route:"/app/wallet",note:${q('Your invoices, receipts and points')}},{label:"Merchant",href:"/app/merchant",route:"/app/merchant",note:${q('Sign up and get paid')}}],email:{label:"Invoice",href:"/app/invoice"},action:{label:"Open the app",href:"/app/shops"},socials:[{label:"Shops",href:"/app/shops"},{label:"Invoice",href:"/app/invoice"},{label:"Payments",href:"/app/me"},{label:"Merchant",href:"/app/merchant"}]}`,
  },
  {
    file: VC,
    from: `signature:"Andreas Kruszakin-Liboska",email:{label:$.email.href.replace("mailto:",""),href:$.email.href}`,
    to: `signature:${q('PayKit, USDT on Whitechain')},email:{label:${q('npm i @paykit/react')},href:"/app/components"}`,
  },
  {
    file: VC,
    from: `zones:[{city:"Wrocław",country:"PL",tz:"Europe/Warsaw"},{city:"The Hague",country:"NL",tz:"Europe/Amsterdam",here:!0},{city:"San Francisco",country:"US",tz:"America/Los_Angeles"}]`,
    to: `zones:[{city:"Mumbai",country:"IN",tz:"Asia/Kolkata",here:!0},{city:"Dubai",country:"AE",tz:"Asia/Dubai"},{city:"London",country:"GB",tz:"Europe/London"}]`,
  },

  // ── Work: the two product cards ─────────────────────────────────────────
  {
    file: LANDING,
    from: `Ae={kicker:"Cheval Studio, my own prototyping tool",title:"Product prototyping made 90% faster and more traceable for teamwork",tags:["Design tool","Design engineering","AI"]}`,
    to: `Ae={kicker:${q('@paykit/react, drop-in commerce components')},title:${q('Checkout, carts and receipts added to any shop in twenty lines')},tags:["SDK","React","Gasless"]}`,
  },
  {
    file: COVER,
    from: `kicker:"Schneider Electric, ADIPEC",title:"A dashboard redesign that made $172M in 3 weeks"`,
    to: `kicker:${q('PayKit merchant dashboard')},title:${q('One dashboard for sales, refunds and installment plans')}`,
  },
  {
    file: COVER,
    from: `tags:["Product design","Data visualisation","Energy"]`,
    to: `tags:["Merchants","Dashboard","USDT"]`,
  },
  { file: LANDING, from: `hrefOf:A=>It(Kn[A])`, to: `hrefOf:A=>"/app/"+(A==="schneider"?"merchant":"shops")` },

  // ── Work: our own media (recorded from the live product, motion made in-house) ──
  // The two big cards play real recordings instead of the template's mock UIs.
  {
    file: LANDING,
    from: `media:i.jsx(Bt,{mock:"canvas",still:!0})`,
    to: `media:i.jsx("video",{className:"block",src:"/assets/paykit-sdk-checkout.mp4",poster:"/assets/paykit-sdk-checkout.webp",autoPlay:!0,muted:!0,loop:!0,playsInline:!0,preload:"metadata","aria-label":${q('The PayKit checkout component paying an order: press and hold, sign, relay, settle')},style:{width:"100%",height:"100%",objectFit:"cover",display:"block"}})`,
  },
  {
    file: LANDING,
    from: `media:i.jsx(Ct,{screen:"sld",look:"operator",label:IA.cover.alt})`,
    to: `media:i.jsx("video",{className:"block",src:"/assets/paykit-dashboard.mp4",poster:"/assets/paykit-dashboard.webp",autoPlay:!0,muted:!0,loop:!0,playsInline:!0,preload:"metadata","aria-label":${q('The PayKit merchant dashboard: sales, payouts and refunds')},style:{width:"100%",height:"100%",objectFit:"cover",display:"block"}})`,
  },
  // A tile's last argument may be a full link (ours) instead of a post id (the template's).
  {
    file: VA,
    from: 'post:`https://x.com/andreaskruszaki/status/${i}`',
    to: 'post:/^(https?:|\\/)/.test(i)?i:`https://x.com/andreaskruszaki/status/${i}`',
  },
  ...([
    [`I("graph-ui","A graph for org-wide access","Interface","interface",1.53,"2083492433615094084")`, 'graph-ui', 'One signature in, USDT out', 'Relayer', 'animation', '/app/components'],
    [`I("hue-picker","A hue picker","Interaction","interface",1.86,"2073833531864682896")`, 'hue-picker', 'Settled on Whitechain', 'Chain', 'animation', 'https://explorer.testnet.whitechain.io'],
    [`I("dia-folders","Changing folder icons on Dia","Interface","interface",.91,"2085261870122832233")`, 'dia-folders', 'Checkout inside the shop', 'Embed', 'interface', 'https://kettle-and-leaf-five.vercel.app'],
    [`I("radial-menu","A radial menu","Interaction","interface",1.48,"2061704114640433520")`, 'radial-menu', 'USDT, no gas needed', 'Token', 'animation', '/app/wallet'],
    [`I("ceramics","A ceramic collection","3D","animation",1.64,"2092911749708325221")`, 'ceramics', 'Points that travel between shops', 'Loyalty', 'animation', '/app/shops'],
    [`I("idea-forest","Idea Forest, a forest for your ideas","Interface","interface",1.5,"2061346759960625152")`, 'idea-forest', 'The PayKit app, in pixels', 'Mobile', 'interface', '/app/wallet'],
    [`I("fluid-cd-player","A fluid CD player","Interaction","interface",1.68,"2079167183444197800")`, 'fluid-cd-player', 'Pay anyone, anywhere', 'Network', 'animation', '/app/shops'],
    [`I("cursor-traffic-lights","What if Cursor had traffic lights?","Interface","interface",.75,"2060993935023976772")`, 'cursor-traffic-lights', 'From signature to settlement', 'EIP-3009', 'animation', '/app/components'],
    [`I("pr-elevator","What if every PR was an elevator stop?","Interaction","interface",1.53,"2072207574754062722")`, 'pr-elevator', 'One command for your coding agent', 'CLI', 'interface', 'https://www.npmjs.com/package/usepaykit'],
    [`I("voxel-clock","A voxel clock in heerich.js","3D","animation",1.59,"2071486322074886613")`, 'voxel-clock', 'Merchant sign-up in two minutes', 'Merchants', 'interface', '/app/merchant'],
    [`I("gooey-ui","Make gooey UI great again","Interaction","interface",1.3,"2075881281536356743")`, 'gooey-ui', 'Webhooks you can verify', 'Webhooks', 'interface', 'https://www.npmjs.com/package/usepaykit'],
    [`I("waveform","Waveform UI","Interaction","interface",1.59,"2057731437730873766")`, 'waveform', 'Shops that take USDT', 'Directory', 'interface', '/app/shops'],
    [`I("mosaic-brand","Mosaic brand","Generative","animation",1.35,"2106193384465662313")`, 'mosaic-brand', 'Checkout inside the shop', 'Embed', 'interface', 'https://kettle-and-leaf-five.vercel.app'],
    [`I("smart-light","A smart home light","Interaction","interface",1.68,"2087822213399347527")`, 'smart-light', 'From signature to settlement', 'EIP-3009', 'animation', '/app/components'],
    [`I("json-menu","Cursor's JSON menu, for real","Interface","interface",1.48,"2050312160387944504")`, 'json-menu', 'One signature in, USDT out', 'Relayer', 'animation', '/app/components'],
    [`I("vibes-piano","npm i vibes","Interaction","interface",1.49,"2051920851113541647")`, 'vibes-piano', 'Points that travel between shops', 'Loyalty', 'animation', '/app/shops'],
  ] as const).map(([from, id, title, kind, category, link]): Rewrite => ({
    file: VA,
    from,
    to: `I(${q(id)},${q(title)},${q(kind)},${q(category)},1.5,${q(link)})`,
  })),

  // ── Built to move (globe story) ─────────────────────────────────────────
  {
    file: VA,
    from: `Fo={action:{label:"How I design"},motion:{title:"Built to move.",body:"Like the horse, I work best in motion. With the teams I work with, I find the clear way through and build the tools that get us there. Here's how that crossing works."},motionTitleV21:"Built to move",title:"How I design"`,
    to: `Fo={action:{label:"How it works"},motion:{title:"Built to move.",body:${q("Like the horse, money works best in motion. The customer signs once, our relayer pays the gas, and USDT lands in the merchant's wallet. Here's how that crossing works.")}},motionTitleV21:"Built to move",title:"How it works"`,
  },
  {
    file: VA,
    from: `$i=[{lines:["Every project starts like stepping into a running river.","A founder hands you a stream of ideas and goals, all moving at once. Most of them matter. But only one makes a difference.","My first job is finding the one clear way through, the path everyone sees the moment someone points at it. That's the vision part: listening, asking the right questions, and saying a few polite no's."]}`,
    to: `$i=[{lines:${q([
      "Every payment starts like stepping into a running river.",
      "A customer wants to pay in USDT, but the chain wants WBT for gas, and most people don't hold any. That's where most checkouts lose them.",
      "So we found the one clear way through: the customer signs once, and the PayKit relayer submits the transaction and pays the gas. That's the vision part: one token, one signature, no detours.",
    ])}}`,
  },
  {
    file: VA,
    from: `{lines:["Then I cut.","Once the way through is clear, everything else gets trimmed away until only the path is left. I start with the words, so we agree on what this thing is, and build the system underneath before any screen. The shiny part comes last. Every edge that's left has a reason I can say out loud. That's the precise part.","But a clean cut alone is cold. So I leave room for one thing nobody asked for: a colour, a bounce, a cube with opinions. That's the joyful part, and it's how you can tell a person made it."]}`,
    to: `{lines:${q([
      "Then we cut.",
      "Everything that isn't the payment gets trimmed away. Offers are signed by the server, amounts are enforced onchain, and every payout wallet is verified against the merchant's domain. Every edge that's left has a reason we can say out loud. That's the precise part.",
      "But a clean cut alone is cold. So the components ship with a little life: a receipt that lands, a status that moves, a checkout that feels made by someone. That's the joyful part.",
    ])}}`,
  },
  {
    file: VA,
    from: `lines:["He made the cut-outs late in life, from a chair, with scissors and painted paper. Every edge was exact, and the whole thing was pure joy. I stood in front of them this summer and finally had a name for what I'd been chasing since I was 17: cutting precisely, and leaving the joy in."]`,
    to: `lines:${q([
      "He made the cut-outs late in life, with scissors and painted paper. Every edge was exact, and the whole thing was pure joy. That's the bar for a checkout: precise enough to trust with money, and still a pleasure to use.",
    ])}`,
  },
  {
    file: VA,
    from: `{lines:["A clean cut is easy to understand. Customers get it, so they buy. Investors get it, so they say yes. Everyone else gets to enjoy it, which is the part nobody puts in the deck. So far that's helped Neos raise £1.4M and Schneider Electric land $172M.","That's the obsession: the clear way through, cut so precisely it ships, and still fun to hold."]}`,
    to: `{lines:${q([
      "A clean checkout is easy to understand. Customers get it, so they pay. Merchants get it, so they ship. Developers get it, so a shop, an invoice link or an installment plan takes an afternoon in React or Next.js.",
      "That's the obsession: the clear way through, cut so precisely it ships, and still fun to hold.",
    ])}}`,
  },
  {
    file: VA,
    from: `{lines:["This site is cut the same way, on Cheval, the system I built for my own work.","In November I'm heading to the US, looking for a team with a river worth crossing."]}`,
    to: `{lines:${q([
      "PayKit is cut the same way, from the contracts up to the React components.",
      "Built at ETHGlobal Mumbai, looking for shops with a river worth crossing.",
    ])}}`,
  },
  { file: VA, from: `"Every project is like stepping into a running river."`, to: q("Every payment is like stepping into a running river.") },
  {
    file: VA,
    from: `["That's why I got hired at ",{mark:Ch},"Cal.com and currently empower the next generation of time infrastructure as Senior Product Design Engineer, through building tools and workflows that accelerate the product growth!"]`,
    to: q("Built at ETHGlobal Mumbai for Whitechain: shops, invoices, refunds and installment plans, paid in USDT, with no gas for the customer."),
  },
  {
    file: VA,
    from: `route:[{name:"Poland",at:[19.4,52.1],flag:"pl"},{name:"The Netherlands",at:[4.3,52.08],flag:"nl"},{name:"United States",at:[-122.42,37.77],flag:"us"}]`,
    to: `route:[{name:"India",at:[72.88,19.08],flag:"in"},{name:"United Arab Emirates",at:[55.27,25.2],flag:"ae"},{name:"United Kingdom",at:[-0.13,51.51],flag:"gb"}]`,
  },

  // ── Beyond work (photos) ────────────────────────────────────────────────
  { file: VA, from: `w3={label:"More about me",href:"#about",route:"/about"}`, to: `w3={label:"Try the shops",href:"/app/shops",route:"/app/shops"}` },
  { file: VA, from: `Qi={title:["Beyond","work"]`, to: `Qi={title:["Beyond","code"]` },
  {
    file: VA,
    from: `dek:"Always moving, rarely alone. Hosting design nights, ambassador work for SpaceXSI and Mobbin, and many many laughs in between ;)"`,
    to: `dek:${q('Always moving, rarely alone. Built over a weekend at ETHGlobal Mumbai, with a lot of chai, a few demos and many many laughs in between ;)')}`,
  },

  // ── Notes ───────────────────────────────────────────────────────────────
  {
    file: VA,
    from: `M4={title:"Taste notes",dek:"One decision per note, and the reasoning that got me there.",dekV7:"Writing on design, culture, and how I view the world.",more:{label:"More writing",href:"/notes"},read:"Read the note",href:e=>\`/notes/\${e.slug}\``,
    to: `M4={title:"Build notes",dek:${q('One decision per note, and the reasoning behind it.')},dekV7:${q('Notes on payments, gas, and how we built PayKit.')},more:{label:"Open the app",href:"/app/shops"},read:"Open the app",href:e=>"/app/shops"`,
  },
  ...notes(),

  // ── Small talk ──────────────────────────────────────────────────────────
  {
    file: VA,
    from: `items:[{question:"How did you get into design?"`,
    to: `items:[{question:${q('What is PayKit?')}`,
  },
  {
    file: VA,
    from: `answer:["I've loved sci-fi and tech since I was a kid, and my favourite game was Minecraft. That's where I learned to think in systems: a few simple blocks, and rules you can build anything from.","At 17 I wanted to build my own, so I tried to learn Swift from a tutorial. The app it built was pastel shapes with drop shadows, and I couldn't stand it, so I redesigned it before I'd finished learning the code. Looking for how an interface should look, I found a design community online that didn't know my name. I felt part of it anyway, and I stayed."]`,
    to: `answer:${q([
      "An npm SDK and a self-hostable payment service for Whitechain. Drop in the React or Next.js components and you have a shop, an invoice link or an installment plan.",
      "Customers pay in USDT and sign once. Merchants receive USDT directly to a payout wallet that is verified against their domain, and every payment, refund and plan shows up in their dashboard.",
    ])}`,
  },
  {
    file: VA,
    from: `{question:"What's your main thing?",answer:["Design first, then the system underneath, in code. I make founders' products easy to get, so customers buy and investors say yes.","Honestly, I'm more of a people person than a design person. Design is the best excuse I've found to get what's in someone's head out where everyone can see it, and then argue about the spacing."]}`,
    to: `{question:${q('Do my customers need WBT for gas?')},answer:${q([
      "No. They sign the payment, and the PayKit relayer submits it and pays the gas. The network fee is covered in USDT, inside the same payment.",
      "So the only token anyone needs is the one they're paying with, and nobody has to visit an exchange before they can check out.",
    ])}}`,
  },
  {
    file: VA,
    from: `{question:"Where are you based?",answer:["Currently based in {here}. Before that, five years in The Hague in the Netherlands, and originally from a small village in Poland."]}`,
    to: `{question:${q('Where does it run?')},answer:${q([
      "On Whitechain, built in {here}. The contracts run on the Whitechain Sepolia testnet (chain 1874) for now, and nothing is on mainnet yet.",
    ])}}`,
  },
  {
    file: VA,
    from: `{question:"Where do you see yourself in the future?",answer:["Somewhere fast and lively, San Francisco could be great, at a startup I believe in, with a GOATed team. Getting as good at the craft as I can, and building the community with designers in my spare time: events, dinners and some fun hangouts.","Outside the 12-hour workdays, some time for art, and of course lots of running ;)"]}`,
    to: `{question:${q('What can I build with it?')},answer:${q([
      "Shops with carts, one-off invoices sent as a link, pay-in-parts and installment plans, and refunds. Merchants get a dashboard for sales, plans, products, API keys and webhooks, and customers get one for receipts and upcoming payments.",
      "Every page in the app is built from the same components you install ;)",
    ])}}`,
  },
  {
    file: VA,
    from: `{question:"How can I get in touch?",answer:[\`Book a call from the bar, or email \${Nn}. Tell me what you're building and where it's hard to get. I write back.\`,"And if your question isn't up here, ask the cloud. I hate talking about myself, so I taught it to do that for me."]}`,
    to: `{question:${q('How do I get started?')},answer:${q([
      "Open the app from the bar and pay a demo shop with the test wallet, or run npm i @paykit/react and wrap your app in the provider. Tell it your shop and it handles the rest.",
      "And if your question isn't up here, ask the cloud. It has read the docs so you don't have to.",
    ])}}`,
  },
  { file: VA, from: `"Reading Andreas's notes"`, to: q("Reading the PayKit docs") },
  {
    file: VA,
    from: `tired:\`The cloud is dizzy. Email \${Nn} and Andreas will answer this one himself.\`,keyless:\`The cloud has no key yet, so it can't think. Email \${Nn} and Andreas will answer himself.\``,
    to: `tired:${q("The cloud is dizzy. Open the app and try a payment, it explains itself.")},keyless:${q("The cloud has no key yet, so it can't think. Open the app and try a payment instead.")}`,
  },

  // ── Square flags for the globe route (the built-in set has no India or UAE) ──
  {
    file: "squareFlags-D23kPNlV.js",
    from: "ft={be:it,",
    to: `ft={in:${q(svgFlag("<path fill='#f93' d='M0 0h512v171H0z'/><path fill='#fff' d='M0 171h512v170H0z'/><path fill='#128807' d='M0 341h512v171H0z'/><circle cx='256' cy='256' r='72' fill='none' stroke='#008' stroke-width='12'/><circle cx='256' cy='256' r='14' fill='#008'/>"))},ae:${q(svgFlag("<path fill='#00732f' d='M0 0h512v171H0z'/><path fill='#fff' d='M0 171h512v170H0z'/><path fill='#000' d='M0 341h512v171H0z'/><path fill='red' d='M0 0h160v512H0z'/>"))},be:it,`,
  },

  // The globe's label chips draw flags from a pixel map and a round painter, keyed by country.
  {
    file: LANDING,
    from: `gn={w:"#ffffff",r:"#dc143c",o:"#ae1c28",b:"#21468b",n:"#3c3b6e"}`,
    to: `gn={w:"#ffffff",r:"#dc143c",o:"#ae1c28",b:"#21468b",n:"#3c3b6e",s:"#ff9933",g:"#138808",c:"#000080",e:"#00732f",k:"#000000",a:"#ff0000",u:"#012169",x:"#c8102e"}`,
  },
  {
    file: LANDING,
    from: "wn={pl:",
    to: `wn={in:["ssssssssss","ssssssssss","wwwwccwwww","wwwwccwwww","gggggggggg","gggggggggg"],ae:["aaeeeeeeee","aaeeeeeeee","aawwwwwwww","aawwwwwwww","aakkkkkkkk","aakkkkkkkk"],gb:["xwuuwxwuwx","uuxwwxwxuu","wwwwwxwwww","xxxxxxxxxx","uuxwwxwxuu","xwuuwxwuwx"],pl:`,
  },
  {
    file: LANDING,
    from: "mn={pl:",
    to: `mn={in:hA(["#ff9933","#ffffff","#138808"]),ae:A=>{hA(["#00732f","#ffffff","#000000"])(A),A.fillStyle="#ff0000",A.fillRect(-1,-1,.6,2)},pl:`,
  },

  // ── "Built in {here}": default city when the location lookup is unavailable ──
  { file: ASK, from: `nt={city:"Seoul",country:"KR"}`, to: `nt={city:"Mumbai",country:"IN"}` },
]

/** A square flag in the same shape as the built-in flag-icons set, as a data URL. */
function svgFlag(body: string): string {
  return "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'>${body}</svg>`).replace(/%20/g, " ")
}

/** The note cards: same covers and layout, PayKit topics. */
function notes(): Rewrite[] {
  const items: Array<[from: string, to: { stamp: string; title: string; call: string; lines: [string, string]; kicker: string }]> = [
    [
      `stamp:"The cooldown",title:"Where the cooldown went",call:"Agents took the bricklaying, and the bricklaying was where my head rested between decisions. Batching the thinking gives some of that rest back.",date:"2026-11-04",cover:k4,postmark:"Seoul",tone:"dusk",legend:{layout:"split",lines:["The","cooldown"],kicker:"Culture"}`,
      { stamp: "No gas", title: "Why your customers never need WBT", call: "They sign a payment, and the PayKit relayer submits it and pays the gas. The fee is settled in USDT, so nobody has to buy a second token first.", lines: ["No", "gas"], kicker: "Checkout" },
    ],
    [
      `stamp:"Nouns, then verbs",title:"Why do the Mac's menus read like sentences?",call:"The first Mac named its menus with nouns and filled them with verbs, so every pick finishes a sentence. Forty-two years on the Finder still parses. Most product menus don't.",date:"2026-10-29",cover:_4,postmark:"Seoul",tone:"sage",legend:{layout:"band",lines:["Nouns,","then verbs"],kicker:"Interaction"}`,
      { stamp: "Sign once", title: "One signature per payment", call: "Typed EIP-712 data shows the shop, the amount and the deadline right in the wallet, so the customer reads exactly what they sign, once.", lines: ["Sign", "once"], kicker: "Wallets" },
    ],
    [
      `stamp:"Which exit",title:"Why does Google Maps stop at the door?",call:"Even at Oxford Circus, Google Maps draws a Tube logo and a name. Naver draws every exit, the lifts and the change of line, and routes through them: the layer AR will need.",date:"2026-10-22",cover:m4,postmark:"Seoul",tone:"dusk",legend:{layout:"masthead",lines:["Which","exit"],kicker:"Wayfinding"}`,
      { stamp: "Verified payout", title: "Why the payout wallet is tied to a domain", call: "A merchant proves they own their site before PayKit sends USDT anywhere, so a lookalike shop can't quietly redirect the money.", lines: ["Verified", "payout"], kicker: "Merchants" },
    ],
    [
      `stamp:"Hidden system",title:"The hidden design system in album covers",call:"Line up a run of covers from one artist and the rules show. Sakepnk changes one shape per song, ziproom changes the place around the two of them, and both let you spot their records before you read a word.",date:"2026-10-20",cover:w4,postmark:"Seoul",tone:"dusk",legend:{layout:"masthead",lines:["Hidden","system"],kicker:"Culture"}`,
      { stamp: "Pay in parts", title: "Installments that collect themselves", call: "A plan is agreed once onchain and each payment is collected on schedule. The customer sees every upcoming payment and can cancel what's left.", lines: ["Pay in", "parts"], kicker: "Plans" },
    ],
    [
      `stamp:"Design first",title:"What is a design engineer, anyway?",call:"One title, two job listings that want nearly opposite people. Here's how I read the role, where I sit on it, and why the mess makes this the best time to be in the field.",date:"2026-10-19",cover:y4,postmark:"Seoul",tone:"dusk",legend:{layout:"masthead",lines:["Design","first"],kicker:"Culture"}`,
      { stamp: "Clean refunds", title: "Refunds that go back the way they came", call: "A refund points at the original payment, so the USDT returns to the wallet that paid, and both dashboards show the same story.", lines: ["Clean", "refunds"], kicker: "Merchants" },
    ],
    [
      `stamp:"Follow the colour",title:"Why does Korea paint its roads pink?",call:"Korean road wayfinding and how it can decrease user load in split-second decision situations.",date:"2026-10-13",cover:x4,postmark:"Seoul",tone:"dusk",legend:{layout:"masthead",lines:["Follow","the colour"],kicker:"Wayfinding"}`,
      { stamp: "Twenty lines", title: "A shop in twenty lines of React", call: "Wrap the app in the provider, drop in the grid and the checkout button, and the payment flow is done.", lines: ["Twenty", "lines"], kicker: "Developers" },
    ],
    [
      `stamp:"What never moves",title:"Why did the formatting toolbar jump when you pressed Bold?",call:"Bold makes text wider, and a toolbar centred on the selection slides with it. The obvious fix made it worse. The right one came from asking what never moves.",date:"2026-09-24",cover:v4,postmark:"The Hague",tone:"sage",legend:{layout:"band",lines:["What never","moves"],kicker:"Interaction"}`,
      { stamp: "Signed webhooks", title: "Webhooks you can check before you trust", call: "Every event is signed, so a merchant backend verifies it with one call to @paykit/node before it marks an order as paid.", lines: ["Signed", "webhooks"], kicker: "Developers" },
    ],
  ]
  return items.map(([from, n]) => {
    const keep = from.match(/date:"[^"]+",cover:\w+,postmark:"[^"]+",tone:"\w+",legend:\{layout:"\w+"/)![0].replace(/postmark:"[^"]+"/, 'postmark:"Mumbai"')
    return {
      file: VA,
      from,
      to: `stamp:${q(n.stamp)},title:${q(n.title)},call:${q(n.call)},${keep},lines:${q(n.lines)},kicker:${q(n.kicker)}}`,
    }
  })
}
