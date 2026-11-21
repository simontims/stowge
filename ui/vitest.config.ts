import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { tablerShards } from "./vite.tabler-shards.ts";

export default defineConfig({
  plugins: [react(), tablerShards()],
  test: {
    environment: "jsdom",
    globals: true,
  },
});
