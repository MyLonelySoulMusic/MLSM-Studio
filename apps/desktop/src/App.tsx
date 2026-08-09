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
import { importAudio, importVideoFile, loadAudioFromPath } from "./services/audio-import";
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
import { exportProSubtitleVideo } from "./services/pro-subtitle-exporter";
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
import { AIQuantizerWorkspace } from "./components/AIQuantizerWorkspace";
import { exportVideoEditorOfflineVideo } from "./services/video-editor-offline-exporter";
import { videoEditorTimelineDuration } from "./services/video-editor";
import { useVideoEditorPlayback } from "./store/video-editor-playback-store";

const WORKSPACE_LAYOUT_KEY = "dynamic-sound-animation-studio.workspace-layout.v1";
const TIMELINE_LAYOUT_KEY = "dynamic-sound-animation-studio.timeline-height.v1";

function initialWorkspacePanelWidths() {
  if (typeof window === "undefined") return DEFAULT_WORKSPACE_PANEL_WIDTHS;
  return fitWorkspacePanelWidths(parseWorkspacePanelWidths(window.localStorage.getItem(WORKSPACE_LAYOUT_KEY)), window.innerWidth);
}

function initialTimelineHeight() {
  if (typeof window === "undefined") return DEFAULT_TIMELINE_HEIGHT;
  return parseTimelineHeight(window.localStorage.getItem(TIMELINE_LAYOUT_KEY), window.innerHeight);
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
  const store = useProjectStore(); const audio = useAudioStore(); const analysis = useAnalysisStore(); const exportState = useExportStore(); const sceneObjects = useSceneStore((state) => state.objects); const sceneBall = useSceneStore((state) => state.ball); const sceneBackground = useSceneStore((state) => state.background); const sceneRailColors = useSceneStore((state) => state.railColors); const sceneLight = useSceneStore((state) => state.light); const replaceScene = useSceneStore((state) => state.replace); const regenerateScene = useSceneStore((state) => state.regenerate); const resetScene = useSceneStore((state) => state.reset); const updateSceneBall = useSceneStore((state) => state.updateBall); const updateSceneBackground = useSceneStore((state) => state.updateBackground); const updateSceneLight = useSceneStore((state) => state.updateLight); const updateRailColor = useSceneStore((state) => state.updateRailColor); const { setCurrentTime, setPlaying, setDiagnostics } = audio; const audioElement = useRef<HTMLAudioElement>(null); const viewportRenderer = useRef<SharedViewportRenderer | null>(null); const workspace = useRef<HTMLDivElement>(null); const portraitAutoAnalysisHash = useRef<string | null>(null); const [workspacePanelWidths, setWorkspacePanelWidths] = useState(initialWorkspacePanelWidths); const [timelineHeight, setTimelineHeight] = useState(initialTimelineHeight); const [exportRenderTime, setExportRenderTime] = useState<number | null>(null); const [selectedPhonemeId, setSelectedPhonemeId] = useState<string | null>(null); const [selectedSubtitleId, setSelectedSubtitleId] = useState<string | null>(null); const analyzer = useRef(new WebAudioAnalyzer()); const onRendererReady = useCallback((renderer: SharedViewportRenderer | null) => { viewportRenderer.current = renderer; }, []); const handleSelectObject = useCallback((id: string | null) => { useSceneStore.getState().select(id); if (id) useProjectStore.getState().selectEvent(null); }, []); const handleSelectMusicEvent = useCallback((id: string | null, additive = false) => { setSelectedPhonemeId(null); setSelectedSubtitleId(null); useSceneStore.getState().select(null); useProjectStore.getState().selectEvent(id, additive); }, []);
  const timelineResizeFrame = useRef<number | null>(null); const requestedTimelineHeight = useRef(timelineHeight);
  const resizeTimelineHeight = useCallback((height: number) => {
    requestedTimelineHeight.current = clampTimelineHeight(height, window.innerHeight);
    if (timelineResizeFrame.current !== null) return;
    timelineResizeFrame.current = window.requestAnimationFrame(() => { timelineResizeFrame.current = null; setTimelineHeight(requestedTimelineHeight.current); });
  }, []);
  useEffect(() => { try { window.localStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(workspacePanelWidths)); } catch { /* Il ridimensionamento resta attivo per la sessione. */ } }, [workspacePanelWidths]);
  useEffect(() => { requestedTimelineHeight.current = timelineHeight; try { window.localStorage.setItem(TIMELINE_LAYOUT_KEY, String(timelineHeight)); } catch { /* Il ridimensionamento resta attivo per la sessione. */ } }, [timelineHeight]);
  useEffect(() => () => { if (timelineResizeFrame.current !== null) window.cancelAnimationFrame(timelineResizeFrame.current); }, []);
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
  const resizeWorkspaceSide = useCallback((side: WorkspacePanelSide, width: number) => {
    setWorkspacePanelWidths((current) => resizeWorkspacePanel(current, side, width, workspace.current?.clientWidth ?? window.innerWidth));
  }, []);
  const workspaceStyle = { "--library-width": `${workspacePanelWidths.left}px`, "--inspector-width": `${workspacePanelWidths.right}px` } as CSSProperties;
  const applyGeneratedScene = useCallback((project: RhythmBallProject) => { const generated = generateSceneForMode(project); const availableTypes = new Set(getAnimationMode(project.animation.modeId).objectTypes.map((item) => item.type)); const sceneState = useSceneStore.getState(); const current = sceneState.objects; const rebasedLight = rebaseSceneLight(sceneState.light, current, generated); if (current.length && current.every((object) => availableTypes.has(object.type))) regenerateScene(generated); else replaceScene(generated); sceneState.updateLight(rebasedLight); }, [regenerateScene, replaceScene]);
  useEffect(() => {
    const element = audioElement.current; if (!element) return;
    const update = () => setCurrentTime(element.currentTime); const ended = () => setPlaying(false);
    element.addEventListener("timeupdate", update); element.addEventListener("ended", ended);
    return () => { element.removeEventListener("timeupdate", update); element.removeEventListener("ended", ended); };
  }, [setCurrentTime, setPlaying]);
  useEffect(() => {
    if (!audio.playing) return; let animationFrame = 0; let last = performance.now(); let windowStart = last; let frames = 0; let dropped = audio.droppedFrames;
    const tick = (now: number) => { const element = audioElement.current; if (!element) return; const interval = now - last; if (interval > 50) dropped += Math.max(1, Math.round(interval / (1000 / 30)) - 1); last = now; frames += 1; setCurrentTime(element.currentTime); if (now - windowStart >= 1000) { setDiagnostics(frames * 1000 / (now - windowStart), dropped, 0); frames = 0; windowStart = now; } animationFrame = requestAnimationFrame(tick); };
    animationFrame = requestAnimationFrame(tick); return () => cancelAnimationFrame(animationFrame);
  }, [audio.droppedFrames, audio.playing, setCurrentTime, setDiagnostics]);
  const saveProject = useCallback(async () => {
    try { const repository = new TauriProjectRepository(store.filePath); const snapshot = { ...store.project, objects: serializeSceneObjects(sceneObjects), ball: { ...store.project.ball, radius: sceneBall.radius, material: { ...store.project.ball.material, color: sceneBall.color, emission: sceneBall.emission, metalness: sceneBall.metalness }, trailEnabled: sceneBall.trailEnabled, innerColor: sceneBall.innerColor, innerShape: sceneBall.innerShape, innerImageUrl: sceneBall.innerImageUrl, endRevealEnabled: sceneBall.endRevealEnabled, revealMode: sceneBall.revealMode, revealTimeSeconds: sceneBall.revealTimeSeconds, revealHoldSeconds: sceneBall.revealHoldSeconds }, background: { ...store.project.background, type: sceneBackground.imageUrl ? sceneBackground.mediaType : "linearGradient" as const, colors: sceneBackground.colors, imageUrl: sceneBackground.imageUrl, presetId: sceneBackground.presetId, finish: sceneBackground.finish, opacity: sceneBackground.opacity, blur: sceneBackground.blur, effects: sceneBackground.effects, neon: sceneBackground.neon, railColors: sceneRailColors }, lighting: { ...sceneLight, origin: { x: sceneLight.origin[0], y: sceneLight.origin[1], z: sceneLight.origin[2] }, target: { x: sceneLight.target[0], y: sceneLight.target[1], z: sceneLight.target[2] } } }; const saved = await new ProjectService(repository).save(snapshot); if (repository.filePath) store.markSaved(saved, repository.filePath); }
    catch (error) { store.setStatus(error instanceof Error ? error.message : "Errore durante il salvataggio"); }
  }, [sceneBackground, sceneBall, sceneLight, sceneObjects, sceneRailColors, store]);
  const openProject = useCallback(async () => {
    try { const repository = new TauriProjectRepository(null); if (!(await repository.chooseForLoad())) return; const loaded = await new ProjectService(repository).load(); if (loaded && repository.filePath) { store.setProject(loaded, repository.filePath); if (loaded.objects.length) replaceScene(deserializeSceneObjects(loaded.objects)); updateSceneBall({ radius: loaded.ball.radius, color: loaded.ball.material.color, emission: loaded.ball.material.emission, metalness: loaded.ball.material.metalness, trailEnabled: loaded.ball.trailEnabled, innerColor: loaded.ball.innerColor, innerShape: loaded.ball.innerShape, innerImageUrl: loaded.ball.innerImageUrl, endRevealEnabled: loaded.ball.endRevealEnabled, revealMode: loaded.ball.revealMode, revealTimeSeconds: loaded.ball.revealTimeSeconds, revealHoldSeconds: loaded.ball.revealHoldSeconds }); updateSceneBackground({ colors: [loaded.background.colors[0] ?? "#0d1020", loaded.background.colors[1] ?? "#211238"], imageUrl: loaded.background.imageUrl, mediaType: loaded.background.type === "video" ? "video" : "image", presetId: loaded.background.presetId as typeof sceneBackground.presetId, finish: loaded.background.finish, opacity: loaded.background.opacity, blur: loaded.background.blur, effects: loaded.background.effects, neon: loaded.background.neon }); updateSceneLight({ ...loaded.lighting, origin: [loaded.lighting.origin.x, loaded.lighting.origin.y, loaded.lighting.origin.z], target: [loaded.lighting.target.x, loaded.lighting.target.y, loaded.lighting.target.z] }); updateRailColor("pinball", loaded.background.railColors.pinball); updateRailColor("glassTube", loaded.background.railColors.glassTube); updateRailColor("bricks", loaded.background.railColors.bricks); if (loaded.audio.sourcePath && isTauri()) audio.setImported(await loadAudioFromPath(loaded.audio.sourcePath)); else if (loaded.audio.sourcePath) store.setStatus("Progetto caricato: reimporta l’audio per riattivare la preview web"); } }
    catch (error) { store.setStatus(error instanceof Error ? error.message : "Errore durante l'apertura"); }
  }, [audio, replaceScene, sceneBackground, store, updateRailColor, updateSceneBackground, updateSceneBall, updateSceneLight]);
  const newProject = useCallback(() => {
    if (store.dirty && !window.confirm("Le modifiche non salvate andranno perse. Continuare?")) return;
    audioElement.current?.pause(); audio.reset(); analysis.reset(); resetScene(); store.newProject();
  }, [analysis, audio, resetScene, store]);
  const handleImportAudio = useCallback(async () => {
    audio.setLoading(true); audio.setError(null);
    try { const imported = await importAudio(); if (!imported) { audio.setLoading(false); return; } analysis.reset(); audio.setImported(imported); store.attachAudio(imported.metadata, imported.waveform); }
    catch (error) { const message = error instanceof Error ? error.message : String(error); audio.setError(message); store.setStatus(message); }
  }, [analysis, audio, store]);
  const handleImportSubtitleVideo = useCallback(async (file: File) => {
    audio.setLoading(true); audio.setError(null);
    try {
      const importedVideo = await importVideoFile(file);
      const currentMode = useProjectStore.getState().project.animation.modeId;
      const preserveSubtitleTrack = currentMode === "proSubtitles" || currentMode === "portraitLandscape" || currentMode === "staticWatermark";
      analysis.reset(); audio.setImported(importedVideo); store.attachAudio(importedVideo.metadata, importedVideo.waveform, { preserveSubtitleTrack });
      if (currentMode === "staticWatermark") {
        const dimensions = await probeVideoDimensions(importedVideo.url);
        store.updateStaticWatermark({ videoUrl: importedVideo.url, videoName: file.name, videoWidth: dimensions.width, videoHeight: dimensions.height });
        store.setAspectRatio(dimensions.width >= dimensions.height ? "16:9" : "9:16");
        store.setStatus(`${file.name} caricato · trascina sulla preview per selezionare il watermark`);
      } else if (currentMode === "portraitLandscape") {
        const dimensions = await probeVideoDimensions(importedVideo.url);
        portraitAutoAnalysisHash.current = null;
        store.updatePortraitLandscape({ videoUrl: importedVideo.url, videoName: file.name, videoWidth: dimensions.width, videoHeight: dimensions.height, videoHasAudio: importedVideo.waveform.length > 0 });
        store.setAspectRatio("16:9"); store.setStatus(`${file.name} caricato · analisi automatica di spettro e ritmo…`);
      } else if (currentMode === "proSubtitles") { store.updateProSubtitles({ videoUrl: importedVideo.url, videoName: file.name }); store.setStatus(`${file.name} caricato · video guida e timeline pronti`); }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error); audio.setError(message); store.setStatus(message);
    }
  }, [analysis, audio, store]);
  const handleAnalyze = useCallback(async () => {
    const imported = audio.imported; if (!imported) return; analysis.start();
    try { const completed = await analyzer.current.analyze(imported.url, imported.metadata.hash, undefined, analysis.updateProgress); analysis.complete(completed.result, completed.cached); store.applyAnalysis(completed.result); const current = useProjectStore.getState(); if (current.project.animation.modeId === "teddySing") { const settings = current.project.animation.teddySing; current.setTeddySingPhonemes(extractTeddyPhonemeCues(completed.result.energy, settings.vocalSensitivity, settings.lipSyncIntensity)); } applyGeneratedScene(useProjectStore.getState().project); }
    catch (error) { analysis.fail(error instanceof Error ? error.message : String(error)); }
  }, [analysis, applyGeneratedScene, audio.imported, store]);
  const seek = useCallback((time: number) => { if (!audioElement.current) return; audioElement.current.currentTime = time; audio.setCurrentTime(time); }, [audio]);
  const playPause = useCallback(() => {
    const element = audioElement.current; if (!element) return;
    if (element.paused) void element.play().then(() => audio.setPlaying(true)).catch((error: unknown) => audio.setError(error instanceof Error ? error.message : String(error)));
    else { element.pause(); audio.setPlaying(false); }
  }, [audio]);
  const stop = useCallback(() => { audioElement.current?.pause(); seek(0); audio.setPlaying(false); }, [audio, seek]);
  const imported = audio.imported; const duration = imported?.metadata.durationSeconds ?? store.project.audio.durationSeconds;
  useEffect(() => {
    const settings = store.project.animation.teddySing;
    if (store.project.animation.modeId !== "teddySing" || !analysis.result || settings.phonemesGenerated) return;
    store.setTeddySingPhonemes(extractTeddyPhonemeCues(analysis.result.energy, settings.vocalSensitivity, settings.lipSyncIntensity));
  }, [analysis.result, store, store.project.animation.modeId, store.project.animation.teddySing]);
  useEffect(() => { if (selectedPhonemeId && !store.project.animation.teddySing.phonemeCues.some((cue) => cue.id === selectedPhonemeId)) setSelectedPhonemeId(null); }, [selectedPhonemeId, store.project.animation.teddySing.phonemeCues]);
  useEffect(() => { if (selectedSubtitleId && !store.project.subtitles.cues.some((cue) => cue.id === selectedSubtitleId)) setSelectedSubtitleId(null); }, [selectedSubtitleId, store.project.subtitles.cues]);
  const videoEditorMode = store.project.animation.modeId === "videoEditor";
  const aiQuantizerMode = store.project.animation.modeId === "aiQuantizer";
  useEffect(() => {
    const keyboardPlayback = (event: KeyboardEvent) => {
      // Nel Video Editor la barra spaziatrice appartiene al trasporto del montaggio.
      if (videoEditorMode || aiQuantizerMode || (event.code !== "Space" && event.key !== " ") || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || duration <= 0 || exportState.open || exportState.running) return;
      const target = event.target; if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select, button, [role='button']"))) return;
      event.preventDefault(); playPause();
    };
    window.addEventListener("keydown", keyboardPlayback); return () => window.removeEventListener("keydown", keyboardPlayback);
  }, [aiQuantizerMode, duration, exportState.open, exportState.running, playPause, videoEditorMode]);
  const walkingCubeMode = store.project.animation.modeId === "walkingCube";
  const portraitLandscapeMode = store.project.animation.modeId === "portraitLandscape";
  useEffect(() => {
    if (!portraitLandscapeMode || !imported || analysis.result || analysis.running || portraitAutoAnalysisHash.current === imported.metadata.hash) return;
    portraitAutoAnalysisHash.current = imported.metadata.hash; analysis.start(); store.setStatus(`${imported.metadata.fileName} · analisi automatica di spettro e ritmo…`);
    void analyzer.current.analyze(imported.url, imported.metadata.hash, undefined, analysis.updateProgress).then((completed) => {
      analysis.complete(completed.result, completed.cached); const state = useProjectStore.getState(); state.applyAnalysis(completed.result); state.updatePortraitLandscape({ videoHasAudio: true }); state.setStatus(`${imported.metadata.fileName} · 48 bande stereo sincronizzate al brano`);
    }).catch(() => { analysis.reset(); useProjectStore.getState().setStatus(`${imported.metadata.fileName} · codec audio non analizzabile, visualizer di sicurezza attivo`); });
  }, [analysis, imported, portraitLandscapeMode, store]);
  const pixelsSubMode = store.project.animation.modeId === "pixelsSub";
  const staticWatermarkMode = store.project.animation.modeId === "staticWatermark";
  const upscalerMode = store.project.animation.modeId === "upscaler";
  const videoEditorSettings = store.project.animation.videoEditor;
  // Il montaggio ha una propria durata e un proprio playhead: non dipende dal brano importato.
  const videoEditorDuration = useMemo(() => videoEditorTimelineDuration(videoEditorSettings), [videoEditorSettings]);
  const characterMode = walkingCubeMode || pixelsSubMode || store.project.animation.modeId === "pixelArt" || store.project.animation.modeId === "teddyWalk" || store.project.animation.modeId === "teddySing";
  const stereoUnfoldMode = store.project.animation.modeId === "stereoUnfold";
  const proSubtitlesMode = store.project.animation.modeId === "proSubtitles";
  const viewportSubtitles = proSubtitlesMode
    ? { ...store.project.subtitles, enabled: true }
    : store.project.subtitles;
  const subtitleVideoMode = proSubtitlesMode;
  const sourceVideoMode = subtitleVideoMode || staticWatermarkMode || upscalerMode || portraitLandscapeMode;
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
  const exportDuration = duration + (!characterMode && !stereoUnfoldMode && !sourceVideoMode && sceneBall.endRevealEnabled && sceneBall.innerImageUrl && sceneBall.revealMode === "end" ? sceneBall.revealHoldSeconds : 0);
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
  const displayTime = exportRenderTime ?? audio.currentTime;
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
  const startExport = useCallback(async (settings: ExportDialogStartSettings) => {
    const renderer = viewportRenderer.current;
    const element = audioElement.current;
    const rendererIndependentMode = pixelsSubMode || staticWatermarkMode || portraitLandscapeMode || videoEditorMode;
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
        element?.pause(); audio.setPlaying(false); useVideoEditorPlayback.getState().setPlaying(false);
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
        }, controller.signal, (progress) => exportState.update(progress.progress, progress.currentFrame, progress.totalFrames));
        exportState.complete();
        const interpolated = result.interpolatedFps ? ` · interpolato a ${result.interpolatedFps} fps` : "";
        const note = result.interpolationNote ? ` · ${result.interpolationNote}` : "";
        store.setStatus(`Montaggio verificato · ${result.width} × ${result.height} · ${result.fps} fps · ${result.encodedFrameCount} frame${interpolated} · ${result.fileName}${note}`);
        return;
      }
      if (staticWatermarkMode) {
        const watermark = store.project.animation.staticWatermark;
        if (!watermark.videoUrl || !watermark.referenceImageUrl) throw new Error("Carica sia il video con watermark sia la fotografia originale pulita.");
        element?.pause(); audio.setPlaying(false);
        const result = await exportStaticWatermarkVideo({ projectName: store.project.project.name, quality: settings.quality, sourceVideoUrl: watermark.videoUrl, referenceImageUrl: watermark.referenceImageUrl, watermarkSettings: watermark }, controller.signal, (progress) => exportState.update(progress.progress, progress.currentFrame, progress.totalFrames));
        exportState.complete(); store.setStatus(`Watermark rimosso · ${result.width} × ${result.height} · ${result.encodedFrameCount} frame verificati · ${result.fileName}`); return;
      }
      if (pixelsSubMode) {
        if (!imported?.url || !store.project.animation.pixelsSub.imageUrl) throw new Error("Brano o cover Pixels Subtitles mancanti.");
        element?.pause();
        audio.setPlaying(false);
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
        element?.pause(); audio.setPlaying(false);
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
      if (!renderer) throw new Error("Renderer della scena non disponibile.");
      if (proSubtitlesMode) {
        const proSettings = settings.proSubtitles;
        if (!proSettings) throw new Error("Impostazioni export Pro Subtitles mancanti.");
        element?.pause();
        audio.setPlaying(false);
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
      element?.pause();
      audio.setPlaying(false);
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
  }, [analysis.result, audio, characterMode, duration, exportState, globalBpm, imported?.url, pixelsSubMode, pixelsSubRhythmHits, portraitLandscapeMode, proSubtitlesMode, sceneBackground, sceneBall, staticWatermarkMode, stereoUnfoldMode, store, videoEditorMode, walkingCubeMode]);
  const canExportCurrentMode = upscalerMode
    ? Boolean(store.project.animation.upscaler.sourceUrl)
    : videoEditorMode
      ? videoEditorDuration > 0
      : duration > 0 && (staticWatermarkMode ? Boolean(store.project.animation.staticWatermark.videoUrl && store.project.animation.staticWatermark.referenceImageUrl) : portraitLandscapeMode ? Boolean(store.project.animation.portraitLandscape.videoUrl && store.project.animation.portraitLandscape.sideImageUrl && store.project.animation.portraitLandscape.coverImageUrl && (!store.project.animation.portraitLandscape.videoHasAudio || analysis.result)) : pixelsSubMode ? Boolean(store.project.animation.pixelsSub.imageUrl) : subtitleVideoMode ? subtitleVideoReady : store.project.animation.modeId === "coverSphere" || stereoUnfoldMode || characterMode || trajectory.segments.length > 0);
  const handleToolbarExport = () => { if (upscalerMode) window.dispatchEvent(new Event("upscaler:export")); else exportState.show(); };
  const shellStyle = { "--timeline-height": `${timelineHeight}px` } as CSSProperties;
  if (aiQuantizerMode) return <AIQuantizerWorkspace {...(onHome ? { onHome } : {})} />;
  return <div className={`app-shell${upscalerMode ? " upscaler-app-shell" : ""}${portraitLandscapeMode ? " portrait-landscape-app-shell" : ""}${videoEditorMode ? " video-editor-app-shell" : ""}`} style={shellStyle}>
    <audio ref={audioElement} src={imported?.url} preload="auto" loop={audio.looping} />
    <Toolbar {...(onHome ? { onHome } : {})} name={store.project.project.name} dirty={store.dirty} subtitleVideoMode={videoEditorMode || (sourceVideoMode && !portraitLandscapeMode)} analysisOnlyMode={portraitLandscapeMode} audioLoading={audio.loading} canAnalyze={Boolean(imported) && !staticWatermarkMode} analysisRunning={analysis.running} analysisProgress={analysis.progress?.progress ?? 0} canGenerate={store.project.events.length > 0 && !characterMode && !stereoUnfoldMode && !sourceVideoMode && store.project.animation.modeId !== "coverSphere"} canExport={canExportCurrentMode} canUndo={store.eventHistory.length > 0} canRedo={store.eventFuture.length > 0} onNew={newProject} onOpen={() => void openProject()} onSave={() => void saveProject()} onImportAudio={() => void handleImportAudio()} onAnalyze={() => void handleAnalyze()} onGenerate={handleGenerateScene} onExport={handleToolbarExport} onUndo={store.undoEvents} onRedo={store.redoEvents} />
    <div className="workspace" ref={workspace} style={workspaceStyle}>
      <LibraryPanel canRegenerate={store.project.events.length > 0} onRegenerate={handleGenerateScene} onImportSubtitleVideo={handleImportSubtitleVideo} audioUrl={imported?.url ?? null} duration={duration} currentTime={audio.currentTime} selectedSubtitleId={selectedSubtitleId} onSelectSubtitle={setSelectedSubtitleId} />
      <WorkspaceResizeHandle side="left" width={workspacePanelWidths.left} onResize={(width) => resizeWorkspaceSide("left", width)} onReset={() => resizeWorkspaceSide("left", DEFAULT_WORKSPACE_PANEL_WIDTHS.left)} />
      {videoEditorMode ? <VideoEditorPreview /> : portraitLandscapeMode ? <PortraitLandscapePreview settings={store.project.animation.portraitLandscape} subtitles={store.project.subtitles} proSubtitlesSettings={store.project.animation.proSubtitles} timeSeconds={displayTime} durationSeconds={duration} playing={audio.playing} bpm={globalBpm} analysisReady={Boolean(analysis.result?.energy.length)} audioPulse={coverSpectrum.pulse} rhythmPulse={rhythmPulse} spectrumBands={coverSpectrum.bands} stereoLeftBands={coverSpectrum.leftBands} stereoRightBands={coverSpectrum.rightBands} onPlayPause={playPause} onStop={stop} onSeek={seek} /> : <Viewport key={`${sceneBall.innerShape}-${store.project.animation.modeId}`} timeSeconds={displayTime} durationSeconds={duration} playing={audio.playing || exportState.running} onPlayPause={playPause} onStop={stop} onSeek={seek} ballPosition={trajectory.segments.length ? ballState.position : undefined} ballVelocity={trajectory.segments.length ? ballState.velocity : undefined} activeObjectIndex={activeObjectIndex} aspectRatio={store.project.canvas.aspectRatio} animationModeId={store.project.animation.modeId} newYorkSettings={store.project.animation.newYorkStreets} coverSphereSettings={store.project.animation.coverSphere} stereoUnfoldSettings={store.project.animation.stereoUnfold} walkingCubeSettings={store.project.animation.walkingCube} pixelArtSettings={store.project.animation.pixelArt} teddyWalkSettings={store.project.animation.teddyWalk} teddySingSettings={store.project.animation.teddySing} proSubtitlesSettings={store.project.animation.proSubtitles} pixelsSubSettings={store.project.animation.pixelsSub} staticWatermarkSettings={store.project.animation.staticWatermark} upscalerSettings={store.project.animation.upscaler} pixelsSubRhythmHits={pixelsSubRhythmHits} teddyLipSync={teddyLipSync} subtitles={viewportSubtitles} spectrumBands={coverSpectrum.bands} stereoLeftBands={coverSpectrum.leftBands} stereoRightBands={coverSpectrum.rightBands} stereoWidth={coverSpectrum.stereoWidth} stereoLeftPulse={coverSpectrum.leftPulse} stereoRightPulse={coverSpectrum.rightPulse} audioPulse={coverSpectrum.pulse} rhythmPulse={rhythmPulse} globalBpm={globalBpm} trajectorySegments={trajectory.segments} projectSeed={store.project.project.seed} motionKinds={trajectory.objectMotionKinds} impactResponses={impactResponses} onRendererReady={onRendererReady} onSelectObject={handleSelectObject} />}
      <WorkspaceResizeHandle side="right" width={workspacePanelWidths.right} onResize={(width) => resizeWorkspaceSide("right", width)} onReset={() => resizeWorkspaceSide("right", DEFAULT_WORKSPACE_PANEL_WIDTHS.right)} />
      {videoEditorMode ? <VideoEditorInspector /> : upscalerMode ? <UpscalerInspector /> : staticWatermarkMode ? <StaticWatermarkInspector /> : portraitLandscapeMode ? <PortraitLandscapeInspector /> : <InspectorPanel name={store.project.project.name} aspectRatio={store.project.canvas.aspectRatio} event={selectedMusicEvent} events={store.project.events} duration={duration} availableObjectTypes={availableObjectTypes} onRename={store.renameProject} onAspectRatio={store.setAspectRatio} onSelectObject={(id) => handleSelectObject(id)} onChangeObjectType={handleChangeObjectType} onUpdateEvent={handleUpdateEvent} onDeleteEvent={store.deleteEvent} />}
    </div>
    {videoEditorMode ? <VideoEditorTimeline timelineHeight={timelineHeight} onResizeHeight={resizeTimelineHeight} /> : upscalerMode ? null : <Timeline peaks={imported?.waveform ?? store.project.analysis.waveform} events={store.project.events} beats={analysis.result?.beats ?? store.project.events.map((event) => event.timeSeconds)} subtitleOnly={subtitleVideoMode || pixelsSubMode} showPhonemes={store.project.animation.modeId === "teddySing"} phonemes={store.project.animation.modeId === "teddySing" ? store.project.animation.teddySing.phonemeCues : []} selectedPhonemeId={selectedPhonemeId} subtitles={timelineSubtitles} selectedSubtitleId={selectedSubtitleId} selectedEventId={store.selectedEventId} selectedEventIds={store.selectedEventIds} compositorLayers={portraitCompositorLayers} timelineHeight={timelineHeight} currentTime={audio.currentTime} duration={duration} playing={audio.playing} looping={audio.looping} onResizeHeight={resizeTimelineHeight} onPlayPause={playPause} onStop={stop} onSeek={seek} onLoop={audio.setLooping} onSelectPhoneme={(id) => { setSelectedPhonemeId(id); setSelectedSubtitleId(null); if (id) useProjectStore.getState().selectEvent(null); }} onDeletePhoneme={(id) => store.deleteTeddySingPhoneme(id)} onSplitPhoneme={(id, time) => store.splitTeddySingPhoneme(id, time)} onAddSubtitle={(time) => { const id = store.addSubtitleCue(time); setSelectedSubtitleId(id); setSelectedPhonemeId(null); }} onSelectSubtitle={(id) => { setSelectedSubtitleId(id); setSelectedPhonemeId(null); if (id) useProjectStore.getState().selectEvent(null); }} onMoveSubtitle={store.moveSubtitleCue} onResizeSubtitle={store.resizeSubtitleCue} onDeleteSubtitle={store.deleteSubtitleCue} onSplitSubtitle={store.splitSubtitleCue} onSelectEvent={handleSelectMusicEvent} onAddEvent={addElementAtBeat} onMoveEvent={store.moveEvent} onDeleteEvent={store.deleteEvent} onDeleteEvents={store.deleteEvents} onMoveCompositorLayer={movePortraitCompositorLayer} />}
    <footer className="statusbar"><span className={audio.error || analysis.error ? "status-error" : ""}>{audio.error ?? analysis.error ?? store.status}</span><span>{videoEditorMode ? `${videoEditorSettings.clips.length} clip · ${videoEditorSettings.tracks.length} tracce · ${videoEditorDuration.toFixed(2)} s · ${videoEditorSettings.outputWidth} × ${videoEditorSettings.outputHeight}` : audio.playing ? `${audio.previewFps.toFixed(0)} FPS · ${audio.droppedFrames} drop · drift ${audio.driftMs.toFixed(1)} ms` : analysis.result ? `${analysis.result.globalBpm?.toFixed(1) ?? "—"} BPM · ${store.project.events.filter((event) => event.action !== "nearMiss" && event.action !== "freeFall").length} rimbalzi · percorso emozionale${analysis.cached ? " · cache" : ""}` : imported ? `${imported.metadata.sampleRate} Hz · ${imported.metadata.channels} ch · ${imported.metadata.codec}` : "Fase 8 · Preview audio-master"}</span></footer>
    <ApplicationAssistant context={{ modeId: animationMode.id, modeLabel: animationMode.label, aspectRatio: store.project.canvas.aspectRatio, hasAudio: Boolean(imported), analysisReady: Boolean(analysis.result) }} />
    {exportState.open ? <ExportDialog duration={videoEditorMode ? videoEditorDuration : exportDuration} aspectRatio={store.project.canvas.aspectRatio === "16:9" ? "16:9" : "9:16"} videoEditor={videoEditorMode ? { compositionWidth: videoEditorSettings.outputWidth, compositionHeight: videoEditorSettings.outputHeight } : undefined} offlineExportProfile={portraitLandscapeMode ? { title: "Esporta From 9:16 to 16:9", defaultResolution: "3840x2160", defaultFps: 60, recommendation: "4K · 3840 × 2160 consigliato: il video verticale 1080p conserva quasi interamente i suoi 1920 pixel di altezza e le aree laterali acquistano dettaglio reale." } : undefined} sourceVideoExport={staticWatermarkMode ? { label: "Static Watermark Remover" } : undefined} {...(proSubtitlesMode ? { proSubtitles: { backgroundMode: store.project.animation.proSubtitles.backgroundMode, backgroundColor: store.project.animation.proSubtitles.backgroundColor, exportFormat: store.project.animation.proSubtitles.exportFormat, hasSourceVideo: Boolean(store.project.animation.proSubtitles.videoUrl) } } : {})} running={exportState.running} progress={exportState.progress} currentFrame={exportState.currentFrame} totalFrames={exportState.totalFrames} error={exportState.error} onClose={exportState.hide} onCancel={exportState.cancel} onStart={(settings) => void startExport(settings)} /> : null}
  </div>;
}
