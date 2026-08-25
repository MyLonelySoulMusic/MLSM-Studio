import type { ImportedAudio } from "./audio-import";
import type { SongPlayerAsset, SongPlayerMatch, SongPlayerSettings } from "@rbs/project-schema";

export type SongPlayerRuntimeAsset = ImportedAudio & { assetId: string; kind: "fragment" | "fullTrack" };
export interface SongPlayerSpectrogramCacheRecord {
  version: 1; sourceHash: string; sampleRate: number; fftSize: number; hopSize: number; bands: number;
  frameCount: number; durationSeconds: number; minDb: -80; maxDb: 0; data: ArrayBuffer;
}
export interface SongPlayerAnalysis {
  sourceHash: string; durationSeconds: number; chromaHopSeconds: number; chroma: Float32Array;
  fingerprintVersion: "v1"; spectrogram: SongPlayerSpectrogramCacheRecord;
}
export type { SongPlayerAsset, SongPlayerMatch, SongPlayerSettings };

const runtimeAssets = new Map<string, SongPlayerRuntimeAsset>();
const MAX_RUNTIME_ASSETS = 8;
let currentProjectId: string | null = null;
function revoke(audio: ImportedAudio | undefined): void { if (audio?.url.startsWith("blob:")) URL.revokeObjectURL(audio.url); }
export function registerSongPlayerRuntimeAsset(projectId: string, asset: SongPlayerRuntimeAsset): void {
  if (currentProjectId !== projectId) replaceSongPlayerRuntimeProject(projectId);
  const previous = runtimeAssets.get(asset.assetId); if (previous && previous.url !== asset.url) revoke(previous);
  runtimeAssets.delete(asset.assetId);
  runtimeAssets.set(asset.assetId, asset);
  while (runtimeAssets.size > MAX_RUNTIME_ASSETS) { const oldestAssetId = runtimeAssets.keys().next().value as string | undefined; if (!oldestAssetId) break; unregisterSongPlayerRuntimeAsset(oldestAssetId); }
}
export function getSongPlayerRuntimeAsset(assetId: string): SongPlayerRuntimeAsset | null { return runtimeAssets.get(assetId) ?? null; }
export function unregisterSongPlayerRuntimeAsset(assetId: string): void { const previous = runtimeAssets.get(assetId); if (previous) revoke(previous); runtimeAssets.delete(assetId); }
export function replaceSongPlayerRuntimeProject(projectId: string): void {
  if (currentProjectId === projectId) return;
  runtimeAssets.forEach((asset) => revoke(asset)); runtimeAssets.clear(); currentProjectId = projectId;
}
export function getSongPlayerRuntimeProjectId(): string | null { return currentProjectId; }
export function clearSongPlayerRuntimeAssets(): void { runtimeAssets.forEach((asset) => revoke(asset)); runtimeAssets.clear(); currentProjectId = null; }
