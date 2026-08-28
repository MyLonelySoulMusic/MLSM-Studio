import { useAnalysisStore } from "../store/analysis-store";
import { useAudioStore } from "../store/audio-store";
import { useProjectStore } from "../store/project-store";
import { useSceneStore } from "../store/scene-store";
import { resetSongPlayerRuntimeForProjectReplacement } from "./song-player-lifecycle";
import { resetUpscalerRuntimeForProjectReplacement } from "./upscaler-batch-lifecycle";
import { clearVideoEditorSession } from "./video-editor-import";
import { resetCommentsInvasionRuntime } from "../store/comments-invasion-store";

/**
 * Area boundaries are new workspaces, not navigation tabs. Runtime media,
 * persisted editor settings and analysis results must never leak into the next
 * area selected from Studio Home.
 */
export function resetWorkspaceForAreaEntry(): void {
  const previousProject = useProjectStore.getState().project;
  clearVideoEditorSession(previousProject.animation.videoEditor.assets);
  resetUpscalerRuntimeForProjectReplacement();
  resetCommentsInvasionRuntime();
  useAudioStore.getState().reset();
  useAnalysisStore.getState().reset();
  useSceneStore.getState().reset();
  useProjectStore.getState().newProject();
  resetSongPlayerRuntimeForProjectReplacement(useProjectStore.getState().project.project.id);
}
