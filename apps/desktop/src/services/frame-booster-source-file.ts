/** Session-only file registry for Frame Booster uploads.
 *
 * Object URLs are deliberately kept outside the project JSON.  The registry
 * is isolated from the Upscaler source registry so importing a booster video
 * can never replace the still/video currently open in the Upscaler.
 */
const files = new Map<string, File>();

export function registerFrameBoosterSourceFile(url: string, file: File): void {
  if (!url || !file) return;
  files.set(url, file);
}

export function getFrameBoosterSourceFile(url: string | null): File | null {
  return url ? files.get(url) ?? null : null;
}

export function clearFrameBoosterSourceFile(url?: string): void {
  if (url) files.delete(url);
  else files.clear();
}

/** Releases only URLs created and owned by the Frame Booster importer. */
export function releaseFrameBoosterSourceFile(url: string | null | undefined): void {
  if (!url || !files.has(url)) return;
  files.delete(url);
  URL.revokeObjectURL(url);
}

/** Successful New/Open boundaries use this to release every session asset. */
export function resetFrameBoosterRuntimeForProjectReplacement(): void {
  window.dispatchEvent(new Event("frame-booster:reset"));
  for (const url of files.keys()) URL.revokeObjectURL(url);
  files.clear();
}

export function frameBoosterSourceFileCount(): number { return files.size; }
