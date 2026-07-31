import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { persistentModelCache } from "./vite-model-cache";

export default defineConfig({
  plugins: [persistentModelCache(), react()], clearScreen: false,
  build: { rollupOptions: { output: { manualChunks: { three: ["three"] } } }, chunkSizeWarningLimit: 700 },
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"]
});
