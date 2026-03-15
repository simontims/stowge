import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
// Build output goes to ../ui so the FastAPI backend can serve it directly.
// Run `npm run build` to replace the vanilla app in ui/ with the React build.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../ui",
    emptyOutDir: true,
  },
});
