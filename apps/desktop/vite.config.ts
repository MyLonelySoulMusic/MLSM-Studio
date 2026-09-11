import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { persistentModelCache } from "./vite-model-cache";
import { localPyTorchService } from "./vite-pytorch-service";
import { localAiQuantizerService } from "./vite-ai-quantizer-service";
import { localMemoryService } from "./vite-memory-service";
import { localSongPlayerVocalsService } from "./vite-song-player-vocals-service";
import { localAudioToolsService } from "./vite-audio-tools-service";
import { studioSettingsService } from "./vite-settings-service";
import { localAutoPostService } from "./vite-autopost-service";
import { localReportsService } from "./vite-reports-service";

export default defineConfig({
  plugins: [localReportsService(), localAutoPostService(), studioSettingsService(), localMemoryService(), localPyTorchService(), localAiQuantizerService(), localSongPlayerVocalsService(), localAudioToolsService(), persistentModelCache(), react()], clearScreen: false,
  build: { rollupOptions: { output: { manualChunks: { three: ["three"] } } }, chunkSizeWarningLimit: 700 },
  server: { port: 1420, strictPort: true, proxy: { "/autopost/api": { target: "http://127.0.0.1:1430", changeOrigin: true, rewrite: (path) => path.replace(/^\/autopost/, "") }, "/music/ai-quantizer/api": { target: "http://127.0.0.1:4173", changeOrigin: true, rewrite: (path) => path.replace(/^\/music\/ai-quantizer/, "") } } },
  envPrefix: ["VITE_", "TAURI_ENV_"]
});
