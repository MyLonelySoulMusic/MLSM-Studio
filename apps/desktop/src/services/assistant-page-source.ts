// Only shipped application source is eligible; no filesystem input, .env or user files.
const sourceLoaders = import.meta.glob<string>(["../components/*.tsx", "./*-renderer.ts", "./audio-tools.ts", "./frame-interpolation-client.ts"], { query: "?raw", import: "default" });
const sources: Record<string, string[]> = {
  studioSettings: ["StudioSettings"],
  studioHome: ["StudioHome", "StudioExperience"], audioWorkspace: ["AudioWorkspace", "audio-tools"],
  upscaler: ["UpscalerPanel", "RemoteUpscalerPanel", "UpscalerPreview"], frameBooster: ["FrameBoosterPanel", "FrameBoosterPreview", "frame-interpolation-client"],
  videoEditor: ["VideoEditorLibrary", "VideoEditorInspector", "VideoEditorTimeline"], mlsmPostLipsync: ["MlsmPostLipsyncWorkspace"],
  proSubtitles: ["ProSubtitlesPanel"], cassetteDesk: ["CassetteDeskPanel"], overlaySpectral: ["OverlaySpectralPanel"],
};
export interface PageSource { revision: string; text: string; files: string[] }
function fingerprint(text: string) { let hash = 2166136261; for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return (hash >>> 0).toString(16); }
export async function getAssistantPageSource(modeId: string): Promise<PageSource> {
  const prefix = modeId.charAt(0).toUpperCase() + modeId.slice(1);
  const names = [...(sources[modeId] ?? [prefix + "Panel", prefix + "Preview"]), "Toolbar"];
  const entries = Object.entries(sourceLoaders).filter(([path]) => names.some(name => path.endsWith(`/${name}.tsx`) || path.endsWith(`/${name}.ts`)));
  const loaded = await Promise.all(entries.map(async ([path, read]) => ({ path, code: await read() })));
  const revision = fingerprint(loaded.map(file => file.code).join("\n"));
  const text = loaded.map(({ path, code }) => {
    // Remove imports and blank lines; preserve executable handlers, labels and conditions.
    const body = code.split("\n").filter(line => !line.startsWith("import ") && line.trim()).join("\n");
    return `SOURCE ${path}\n${body.slice(0, 14_000)}`;
  }).join("\n\n").slice(0, 40_000);
  return { revision, text, files: loaded.map(file => file.path) };
}
