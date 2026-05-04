import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Lädt die .env Datei basierend auf dem aktuellen Modus (development/production)
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    base: './',
    root: 'apps/web',
    resolve: {
      alias: {
        "@shared": path.resolve(__dirname, "./packages/shared/src"),
        "@": path.resolve(__dirname, "./packages/shared/src"),
        // Force all React imports to resolve to the same physical path from root node_modules
        "react": path.resolve(__dirname, "./node_modules/react"),
        "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
        "react/jsx-runtime": path.resolve(__dirname, "./node_modules/react/jsx-runtime.js"),
        "react/jsx-dev-runtime": path.resolve(__dirname, "./node_modules/react/jsx-dev-runtime.js"),
      },
      // Critical: Deduplicate React across all modules to prevent multiple React instances
      dedupe: ['react', 'react-dom'],
    },
    build: {
      // Output to root dist/ so Electron can find it
      outDir: path.resolve(__dirname, "./dist"),
      emptyOutDir: true,
      // Enable sourcemaps for debugging in dev
      sourcemap: true,
      rollupOptions: {
        output: {
          entryFileNames: `assets/[name].js`,
          chunkFileNames: `assets/[name].js`,
          assetFileNames: `assets/[name].[ext]`,
          // Inline dynamic imports to prevent duplicate React instances
          inlineDynamicImports: true,
        },
      },
    },
    server: {
      proxy: {
        "/api/csfloat": {
          target: "https://csfloat.com/api/v1",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/csfloat/, ""),
          headers: {
            Authorization: env.CSFLOAT_API_KEY || "",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
            Accept: "application/json",
          },
        },
      },
    },
  };
});