export interface OverlaySpectralBackgroundOwner {
  readonly file: File;
  readonly projectId: string;
  readonly url: string;
}

let activeOwner: OverlaySpectralBackgroundOwner | null = null;

function revoke(owner: OverlaySpectralBackgroundOwner): void {
  if (owner.url.startsWith("blob:") && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(owner.url);
}

/**
 * Video backgrounds are intentionally runtime assets. Keeping the File alive and
 * exposing it through a blob URL avoids the very large data: URLs that WebKit can
 * fail to decode. Only the exact current owner may release the URL.
 */
export function registerOverlaySpectralBackground(projectId: string, file: File): OverlaySpectralBackgroundOwner {
  const previous = activeOwner;
  const owner = { file, projectId, url: URL.createObjectURL(file) };
  activeOwner = owner;
  if (previous) revoke(previous);
  return owner;
}

export function releaseOverlaySpectralBackground(owner: OverlaySpectralBackgroundOwner): boolean {
  if (activeOwner !== owner) return false;
  activeOwner = null;
  revoke(owner);
  return true;
}

export function clearOverlaySpectralBackground(): void {
  const owner = activeOwner;
  if (!owner) return;
  activeOwner = null;
  revoke(owner);
}

export function getOverlaySpectralBackground(): OverlaySpectralBackgroundOwner | null {
  return activeOwner;
}

