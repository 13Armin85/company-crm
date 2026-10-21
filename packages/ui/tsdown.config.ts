import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  platform: "neutral",
  exports: {
    customExports: (exports) => ({
      ...exports,
      "./styles/schema-form.css": "./styles/schema-form.css",
      "./styles/schema-data-grid.css": "./styles/schema-data-grid.css",
    }),
  },
});
