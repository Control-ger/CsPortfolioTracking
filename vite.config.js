import path from "path"; // WICHTIG
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api/csfloat": {
        target: "https://csfloat.com/api/v1",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/csfloat/, ""),
        headers: {
          Authorization: "",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
          Accept: "application/json",
        },
      },
    },
  },
});
