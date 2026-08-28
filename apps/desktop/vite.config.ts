import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { persistentModelCache } from "./vite-model-cache";
import { localPyTorchService } from "./vite-pytorch-service";
import { localAiQuantizerService } from "./vite-ai-quantizer-service";
import { localMemoryService } from "./vite-memory-service";
import { localSongPlayerVocalsService } from "./vite-song-player-vocals-service";

export default defineConfig({
  plugins: [localMemoryService(), localPyTorchService(), localAiQuantizerService(), localSongPlayerVocalsService(), persistentModelCache(), react()], clearScreen: false,
  build: { rollupOptions: { output: { manualChunks: { three: ["three"] } } }, chunkSizeWarningLimit: 700 },
  server: { port: 1420, strictPort: true, proxy: { "/music/ai-quantizer/api": { target: "http://127.0.0.1:4173", changeOrigin: true, rewrite: (path) => path.replace(/^\/music\/ai-quantizer/, "") } } },
  envPrefix: ["VITE_", "TAURI_ENV_"]
});
