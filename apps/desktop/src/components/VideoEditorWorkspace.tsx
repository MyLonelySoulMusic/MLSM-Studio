import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useProjectStore } from "../store/project-store";
import { VideoEditorEffectsLibrary } from "./VideoEditorEffectsLibrary";
import { VideoEditorPanel } from "./VideoEditorPanel";
import { videoEditorToolAvailability, videoEditorToolRegistry, type VideoEditorToolArtifact, type VideoEditorToolId } from "../services/video-editor-tools";
import { videoEditorAsset, videoEditorClip } from "../services/video-editor";
import { videoEditorEffectCatalog } from "../services/video-editor-effects";
import { WorkspaceResizeHandle } from "./WorkspaceResizeHandle";
import {
  DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH,
  MIN_VIDEO_EDITOR_LEFT_DOCK_WIDTH,
  VIDEO_EDITOR_WORKSPACE_LAYOUT_KEY,
  clampVideoEditorLeftDockWidth,
  parseVideoEditorLeftDockWidth,
  videoEditorInspectorUsesOverlay,
  videoEditorLeftDockMaxWidth,
  videoEditorUsesLeftDockDrawer
} from "../services/video-editor-workspace-layout";

export type VideoEditorWorkspaceTab = "media" | "audio" | "text" | "effects" | "transitions" | "adjust" | "tools";

interface Props {
  preview: ReactNode;
  inspector: ReactNode;
  timeline: ReactNode;
  onUndo?: () => void;
  onRedo?: () => void;
  onOpenTool?: (toolId: VideoEditorToolId, clipId: string) => void;
  runTool?: (toolId: VideoEditorToolId, clipId: string, signal: AbortSignal) => Promise<VideoEditorToolArtifact>;
}

const tabs: readonly { id: VideoEditorWorkspaceTab; label: string }[] = [
  { id: "media", label: "Media" }, { id: "audio", label: "Audio" }, { id: "text", label: "Text" },
  { id: "effects", label: "Effects" }, { id: "transitions", label: "Transitions" }, { id: "adjust", label: "Adjust" }, { id: "tools", label: "AI Tools" }
];

function VideoEditorTransitionsPanel() {
  const settings = useProjectStore((state) => state.project.animation.videoEditor);
  const addEffect = useProjectStore((state) => state.addVideoEditorEffectClip);
  const selected = videoEditorClip(settings, settings.selectedClipIds.at(-1) ?? "");
  const asset = selected ? videoEditorAsset(settings, selected.assetId) : null;
  const track = selected ? settings.tracks.find((candidate) => candidate.id === selected.trackId) : null;
  const target = selected && asset?.kind !== "audio" && !track?.locked ? selected : null;
  const transitions = videoEditorEffectCatalog.filter((definition) => definition.category === "transitions");

  return <section className="video-editor-tool-placeholder" aria-label="Transizioni Video Editor">
    <strong>Transitions</strong>
    <span>{transitions.length ? `${transitions.length} transizioni disponibili. Si applicano soltanto alla clip visiva selezionata.` : "Nessuna transizione disponibile in questa build."}</span>
    {transitions.length ? <div className="video-editor-tool-list">{transitions.map((transition) => <button key={transition.id} type="button" disabled={!target} title={target ? transition.description : "Seleziona una clip visiva su una traccia sbloccata."} onClick={() => target && addEffect(transition.id, { targetClipId: target.id })}>{transition.label}<small>{transition.description}</small></button>)}</div> : <p className="muted" role="status">Il catalogo Transitions è vuoto: nessun effetto generico viene mostrato al suo posto.</p>}
  </section>;
}

