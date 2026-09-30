import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
  ],
  // Pre-bundle the browser-only signing deps (backer.client.ts) so the first dev load doesn't hit
  // Vite's "504 Outdated Optimize Dep" and fail to hydrate (docs/reference/mera.md, gotcha 9).
  optimizeDeps: {
    include: [
      "@category-labs/mera",
      "@category-labs/mera/viem",
      "@scure/bip32",
      "@scure/bip39",
      "@scure/bip39/wordlists/english.js",
      "viem",
    ],
  },
  resolve: {
    tsconfigPaths: true,
  },
});
