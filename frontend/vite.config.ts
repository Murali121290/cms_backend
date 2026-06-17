import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_DEV_PROXY_TARGET || "http://127.0.0.1:8000";
  const currentDir = dirname(fileURLToPath(import.meta.url));

  return {
    // In production (Docker) the SPA is served from / by nginx.
    // In development (npm run dev) the Vite server also serves from root.
    // Both use base: "/" so asset paths are consistent.
    base: "/",

    plugins: [tailwindcss(), react()],

    resolve: {
      alias: {
        "@": resolve(currentDir, "src"),
      },
    },

    build: {
      outDir: "dist",
      sourcemap: false,
      // Split large vendor bundles into separate cacheable chunks so that
      // app code changes don't bust the cached vendor chunk in browsers.
      rollupOptions: {
        output: {
          manualChunks: {
            "vendor-react": ["react", "react-dom", "react-router-dom"],
            "vendor-query": ["@tanstack/react-query"],
            "vendor-forms": ["react-hook-form", "@hookform/resolvers", "zod"],
            "vendor-tiptap": ["@tiptap/react", "@tiptap/core"],
          },
        },
      },
    },

    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      css: false,
      restoreMocks: true,
      clearMocks: true,
      exclude: ["e2e/**", "node_modules/**"],
    },

    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
