import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
// Build output goes to ./dist, served by the FastAPI backend.
// Run `npm run build` to update the production build.
// For local development with hot-reload: `npm run dev` (proxies API to :18090)
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "./dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:18090",
      "/healthz": "http://localhost:18090",
      "/readyz": "http://localhost:18090",
      "/health": "http://localhost:18090",
    },
  },
});
