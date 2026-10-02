import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/start.ts"],
  outDir: "dist",
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: false,
  exports: true,
  copy: [{ from: "src/lib/pdf/fonts", to: "dist/fonts" }],
});
