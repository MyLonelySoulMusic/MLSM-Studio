import { useAnalysisStore } from "../store/analysis-store";
import { useAudioStore } from "../store/audio-store";
import { useProjectStore } from "../store/project-store";
import { useSceneStore } from "../store/scene-store";
import { resetSongPlayerRuntimeForProjectReplacement } from "./song-player-lifecycle";
import { resetUpscalerRuntimeForProjectReplacement } from "./upscaler-batch-lifecycle";
import { clearVideoEditorSession } from "./video-editor-import";
import { resetCommentsInvasionRuntime } from "../store/comments-invasion-store";
import { resetFrameBoosterRuntimeForProjectReplacement } from "./frame-booster-source-file";
import { clearOverlaySpectralBackground } from "./overlay-spectral-background-runtime";
import { useVideoEditorPlayback } from "../store/video-editor-playback-store";
import { shutdownAreaPythonServices } from "./python-service-lifecycle";

/**
 * Area boundaries are new workspaces, not navigation tabs. Runtime media,
 * persisted editor settings and analysis results must never leak into the next
 * area selected from Studio Home.
 */
export function resetWorkspaceForAreaEntry(): void {
  void shutdownAreaPythonServices();
  const previousProject = useProjectStore.getState().project;
  clearVideoEditorSession(previousProject.animation.videoEditor.assets);
  resetUpscalerRuntimeForProjectReplacement();
  resetFrameBoosterRuntimeForProjectReplacement();
  clearOverlaySpectralBackground();
  resetCommentsInvasionRuntime();
  const videoEditorPlayback = useVideoEditorPlayback.getState(); videoEditorPlayback.stop(); videoEditorPlayback.setLooping(false); videoEditorPlayback.setZoom(1);
  useAudioStore.getState().reset();
  useAnalysisStore.getState().reset();
  useSceneStore.getState().reset();
  useProjectStore.getState().newProject();
  resetSongPlayerRuntimeForProjectReplacement(useProjectStore.getState().project.project.id);
}
