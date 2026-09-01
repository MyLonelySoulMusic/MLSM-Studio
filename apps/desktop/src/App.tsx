import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { ProjectService } from "@rbs/core";
import type { RhythmBallProject } from "@rbs/project-schema";
import { Toolbar } from "./components/Toolbar";
import { LibraryPanel } from "./components/LibraryPanel";
import { Viewport } from "./components/Viewport";
import { InspectorPanel } from "./components/InspectorPanel";
import { Timeline, type TimelineCompositorLayer } from "./components/Timeline";
import { TauriProjectRepository } from "./services/tauri-project-repository";
import { importAudio, importVideoFile, loadAudioFromPath, releaseImportedAudio } from "./services/audio-import";
import { useProjectStore } from "./store/project-store";
import { useAudioStore } from "./store/audio-store";
import { useAnalysisStore } from "./store/analysis-store";
import { WebAudioAnalyzer } from "./services/web-audio-analyzer";
import { createTrajectoryEvaluator, planTrajectory, type MotionKind, type ScheduledImpact } from "@rbs/trajectory";
import { rebaseSceneLight, useSceneStore } from "./store/scene-store";
import { isVerticalDescent } from "./services/scene-generator";
import { newYorkSewerEntryIndex, normalizeNewYorkLevels } from "./services/new-york-scene-generator";
import { generateSceneForMode } from "./services/mode-scene-generator";
import { ExportDialog, type ExportDialogStartSettings } from "./components/ExportDialog";
import { useExportStore } from "./store/export-store";
import { exportOfflineSceneVideo, type SharedViewportRenderer } from "./services/offline-video-exporter";
import { exportPixelsSubOfflineVideo } from "./services/pixels-sub-offline-exporter";
import { exportStaticWatermarkVideo } from "./services/static-watermark-exporter";
import { exportProSubtitleVideo, processProSubtitleVideo } from "./services/pro-subtitle-exporter";
import { isTauri } from "@tauri-apps/api/core";
import { deserializeSceneObjects, serializeSceneObjects } from "./services/scene-persistence";
import type { EditableSceneObject } from "./store/scene-store";
import { getAnimationMode } from "./services/animation-modes";
import { resolveCoverSpectrum } from "./services/cover-spectrum";
import { applyTeddyPhonemeTimeline, extractTeddyPhonemeCues, resolveTeddyLipSync } from "./services/teddy-lipsync";
import { ApplicationAssistant } from "./components/ApplicationAssistant";
import { proSubtitleAnimationOptions } from "./services/pro-subtitles";
import { WorkspaceResizeHandle } from "./components/WorkspaceResizeHandle";
import { DEFAULT_WORKSPACE_PANEL_WIDTHS, fitWorkspacePanelWidths, parseWorkspacePanelWidths, resizeWorkspacePanel, type WorkspacePanelSide } from "./services/workspace-layout";
import { clampTimelineHeight, DEFAULT_TIMELINE_HEIGHT, parseTimelineHeight } from "./services/timeline-layout";
import { StaticWatermarkInspector } from "./components/StaticWatermarkInspector";
import { UpscalerInspector } from "./components/UpscalerInspector";
import { PortraitLandscapePreview } from "./components/PortraitLandscapePreview";
import { PortraitLandscapeInspector } from "./components/PortraitLandscapeInspector";
import { exportPortraitLandscapeOfflineVideo } from "./services/portrait-landscape-offline-exporter";
import { VideoEditorPreview } from "./components/VideoEditorPreview";
import { VideoEditorInspector } from "./components/VideoEditorInspector";
import { VideoEditorTimeline } from "./components/VideoEditorTimeline";
import { VideoEditorWorkspace } from "./components/VideoEditorWorkspace";
import { AIQuantizerWorkspace } from "./components/AIQuantizerWorkspace";
import { MlsmPostLipsyncWorkspace } from "./components/MlsmPostLipsyncWorkspace";
import { exportVideoEditorOfflineVideo } from "./services/video-editor-offline-exporter";
import { videoEditorSourceTime, videoEditorTimelineDuration } from "./services/video-editor";
import { useVideoEditorPlayback } from "./store/video-editor-playback-store";
import { BackgroundAutoPreview } from "./components/BackgroundAutoPreview";
import { exportBackgroundAutoOfflineVideo } from "./services/background-auto-offline-exporter";
import { backgroundAutoConfigurationError } from "./services/background-auto-renderer";
import type { VideoEditorToolId } from "./services/video-editor-tools";
import { createVideoEditorArtifact, videoEditorToolSourceRange } from "./services/video-editor-tools";
import { processUpscaledVideo } from "./services/upscaler-video-exporter";
import { processStaticWatermarkVideo } from "./services/static-watermark-exporter";
import { videoEditorSessionFile } from "./services/video-editor-import";
import { FrameBoosterPreview } from "./components/FrameBoosterPreview";
import { FrameBoosterInspector } from "./components/FrameBoosterInspector";
import { useUpscalerBatchStore } from "./store/upscaler-batch-store";
import { resolveUpscalerDisplaySettings } from "./services/upscaler-batch";
import { resetUpscalerRuntimeForProjectReplacement } from "./services/upscaler-batch-lifecycle";
import { resetFrameBoosterRuntimeForProjectReplacement } from "./services/frame-booster-source-file";
import { clearOverlaySpectralBackground } from "./services/overlay-spectral-background-runtime";
import { requestMediaPlayback } from "./services/media-playback";
import { SongPlayerPreview } from "./components/SongPlayerPreview";
import { analyzeSongPlayerAudio } from "./services/song-player-analysis";
import { exportSongPlayerOfflineVideo } from "./services/song-player-offline-exporter";
import type { SongPlayerAnalysis } from "./services/song-player-types";
import { disposeSongPlayerRuntime, ensureSongPlayerRuntimeProject, rehydrateSongPlayerFullTrack, resetSongPlayerRuntimeForProjectReplacement } from "./services/song-player-lifecycle";
import { songPlayerPlaybackRange } from "./services/song-player-playback";
import { LatestOperation } from "./services/latest-operation";
import { CassetteDeskPreview } from "./components/CassetteDeskPreview";
import { buildCassetteDeskAnalysis } from "./services/cassette-desk";
import { playCassetteDeskIntro, type CassetteDeskIntroPlayback } from "./services/cassette-desk-audio";
import { exportCassetteDeskOfflineVideo } from "./services/cassette-desk-offline-exporter";
import { separateCassetteDeskVocals } from "./services/cassette-desk-vocals";
import type { CassetteDeskMusicalAnalysis, CassetteDeskPitchFrame } from "./services/cassette-desk";
import { CommentsInvasionPreview } from "./components/CommentsInvasionPreview";
import { CommentsInvasionInspector } from "./components/CommentsInvasionInspector";
import { exportCommentsInvasionOfflineVideo } from "./services/comments-invasion-offline-exporter";
import { resetCommentsInvasionRuntime, useCommentsInvasionStore } from "./store/comments-invasion-store";
import { OverlaySpectralPreview } from "./components/OverlaySpectralPreview";
import { exportOverlaySpectralOfflineVideo } from "./services/overlay-spectral-offline-exporter";

const WORKSPACE_LAYOUT_KEY = "dynamic-sound-animation-studio.workspace-layout.v1";
const TIMELINE_LAYOUT_KEY = "dynamic-sound-animation-studio.timeline-height.v1";
const VIDEO_EDITOR_TIMELINE_LAYOUT_KEY = "dynamic-sound-animation-studio.video-editor.timeline-height.v1";
type PlaybackPhase = "idle" | "intro" | "starting" | "playing";

function initialWorkspacePanelWidths() {
  if (typeof window === "undefined") return DEFAULT_WORKSPACE_PANEL_WIDTHS;
  return fitWorkspacePanelWidths(parseWorkspacePanelWidths(window.localStorage.getItem(WORKSPACE_LAYOUT_KEY)), window.innerWidth);
}

function initialTimelineHeight() {
  if (typeof window === "undefined") return DEFAULT_TIMELINE_HEIGHT;
  return parseTimelineHeight(window.localStorage.getItem(TIMELINE_LAYOUT_KEY), window.innerHeight);
}

function initialVideoEditorTimelineHeight() {
  if (typeof window === "undefined") return DEFAULT_TIMELINE_HEIGHT;
  return parseTimelineHeight(window.localStorage.getItem(VIDEO_EDITOR_TIMELINE_LAYOUT_KEY), window.innerHeight);
}

function objectSurfaceHeight(object: EditableSceneObject | undefined): number { if (!object) return .2; if (object.type === "kick") return .31; if (object.type === "snare") return .22; if (object.type === "drum") return .27; if (object.type === "guitar" || object.type === "strings") return .2; if (object.type === "pebble") return .12; if (object.type === "spring") return .54; if (object.type === "peg") return .75; if (object.type === "block") return .28; return .14; }

function probeVideoDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video"); video.preload = "metadata"; video.muted = true;
    video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight });
    video.onerror = () => reject(new Error("Impossibile leggere le dimensioni del video.")); video.src = url;
  });
}