export function VideoEditorWorkspace({ preview, inspector, timeline, onUndo, onRedo, onOpenTool, runTool }: Props) {
  const [activeTab, setActiveTab] = useState<VideoEditorWorkspaceTab>("media");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const workspaceMainRef = useRef<HTMLDivElement>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(() => typeof window === "undefined" ? 1280 : window.innerWidth);
  const [leftDockWidth, setLeftDockWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH;
    try { return parseVideoEditorLeftDockWidth(window.localStorage.getItem(VIDEO_EDITOR_WORKSPACE_LAYOUT_KEY)); } catch { return DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH; }
  });
  const settings = useProjectStore((state) => state.project.animation.videoEditor);
  const hasSelection = settings.selectedClipIds.length > 0 || settings.selectedEffectClipIds.length > 0;
  const inspectorVisible = rightOpen && hasSelection;
  const leftDrawer = videoEditorUsesLeftDockDrawer(workspaceWidth);
  const leftDockMaxWidth = videoEditorLeftDockMaxWidth(workspaceWidth);
  const visibleLeftDockWidth = clampVideoEditorLeftDockWidth(leftDockWidth, workspaceWidth);
  const inspectorOverlay = videoEditorInspectorUsesOverlay(workspaceWidth, visibleLeftDockWidth, inspectorVisible);
  const selectedClipId = settings.selectedClipIds.at(-1) ?? null;
  const [toolModal, setToolModal] = useState<VideoEditorToolId | null>(null);
  const insertArtifact = useProjectStore((state) => state.insertVideoEditorArtifact);
  const updateClip = useProjectStore((state) => state.updateVideoEditorClip);
  const updateAdjustments = useProjectStore((state) => state.updateVideoEditorClipAdjustments);
  const updateTrack = useProjectStore((state) => state.updateVideoEditorTrack);
  const [toolRunning, setToolRunning] = useState(false);
  const [toolError, setToolError] = useState<string | null>(null);
  const toolController = useRef<AbortController | null>(null);
  const selectedClip = selectedClipId ? videoEditorClip(settings, selectedClipId) : null;
  const selectedAsset = selectedClip ? videoEditorAsset(settings, selectedClip.assetId) : null;
  useEffect(() => () => toolController.current?.abort(), []);
  useEffect(() => {
    const element = workspaceMainRef.current;
    const measure = () => setWorkspaceWidth(Math.max(1, element?.clientWidth || window.innerWidth));
    measure();
    if (typeof ResizeObserver === "undefined" || !element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(VIDEO_EDITOR_WORKSPACE_LAYOUT_KEY, JSON.stringify({ left: leftDockWidth })); } catch { /* Il ridimensionamento resta attivo per la sessione. */ }
  }, [leftDockWidth]);
  const resizeLeftDock = (width: number) => setLeftDockWidth(clampVideoEditorLeftDockWidth(width, workspaceWidth));
  const cancelTool = () => {
    toolController.current?.abort();
    toolController.current = null;
    setToolRunning(false);
    setToolModal(null);
  };
  const openTool = (toolId: VideoEditorToolId) => {
    if (!selectedClipId) return;
    const source = videoEditorClip(settings, selectedClipId);
    if (!source) { setToolError("La clip selezionata non esiste più."); return; }
    const availability = videoEditorToolAvailability(settings, source, toolId);
    if (availability.status !== "available") { setToolError(availability.reason ?? "Tool non disponibile."); return; }
    if (!runTool) { setToolModal(null); onOpenTool?.(toolId, selectedClipId); return; }
    const controller = new AbortController();
    toolController.current = controller;
    setToolRunning(true); setToolError(null);
    void runTool(toolId, selectedClipId, controller.signal).then((artifact) => {
      if (controller.signal.aborted || toolController.current !== controller) {
        if (artifact.url.startsWith("blob:")) URL.revokeObjectURL(artifact.url);
        return;
      }
      const insertedId = insertArtifact(artifact, selectedClipId);
      if (!insertedId) {
        if (artifact.url.startsWith("blob:")) URL.revokeObjectURL(artifact.url);
        setToolError("Il risultato non può essere inserito: la clip o la traccia è stata rimossa o bloccata durante l’elaborazione.");
        return;
      }
      setToolModal(null);
    }).catch((error) => {
      if (!controller.signal.aborted) setToolError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (toolController.current === controller) { toolController.current = null; setToolRunning(false); }
    });
  };

  return <section className="video-editor-workspace" aria-label="Video Editor workspace">
    <nav className="video-editor-subtoolbar" aria-label="Funzioni Video Editor">
      <div className="video-editor-tab-list">{tabs.map((tab) => <button key={tab.id} type="button" className={activeTab === tab.id ? "active-control" : ""} aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}</div>
      <div className="video-editor-subtoolbar-actions">
        <button type="button" aria-label="Annulla modifica Video Editor" onClick={onUndo}>↶</button>
        <button type="button" aria-label="Ripristina modifica Video Editor" onClick={onRedo}>↷</button>
        <button type="button" className={leftOpen ? "active-control" : ""} aria-expanded={leftOpen} aria-controls="video-editor-left-dock-shell" onClick={() => setLeftOpen((open) => !open)}>Dock</button>
        <button type="button" className={rightOpen ? "active-control" : ""} aria-expanded={rightOpen} aria-controls="video-editor-inspector" onClick={() => setRightOpen((open) => !open)}>Inspector</button>
      </div>
    </nav>
    <div ref={workspaceMainRef} className={`video-editor-workspace-main${!leftOpen ? " no-left-dock" : ""}${!inspectorVisible || inspectorOverlay ? " no-right-dock" : ""}${leftDrawer && leftOpen ? " has-left-drawer" : ""}${inspectorOverlay ? " has-inspector-overlay" : ""}`} style={{ "--video-editor-left-dock-width": `${visibleLeftDockWidth}px` } as CSSProperties}>
      {leftDrawer && leftOpen ? <button type="button" className="video-editor-left-dock-backdrop" aria-label="Chiudi libreria Video Editor" onClick={() => setLeftOpen(false)} /> : null}
      {leftOpen ? <div className="video-editor-left-dock-shell" id="video-editor-left-dock-shell">
        <aside className="video-editor-left-dock" aria-label="Libreria Video Editor">
        <div hidden={activeTab !== "effects"}><VideoEditorEffectsLibrary /></div>
        {/* eslint-disable-next-line @typescript-eslint/no-unused-vars -- the checkbox only toggles the current track state. */}
        {activeTab === "media" ? <VideoEditorPanel /> : activeTab === "effects" ? null : activeTab === "transitions" ? <VideoEditorTransitionsPanel /> : activeTab === "tools" ? <div className="video-editor-tool-placeholder"><strong>AI Tools</strong><span>{selectedClipId ? "Scegli il tool da applicare al frammento selezionato." : "Seleziona un frammento nella timeline."}</span><div className="video-editor-tool-list">{videoEditorToolRegistry.map((tool) => { const availability = selectedClip ? videoEditorToolAvailability(settings, selectedClip, tool.id) : { status: "unavailable" as const, reason: "Seleziona una clip video." }; return <button key={tool.id} type="button" disabled={availability.status !== "available"} onClick={() => { setToolError(null); setToolModal(tool.id); }} title={availability.reason ?? tool.description}>{tool.label}<small>{availability.status === "available" ? "Apri workflow" : availability.reason}</small></button>; })}</div></div> : activeTab === "text" ? <div className="video-editor-tool-placeholder"><strong>Text</strong><span>Genera un layer Pro Subtitles per la clip selezionata.</span><button type="button" disabled={!selectedClip || videoEditorToolAvailability(settings, selectedClip, "pro-subtitles").status !== "available"} onClick={() => { setToolError(null); setToolModal("pro-subtitles"); }}>Apri Pro Subtitles</button></div> : activeTab === "audio" ? <div className="video-editor-tool-placeholder"><strong>Audio mixer</strong>{settings.tracks.map((track) => <label key={track.id}>{track.name}: {Math.round(track.volume * 100)}%<input aria-label={`Mixer ${track.name}`} type="range" min="0" max="2" step=".01" value={track.volume} onChange={(event) => updateTrack(track.id, { volume: Number(event.target.value) })} /><input aria-label={`Muta ${track.name}`} type="checkbox" checked={track.muted} onChange={(event) => updateTrack(track.id, { muted: !track.muted })} /></label>)}{selectedClip && (selectedAsset?.kind === "audio" || selectedAsset?.hasAudio) ? <label>Clip: {Math.round(selectedClip.volume * 100)}%<input aria-label="Volume clip nel dock Audio" type="range" min="0" max="2" step=".01" value={selectedClip.volume} onChange={(event) => updateClip(selectedClip.id, { volume: Number(event.target.value) })} /></label> : <span>Seleziona una clip con audio per regolarne il volume.</span>}</div> : <div className="video-editor-tool-placeholder"><strong>Adjust</strong>{selectedClip && selectedAsset?.kind !== "audio" ? <><label>Esposizione<input aria-label="Esposizione nel dock Adjust" type="range" min="-2" max="2" step=".01" value={selectedClip.adjustments.exposure} onChange={(event) => updateAdjustments(selectedClip.id, { exposure: Number(event.target.value) })} /></label><label>Contrasto<input aria-label="Contrasto nel dock Adjust" type="range" min="-100" max="100" step="1" value={selectedClip.adjustments.contrast} onChange={(event) => updateAdjustments(selectedClip.id, { contrast: Number(event.target.value) })} /></label><label>Saturazione<input aria-label="Saturazione nel dock Adjust" type="range" min="-100" max="100" step="1" value={selectedClip.adjustments.saturation} onChange={(event) => updateAdjustments(selectedClip.id, { saturation: Number(event.target.value) })} /></label></> : <span>Seleziona una clip video o immagine per regolarla.</span>}</div>}
        </aside>
        <WorkspaceResizeHandle side="left" className="video-editor-workspace-resize-handle" width={visibleLeftDockWidth} minWidth={MIN_VIDEO_EDITOR_LEFT_DOCK_WIDTH} maxWidth={leftDockMaxWidth} keyboardStep={16} label="Ridimensiona dock sinistro Video Editor" onResize={resizeLeftDock} onReset={() => resizeLeftDock(DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH)} />
      </div> : null}
      <div className="video-editor-center-stage">{preview}</div>
      {inspectorVisible ? <aside id="video-editor-inspector" className={`video-editor-right-dock${inspectorOverlay ? " video-editor-inspector-overlay" : ""}`} aria-label="Inspector contestuale">{inspector}</aside> : null}
    </div>
    <div className="video-editor-timeline-dominant">{timeline}</div>
    {toolModal ? <div className="video-editor-tool-modal-backdrop" role="presentation" onMouseDown={() => !toolRunning && setToolModal(null)}><div className="video-editor-tool-modal" role="dialog" aria-modal="true" aria-label={`Apri ${videoEditorToolRegistry.find((tool) => tool.id === toolModal)?.label ?? toolModal}`} onMouseDown={(event) => event.stopPropagation()}><button type="button" className="video-editor-tool-modal-close" aria-label="Chiudi" disabled={toolRunning} onClick={() => setToolModal(null)}>×</button><strong>{videoEditorToolRegistry.find((tool) => tool.id === toolModal)?.label}</strong><p>Il frammento selezionato verrà elaborato e il risultato inserito come nuova clip sopra l’originale.</p>{toolError ? <p className="status-error" role="alert">{toolError}</p> : null}{!runTool ? <p className="muted">Backend video artifact non disponibile in questa build: nessun risultato simulato.</p> : toolRunning ? <button type="button" onClick={cancelTool}>Annulla elaborazione</button> : <button type="button" className="active-control" onClick={() => openTool(toolModal)}>Esegui sul frammento</button>}</div></div> : null}
  </section>;
}
