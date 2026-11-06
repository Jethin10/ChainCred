// Bundles sdk/host.ts (the PayKit SDK API from packages/server) into one Node ESM file that the
// Vercel function loads. Run from the repo root: npm run bundle-sdk -w paykit-server
import path from "node:path";
import { defineConfig } from "vite";

const here = import.meta.dirname;

export default defineConfig({
  root: here,
  logLevel: "warn",
  resolve: { conditions: ["source", "node", "import"] },
  ssr: { noExternal: true, target: "node", resolve: { conditions: ["source", "node", "import"], externalConditions: ["node"] } },
  build: {
    ssr: path.join(here, "host.ts"),
    outDir: path.join(here, "dist"),
    emptyOutDir: true,
    target: "node22",
    minify: false,
    rollupOptions: { output: { format: "es", entryFileNames: "paykit-sdk.mjs", codeSplitting: false } },
  },
});
