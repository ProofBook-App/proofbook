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
  // Pre-bundle the client-only signing deps so the first dev page load does
  // not hit Vite's "504 Outdated Optimize Dep" and fail to hydrate.
  optimizeDeps: {
    include: [
      "@category-labs/mera",
      "@category-labs/mera/viem",
      "@scure/bip32",
      "@scure/bip39",
      "@scure/bip39/wordlists/english.js",
      "viem",
      "viem/chains",
    ],
  },
  resolve: {
    tsconfigPaths: true,
  },
});
