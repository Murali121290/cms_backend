// vite.config.ts
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "file:///D:/cms_backend/frontend/node_modules/@tailwindcss/vite/dist/index.mjs";
import react from "file:///D:/cms_backend/frontend/node_modules/@vitejs/plugin-react/dist/index.js";
import { defineConfig, loadEnv } from "file:///D:/cms_backend/frontend/node_modules/vite/dist/node/index.js";
var __vite_injected_original_import_meta_url = "file:///D:/cms_backend/frontend/vite.config.ts";
var vite_config_default = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_DEV_PROXY_TARGET || "http://127.0.0.1:8000";
  const currentDir = dirname(fileURLToPath(__vite_injected_original_import_meta_url));
  return {
    // In production (Docker) the SPA is served from / by nginx.
    // In development (npm run dev) the Vite server also serves from root.
    // Both use base: "/" so asset paths are consistent.
    base: "/",
    plugins: [tailwindcss(), react()],
    resolve: {
      alias: {
        "@": resolve(currentDir, "src")
      }
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
            "vendor-tiptap": ["@tiptap/react", "@tiptap/core"]
          }
        }
      }
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      css: false,
      restoreMocks: true,
      clearMocks: true,
      exclude: ["e2e/**", "node_modules/**"]
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true
        }
      }
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxjbXNfYmFja2VuZFxcXFxmcm9udGVuZFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRDpcXFxcY21zX2JhY2tlbmRcXFxcZnJvbnRlbmRcXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0Q6L2Ntc19iYWNrZW5kL2Zyb250ZW5kL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGlybmFtZSwgcmVzb2x2ZSB9IGZyb20gXCJub2RlOnBhdGhcIjtcclxuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJub2RlOnVybFwiO1xyXG5cclxuaW1wb3J0IHRhaWx3aW5kY3NzIGZyb20gXCJAdGFpbHdpbmRjc3Mvdml0ZVwiO1xyXG5pbXBvcnQgcmVhY3QgZnJvbSBcIkB2aXRlanMvcGx1Z2luLXJlYWN0XCI7XHJcbmltcG9ydCB7IGRlZmluZUNvbmZpZywgbG9hZEVudiB9IGZyb20gXCJ2aXRlXCI7XHJcblxyXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoKHsgbW9kZSB9KSA9PiB7XHJcbiAgY29uc3QgZW52ID0gbG9hZEVudihtb2RlLCBwcm9jZXNzLmN3ZCgpLCBcIlwiKTtcclxuICBjb25zdCBwcm94eVRhcmdldCA9IGVudi5WSVRFX0RFVl9QUk9YWV9UQVJHRVQgfHwgXCJodHRwOi8vMTI3LjAuMC4xOjgwMDBcIjtcclxuICBjb25zdCBjdXJyZW50RGlyID0gZGlybmFtZShmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybCkpO1xyXG5cclxuICByZXR1cm4ge1xyXG4gICAgLy8gSW4gcHJvZHVjdGlvbiAoRG9ja2VyKSB0aGUgU1BBIGlzIHNlcnZlZCBmcm9tIC8gYnkgbmdpbnguXHJcbiAgICAvLyBJbiBkZXZlbG9wbWVudCAobnBtIHJ1biBkZXYpIHRoZSBWaXRlIHNlcnZlciBhbHNvIHNlcnZlcyBmcm9tIHJvb3QuXHJcbiAgICAvLyBCb3RoIHVzZSBiYXNlOiBcIi9cIiBzbyBhc3NldCBwYXRocyBhcmUgY29uc2lzdGVudC5cclxuICAgIGJhc2U6IFwiL1wiLFxyXG5cclxuICAgIHBsdWdpbnM6IFt0YWlsd2luZGNzcygpLCByZWFjdCgpXSxcclxuXHJcbiAgICByZXNvbHZlOiB7XHJcbiAgICAgIGFsaWFzOiB7XHJcbiAgICAgICAgXCJAXCI6IHJlc29sdmUoY3VycmVudERpciwgXCJzcmNcIiksXHJcbiAgICAgIH0sXHJcbiAgICB9LFxyXG5cclxuICAgIGJ1aWxkOiB7XHJcbiAgICAgIG91dERpcjogXCJkaXN0XCIsXHJcbiAgICAgIHNvdXJjZW1hcDogZmFsc2UsXHJcbiAgICAgIC8vIFNwbGl0IGxhcmdlIHZlbmRvciBidW5kbGVzIGludG8gc2VwYXJhdGUgY2FjaGVhYmxlIGNodW5rcyBzbyB0aGF0XHJcbiAgICAgIC8vIGFwcCBjb2RlIGNoYW5nZXMgZG9uJ3QgYnVzdCB0aGUgY2FjaGVkIHZlbmRvciBjaHVuayBpbiBicm93c2Vycy5cclxuICAgICAgcm9sbHVwT3B0aW9uczoge1xyXG4gICAgICAgIG91dHB1dDoge1xyXG4gICAgICAgICAgbWFudWFsQ2h1bmtzOiB7XHJcbiAgICAgICAgICAgIFwidmVuZG9yLXJlYWN0XCI6IFtcInJlYWN0XCIsIFwicmVhY3QtZG9tXCIsIFwicmVhY3Qtcm91dGVyLWRvbVwiXSxcclxuICAgICAgICAgICAgXCJ2ZW5kb3ItcXVlcnlcIjogW1wiQHRhbnN0YWNrL3JlYWN0LXF1ZXJ5XCJdLFxyXG4gICAgICAgICAgICBcInZlbmRvci1mb3Jtc1wiOiBbXCJyZWFjdC1ob29rLWZvcm1cIiwgXCJAaG9va2Zvcm0vcmVzb2x2ZXJzXCIsIFwiem9kXCJdLFxyXG4gICAgICAgICAgICBcInZlbmRvci10aXB0YXBcIjogW1wiQHRpcHRhcC9yZWFjdFwiLCBcIkB0aXB0YXAvY29yZVwiXSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgfSxcclxuICAgIH0sXHJcblxyXG4gICAgdGVzdDoge1xyXG4gICAgICBlbnZpcm9ubWVudDogXCJqc2RvbVwiLFxyXG4gICAgICBzZXR1cEZpbGVzOiBcIi4vc3JjL3Rlc3Qvc2V0dXAudHNcIixcclxuICAgICAgY3NzOiBmYWxzZSxcclxuICAgICAgcmVzdG9yZU1vY2tzOiB0cnVlLFxyXG4gICAgICBjbGVhck1vY2tzOiB0cnVlLFxyXG4gICAgICBleGNsdWRlOiBbXCJlMmUvKipcIiwgXCJub2RlX21vZHVsZXMvKipcIl0sXHJcbiAgICB9LFxyXG5cclxuICAgIHNlcnZlcjoge1xyXG4gICAgICBwb3J0OiA1MTczLFxyXG4gICAgICBwcm94eToge1xyXG4gICAgICAgIFwiL2FwaVwiOiB7XHJcbiAgICAgICAgICB0YXJnZXQ6IHByb3h5VGFyZ2V0LFxyXG4gICAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0sXHJcbiAgICB9LFxyXG4gIH07XHJcbn0pO1xyXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQTZQLFNBQVMsU0FBUyxlQUFlO0FBQzlSLFNBQVMscUJBQXFCO0FBRTlCLE9BQU8saUJBQWlCO0FBQ3hCLE9BQU8sV0FBVztBQUNsQixTQUFTLGNBQWMsZUFBZTtBQUxxSCxJQUFNLDJDQUEyQztBQU81TSxJQUFPLHNCQUFRLGFBQWEsQ0FBQyxFQUFFLEtBQUssTUFBTTtBQUN4QyxRQUFNLE1BQU0sUUFBUSxNQUFNLFFBQVEsSUFBSSxHQUFHLEVBQUU7QUFDM0MsUUFBTSxjQUFjLElBQUkseUJBQXlCO0FBQ2pELFFBQU0sYUFBYSxRQUFRLGNBQWMsd0NBQWUsQ0FBQztBQUV6RCxTQUFPO0FBQUE7QUFBQTtBQUFBO0FBQUEsSUFJTCxNQUFNO0FBQUEsSUFFTixTQUFTLENBQUMsWUFBWSxHQUFHLE1BQU0sQ0FBQztBQUFBLElBRWhDLFNBQVM7QUFBQSxNQUNQLE9BQU87QUFBQSxRQUNMLEtBQUssUUFBUSxZQUFZLEtBQUs7QUFBQSxNQUNoQztBQUFBLElBQ0Y7QUFBQSxJQUVBLE9BQU87QUFBQSxNQUNMLFFBQVE7QUFBQSxNQUNSLFdBQVc7QUFBQTtBQUFBO0FBQUEsTUFHWCxlQUFlO0FBQUEsUUFDYixRQUFRO0FBQUEsVUFDTixjQUFjO0FBQUEsWUFDWixnQkFBZ0IsQ0FBQyxTQUFTLGFBQWEsa0JBQWtCO0FBQUEsWUFDekQsZ0JBQWdCLENBQUMsdUJBQXVCO0FBQUEsWUFDeEMsZ0JBQWdCLENBQUMsbUJBQW1CLHVCQUF1QixLQUFLO0FBQUEsWUFDaEUsaUJBQWlCLENBQUMsaUJBQWlCLGNBQWM7QUFBQSxVQUNuRDtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLElBRUEsTUFBTTtBQUFBLE1BQ0osYUFBYTtBQUFBLE1BQ2IsWUFBWTtBQUFBLE1BQ1osS0FBSztBQUFBLE1BQ0wsY0FBYztBQUFBLE1BQ2QsWUFBWTtBQUFBLE1BQ1osU0FBUyxDQUFDLFVBQVUsaUJBQWlCO0FBQUEsSUFDdkM7QUFBQSxJQUVBLFFBQVE7QUFBQSxNQUNOLE1BQU07QUFBQSxNQUNOLE9BQU87QUFBQSxRQUNMLFFBQVE7QUFBQSxVQUNOLFFBQVE7QUFBQSxVQUNSLGNBQWM7QUFBQSxRQUNoQjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