export function App({ onHome }: { onHome?: () => void } = {}) {
  const store = useProjectStore(); const audio = useAudioStore(); const analysis = useAnalysisStore(); const exportState = useExportStore(); const sceneObjects = useSceneStore((state) => state.objects); const sceneBall = useSceneStore((state) => state.ball); const sceneBackground = useSceneStore((state) => state.background); const sceneRailColors = useSceneStore((state) => state.railColors); const sceneLight = useSceneStore((state) => state.light); const replaceScene = useSceneStore((state) => state.replace); const regenerateScene = useSceneStore((state) => state.regenerate); const resetScene = useSceneStore((state) => state.reset); const updateSceneBall = useSceneStore((state) => state.updateBall); const updateSceneBackground = useSceneStore((state) => state.updateBackground); const updateSceneLight = useSceneStore((state) => state.updateLight); const updateRailColor = useSceneStore((state) => state.updateRailColor); const { setCurrentTime, setPlaying, setDiagnostics, setSongPlayerSegmentOffsetSeconds } = audio; const audioElement = useRef<HTMLAudioElement>(null); const playbackIntent = useRef(0); const playbackPhase = useRef<PlaybackPhase>("idle"); const viewportRenderer = useRef<SharedViewportRenderer | null>(null); const workspace = useRef<HTMLDivElement>(null); const portraitAutoAnalysisHash = useRef<string | null>(null); const [workspacePanelWidths, setWorkspacePanelWidths] = useState(initialWorkspacePanelWidths); const [timelineHeight, setTimelineHeight] = useState(initialTimelineHeight); const [videoEditorTimelineHeight, setVideoEditorTimelineHeight] = useState(initialVideoEditorTimelineHeight); const [exportRenderTime, setExportRenderTime] = useState<number | null>(null); const [selectedPhonemeId, setSelectedPhonemeId] = useState<string | null>(null); const [selectedSubtitleId, setSelectedSubtitleId] = useState<string | null>(null); const analyzer = useRef(new WebAudioAnalyzer()); const onRendererReady = useCallback((renderer: SharedViewportRenderer | null) => { viewportRenderer.current = renderer; }, []); const overlaySpectralPlaybackTime = useCallback(() => audioElement.current?.currentTime ?? useAudioStore.getState().currentTime, []); const handleSelectObject = useCallback((id: string | null) => { useSceneStore.getState().select(id); if (id) useProjectStore.getState().selectEvent(null); }, []); const handleSelectMusicEvent = useCallback((id: string | null, additive = false) => { setSelectedPhonemeId(null); setSelectedSubtitleId(null); useSceneStore.getState().select(null); useProjectStore.getState().selectEvent(id, additive); }, []);
  const pauseMasterPlayback = useCallback((element: HTMLMediaElement | null = audioElement.current) => {
    playbackIntent.current += 1;
    playbackPhase.current = "idle";
    element?.pause();
    setPlaying(false);
  }, [setPlaying]);
  const upscalerBatchRunning = useUpscalerBatchStore((state) => state.running);
  const commentsInvasionAssets = useCommentsInvasionStore((state) => state.assets);
  const projectSourceOperation = useRef(new LatestOperation());
  const imported = audio.imported; const duration = imported?.metadata.durationSeconds ?? store.project.audio.durationSeconds;
  const songPlayerMode = store.project.animation.modeId === "songPlayer";
  const cassetteDeskMode = store.project.animation.modeId === "cassetteDesk";
  const overlaySpectralMode = store.project.animation.modeId === "overlaySpectral";
  const songPlayerOffsetSeconds = store.project.animation.songPlayer.match.selectedOffsetMs / 1000;
  const songPlayerRange = useMemo(() => songPlayerPlaybackRange(songPlayerOffsetSeconds, duration, audio.fullTrack?.metadata.durationSeconds ?? duration), [audio.fullTrack?.metadata.durationSeconds, duration, songPlayerOffsetSeconds]);
  const [cassetteVocalNotes,setCassetteVocalNotes]=useState<CassetteDeskPitchFrame[]>([]);const [cassetteMusicalAnalysis,setCassetteMusicalAnalysis]=useState<CassetteDeskMusicalAnalysis|null>(null);const [cassetteVocalsReady,setCassetteVocalsReady]=useState(false);const [cassetteVocalStatus,setCassetteVocalStatus]=useState("In attesa del brano");const [cassetteVocalError,setCassetteVocalError]=useState<string|null>(null);const [cassetteVocalRetry,setCassetteVocalRetry]=useState(0);
  const cassetteSettings=store.project.animation.cassetteDesk;
  const cassetteDeskAnalysis = useMemo(() => buildCassetteDeskAnalysis(analysis.result, imported?.waveform ?? store.project.analysis.waveform, cassetteVocalNotes, cassetteSettings.vocalToleranceCents,{musicalAnalysis:cassetteMusicalAnalysis,tempoDetectionMode:cassetteSettings.tempoDetectionMode,manualBpm:cassetteSettings.manualBpm,halfTime:cassetteSettings.halfTime,keyDetectionMode:cassetteSettings.keyDetectionMode,manualKeyRoot:cassetteSettings.manualKeyRoot,manualKeyMode:cassetteSettings.manualKeyMode}), [analysis.result, cassetteMusicalAnalysis, cassetteSettings.halfTime, cassetteSettings.keyDetectionMode, cassetteSettings.manualBpm, cassetteSettings.manualKeyMode, cassetteSettings.manualKeyRoot, cassetteSettings.tempoDetectionMode, cassetteSettings.vocalToleranceCents, cassetteVocalNotes, imported?.waveform, store.project.analysis.waveform]);
  const [cassetteIntroTime, setCassetteIntroTime] = useState(0); const [cassetteIntroPlayed, setCassetteIntroPlayed] = useState(false); const cassetteIntroPlayback = useRef<CassetteDeskIntroPlayback | null>(null);
  useEffect(() => { cassetteIntroPlayback.current?.cancel(); cassetteIntroPlayback.current=null; setCassetteIntroTime(0); setCassetteIntroPlayed(false); }, [imported?.url, cassetteDeskMode]);
  useEffect(() => () => cassetteIntroPlayback.current?.cancel(), []);
  useEffect(()=>{const retry=()=>setCassetteVocalRetry(value=>value+1);window.addEventListener("cassette-desk:retry-vocals",retry);return()=>window.removeEventListener("cassette-desk:retry-vocals",retry);},[]);
  useEffect(()=>{setCassetteVocalNotes([]);setCassetteMusicalAnalysis(null);setCassetteVocalsReady(false);setCassetteVocalError(null);if(!cassetteDeskMode||!imported){setCassetteVocalStatus("In attesa del brano");return;}const controller=new AbortController();const sourceHash=imported.metadata.hash;setCassetteVocalStatus("Separazione voce · caricamento Demucs…");void separateCassetteDeskVocals(imported,controller.signal,(progress,message)=>setCassetteVocalStatus(`${message} · ${Math.round(progress*100)}%`)).then(result=>{if(controller.signal.aborted||useAudioStore.getState().imported?.metadata.hash!==sourceHash)return;setCassetteVocalNotes(result.notes);setCassetteMusicalAnalysis(result.musicalAnalysis);setCassetteVocalsReady(true);const musical=result.musicalAnalysis?` · ${result.musicalAnalysis.bpm.toFixed(1)} BPM`:result.musicalAnalysisError?" · usa BPM/Key manuali":"";setCassetteVocalStatus(`Voce separata · ${result.notes.length} note${musical}`);}).catch(error=>{if(controller.signal.aborted)return;setCassetteVocalError(error instanceof Error?error.message:String(error));setCassetteVocalStatus("Separazione vocale non disponibile");});return()=>controller.abort();},[cassetteDeskMode,cassetteVocalRetry,imported]);
  const upscalerPreviewItemId = useUpscalerBatchStore((state) => state.previewItemId);
  const upscalerBatchItems = useUpscalerBatchStore((state) => state.items);
  const upscalerPreviewItem = useMemo(() => upscalerBatchItems.find((item) => item.id === upscalerPreviewItemId) ?? null, [upscalerBatchItems, upscalerPreviewItemId]);
  const upscalerDisplaySettings = useMemo(() => resolveUpscalerDisplaySettings(store.project.animation.upscaler, upscalerPreviewItem), [store.project.animation.upscaler, upscalerPreviewItem]);
  const timelineResizeFrame = useRef<number | null>(null); const requestedTimelineHeight = useRef(timelineHeight);
  const resizeTimelineHeight = useCallback((height: number) => {
    requestedTimelineHeight.current = clampTimelineHeight(height, window.innerHeight);
    if (timelineResizeFrame.current !== null) return;
    timelineResizeFrame.current = window.requestAnimationFrame(() => { timelineResizeFrame.current = null; setTimelineHeight(requestedTimelineHeight.current); });
  }, []);
  const videoEditorTimelineResizeFrame = useRef<number | null>(null); const requestedVideoEditorTimelineHeight = useRef(videoEditorTimelineHeight);
  const resizeVideoEditorTimelineHeight = useCallback((height: number) => {
    requestedVideoEditorTimelineHeight.current = clampTimelineHeight(height, window.innerHeight);
    if (videoEditorTimelineResizeFrame.current !== null) return;
    videoEditorTimelineResizeFrame.current = window.requestAnimationFrame(() => { videoEditorTimelineResizeFrame.current = null; setVideoEditorTimelineHeight(requestedVideoEditorTimelineHeight.current); });
  }, []);
  useEffect(() => { try { window.localStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(workspacePanelWidths)); } catch { /* Il ridimensionamento resta attivo per la sessione. */ } }, [workspacePanelWidths]);
  useEffect(() => { requestedTimelineHeight.current = timelineHeight; try { window.localStorage.setItem(TIMELINE_LAYOUT_KEY, String(timelineHeight)); } catch { /* Il ridimensionamento resta attivo per la sessione. */ } }, [timelineHeight]);
  useEffect(() => { requestedVideoEditorTimelineHeight.current = videoEditorTimelineHeight; try { window.localStorage.setItem(VIDEO_EDITOR_TIMELINE_LAYOUT_KEY, String(videoEditorTimelineHeight)); } catch { /* Il layout del Video Editor resta attivo per la sessione. */ } }, [videoEditorTimelineHeight]);
  useEffect(() => () => { if (timelineResizeFrame.current !== null) window.cancelAnimationFrame(timelineResizeFrame.current); if (videoEditorTimelineResizeFrame.current !== null) window.cancelAnimationFrame(videoEditorTimelineResizeFrame.current); }, []);
  useEffect(() => {
    const fit = () => setWorkspacePanelWidths((current) => fitWorkspacePanelWidths(current, workspace.current?.clientWidth ?? window.innerWidth));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  useEffect(() => {
    const fit = () => setTimelineHeight((current) => clampTimelineHeight(current, window.innerHeight));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  useEffect(() => {
    const fit = () => setVideoEditorTimelineHeight((current) => clampTimelineHeight(current, window.innerHeight));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  const resizeWorkspaceSide = useCallback((side: WorkspacePanelSide, width: number) => {
    setWorkspacePanelWidths((current) => resizeWorkspacePanel(current, side, width, workspace.current?.clientWidth ?? window.innerWidth));
  }, []);
  const workspaceStyle = { "--library-width": `${workspacePanelWidths.left}px`, "--inspector-width": `${workspacePanelWidths.right}px` } as CSSProperties;
  const applyGeneratedScene = useCallback((project: RhythmBallProject) => { const generated = generateSceneForMode(project); const availableTypes = new Set(getAnimationMode(project.animation.modeId).objectTypes.map((item) => item.type)); const sceneState = useSceneStore.getState(); const current = sceneState.objects; const rebasedLight = rebaseSceneLight(sceneState.light, current, generated); if (current.length && current.every((object) => availableTypes.has(object.type))) regenerateScene(generated); else replaceScene(generated); sceneState.updateLight(rebasedLight); }, [regenerateScene, replaceScene]);
  useEffect(() => { ensureSongPlayerRuntimeProject(store.project.project.id); }, [store.project.project.id]);
  useEffect(() => () => { playbackIntent.current += 1; playbackPhase.current = "idle"; projectSourceOperation.current.invalidate(); clearOverlaySpectralBackground(); disposeSongPlayerRuntime(); }, []);
  useEffect(() => {
    playbackIntent.current += 1;
    playbackPhase.current = "idle";
    setPlaying(false);
  }, [imported?.url, setPlaying]);
  useEffect(() => {
    const element = audioElement.current; if (!element) return;
    const update = () => setCurrentTime(Math.max(0, Math.min(duration, element.currentTime)));
    const playing = () => { if (playbackPhase.current === "starting" || playbackPhase.current === "playing") { playbackPhase.current = "playing"; setPlaying(true); } };
    const paused = () => { if (playbackPhase.current === "playing") { playbackIntent.current += 1; playbackPhase.current = "idle"; setPlaying(false); } };
    const failed = () => { if (playbackPhase.current === "idle") return; playbackIntent.current += 1; playbackPhase.current = "idle"; setPlaying(false); useAudioStore.getState().setError(element.error?.message ? `Riproduzione audio non riuscita: ${element.error.message}` : "Riproduzione audio non riuscita."); };
    const ended = () => { playbackIntent.current += 1; playbackPhase.current = "idle"; setPlaying(false); if (cassetteDeskMode) { setCassetteIntroPlayed(false); setCassetteIntroTime(0); } };
    element.addEventListener("timeupdate", update); element.addEventListener("playing", playing); element.addEventListener("pause", paused); element.addEventListener("error", failed); element.addEventListener("ended", ended);
    return () => { element.removeEventListener("timeupdate", update); element.removeEventListener("playing", playing); element.removeEventListener("pause", paused); element.removeEventListener("error", failed); element.removeEventListener("ended", ended); };
  }, [cassetteDeskMode, duration, setCurrentTime, setPlaying]);
  useEffect(() => {
    if (!audio.playing) return; let animationFrame = 0; let last = performance.now(); let windowStart = last; let frames = 0; let dropped = audio.droppedFrames;
    const tick = (now: number) => { const element = audioElement.current; if (!element) return; const interval = now - last; if (interval > 50) dropped += Math.max(1, Math.round(interval / (1000 / 30)) - 1); last = now; frames += 1; setCurrentTime(Math.max(0, Math.min(duration, element.currentTime))); if (now - windowStart >= 1000) { setDiagnostics(frames * 1000 / (now - windowStart), dropped, 0); frames = 0; windowStart = now; } animationFrame = requestAnimationFrame(tick); };
    animationFrame = requestAnimationFrame(tick); return () => cancelAnimationFrame(animationFrame);
  }, [audio.droppedFrames, audio.playing, duration, setCurrentTime, setDiagnostics]);
  const saveProject = useCallback(async () => {
    try {
      const repository = new TauriProjectRepository(store.filePath);
      const liveOverlay = store.project.animation.overlaySpectral;
      const persistedOverlay = liveOverlay.backgroundImageUrl?.startsWith("blob:") ? { ...liveOverlay, backgroundImageUrl: null, backgroundMediaType: "image" as const } : liveOverlay;
      const snapshot = {
        ...store.project,
        animation: { ...store.project.animation, overlaySpectral: persistedOverlay },
        objects: serializeSceneObjects(sceneObjects),
        ball: { ...store.project.ball, radius: sceneBall.radius, material: { ...store.project.ball.material, color: sceneBall.color, emission: sceneBall.emission, metalness: sceneBall.metalness }, trailEnabled: sceneBall.trailEnabled, innerColor: sceneBall.innerColor, innerShape: sceneBall.innerShape, innerImageUrl: sceneBall.innerImageUrl, endRevealEnabled: sceneBall.endRevealEnabled, revealMode: sceneBall.revealMode, revealTimeSeconds: sceneBall.revealTimeSeconds, revealHoldSeconds: sceneBall.revealHoldSeconds },
        background: { ...store.project.background, type: sceneBackground.imageUrl ? sceneBackground.mediaType : "linearGradient" as const, colors: sceneBackground.colors, imageUrl: sceneBackground.imageUrl, presetId: sceneBackground.presetId, finish: sceneBackground.finish, opacity: sceneBackground.opacity, blur: sceneBackground.blur, effects: sceneBackground.effects, neon: sceneBackground.neon, railColors: sceneRailColors },
        lighting: { ...sceneLight, origin: { x: sceneLight.origin[0], y: sceneLight.origin[1], z: sceneLight.origin[2] }, target: { x: sceneLight.target[0], y: sceneLight.target[1], z: sceneLight.target[2] } }
      };
      const saved = await new ProjectService(repository).save(snapshot);
      if (repository.filePath) {
        const liveSaved = liveOverlay.backgroundImageUrl?.startsWith("blob:") ? { ...saved, animation: { ...saved.animation, overlaySpectral: liveOverlay } } : saved;
        store.markSaved(liveSaved, repository.filePath);
      }
    } catch (error) { store.setStatus(error instanceof Error ? error.message : "Errore durante il salvataggio"); }
  }, [sceneBackground, sceneBall, sceneLight, sceneObjects, sceneRailColors, store]);
  const openProject = useCallback(async () => {
    const operation = projectSourceOperation.current.begin();
    try {
      const repository = new TauriProjectRepository(null); if (!(await repository.chooseForLoad()) || !operation.isCurrent()) return; const loaded = await new ProjectService(repository).load(); if (!operation.isCurrent() || !loaded || !repository.filePath) return;
      pauseMasterPlayback(); resetUpscalerRuntimeForProjectReplacement(); resetFrameBoosterRuntimeForProjectReplacement(); resetCommentsInvasionRuntime(); clearOverlaySpectralBackground(); resetSongPlayerRuntimeForProjectReplacement(loaded.project.id); audio.reset(); analysis.reset(); store.setProject(loaded, repository.filePath);
      if (loaded.objects.length) replaceScene(deserializeSceneObjects(loaded.objects)); updateSceneBall({ radius: loaded.ball.radius, color: loaded.ball.material.color, emission: loaded.ball.material.emission, metalness: loaded.ball.material.metalness, trailEnabled: loaded.ball.trailEnabled, innerColor: loaded.ball.innerColor, innerShape: loaded.ball.innerShape, innerImageUrl: loaded.ball.innerImageUrl, endRevealEnabled: loaded.ball.endRevealEnabled, revealMode: loaded.ball.revealMode, revealTimeSeconds: loaded.ball.revealTimeSeconds, revealHoldSeconds: loaded.ball.revealHoldSeconds }); updateSceneBackground({ colors: [loaded.background.colors[0] ?? "#0d1020", loaded.background.colors[1] ?? "#211238"], imageUrl: loaded.background.imageUrl, mediaType: loaded.background.type === "video" ? "video" : "image", presetId: loaded.background.presetId as typeof sceneBackground.presetId, finish: loaded.background.finish, opacity: loaded.background.opacity, blur: loaded.background.blur, effects: loaded.background.effects, neon: loaded.background.neon }); updateSceneLight({ ...loaded.lighting, origin: [loaded.lighting.origin.x, loaded.lighting.origin.y, loaded.lighting.origin.z], target: [loaded.lighting.target.x, loaded.lighting.target.y, loaded.lighting.target.z] }); updateRailColor("pinball", loaded.background.railColors.pinball); updateRailColor("glassTube", loaded.background.railColors.glassTube); updateRailColor("bricks", loaded.background.railColors.bricks);
      if (loaded.audio.sourcePath && isTauri()) { const fragmentAudio = await loadAudioFromPath(loaded.audio.sourcePath); if (!operation.isCurrent() || useProjectStore.getState().project.project.id !== loaded.project.id) { releaseImportedAudio(fragmentAudio); return; } audio.setImported(fragmentAudio); } else if (loaded.audio.sourcePath) store.setStatus("Progetto caricato: reimporta l’audio per riattivare la preview web");
      if (isTauri()) { try { const fullTrackAudio = await rehydrateSongPlayerFullTrack(loaded, loadAudioFromPath, { isCurrent: () => operation.isCurrent() && useProjectStore.getState().project.project.id === loaded.project.id }); if (!operation.isCurrent() || useProjectStore.getState().project.project.id !== loaded.project.id) { releaseImportedAudio(fullTrackAudio); return; } audio.setFullTrack(fullTrackAudio); } catch (error) { if (!operation.isCurrent() || (error instanceof DOMException && error.name === "AbortError")) return; audio.setFullTrack(null); store.setStatus(error instanceof Error ? error.message : "Traccia completa non recuperabile: reimportala."); } }
    }
    catch (error) { if (operation.isCurrent()) store.setStatus(error instanceof Error ? error.message : "Errore durante l'apertura"); }
  }, [analysis, audio, pauseMasterPlayback, replaceScene, sceneBackground, store, updateRailColor, updateSceneBackground, updateSceneBall, updateSceneLight]);
  const newProject = useCallback(() => {
    if (store.dirty && !window.confirm("Le modifiche non salvate andranno perse. Continuare?")) return;
    projectSourceOperation.current.invalidate(); pauseMasterPlayback(); resetUpscalerRuntimeForProjectReplacement(); resetFrameBoosterRuntimeForProjectReplacement(); resetCommentsInvasionRuntime(); clearOverlaySpectralBackground(); audio.reset(); analysis.reset(); resetScene(); store.newProject(); resetSongPlayerRuntimeForProjectReplacement(useProjectStore.getState().project.project.id);
  }, [analysis, audio, pauseMasterPlayback, resetScene, store]);
  const handleImportAudio = useCallback(async () => {
    const operation = projectSourceOperation.current.begin(); const ownerProjectId = useProjectStore.getState().project.project.id; const isCurrent = () => operation.isCurrent() && useProjectStore.getState().project.project.id === ownerProjectId;
    audio.setLoading(true); audio.setError(null);
    try { const imported = await importAudio({ isCurrent }); if (!imported) { if (isCurrent()) audio.setLoading(false); return; } if (!isCurrent()) { releaseImportedAudio(imported); return; } analysis.reset(); audio.setImported(imported); store.attachAudio(imported.metadata, imported.waveform); }
    catch (error) { if (!isCurrent() || (error instanceof DOMException && error.name === "AbortError")) return; const message = error instanceof Error ? error.message : String(error); audio.setError(message); store.setStatus(message); }
  }, [analysis, audio, store]);
  const handleImportSubtitleVideo = useCallback(async (file: File) => {
    const operation = projectSourceOperation.current.begin();
    const ownerProjectId = useProjectStore.getState().project.project.id;
    const ownerMode = useProjectStore.getState().project.animation.modeId;
    const ownsProject = () => operation.isCurrent() && useProjectStore.getState().project.project.id === ownerProjectId;
    const isCurrent = () => ownsProject() && useProjectStore.getState().project.animation.modeId === ownerMode;
    let importedVideo: Awaited<ReturnType<typeof importVideoFile>> | null = null;
    let adopted = false;
    audio.setLoading(true); audio.setError(null);
    try {
      importedVideo = await importVideoFile(file);
      if (!isCurrent()) { releaseImportedAudio(importedVideo); if (ownsProject()) audio.setLoading(false); return; }
      const currentMode = ownerMode;
      const needsDimensions = currentMode === "staticWatermark" || currentMode === "portraitLandscape" || currentMode === "commentsInvasion";
      const dimensions = needsDimensions ? await probeVideoDimensions(importedVideo.url) : null;
      if (!isCurrent()) { releaseImportedAudio(importedVideo); if (ownsProject()) audio.setLoading(false); return; }
      const preserveSubtitleTrack = currentMode === "proSubtitles" || currentMode === "portraitLandscape" || currentMode === "commentsInvasion" || currentMode === "staticWatermark";
      analysis.reset(); audio.setImported(importedVideo); adopted = true; store.attachAudio(importedVideo.metadata, importedVideo.waveform, { preserveSubtitleTrack });
      if (currentMode === "staticWatermark") {
        if (!dimensions) throw new Error("Dimensioni del video non disponibili.");
        store.updateStaticWatermark({ videoUrl: importedVideo.url, videoName: file.name, videoWidth: dimensions.width, videoHeight: dimensions.height });
        store.setAspectRatio(dimensions.width >= dimensions.height ? "16:9" : "9:16");
        store.setStatus(`${file.name} caricato · trascina sulla preview per selezionare il watermark`);
      } else if (currentMode === "portraitLandscape") {
        if (!dimensions) throw new Error("Dimensioni del video non disponibili.");
        portraitAutoAnalysisHash.current = null;
        store.updatePortraitLandscape({ videoUrl: importedVideo.url, videoName: file.name, videoWidth: dimensions.width, videoHeight: dimensions.height, videoHasAudio: importedVideo.waveform.length > 0 });
        store.setAspectRatio("16:9"); store.setStatus(`${file.name} caricato · analisi automatica di spettro e ritmo…`);
      } else if (currentMode === "commentsInvasion") {
        if (!dimensions) throw new Error("Dimensioni del video non disponibili.");
        store.updateCommentsInvasion({ videoUrl: importedVideo.url, videoName: file.name, videoWidth: dimensions.width, videoHeight: dimensions.height, videoHasAudio: importedVideo.waveform.length > 0 });
        store.setCanvasFormat({ aspectRatio: "custom", width: dimensions.width, height: dimensions.height });
        store.setStatus(`${file.name} caricato · rapporto ${dimensions.width}:${dimensions.height} preservato`);
      } else if (currentMode === "proSubtitles") { store.updateProSubtitles({ videoUrl: importedVideo.url, videoName: file.name }); store.setStatus(`${file.name} caricato · video guida e timeline pronti`); }
    } catch (error) {
      if (importedVideo && !adopted) releaseImportedAudio(importedVideo);
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : String(error); audio.setError(message); store.setStatus(message);
    }
  }, [analysis, audio, store]);
  const handleAnalyze = useCallback(async () => {
    const imported = audio.imported; if (!imported) return; analysis.start();
    try { const completed = await analyzer.current.analyze(imported.url, imported.metadata.hash, undefined, analysis.updateProgress); analysis.complete(completed.result, completed.cached); store.applyAnalysis(completed.result); const current = useProjectStore.getState(); if (current.project.animation.modeId === "teddySing") { const settings = current.project.animation.teddySing; current.setTeddySingPhonemes(extractTeddyPhonemeCues(completed.result.energy, settings.vocalSensitivity, settings.lipSyncIntensity)); } applyGeneratedScene(useProjectStore.getState().project); }
    catch (error) { analysis.fail(error instanceof Error ? error.message : String(error)); }
  }, [analysis, applyGeneratedScene, audio.imported, store]);
  useEffect(() => { if ((cassetteDeskMode || overlaySpectralMode) && imported && !analysis.result && !analysis.running && !analysis.error) void handleAnalyze(); }, [analysis.error, analysis.result, analysis.running, cassetteDeskMode, handleAnalyze, imported, overlaySpectralMode]);
  const seek = useCallback((time: number) => { if (!audioElement.current) return; const local = Math.max(0, Math.min(duration, time)); cassetteIntroPlayback.current?.cancel(); cassetteIntroPlayback.current=null; setCassetteIntroPlayed(local > 0); setCassetteIntroTime(local > 0 ? store.project.animation.cassetteDesk.introDurationSeconds : 0); audioElement.current.currentTime = local; audio.setCurrentTime(local); }, [audio, duration, store.project.animation.cassetteDesk.introDurationSeconds]);
  const playPause = useCallback(() => {
    const element = audioElement.current; if (!element) return;
    const beginPlayback = () => {
      const intent = ++playbackIntent.current;
      playbackPhase.current = "starting";
      const requested = requestMediaPlayback(element, () => playbackIntent.current === intent);
      audio.setError(null);
      audio.setPlaying(false);
      void requested.then((started) => {
        if (playbackIntent.current !== intent) return;
        if (!started) { playbackPhase.current = "idle"; audio.setPlaying(false); return; }
        if (playbackPhase.current === "starting") { playbackPhase.current = "playing"; audio.setPlaying(true); }
      }).catch((error: unknown) => {
        if (playbackIntent.current !== intent) return;
        playbackPhase.current = "idle"; audio.setPlaying(false); audio.setError(error instanceof Error ? error.message : String(error));
      });
    };
    if (cassetteIntroPlayback.current) { cassetteIntroPlayback.current.cancel(); cassetteIntroPlayback.current=null; pauseMasterPlayback(element); return; }
    if (playbackPhase.current === "intro" || playbackPhase.current === "starting" || playbackPhase.current === "playing") { pauseMasterPlayback(element); return; }
    if (cassetteDeskMode && element.currentTime < .005 && !cassetteIntroPlayed) { playbackIntent.current += 1; playbackPhase.current = "intro"; const playback=playCassetteDeskIntro(store.project.animation.cassetteDesk.introDurationSeconds,setCassetteIntroTime); cassetteIntroPlayback.current=playback; audio.setPlaying(true); void playback.finished.then(()=>{if(cassetteIntroPlayback.current!==playback || playbackPhase.current !== "intro")return;cassetteIntroPlayback.current=null;setCassetteIntroPlayed(true);beginPlayback();}); return; }
    if (element.currentTime >= duration - .005) element.currentTime = 0;
    beginPlayback();
  }, [audio, cassetteDeskMode, cassetteIntroPlayed, duration, pauseMasterPlayback, store.project.animation.cassetteDesk.introDurationSeconds]);
  const stop = useCallback(() => { cassetteIntroPlayback.current?.cancel(); cassetteIntroPlayback.current=null; pauseMasterPlayback(); seek(0); }, [pauseMasterPlayback, seek]);
  useEffect(() => {
    setSongPlayerSegmentOffsetSeconds(songPlayerRange.startSeconds);
  }, [setSongPlayerSegmentOffsetSeconds, songPlayerRange.startSeconds]);
  useEffect(() => {
    const settings = store.project.animation.teddySing;
    if (store.project.animation.modeId !== "teddySing" || !analysis.result || settings.phonemesGenerated) return;
    store.setTeddySingPhonemes(extractTeddyPhonemeCues(analysis.result.energy, settings.vocalSensitivity, settings.lipSyncIntensity));
  }, [analysis.result, store, store.project.animation.modeId, store.project.animation.teddySing]);
  useEffect(() => { if (selectedPhonemeId && !store.project.animation.teddySing.phonemeCues.some((cue) => cue.id === selectedPhonemeId)) setSelectedPhonemeId(null); }, [selectedPhonemeId, store.project.animation.teddySing.phonemeCues]);
  useEffect(() => { if (selectedSubtitleId && !store.project.subtitles.cues.some((cue) => cue.id === selectedSubtitleId)) setSelectedSubtitleId(null); }, [selectedSubtitleId, store.project.subtitles.cues]);
  const videoEditorMode = store.project.animation.modeId === "videoEditor";
  const aiQuantizerMode = store.project.animation.modeId === "aiQuantizer";
  const mlsmPostLipsyncMode = store.project.animation.modeId === "mlsmPostLipsync";
  useEffect(() => {
    const keyboardPlayback = (event: KeyboardEvent) => {
      // Nel Video Editor la barra spaziatrice appartiene al trasporto del montaggio.
      if (videoEditorMode || aiQuantizerMode || mlsmPostLipsyncMode || (event.code !== "Space" && event.key !== " ") || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || duration <= 0 || exportState.open || exportState.running) return;
      const target = event.target; if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select, button, [role='button']"))) return;
      event.preventDefault(); playPause();
    };
    window.addEventListener("keydown", keyboardPlayback); return () => window.removeEventListener("keydown", keyboardPlayback);
  }, [aiQuantizerMode, duration, exportState.open, exportState.running, mlsmPostLipsyncMode, playPause, videoEditorMode]);
  const walkingCubeMode = store.project.animation.modeId === "walkingCube";
  const portraitLandscapeMode = store.project.animation.modeId === "portraitLandscape";
  const commentsInvasionMode = store.project.animation.modeId === "commentsInvasion";
  useEffect(() => {
    if (!portraitLandscapeMode || !imported || analysis.result || analysis.running || portraitAutoAnalysisHash.current === imported.metadata.hash) return;
    portraitAutoAnalysisHash.current = imported.metadata.hash; analysis.start(); store.setStatus(`${imported.metadata.fileName} · analisi automatica di spettro e ritmo…`);
    void analyzer.current.analyze(imported.url, imported.metadata.hash, undefined, analysis.updateProgress).then((completed) => {
      analysis.complete(completed.result, completed.cached); const state = useProjectStore.getState(); state.applyAnalysis(completed.result); state.updatePortraitLandscape({ videoHasAudio: true }); state.setStatus(`${imported.metadata.fileName} · 48 bande stereo sincronizzate al brano`);
    }).catch(() => { analysis.reset(); useProjectStore.getState().setStatus(`${imported.metadata.fileName} · codec audio non analizzabile, visualizer di sicurezza attivo`); });
  }, [analysis, imported, portraitLandscapeMode, store]);
  const pixelsSubMode = store.project.animation.modeId === "pixelsSub";
  const backgroundAutoMode = store.project.animation.modeId === "backgroundAuto";
  const staticWatermarkMode = store.project.animation.modeId === "staticWatermark";
  const upscalerMode = store.project.animation.modeId === "upscaler";
  const frameBoosterMode = store.project.animation.modeId === "frameBooster";
  const [songPlayerAnalysis, setSongPlayerAnalysis] = useState<SongPlayerAnalysis | null>(null);
  const [songPlayerAnalysisError, setSongPlayerAnalysisError] = useState<string | null>(null);
  const songPlayerAnalysisHash = useRef<string | null>(null);
  useEffect(() => {
    const source = audio.fullTrack; if (!songPlayerMode || !source) { songPlayerAnalysisHash.current = null; setSongPlayerAnalysis(null); setSongPlayerAnalysisError(null); return; } if (songPlayerAnalysisHash.current === source.metadata.hash) return;
    const projectId = store.project.project.id; const sourceHash = source.metadata.hash; const controller = new AbortController(); songPlayerAnalysisHash.current = sourceHash; setSongPlayerAnalysis(null); setSongPlayerAnalysisError(null);
    void analyzeSongPlayerAudio(source, undefined, controller.signal).then((result) => { const current = useProjectStore.getState().project.project.id; const activeSource = useAudioStore.getState().fullTrack?.metadata.hash; if (controller.signal.aborted || current !== projectId || activeSource !== sourceHash) return; setSongPlayerAnalysis(result); setSongPlayerAnalysisError(null); analysis.completeSongPlayer(sourceHash, result); }).catch((error: unknown) => { const current = useProjectStore.getState().project.project.id; const activeSource = useAudioStore.getState().fullTrack?.metadata.hash; if (controller.signal.aborted || current !== projectId || activeSource !== sourceHash) return; setSongPlayerAnalysis(null); setSongPlayerAnalysisError(error instanceof Error ? error.message : "Analisi audio reale non disponibile."); });
    return () => controller.abort();
  }, [analysis, audio.fullTrack, songPlayerMode, store.project.project.id]);
  const videoEditorSettings = store.project.animation.videoEditor;
  const openVideoEditorTool = useCallback((toolId: VideoEditorToolId, clipId: string) => {
    const settings = useProjectStore.getState().project.animation.videoEditor;
    const clip = settings.clips.find((item) => item.id === clipId);
    const asset = clip ? settings.assets.find((item) => item.id === clip.assetId) : null;
    if (!clip || !asset) return;
    if (toolId === "upscaler") {
      const { sourceDurationSeconds } = videoEditorToolSourceRange(clip, settings.timebase);
      store.updateUpscaler({ sourceUrl: asset.url, sourceName: asset.name, sourceKind: asset.kind === "video" ? "video" : "image", sourceWidth: asset.width, sourceHeight: asset.height, durationSeconds: sourceDurationSeconds });
      store.setAnimationMode("upscaler", store.project.animation.baseObjectTypes);
    } else if (toolId === "pro-subtitles") {
      store.updateProSubtitles({ videoUrl: asset.url, videoName: asset.name });
      store.setAnimationMode("proSubtitles", store.project.animation.baseObjectTypes);
    } else {
      store.setStatus("Watermark Remover: backend artifact non disponibile; nessun output simulato.");
    }
  }, [store]);
  const runVideoEditorTool = useCallback(async (toolId: VideoEditorToolId, clipId: string, signal: AbortSignal) => {
    const settings = useProjectStore.getState().project.animation.videoEditor;
    const clip = settings.clips.find((item) => item.id === clipId);
    const asset = clip ? settings.assets.find((item) => item.id === clip.assetId) : null;
    if (!clip || !asset) throw new Error("Clip selezionata non disponibile.");
    const { sourceStartSeconds, sourceDurationSeconds } = videoEditorToolSourceRange(clip, settings.timebase);
    if (toolId === "upscaler") {
      if (asset.kind !== "video") throw new Error("Upscaler video richiede una clip video.");
      const result = await processUpscaledVideo({ projectName: store.project.project.name, quality: "high", sourceVideoUrl: asset.url, sourceVideoFile: videoEditorSessionFile(asset.id), sourceStartSeconds, sourceDurationSeconds, upscalerSettings: { ...store.project.animation.upscaler, sourceUrl: asset.url, sourceName: asset.name, sourceKind: "video", sourceWidth: asset.width, sourceHeight: asset.height, durationSeconds: sourceDurationSeconds } }, signal, () => undefined);
      return createVideoEditorArtifact(toolId, clip, asset, URL.createObjectURL(result.blob), { name: result.fileName, sourceFrameCount: result.sourceFrameCount, sourceDurationSeconds, ...(asset.sourceRate ? { sourceRate: asset.sourceRate } : {}) });
    }
    if (toolId === "watermark-remover") {
      const watermark = store.project.animation.staticWatermark;
      if (!watermark.referenceImageUrl) throw new Error("Watermark Remover richiede prima un’immagine di riferimento.");
      if (asset.kind !== "video") throw new Error("Watermark Remover richiede una clip video.");
      const result = await processStaticWatermarkVideo({ projectName: store.project.project.name, quality: "high", sourceVideoUrl: asset.url, sourceVideoFile: videoEditorSessionFile(asset.id), sourceStartSeconds, sourceDurationSeconds, referenceImageUrl: watermark.referenceImageUrl, watermarkSettings: watermark }, signal, () => undefined);
      return createVideoEditorArtifact(toolId, clip, asset, URL.createObjectURL(result.blob), { name: result.fileName, sourceFrameCount: result.sourceFrameCount, sourceDurationSeconds, ...(asset.sourceRate ? { sourceRate: asset.sourceRate } : {}) });
    }
    if (asset.kind !== "video") throw new Error("Pro Subtitles richiede una clip video.");
    const clipStart = clip.startSeconds;
    const clipEnd = clip.startSeconds + clip.durationSeconds;
    const sourceRelativeCues = store.project.subtitles.cues.flatMap((cue) => {
      const timelineStart = Math.max(clipStart, cue.startSeconds);
      const timelineEnd = Math.min(clipEnd, cue.endSeconds);
      if (timelineEnd <= timelineStart || !cue.text.trim()) return [];
      const sourceStart = videoEditorSourceTime(clip, timelineStart, settings.timebase);
      const sourceEnd = videoEditorSourceTime(clip, timelineEnd, settings.timebase);
      return [{
        ...cue,
        // I tool elaborano sempre l'intervallo sorgente crescente; la nuova clip
        // conserva `reversed` e applica l'inversione dopo il processing.
        startSeconds: Math.min(sourceStart, sourceEnd),
        endSeconds: Math.max(sourceStart, sourceEnd)
      }];
    });
    const fps = (settings.timebase?.fpsNumerator ?? 60) / Math.max(1, settings.timebase?.fpsDenominator ?? 1);
    const renderer = {
      canvas: document.createElement("canvas"),
      setExportSize: () => undefined,
      restorePreviewSize: () => undefined,
      renderNow: () => undefined
    };
    const result = await processProSubtitleVideo({
      width: Math.max(2, asset.width),
      height: Math.max(2, asset.height),
      fps,
      durationSeconds: sourceDurationSeconds,
      projectName: store.project.project.name,
      quality: "high",
      outputMode: "completeVideo",
      backgroundMode: "solid",
      backgroundColor: "#000000",
      sourceVideoUrl: asset.url,
      sourceVideoFile: videoEditorSessionFile(asset.id),
      sourceVideoName: asset.name,
      sourceStartSeconds,
      sourceDurationSeconds,
      subtitleCues: sourceRelativeCues,
      subtitleSettings: store.project.animation.proSubtitles
    }, renderer, signal, () => undefined);
    return createVideoEditorArtifact(toolId, clip, asset, URL.createObjectURL(result.blob), {
      name: result.fileName,
      sourceDurationSeconds,
      ...(result.sourceFrameCount !== undefined ? { sourceFrameCount: result.sourceFrameCount } : {}),
      ...(asset.sourceRate ? { sourceRate: asset.sourceRate } : {})
    });
  }, [store]);
  // Il montaggio ha una propria durata e un proprio playhead: non dipende dal brano importato.
  const videoEditorDuration = useMemo(() => videoEditorTimelineDuration(videoEditorSettings), [videoEditorSettings]);
  const characterMode = walkingCubeMode || pixelsSubMode || backgroundAutoMode || store.project.animation.modeId === "teddyWalk" || store.project.animation.modeId === "teddySing";
  const stereoUnfoldMode = store.project.animation.modeId === "stereoUnfold";
  const proSubtitlesMode = store.project.animation.modeId === "proSubtitles";
  const viewportSubtitles = proSubtitlesMode
    ? { ...store.project.subtitles, enabled: true }
    : store.project.subtitles;
  const subtitleVideoMode = proSubtitlesMode;
  const sourceVideoMode = subtitleVideoMode || staticWatermarkMode || upscalerMode || frameBoosterMode || portraitLandscapeMode || commentsInvasionMode;
  const portraitCompositorLayers = useMemo<TimelineCompositorLayer[]>(() => {
    if (!portraitLandscapeMode) return [];
    const settings = store.project.animation.portraitLandscape;
    const spectrumPalette = settings.spectrumPaletteSource === "manual" ? settings.spectrumManualPalette : settings.spectrumPaletteSource === "sideImage" ? settings.sideImagePalette : settings.palette;
    const labels = { sideImage: "Immagini laterali", cube: "Cubo 3D", centerVideo: "Video 9:16", spectrum: "Spettro 48 bande", rain: "Pioggia", lightning: "Fulmini", feathers: "Piume", particles: "Particelle" } as const;
    const fixed = new Set(["sideImage", "cube", "centerVideo", "spectrum"]);
    return [...settings.layerOrder].reverse().filter((id) => fixed.has(id) || settings.effects[id as keyof typeof settings.effects]).map((id) => ({ id, label: labels[id], color: id === "sideImage" ? settings.sideImagePalette[1] : id === "cube" ? settings.palette[0] : id === "centerVideo" ? "#f7f7f7" : id === "spectrum" ? spectrumPalette[1] : settings.effectColors[id as keyof typeof settings.effectColors], locked: false, opacity: id === "spectrum" ? settings.spectrumOpacity : fixed.has(id) ? 1 : settings.effectOpacity[id as keyof typeof settings.effectOpacity] }));
  }, [portraitLandscapeMode, store.project.animation.portraitLandscape]);
  const movePortraitCompositorLayer = useCallback((id: string, direction: "up" | "down") => {
    const state = useProjectStore.getState(); const settings = state.project.animation.portraitLandscape; const order = [...settings.layerOrder]; const index = order.indexOf(id as typeof order[number]); if (index < 0) return;
    const visible = (item: typeof order[number]) => item === "sideImage" || item === "cube" || item === "centerVideo" || item === "spectrum" || settings.effects[item as keyof typeof settings.effects];
    let target = index + (direction === "up" ? 1 : -1); while (target >= 0 && target < order.length && !visible(order[target]!)) target += direction === "up" ? 1 : -1; if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target]!, order[index]!]; state.updatePortraitLandscape({ layerOrder: order });
  }, []);
  const subtitleVideoReady = proSubtitlesMode && Boolean(store.project.animation.proSubtitles.videoUrl && store.project.subtitles.cues.length);
  const exportDuration = duration + (cassetteDeskMode ? store.project.animation.cassetteDesk.introDurationSeconds : !characterMode && !stereoUnfoldMode && !sourceVideoMode && sceneBall.endRevealEnabled && sceneBall.innerImageUrl && sceneBall.revealMode === "end" ? sceneBall.revealHoldSeconds : 0);
  const timelineSubtitles = useMemo(() => {
    if (!proSubtitlesMode && !portraitLandscapeMode) return store.project.subtitles.cues;
    const proSettings = store.project.animation.proSubtitles;
    const animationLabels = new Map(proSubtitleAnimationOptions.map((option) => [option.id, option.label]));
    return store.project.subtitles.cues.map((cue) => {
      const cueStyle = proSettings.cueStyles.find((style) => style.cueId === cue.id);
      return {
        ...cue,
        animationLabel: animationLabels.get(cueStyle?.animation ?? proSettings.defaultAnimation),
        accentColors: proSettings.palette
      };
    });
  }, [portraitLandscapeMode, proSubtitlesMode, store.project.animation.proSubtitles, store.project.subtitles.cues]);
  const handleGenerateScene = useCallback(() => { applyGeneratedScene(store.project); store.setStatus(`${getAnimationMode(store.project.animation.modeId).label} rigenerata senza perdere le personalizzazioni · seed ${store.project.project.seed}`); }, [applyGeneratedScene, store]);
  const impactEvents = useMemo(() => store.project.events.filter((event) => event.enabled && event.action !== "nearMiss" && event.action !== "freeFall"), [store.project.events]);
  const impactResponses = useMemo(() => impactEvents.map((event) => ({ timeSeconds: event.timeSeconds, strength: event.strength })), [impactEvents]);
  const pixelsSubRhythmHits = useMemo(() => store.project.events.flatMap((event) => event.enabled && (event.eventType === "kick" || event.eventType === "snare") ? [{ timeSeconds: event.timeSeconds, strength: event.strength, type: event.eventType }] : []), [store.project.events]);
  const impactCount = impactEvents.length;
  const routeObjects = useMemo(() => { const source = store.project.events.length === 0 && duration === 0 ? sceneObjects : sceneObjects.slice(0, impactCount); return store.project.animation.modeId === "newYorkStreets" ? normalizeNewYorkLevels(source) : source; }, [duration, impactCount, sceneObjects, store.project.animation.modeId, store.project.events.length]);
  const addElementAtBeat = useCallback((timeSeconds: number) => { const state = useProjectStore.getState(); const existing = state.project.events.find((event) => Math.abs(event.timeSeconds - timeSeconds) < .035); const alreadyImpact = existing?.enabled && existing.action !== "nearMiss" && existing.action !== "freeFall"; if (existing) { state.updateEvent(existing.id, { enabled: true, action: existing.accent ? "accentedCollision" : "collision" }); state.selectEvent(existing.id); } else state.addEvent(timeSeconds); if (!alreadyImpact && impactCount >= sceneObjects.length) { const baseTypes = state.project.animation.baseObjectTypes; useSceneStore.getState().add(baseTypes[impactCount % baseTypes.length] ?? "drum"); } }, [impactCount, sceneObjects.length]);
  const trajectory = useMemo(() => {
    const enabled = store.project.events.filter((event) => event.enabled); const anchorEntries = enabled.map((event, timelineIndex) => ({ event, timelineIndex })).filter(({ event }) => event.action !== "nearMiss" && event.action !== "freeFall"); const impacts: ScheduledImpact[] = [];
    const newYorkRace = store.project.animation.modeId === "newYorkStreets"; const sewerEntryIndex = newYorkRace ? newYorkSewerEntryIndex(routeObjects) : -1; const objectMotionKinds: MotionKind[] = anchorEntries.map((entry, index) => { const next = anchorEntries[index + 1]; if (!next) return newYorkRace ? "roll" : "bounce"; if (newYorkRace && index === sewerEntryIndex - 1) return "sewerDrop"; if (!newYorkRace && isVerticalDescent(routeObjects[index], routeObjects[index + 1])) return "freeFall"; const between = enabled.slice(entry.timelineIndex + 1, next.timelineIndex); if (between.some((event) => event.action === "freeFall")) return newYorkRace ? "roll" : "freeFall"; if (newYorkRace) { if (Math.abs(index - sewerEntryIndex) <= 2) return "roll"; const accented = entry.event.accent || entry.event.action === "accentedCollision" || entry.event.strength >= .84; return (accented && index % 3 === 0) || index % 7 === 4 ? "bounce" : "roll"; } const skipped = between.filter((event) => event.action === "nearMiss"); return skipped.some((event) => event.manualOverride) || skipped.length > 0 && index % 3 === 1 ? "slide" : "bounce"; });
    const first = routeObjects[0]; const firstContactY = (first?.position[1] ?? 2.1) + (newYorkRace ? -.12 : objectSurfaceHeight(first)) + sceneBall.radius;
    if ((anchorEntries[0]?.event.timeSeconds ?? 0) > 0) { const second = routeObjects[1]; const startX = first && second ? first.position[0] + (first.position[0] - second.position[0]) * .7 : 0; const startZ = first && second ? first.position[2] + (first.position[2] - second.position[2]) * .7 : (first?.position[2] ?? 0) + 2.5; impacts.push({ eventId: "project-start", timeSeconds: 0, objectId: "start", contactPoint: { x: startX, y: newYorkRace ? firstContactY : firstContactY + 1.35, z: startZ }, contactNormal: { x: 0, y: 1, z: 0 }, impactStrength: 0, motionToNext: newYorkRace ? "roll" : "bounce" }); }
    anchorEntries.forEach(({ event }, index) => { const object = routeObjects[index]; const last = routeObjects.at(-1); const lastContactY = (last?.position[1] ?? 2.1) + (newYorkRace ? -.12 : objectSurfaceHeight(last)) + sceneBall.radius; const fallbackY = lastContactY - Math.max(1, index - routeObjects.length + 1) * .4; impacts.push({ eventId: event.id, timeSeconds: event.timeSeconds, objectId: object?.id ?? `virtual-${index}`, contactPoint: { x: object?.position[0] ?? (index % 2 ? 1.65 : -1.65), y: object ? object.position[1] + (newYorkRace ? -.12 : objectSurfaceHeight(object)) + sceneBall.radius : fallbackY, z: object?.position[2] ?? 0 }, contactNormal: { x: 0, y: 1, z: 0 }, impactStrength: event.strength, motionToNext: objectMotionKinds[index] ?? "bounce" }); });
    try { const segments = planTrajectory(impacts, newYorkRace ? { gravity: { x: 0, y: -9.81, z: 0 }, maxSpeed: 32, maxArcHeight: 4, minimumDuration: .035, minimumBounceHeight: .24 } : undefined); return { segments, evaluate: createTrajectoryEvaluator(segments), objectMotionKinds }; } catch { return { segments: [], evaluate: createTrajectoryEvaluator([]), objectMotionKinds }; }
  }, [routeObjects, sceneBall.radius, store.project.animation.modeId, store.project.events]);
  const displayTime = exportRenderTime ?? (cassetteDeskMode ? cassetteIntroPlayed ? store.project.animation.cassetteDesk.introDurationSeconds + audio.currentTime : cassetteIntroTime : audio.currentTime);
  const portraitPreviewSampleTime = portraitLandscapeMode && exportRenderTime === null && audio.playing
    ? Math.floor(displayTime * 30) / 30
    : displayTime;
  const ballState = trajectory.evaluate(displayTime);
  const coverSpectrum = useMemo(
    () => resolveCoverSpectrum(analysis.result?.energy, portraitPreviewSampleTime),
    [analysis.result?.energy, portraitPreviewSampleTime]
  );
  const teddyLipSyncRaw = resolveTeddyLipSync(analysis.result?.energy, displayTime, store.project.animation.teddySing.vocalSensitivity, store.project.animation.teddySing.lipSyncIntensity);
  const teddyLipSync = applyTeddyPhonemeTimeline(teddyLipSyncRaw, displayTime, store.project.animation.teddySing.phonemeCues, store.project.animation.teddySing.phonemesGenerated, duration);
  const globalBpm = analysis.result?.globalBpm ?? store.project.analysis.globalBpm ?? 120;
  const previousRhythmEvent = [...store.project.events].reverse().find((event) => event.enabled && event.timeSeconds <= portraitPreviewSampleTime);
  const rhythmPulse = previousRhythmEvent
    ? Math.max(0, Math.min(1, previousRhythmEvent.strength * Math.exp(-(portraitPreviewSampleTime - previousRhythmEvent.timeSeconds) / .18)))
    : coverSpectrum.pulse;
  const activeSegment = trajectory.segments.find((segment) => segment.id === ballState.segmentId); const activeObjectIndex = Math.max(0, impactEvents.findIndex((event) => event.id === activeSegment?.endEventId));
  const selectedMusicEvent = store.project.events.find((event) => event.id === store.selectedEventId);
  const animationMode = getAnimationMode(store.project.animation.modeId); const availableObjectTypes = animationMode.objectTypes.map((item) => item.type);
  const handleUpdateEvent = useCallback((id: string, patch: Partial<RhythmBallProject["events"][number]>) => {
    const projectState = useProjectStore.getState(); const currentImpacts = projectState.project.events.filter((event) => event.enabled && event.action !== "nearMiss" && event.action !== "freeFall"); const impactIndex = currentImpacts.findIndex((event) => event.id === id); const target = impactIndex >= 0 ? useSceneStore.getState().objects[impactIndex] : undefined; const changesObject = Object.prototype.hasOwnProperty.call(patch, "assignedObjectType");
    projectState.updateEvent(id, changesObject ? { ...patch, assignedObjectId: target?.id ?? null } : patch);
    if (!changesObject || !target) return;
    const nextProject = useProjectStore.getState().project; const requested = getAnimationMode(nextProject.animation.modeId).objectTypes.find((item) => item.type === patch.assignedObjectType)?.type; const nextImpacts = nextProject.events.filter((event) => event.enabled && event.action !== "nearMiss" && event.action !== "freeFall"); const automatic = generateSceneForMode(nextProject, nextImpacts.length)[impactIndex]; const nextType = requested ?? automatic?.type;
    if (nextType) useSceneStore.getState().changeType(target.id, nextType); projectState.setStatus("Oggetto del rimbalzo aggiornato in tempo reale");
  }, []);
  const handleChangeObjectType = useCallback((id: string, type: EditableSceneObject["type"]) => {
    const sceneState = useSceneStore.getState(); const objectIndex = sceneState.objects.findIndex((object) => object.id === id); sceneState.changeType(id, type); const projectState = useProjectStore.getState(); const event = projectState.project.events.filter((item) => item.enabled && item.action !== "nearMiss" && item.action !== "freeFall")[objectIndex]; if (event) projectState.updateEvent(event.id, { assignedObjectType: type, assignedObjectId: id }); projectState.setStatus("Elemento sostituito in tempo reale · colori e materiale conservati");
  }, []);
  const hydrateBackgroundAutoSource = useCallback((dimensions: { width: number; height: number }) => {
    if (!Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0) return;
    const current = useProjectStore.getState().project.animation.backgroundAuto;
    if (current.sourceWidth > 0 && current.sourceHeight > 0) return;
    useProjectStore.getState().updateBackgroundAuto({ sourceWidth: dimensions.width, sourceHeight: dimensions.height });
  }, []);
  const startExport = useCallback(async (settings: ExportDialogStartSettings) => {
    const renderer = viewportRenderer.current;
    const element = audioElement.current;
    const rendererIndependentMode = pixelsSubMode || backgroundAutoMode || staticWatermarkMode || frameBoosterMode || portraitLandscapeMode || commentsInvasionMode || videoEditorMode || songPlayerMode || cassetteDeskMode || overlaySpectralMode;
    if (!rendererIndependentMode && !renderer) {
      exportState.fail("Renderer o sorgente audio/video non disponibili");
      return;
    }
    const controller = new AbortController();
    exportState.start(controller);
    try {
      if (videoEditorMode) {
        const editorSettings = useProjectStore.getState().project.animation.videoEditor;
        const timelineDuration = videoEditorTimelineDuration(editorSettings);
        if (timelineDuration <= 0) throw new Error("La timeline è vuota: aggiungi almeno una clip prima dell’export.");
        pauseMasterPlayback(element); useVideoEditorPlayback.getState().setPlaying(false);
        const advanced = settings.videoEditor;
        const result = await exportVideoEditorOfflineVideo({
          width: settings.width,
          height: settings.height,
          fps: settings.fps,
          durationSeconds: timelineDuration,
          projectName: store.project.project.name,
          quality: settings.quality,
          videoEditorSettings: editorSettings,
          interpolationEnabled: advanced?.interpolationEnabled ?? false,
          interpolationTargetFps: advanced?.interpolationTargetFps ?? settings.fps,
          interpolationMethod: advanced?.interpolationMethod ?? "motion"
        }, controller.signal, (progress) => exportState.update(progress));
        exportState.complete();
        const interpolated = result.interpolatedFps ? ` · interpolato a ${result.interpolatedFps} fps` : "";
        const note = result.interpolationNote ? ` · ${result.interpolationNote}` : "";
        store.setStatus(`Montaggio verificato · ${result.width} × ${result.height} · ${result.fps} fps · ${result.encodedFrameCount} frame${interpolated} · ${result.fileName}${note}`);
        return;
      }
      if (backgroundAutoMode) {
        const backgroundAuto = store.project.animation.backgroundAuto;
        if (!backgroundAuto.imageUrl) throw new Error("Upload an image before exporting Circular Spectrum Auto Detector.");
        if (backgroundAuto.sourceWidth <= 0 || backgroundAuto.sourceHeight <= 0) throw new Error("Source dimensions are missing: reload the image before export.");
        const configurationError = backgroundAutoConfigurationError(backgroundAuto); if (configurationError) throw new Error(configurationError);
        pauseMasterPlayback(element);
        if (!imported?.url) throw new Error("Import an audio track before Circular Spectrum Auto Detector export.");
        const result = await exportBackgroundAutoOfflineVideo({ width: settings.width, height: settings.height, fps: settings.fps, durationSeconds: settings.durationSeconds, projectName: store.project.project.name, projectSeed: store.project.project.seed, quality: settings.quality, audioUrl: imported.url, imageUrl: backgroundAuto.imageUrl, backgroundAutoSettings: backgroundAuto, energyFrames: analysis.result?.energy ?? [], subtitleCues: store.project.subtitles.cues, proSubtitlesSettings: store.project.animation.proSubtitles }, controller.signal, (progress) => exportState.update(progress.progress, progress.currentFrame, progress.totalFrames));
        exportState.complete(); store.setStatus(`Circular Spectrum Auto Detector export ready · ${result.width} × ${result.height} · ${result.encodedFrameCount} frames · ${result.fileName}`); return;
      }
      if (staticWatermarkMode) {
        const watermark = store.project.animation.staticWatermark;
        if (!watermark.videoUrl || !watermark.referenceImageUrl) throw new Error("Carica sia il video con watermark sia la fotografia originale pulita.");
        pauseMasterPlayback(element);
        const result = await exportStaticWatermarkVideo({ projectName: store.project.project.name, quality: settings.quality, sourceVideoUrl: watermark.videoUrl, referenceImageUrl: watermark.referenceImageUrl, watermarkSettings: watermark }, controller.signal, (progress) => exportState.update(progress.progress, progress.currentFrame, progress.totalFrames));
        exportState.complete(); store.setStatus(`Watermark rimosso · ${result.width} × ${result.height} · ${result.encodedFrameCount} frame verificati · ${result.fileName}`); return;
      }
      if (pixelsSubMode) {
        if (!imported?.url || !store.project.animation.pixelsSub.imageUrl) throw new Error("Brano o cover Pixels Subtitles mancanti.");
        pauseMasterPlayback(element);
        const rhythmEvents = store.project.events.filter((event) => event.enabled).map((event) => ({ timeSeconds: event.timeSeconds, strength: event.strength }));
        const result = await exportPixelsSubOfflineVideo({
          width: settings.width,
          height: settings.height,
          fps: settings.fps,
          durationSeconds: settings.durationSeconds,
          projectName: store.project.project.name,
          quality: settings.quality,
          audioUrl: imported.url,
          imageUrl: store.project.animation.pixelsSub.imageUrl,
          pixelsSubSettings: store.project.animation.pixelsSub,
          subtitleCues: store.project.subtitles.cues,
          subtitlesEnabled: store.project.subtitles.enabled,
          energyFrames: analysis.result?.energy ?? [],
          rhythmEvents,
          rhythmHits: pixelsSubRhythmHits
        }, controller.signal, (progress) => exportState.update(progress.progress, progress.currentFrame, progress.totalFrames));
        exportState.complete();
        store.setStatus(`Video Pixels Subtitles verificato · ${result.formatLabel} · ${result.encodedFrameCount} frame · ${result.fileName}`);
        return;
      }
      if (portraitLandscapeMode) {
        const portrait = store.project.animation.portraitLandscape;
        if (!portrait.videoUrl || !portrait.sideImageUrl || !portrait.coverImageUrl) throw new Error("Carica video verticale, immagine laterale e cover prima dell’export.");
        if (portrait.videoHasAudio && !analysis.result) throw new Error("Analizza l’audio del video prima dell’export per generare spettro, urti e rotazione ritmica.");
        pauseMasterPlayback(element);
        const rhythmEvents = store.project.events.filter((event) => event.enabled).map((event) => ({ timeSeconds: event.timeSeconds, strength: event.strength }));
        const result = await exportPortraitLandscapeOfflineVideo({
          width: settings.width,
          height: settings.height,
          fps: settings.fps,
          durationSeconds: settings.durationSeconds,
          projectName: store.project.project.name,
          quality: settings.quality,
          sourceVideoUrl: portrait.videoUrl,
          portraitLandscapeSettings: portrait,
          energyFrames: analysis.result?.energy ?? [],
          rhythmEvents,
          bpm: globalBpm,
          subtitleCues: store.project.subtitles.cues,
          subtitleSettings: store.project.animation.proSubtitles,
          subtitlesEnabled: store.project.subtitles.enabled
        }, controller.signal, (progress) => exportState.update(progress.progress, progress.currentFrame, progress.totalFrames));
        exportState.complete();
        store.setStatus(`From 9:16 to 16:9 verificato · ${result.width} × ${result.height} · ${result.fps} fps · ${result.encodedFrameCount} frame · ${result.fileName}`);
        return;
      }
      if (commentsInvasionMode) {
        const invasion = store.project.animation.commentsInvasion;
        if (!invasion.videoUrl) throw new Error("Carica il video sorgente prima dell’export Comments Invasion.");
        if (!commentsInvasionAssets.length) throw new Error("Carica almeno uno screenshot di commento prima dell’export Comments Invasion.");
        pauseMasterPlayback(element);
        const result = await exportCommentsInvasionOfflineVideo({
          width: settings.width,
          height: settings.height,
          fps: settings.fps,
          durationSeconds: settings.durationSeconds,
          projectName: store.project.project.name,
          projectSeed: store.project.project.seed,
          quality: settings.quality,
          sourceVideoUrl: invasion.videoUrl,
          comments: commentsInvasionAssets,
          commentsInvasionSettings: invasion
        }, controller.signal, (progress) => exportState.update(progress.progress, progress.currentFrame, progress.totalFrames));
        exportState.complete();
        store.setStatus(`Comments Invasion verificato · ${result.width} × ${result.height} · ${result.fps} fps · ${result.encodedFrameCount} frame · ${result.fileName}`);
        return;
      }
      if (songPlayerMode) {
        if (!audio.fullTrack?.url || !imported?.url) throw new Error("Importa frammento e traccia completa prima dell’export Song Player.");
        if (songPlayerAnalysisError || !songPlayerAnalysis || songPlayerAnalysis.sourceHash !== audio.fullTrack.metadata.hash) throw new Error("L’export Song Player richiede l’analisi FFT reale della traccia completa.");
        if (!renderer) throw new Error("Renderer Song Player non disponibile.");
        const result = await exportSongPlayerOfflineVideo({ width: settings.width, height: settings.height, fps: settings.fps, playbackRange: songPlayerRange, fragmentAudioUrl: imported.url, aspectRatio: store.project.canvas.aspectRatio, projectName: store.project.project.name, quality: settings.quality, renderer }, controller.signal, (progress) => exportState.update(progress.progress, progress.currentFrame, progress.totalFrames));
        exportState.complete(); store.setStatus(`Song Player verificato · ${result.encodedFrameCount} frame · ${result.fileName}`); return;
      }
      if (overlaySpectralMode) {
        if (!imported?.url || !analysis.result) throw new Error("Overlay Spectral richiede un brano con analisi FFT completata.");
        if (!renderer) throw new Error("Renderer Overlay Spectral non disponibile.");
        pauseMasterPlayback(element);
        const result = await exportOverlaySpectralOfflineVideo({ width: settings.width, height: settings.height, fps: settings.fps, durationSeconds: duration, sourceUrl: imported.url, aspectRatio: store.project.canvas.aspectRatio, projectName: store.project.project.name, quality: settings.quality, overlaySettings: store.project.animation.overlaySpectral, renderer }, controller.signal, (progress) => exportState.update(progress.progress, progress.currentFrame, progress.totalFrames));
        exportState.complete(); store.setStatus(`Overlay Spectral verificata · ${result.encodedFrameCount} frame · ${result.fileName}`); return;
      }
      if (cassetteDeskMode) {
        if (!imported?.url || !analysis.result) throw new Error("Cassette Desk richiede il brano analizzato prima dell’export.");
        if (!cassetteVocalsReady || cassetteVocalError) throw new Error("Completa la separazione vocale Demucs prima dell’export Cassette Desk.");
        if (!renderer) throw new Error("Renderer Cassette Desk non disponibile.");
        pauseMasterPlayback(element); const cassette = store.project.animation.cassetteDesk;
        const result = await exportCassetteDeskOfflineVideo({ width: settings.width, height: settings.height, fps: settings.fps, aspectRatio: store.project.canvas.aspectRatio, songDurationSeconds: duration, introDurationSeconds: cassette.introDurationSeconds, sourceUrl: imported.url,includeSongAudio:settings.cassetteDesk?.audioMode!=="effectsOnly", projectName: store.project.project.name, quality: settings.quality, renderer }, controller.signal, (progress) => exportState.update(progress.progress, progress.currentFrame, progress.totalFrames));
        exportState.complete(); store.setStatus(`Cassette Desk verificato · ${result.encodedFrameCount} frame · ${result.fileName}`); return;
      }
      if (!renderer) throw new Error("Renderer della scena non disponibile.");
      if (proSubtitlesMode) {
        const proSettings = settings.proSubtitles;
        if (!proSettings) throw new Error("Impostazioni export Pro Subtitles mancanti.");
        pauseMasterPlayback(element);
        const result = await exportProSubtitleVideo({
          width: settings.width,
          height: settings.height,
          fps: settings.fps,
          durationSeconds: settings.durationSeconds,
          projectName: store.project.project.name,
          quality: settings.quality,
          outputMode: proSettings.outputMode,
          backgroundMode: proSettings.backgroundMode,
          backgroundColor: proSettings.backgroundColor,
          format: proSettings.format,
          allowOpaqueWebmFallback: proSettings.allowOpaqueWebmFallback,
          sourceVideoUrl: store.project.animation.proSubtitles.videoUrl,
          sourceVideoName: store.project.animation.proSubtitles.videoName,
          subtitleCues: store.project.subtitles.cues,
          subtitleSettings: store.project.animation.proSubtitles
        }, renderer, (time) => flushSync(() => setExportRenderTime(time)), controller.signal, (progress) => {
          exportState.update(progress.progress, progress.currentFrame, progress.totalFrames);
        });
        exportState.complete();
        store.setStatus(`${proSettings.outputMode === "completeVideo" ? "Video completo sottotitolato" : "Layer Pro Subtitles"} creato · ${result.format.label} · ${result.fileName}`);
        return;
      }

      if (!imported?.url) throw new Error("Sorgente audio/video non disponibile.");
      pauseMasterPlayback(element);
      const offlineSettings = {
        width: settings.width,
        height: settings.height,
        fps: settings.fps,
        durationSeconds: settings.durationSeconds,
        quality: settings.quality
      };
      const exportBall = characterMode || stereoUnfoldMode ? { ...sceneBall, endRevealEnabled: false } : sceneBall;
      const cubeBackgroundUrl = sceneBackground.mediaType === "image" ? sceneBackground.imageUrl ?? store.project.animation.walkingCube.backgroundImageUrl : null;
      const modeBackground = walkingCubeMode && cubeBackgroundUrl ? { ...sceneBackground, imageUrl: cubeBackgroundUrl, mediaType: "image" as const, opacity: 1, blur: 0 } : sceneBackground;
      const exportBackground = modeBackground;
      const backgroundDimming = walkingCubeMode ? store.project.animation.walkingCube.backgroundDim : 0;
      const backgroundFit = walkingCubeMode ? "fill" as const : "cover" as const;
      const result = await exportOfflineSceneVideo({
        ...offlineSettings,
        aspectRatio: store.project.canvas.aspectRatio === "16:9" ? "16:9" : "9:16",
        projectName: store.project.project.name,
        sourceUrl: imported.url,
        background: exportBackground,
        ball: exportBall,
        sourceDuration: duration,
        backgroundDimming,
        backgroundFit
      }, renderer, (time) => flushSync(() => setExportRenderTime(time)), controller.signal, (progress) => {
        exportState.update(progress.progress, progress.currentFrame, progress.totalFrames);
      });
      exportState.complete();
      store.setStatus(`Video offline verificato · ${result.formatLabel} · ${result.encodedFrameCount} frame · ${result.fileName}`);
    } catch (error) {
      setExportRenderTime(null);
      renderer?.restorePreviewSize();
      if (error instanceof DOMException && error.name === "AbortError") exportState.fail("Esportazione annullata");
      else exportState.fail(error instanceof Error ? error.message : String(error));
    }
  }, [analysis.result, audio, backgroundAutoMode, cassetteDeskMode, cassetteVocalError, cassetteVocalsReady, characterMode, commentsInvasionAssets, commentsInvasionMode, duration, exportState, frameBoosterMode, globalBpm, imported?.url, overlaySpectralMode, pauseMasterPlayback, pixelsSubMode, pixelsSubRhythmHits, portraitLandscapeMode, proSubtitlesMode, sceneBackground, sceneBall, songPlayerAnalysis, songPlayerAnalysisError, songPlayerMode, songPlayerRange, staticWatermarkMode, stereoUnfoldMode, store, videoEditorMode, walkingCubeMode]);
  const canExportCurrentMode = cassetteDeskMode
    ? Boolean(duration > 0 && imported?.url && analysis.result && cassetteVocalsReady && !cassetteVocalError && store.project.animation.cassetteDesk.coverImageUrl)
    : frameBoosterMode
    ? Boolean(store.project.animation.frameBooster.sourceUrl)
    : upscalerMode
    ? Boolean(store.project.animation.upscaler.sourceUrl) && !upscalerBatchRunning
    : videoEditorMode
      ? videoEditorDuration > 0
      : commentsInvasionMode
        ? Boolean(duration > 0 && store.project.animation.commentsInvasion.videoUrl && commentsInvasionAssets.length)
      : songPlayerMode ? Boolean(duration > 0 && audio.fullTrack?.url && songPlayerAnalysis && songPlayerAnalysis.sourceHash === audio.fullTrack.metadata.hash && !songPlayerAnalysisError && (store.project.animation.songPlayer.match.state === "matched" || store.project.animation.songPlayer.match.state === "manual")) : overlaySpectralMode ? Boolean(duration > 0 && imported?.url && analysis.result) : duration > 0 && (backgroundAutoMode ? Boolean(store.project.animation.backgroundAuto.imageUrl && store.project.animation.backgroundAuto.sourceWidth > 0 && store.project.animation.backgroundAuto.effects.some((effect) => effect.enabled && (effect.placementMode === "manual" || Boolean(effect.detectionId))) && !backgroundAutoConfigurationError(store.project.animation.backgroundAuto)) : staticWatermarkMode ? Boolean(store.project.animation.staticWatermark.videoUrl && store.project.animation.staticWatermark.referenceImageUrl) : portraitLandscapeMode ? Boolean(store.project.animation.portraitLandscape.videoUrl && store.project.animation.portraitLandscape.sideImageUrl && store.project.animation.portraitLandscape.coverImageUrl && (!store.project.animation.portraitLandscape.videoHasAudio || analysis.result)) : pixelsSubMode ? Boolean(store.project.animation.pixelsSub.imageUrl) : subtitleVideoMode ? subtitleVideoReady : store.project.animation.modeId === "coverSphere" || stereoUnfoldMode || characterMode || trajectory.segments.length > 0);
  const handleToolbarExport = () => { if (upscalerMode) window.dispatchEvent(new Event("upscaler:export")); else if (frameBoosterMode) window.dispatchEvent(new Event("frame-booster:export")); else exportState.show(); };
  const shellStyle = { "--timeline-height": `${timelineHeight}px` } as CSSProperties;
  if (aiQuantizerMode) return <AIQuantizerWorkspace {...(onHome ? { onHome } : {})} />;
  if (mlsmPostLipsyncMode) return <MlsmPostLipsyncWorkspace {...(onHome ? { onHome } : {})} />;
  return <div className={`app-shell${upscalerMode ? " upscaler-app-shell" : ""}${frameBoosterMode ? " frame-booster-app-shell" : ""}${portraitLandscapeMode ? " portrait-landscape-app-shell" : ""}${commentsInvasionMode ? " comments-invasion-app-shell" : ""}${videoEditorMode ? " video-editor-app-shell" : ""}`} style={shellStyle}>
    <audio ref={audioElement} src={imported?.url} preload="auto" loop={audio.looping} />
    <Toolbar {...(onHome ? { onHome } : {})} name={store.project.project.name} dirty={store.dirty} subtitleVideoMode={videoEditorMode || (sourceVideoMode && !portraitLandscapeMode)} analysisOnlyMode={portraitLandscapeMode} audioLoading={audio.loading} canAnalyze={Boolean(imported) && !staticWatermarkMode} analysisRunning={analysis.running} analysisProgress={analysis.progress?.progress ?? 0} canGenerate={store.project.events.length > 0 && !characterMode && !stereoUnfoldMode && !sourceVideoMode && store.project.animation.modeId !== "coverSphere"} canExport={canExportCurrentMode} canUndo={videoEditorMode ? store.videoEditorHistory.length > 0 : store.eventHistory.length > 0} canRedo={videoEditorMode ? store.videoEditorFuture.length > 0 : store.eventFuture.length > 0} onNew={newProject} onOpen={() => void openProject()} onSave={() => void saveProject()} onImportAudio={() => void handleImportAudio()} onAnalyze={() => void handleAnalyze()} onGenerate={handleGenerateScene} onExport={handleToolbarExport} onUndo={videoEditorMode ? store.undoVideoEditor : store.undoEvents} onRedo={videoEditorMode ? store.redoVideoEditor : store.redoEvents} />
    {videoEditorMode
      ? <VideoEditorWorkspace preview={<VideoEditorPreview />} inspector={<VideoEditorInspector />} timeline={<VideoEditorTimeline timelineHeight={videoEditorTimelineHeight} onResizeHeight={resizeVideoEditorTimelineHeight} />} onUndo={store.undoVideoEditor} onRedo={store.redoVideoEditor} onOpenTool={openVideoEditorTool} runTool={runVideoEditorTool} />
      : <><div className="workspace" ref={workspace} style={workspaceStyle}>
        <LibraryPanel canRegenerate={store.project.events.length > 0} onRegenerate={handleGenerateScene} onImportAudioFragment={handleImportAudio} onImportSubtitleVideo={handleImportSubtitleVideo} audioUrl={imported?.url ?? null} duration={duration} currentTime={audio.currentTime} selectedSubtitleId={selectedSubtitleId} onSelectSubtitle={setSelectedSubtitleId} />
        <WorkspaceResizeHandle side="left" width={workspacePanelWidths.left} onResize={(width) => resizeWorkspaceSide("left", width)} onReset={() => resizeWorkspaceSide("left", DEFAULT_WORKSPACE_PANEL_WIDTHS.left)} />
        {cassetteDeskMode ? <CassetteDeskPreview settings={store.project.animation.cassetteDesk} analysis={cassetteDeskAnalysis} timeSeconds={displayTime} songDurationSeconds={duration} aspectRatio={store.project.canvas.aspectRatio} customWidth={store.project.canvas.previewWidth} customHeight={store.project.canvas.previewHeight} vocalStatus={cassetteVocalStatus} vocalError={cassetteVocalError} onRendererReady={onRendererReady} /> : overlaySpectralMode ? <OverlaySpectralPreview settings={store.project.animation.overlaySpectral} energyFrames={analysis.result?.energy ?? []} currentTime={displayTime} playing={audio.playing} getPlaybackTime={overlaySpectralPlaybackTime} aspectRatio={store.project.canvas.aspectRatio} customWidth={store.project.canvas.previewWidth} customHeight={store.project.canvas.previewHeight} onRendererReady={onRendererReady} /> : frameBoosterMode ? <FrameBoosterPreview /> : songPlayerMode ? <SongPlayerPreview settings={store.project.animation.songPlayer} analysis={songPlayerAnalysis} playbackRange={songPlayerRange} currentTime={displayTime} aspectRatio={store.project.canvas.aspectRatio} customWidth={store.project.canvas.previewWidth} customHeight={store.project.canvas.previewHeight} analysisError={songPlayerAnalysisError} onRendererReady={onRendererReady} /> : commentsInvasionMode ? <CommentsInvasionPreview settings={store.project.animation.commentsInvasion} timeSeconds={displayTime} durationSeconds={duration} playing={audio.playing} aspectRatio={store.project.canvas.aspectRatio} customWidth={store.project.canvas.previewWidth} customHeight={store.project.canvas.previewHeight} projectSeed={store.project.project.seed} onPlayPause={playPause} onStop={stop} onSeek={seek} /> : portraitLandscapeMode ? <PortraitLandscapePreview settings={store.project.animation.portraitLandscape} subtitles={store.project.subtitles} proSubtitlesSettings={store.project.animation.proSubtitles} timeSeconds={displayTime} durationSeconds={duration} playing={audio.playing} bpm={globalBpm} analysisReady={Boolean(analysis.result?.energy.length)} audioPulse={coverSpectrum.pulse} rhythmPulse={rhythmPulse} spectrumBands={coverSpectrum.bands} stereoLeftBands={coverSpectrum.leftBands} stereoRightBands={coverSpectrum.rightBands} onPlayPause={playPause} onStop={stop} onSeek={seek} /> : backgroundAutoMode ? <BackgroundAutoPreview settings={store.project.animation.backgroundAuto} timeSeconds={displayTime} durationSeconds={duration} playing={audio.playing || exportState.running} spectrumBands={coverSpectrum.bands} audioPulse={coverSpectrum.pulse} stereoLeftBands={coverSpectrum.leftBands} stereoRightBands={coverSpectrum.rightBands} stereoLeftPulse={coverSpectrum.leftPulse} stereoRightPulse={coverSpectrum.rightPulse} subtitleCues={store.project.subtitles.cues} proSubtitlesSettings={store.project.animation.proSubtitles} projectSeed={store.project.project.seed} onSourceDimensions={hydrateBackgroundAutoSource} onPlayPause={playPause} onStop={stop} onSeek={seek} /> : <Viewport key={`${sceneBall.innerShape}-${store.project.animation.modeId}`} timeSeconds={displayTime} durationSeconds={duration} playing={audio.playing || exportState.running} onPlayPause={playPause} onStop={stop} onSeek={seek} ballPosition={trajectory.segments.length ? ballState.position : undefined} ballVelocity={trajectory.segments.length ? ballState.velocity : undefined} activeObjectIndex={activeObjectIndex} aspectRatio={store.project.canvas.aspectRatio} animationModeId={store.project.animation.modeId} newYorkSettings={store.project.animation.newYorkStreets} coverSphereSettings={store.project.animation.coverSphere} stereoUnfoldSettings={store.project.animation.stereoUnfold} walkingCubeSettings={store.project.animation.walkingCube} teddyWalkSettings={store.project.animation.teddyWalk} teddySingSettings={store.project.animation.teddySing} proSubtitlesSettings={store.project.animation.proSubtitles} pixelsSubSettings={store.project.animation.pixelsSub} staticWatermarkSettings={store.project.animation.staticWatermark} upscalerSettings={upscalerDisplaySettings} pixelsSubRhythmHits={pixelsSubRhythmHits} teddyLipSync={teddyLipSync} subtitles={viewportSubtitles} spectrumBands={coverSpectrum.bands} stereoLeftBands={coverSpectrum.leftBands} stereoRightBands={coverSpectrum.rightBands} stereoWidth={coverSpectrum.stereoWidth} stereoLeftPulse={coverSpectrum.leftPulse} stereoRightPulse={coverSpectrum.rightPulse} audioPulse={coverSpectrum.pulse} rhythmPulse={rhythmPulse} globalBpm={globalBpm} trajectorySegments={trajectory.segments} projectSeed={store.project.project.seed} motionKinds={trajectory.objectMotionKinds} impactResponses={impactResponses} onRendererReady={onRendererReady} onSelectObject={handleSelectObject} />}
        <WorkspaceResizeHandle side="right" width={workspacePanelWidths.right} onResize={(width) => resizeWorkspaceSide("right", width)} onReset={() => resizeWorkspaceSide("right", DEFAULT_WORKSPACE_PANEL_WIDTHS.right)} />
        {frameBoosterMode ? <FrameBoosterInspector /> : upscalerMode ? <UpscalerInspector /> : staticWatermarkMode ? <StaticWatermarkInspector /> : commentsInvasionMode ? <CommentsInvasionInspector /> : portraitLandscapeMode ? <PortraitLandscapeInspector /> : backgroundAutoMode ? null : <InspectorPanel name={store.project.project.name} aspectRatio={store.project.canvas.aspectRatio} event={selectedMusicEvent} events={store.project.events} duration={duration} availableObjectTypes={availableObjectTypes} onRename={store.renameProject} onAspectRatio={store.setAspectRatio} onSelectObject={(id) => handleSelectObject(id)} onChangeObjectType={handleChangeObjectType} onUpdateEvent={handleUpdateEvent} onDeleteEvent={store.deleteEvent} />}
      </div>
      {upscalerMode || frameBoosterMode ? null : <Timeline peaks={imported?.waveform ?? store.project.analysis.waveform} events={store.project.events} beats={analysis.result?.beats ?? store.project.events.map((event) => event.timeSeconds)} subtitleOnly={subtitleVideoMode || pixelsSubMode} showPhonemes={store.project.animation.modeId === "teddySing"} phonemes={store.project.animation.modeId === "teddySing" ? store.project.animation.teddySing.phonemeCues : []} selectedPhonemeId={selectedPhonemeId} subtitles={timelineSubtitles} selectedSubtitleId={selectedSubtitleId} selectedEventId={store.selectedEventId} selectedEventIds={store.selectedEventIds} compositorLayers={portraitCompositorLayers} timelineHeight={timelineHeight} currentTime={audio.currentTime} duration={duration} playing={audio.playing} looping={audio.looping} onResizeHeight={resizeTimelineHeight} onPlayPause={playPause} onStop={stop} onSeek={seek} onLoop={audio.setLooping} onSelectPhoneme={(id) => { setSelectedPhonemeId(id); setSelectedSubtitleId(null); if (id) useProjectStore.getState().selectEvent(null); }} onDeletePhoneme={(id) => store.deleteTeddySingPhoneme(id)} onSplitPhoneme={(id, time) => store.splitTeddySingPhoneme(id, time)} onAddSubtitle={(time) => { const id = store.addSubtitleCue(time); setSelectedSubtitleId(id); setSelectedPhonemeId(null); }} onSelectSubtitle={(id) => { setSelectedSubtitleId(id); setSelectedPhonemeId(null); if (id) useProjectStore.getState().selectEvent(null); }} onMoveSubtitle={store.moveSubtitleCue} onResizeSubtitle={store.resizeSubtitleCue} onDeleteSubtitle={store.deleteSubtitleCue} onSplitSubtitle={store.splitSubtitleCue} onSelectEvent={handleSelectMusicEvent} onAddEvent={addElementAtBeat} onMoveEvent={store.moveEvent} onDeleteEvent={store.deleteEvent} onDeleteEvents={store.deleteEvents} onMoveCompositorLayer={movePortraitCompositorLayer} />}</>}
    <footer className="statusbar"><span className={audio.error || analysis.error ? "status-error" : ""}>{audio.error ?? analysis.error ?? store.status}</span><span>{videoEditorMode ? `${videoEditorSettings.clips.length} clip · ${videoEditorSettings.tracks.length} tracce · ${videoEditorDuration.toFixed(2)} s · ${videoEditorSettings.outputWidth} × ${videoEditorSettings.outputHeight}` : audio.playing ? `${audio.previewFps.toFixed(0)} FPS · ${audio.droppedFrames} drop · drift ${audio.driftMs.toFixed(1)} ms` : analysis.result ? `${analysis.result.globalBpm?.toFixed(1) ?? "—"} BPM · ${store.project.events.filter((event) => event.action !== "nearMiss" && event.action !== "freeFall").length} rimbalzi · percorso emozionale${analysis.cached ? " · cache" : ""}` : imported ? `${imported.metadata.sampleRate} Hz · ${imported.metadata.channels} ch · ${imported.metadata.codec}` : "Fase 8 · Preview audio-master"}</span></footer>
    <ApplicationAssistant context={{ modeId: animationMode.id, modeLabel: animationMode.label, aspectRatio: store.project.canvas.aspectRatio, hasAudio: Boolean(imported), analysisReady: Boolean(analysis.result) }} />
    {exportState.open ? <ExportDialog duration={videoEditorMode ? videoEditorDuration : exportDuration} aspectRatio={store.project.canvas.aspectRatio} customDimensions={{ width: store.project.canvas.exportWidth, height: store.project.canvas.exportHeight }} videoEditor={videoEditorMode ? { compositionWidth: videoEditorSettings.outputWidth, compositionHeight: videoEditorSettings.outputHeight } : undefined} backgroundAuto={backgroundAutoMode ? { sourceWidth: store.project.animation.backgroundAuto.sourceWidth, sourceHeight: store.project.animation.backgroundAuto.sourceHeight } : undefined} cassetteDesk={cassetteDeskMode} offlineExportProfile={portraitLandscapeMode ? { title: "Esporta From 9:16 to 16:9", defaultResolution: "3840x2160", defaultFps: 60, recommendation: "4K · 3840 × 2160 consigliato: il video verticale 1080p conserva quasi interamente i suoi 1920 pixel di altezza e le aree laterali acquistano dettaglio reale." } : undefined} sourceVideoExport={staticWatermarkMode ? { label: "Static Watermark Remover" } : undefined} {...(proSubtitlesMode ? { proSubtitles: { backgroundMode: store.project.animation.proSubtitles.backgroundMode, backgroundColor: store.project.animation.proSubtitles.backgroundColor, exportFormat: store.project.animation.proSubtitles.exportFormat, hasSourceVideo: Boolean(store.project.animation.proSubtitles.videoUrl) } } : {})} running={exportState.running} progress={exportState.progress} currentFrame={exportState.currentFrame} totalFrames={exportState.totalFrames} phase={exportState.phase} phaseLabel={exportState.phaseLabel} stageProgress={exportState.stageProgress} stageCurrentFrame={exportState.stageCurrentFrame} stageTotalFrames={exportState.stageTotalFrames} processedBytes={exportState.processedBytes} totalBytes={exportState.totalBytes} indeterminate={exportState.indeterminate} elapsedMs={exportState.elapsedMs} estimatedRemainingMs={exportState.estimatedRemainingMs} error={exportState.error} onClose={exportState.hide} onCancel={exportState.cancel} onStart={(settings) => void startExport(settings)} /> : null}
  </div>;
}
