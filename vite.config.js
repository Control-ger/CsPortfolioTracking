import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Lädt die .env Datei basierend auf dem aktuellen Modus (development/production)
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    base: './',
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      // Hier deaktivieren wir die zufälligen Hashes
      rollupOptions: {
        output: {
          entryFileNames: `assets/[name].js`,
          chunkFileNames: `assets/[name].js`,
          assetFileNames: `assets/[name].[ext]`,
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