import { defineConfig } from "tsup";

// ESM output so dist/index.js + dist/worker.js run under "type": "module"
// and import.meta.url (env.ts) resolves correctly.
export default defineConfig({
  format: ["esm"],
  target: "es2023",
  clean: true,
});
