const files = new Map<string, File>();

export function registerMlxDlssReplacementAudio(url: string, file: File): void { files.set(url, file); }
export function getMlxDlssReplacementAudio(url: string | null): File | null { return url ? files.get(url) ?? null : null; }
export function releaseMlxDlssReplacementAudio(url: string | null): void {
  if (!url) return; files.delete(url); if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}
