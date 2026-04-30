import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: true,
  shims: false,
  banner: { js: "#!/usr/bin/env node" },
  minify: false,
});
