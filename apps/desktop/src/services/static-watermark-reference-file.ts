const files = new Map<string, File>();
let activeUrl: string | null = null;

export function registerStaticWatermarkReferenceFile(url: string, file: File): void {
  if (activeUrl && activeUrl !== url) {
    files.delete(activeUrl);
    if (activeUrl.startsWith("blob:")) URL.revokeObjectURL(activeUrl);
  }
  activeUrl = url;
  files.set(url, file);
}

export function getStaticWatermarkReferenceFile(url: string | null): File | null {
  return url ? files.get(url) ?? null : null;
}

export function clearStaticWatermarkReferenceFile(): void {
  if (activeUrl?.startsWith("blob:")) URL.revokeObjectURL(activeUrl);
  files.clear();
  activeUrl = null;
}
