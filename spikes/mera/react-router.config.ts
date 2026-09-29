import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // Required on v7 for @cloudflare/vite-plugin (default in v8).
  future: {
    v8_viteEnvironmentApi: true,
  },
} satisfies Config;
