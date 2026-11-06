// Copies the browser checkout from packages/embed so `paykit/checkout` ships the same code.
// Runs before tests and `npm pack`/`npm publish`. Outside the monorepo it keeps the committed copy.
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const from = path.join(here, "..", "..", "embed", "src", "index.js");
const to = path.join(here, "..", "src", "checkout.js");
if (fs.existsSync(from)) {
  const banner = "// Generated from packages/embed/src/index.js by scripts/sync-checkout.mjs. Edit the source there.\n";
  fs.writeFileSync(to, banner + fs.readFileSync(from, "utf8"));
  console.log("paykit: synced checkout from packages/embed");
}
