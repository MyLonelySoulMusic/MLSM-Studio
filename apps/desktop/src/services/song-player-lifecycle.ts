import type { RhythmBallProject } from "@rbs/project-schema";
import { releaseImportedAudio, type AudioImportOwnership, type ImportedAudio } from "./audio-import";
import { clearSongPlayerRuntimeAssets, getSongPlayerRuntimeProjectId, registerSongPlayerRuntimeAsset, replaceSongPlayerRuntimeProject } from "./song-player-types";
import { useSongPlayerJobStore } from "../store/song-player-job-store";

export function ensureSongPlayerRuntimeProject(projectId: string): void {
  if (getSongPlayerRuntimeProjectId() !== projectId) replaceSongPlayerRuntimeProject(projectId);
  useSongPlayerJobStore.getState().replaceProject(projectId);
}
export function resetSongPlayerRuntimeForProjectReplacement(projectId: string): void {
  clearSongPlayerRuntimeAssets(); replaceSongPlayerRuntimeProject(projectId); useSongPlayerJobStore.getState().dispose(); useSongPlayerJobStore.getState().replaceProject(projectId);
}
export function disposeSongPlayerRuntime(): void { clearSongPlayerRuntimeAssets(); useSongPlayerJobStore.getState().dispose(); }

export async function rehydrateSongPlayerFullTrack(project: RhythmBallProject, load: (path: string) => Promise<ImportedAudio>, ownership?: AudioImportOwnership): Promise<ImportedAudio | null> {
  const settings = project.animation.songPlayer; const asset = settings.fullTrackAssetId ? settings.assets.find((candidate) => candidate.id === settings.fullTrackAssetId) : null;
  if (!asset) return null;
  const audio = await load(asset.sourcePath);
  if (ownership && !ownership.isCurrent()) { releaseImportedAudio(audio); throw new DOMException("Apertura progetto superata da un’operazione più recente.", "AbortError"); }
  if (audio.metadata.hash !== asset.hash) { releaseImportedAudio(audio); throw new Error(`La traccia completa “${asset.fileName}” è cambiata sul disco. Reimportala per recuperare la modalità Song Player.`); }
  registerSongPlayerRuntimeAsset(project.project.id, { ...audio, assetId: asset.id, kind: "fullTrack" }); return audio;
}
