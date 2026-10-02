import path from "node:path";
import * as dotenv from "dotenv";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

dotenv.config({ path: path.resolve(__dirname, ".env") });

// Expose only vars starting with VITE_
const viteEnv = Object.keys(process.env)
  .filter((k) => k.startsWith("VITE_"))
  .reduce<Record<string, string>>((a, k) => {
    a[k] = process.env[k] ?? "";
    return a;
  }, {});

export default defineConfig(() => ({
  define: {
    "process.env": JSON.stringify(viteEnv),
  },
  build: {
    assetsInlineLimit: 0,
  },
  plugins: [reactRouter(), tsconfigPaths({ projects: [path.resolve(__dirname, "tsconfig.json")] })],
  resolve: {
    alias: {
      // Next.js compatibility shims used within web
      "next/link": path.resolve(__dirname, "app/compat/next/link.tsx"),
      "next/navigation": path.resolve(__dirname, "app/compat/next/navigation.ts"),
      "next/script": path.resolve(__dirname, "app/compat/next/script.tsx"),
    },
    dedupe: ["react", "react-dom", "@headlessui/react"],
  },
  server: {
    host: process.env.VITE_DEV_HOST ?? "127.0.0.1",
    // Keep the browser Host for signed MinIO URLs and Django redirects.
    proxy: {
      ...(process.env.VITE_DEV_API_URL
        ? {
            "/api": { target: process.env.VITE_DEV_API_URL, changeOrigin: false },
            "/auth": { target: process.env.VITE_DEV_API_URL, changeOrigin: false },
          }
        : {}),
      ...(process.env.VITE_DEV_MINIO_URL
        ? { "/uploads": { target: process.env.VITE_DEV_MINIO_URL, changeOrigin: false } }
        : {}),
    },
  },
  // No SSR-specific overrides needed; alias resolves to ESM build
}));
