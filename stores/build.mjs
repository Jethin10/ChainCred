// Builds one demo store into stores/out/<slug>/.vercel/output (Build Output API v3): the static
// storefront plus /api/checkout as a Node function. Then: cd stores/out/<slug> && vercel deploy --prebuilt --prod
//   node stores/build.mjs kettle-leaf https://paper-lantern…vercel.app
import fs from "node:fs";
import path from "node:path";
import { build } from "vite";
import { STORES } from "./src/catalog.mjs";

const here = import.meta.dirname;
const slug = process.argv[2];
const otherUrl = process.argv[3] || "";
const store = STORES[slug];
if (!store) throw new Error(`Usage: node stores/build.mjs <${Object.keys(STORES).join("|")}> [other store url]`);

const out = path.join(here, "out", slug, ".vercel", "output");
fs.rmSync(out, { recursive: true, force: true });
process.env.VITE_STORE = slug;
process.env.VITE_STORE_NAME = store.name;
process.env.VITE_STORE_TAGLINE = store.tagline;
process.env.VITE_OTHER_STORE_URL = otherUrl;
await build({ root: here, logLevel: "warn", build: { outDir: path.join(out, "static"), emptyOutDir: true } });

const fn = path.join(out, "functions", "api", "checkout.func");
fs.mkdirSync(fn, { recursive: true });
fs.copyFileSync(path.join(here, "api", "checkout.mjs"), path.join(fn, "index.mjs"));
fs.copyFileSync(path.join(here, "src", "catalog.mjs"), path.join(fn, "catalog.mjs"));
fs.writeFileSync(path.join(fn, ".vc-config.json"), JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs" }));
fs.writeFileSync(path.join(out, "config.json"), JSON.stringify({ version: 3, routes: [{ handle: "filesystem" }, { src: "/(.*)", dest: "/index.html" }] }));
console.log(`Built ${store.name} → ${path.relative(process.cwd(), out)}`);
