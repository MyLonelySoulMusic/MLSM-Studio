import type { VideoEditorAsset, VideoEditorClip, VideoEditorSettings, VideoEditorTimebase } from "./video-editor";
import { videoEditorClipSourceDuration } from "./video-editor-speed";

export type VideoEditorToolId = "upscaler" | "watermark-remover" | "pro-subtitles";
export type VideoEditorToolStatus = "available" | "unavailable";

export interface VideoEditorToolArtifact {
  id: string;
  toolId: VideoEditorToolId;
  url: string;
  name: string;
  kind: VideoEditorAsset["kind"];
  sourceClipId: string;
  sourceFrameCount: number;
  sourceRate: { numerator: number; denominator: number };
  sourceDurationSeconds?: number;
  provenance: { toolId: VideoEditorToolId; createdAt: string; inputAssetId: string };
}

export interface VideoEditorToolDefinition {
  id: VideoEditorToolId;
  label: string;
  description: string;
  status: VideoEditorToolStatus;
  accepts(asset: VideoEditorAsset): boolean;
}

export type VideoEditorToolRunner = (input: { toolId: VideoEditorToolId; clip: VideoEditorClip; asset: VideoEditorAsset; signal: AbortSignal }) => Promise<VideoEditorToolArtifact>;
type VideoEditorToolProcessor = (input: { clip: VideoEditorClip; asset: VideoEditorAsset; signal: AbortSignal }) => Promise<{ url: string; name?: string; kind?: VideoEditorAsset["kind"]; sourceFrameCount?: number; sourceRate?: { numerator: number; denominator: number } }>;

/** Injectable bridge used by the workspace modal. Production adapters can wrap
 * the existing Upscaler/Pro Subtitle exporters without coupling timeline state to
 * download UX; tests inject deterministic Blob-producing processors. */
export function createVideoEditorToolRunner(processors: Partial<Record<VideoEditorToolId, VideoEditorToolProcessor>>): VideoEditorToolRunner {
  return async ({ toolId, clip, asset, signal }) => {
    const processor = processors[toolId];
    if (!processor) throw new Error(`${videoEditorToolDefinition(toolId).label}: backend non disponibile in questa build.`);
    if (signal.aborted) throw new DOMException("Operazione annullata", "AbortError");
    const result = await processor({ clip, asset, signal });
    if (signal.aborted) throw new DOMException("Operazione annullata", "AbortError");
    return createVideoEditorArtifact(toolId, clip, asset, result.url, result);
  };
}

const videoOnly = (asset: VideoEditorAsset) => asset.kind === "video";
export const videoEditorToolRegistry: readonly VideoEditorToolDefinition[] = [
  { id: "upscaler", label: "Upscaler", description: "Richiama il modello di upscaling già configurato e inserisce il risultato come nuova clip.", status: "available", accepts: videoOnly },
  { id: "watermark-remover", label: "Watermark Remover", description: "Elabora una clip con il rimuovi watermark e conserva l’originale intatto.", status: "available", accepts: videoOnly },
  { id: "pro-subtitles", label: "Pro Subtitles", description: "Genera un layer Pro Subtitles da inserire sopra il frammento selezionato.", status: "available", accepts: videoOnly }
];

export function videoEditorToolDefinition(id: VideoEditorToolId): VideoEditorToolDefinition {
  return videoEditorToolRegistry.find((tool) => tool.id === id)!;
}

export function videoEditorToolAvailability(settings: VideoEditorSettings, clip: VideoEditorClip, toolId: VideoEditorToolId): { status: VideoEditorToolStatus; reason?: string } {
  const asset = settings.assets.find((item) => item.id === clip.assetId);
  if (!asset || !videoEditorToolDefinition(toolId).accepts(asset)) return { status: "unavailable", reason: "Il tool richiede una clip video." };
  const definition = videoEditorToolDefinition(toolId);
  return definition.status === "available" ? { status: "available" } : { status: "unavailable", reason: "Backend locale non disponibile: l’inserimento viene bloccato per evitare un falso artifact." };
}

/** Canonical half-open source interval sent to external clip processors. */
export function videoEditorToolSourceRange(clip: VideoEditorClip, timebase: VideoEditorTimebase): { sourceStartSeconds: number; sourceDurationSeconds: number; sourceEndSeconds: number } {
  const sourceStartSeconds = Math.max(0, clip.sourceInSeconds);
  const sourceDurationSeconds = videoEditorClipSourceDuration(clip, timebase);
  return { sourceStartSeconds, sourceDurationSeconds, sourceEndSeconds: sourceStartSeconds + sourceDurationSeconds };
}

export function createVideoEditorArtifact(toolId: VideoEditorToolId, clip: VideoEditorClip, asset: VideoEditorAsset, url: string, metadata: Partial<Pick<VideoEditorToolArtifact, "name" | "kind" | "sourceFrameCount" | "sourceRate" | "sourceDurationSeconds">> = {}): VideoEditorToolArtifact {
  if (!url) throw new Error("Artifact senza URL: operazione rifiutata");
  return { id: `video-editor-artifact-${crypto.randomUUID()}`, toolId, url, kind: metadata.kind ?? asset.kind, name: metadata.name ?? `${asset.name} · ${videoEditorToolDefinition(toolId).label}`, sourceClipId: clip.id, sourceFrameCount: metadata.sourceFrameCount ?? asset.sourceFrameCount ?? 0, sourceRate: metadata.sourceRate ?? asset.sourceRate ?? { numerator: 60, denominator: 1 }, ...(metadata.sourceDurationSeconds !== undefined ? { sourceDurationSeconds: metadata.sourceDurationSeconds } : {}), provenance: { toolId, createdAt: new Date().toISOString(), inputAssetId: asset.id } };
}
