export interface UpscalerSourceFileOwner {
  readonly url: string;
  readonly file: File;
}

let activeSource: UpscalerSourceFileOwner | null = null;

/**
 * Conserva il File originale fuori dal progetto serializzabile. In questo modo
 * l'export video non dipende da un fetch del blob URL, che può essere invalidato
 * da un remount/HMR pur continuando a risultare visibile nel tag <video>.
 */
export function registerUpscalerSourceFile(url: string, file: File): UpscalerSourceFileOwner {
  const owner: UpscalerSourceFileOwner = { url, file };
  activeSource = owner;
  return owner;
}

export function getUpscalerSourceFile(url: string | null): File | null {
  return activeSource?.url === url ? activeSource.file : null;
}

/** Returns the exact runtime owner required to clear the current registration. */
export function getUpscalerSourceFileOwner(): UpscalerSourceFileOwner | null {
  return activeSource;
}

/**
 * Releases a registered source only when the caller still owns the exact
 * registration. Clearing first makes repeated reset calls idempotent even if a
 * host implementation of revokeObjectURL were to throw.
 */
export function clearUpscalerSourceFile(owner: UpscalerSourceFileOwner): string | null {
  if (activeSource !== owner) return null;
  activeSource = null;
  if (owner.url.startsWith("blob:") && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(owner.url);
  return owner.url;
}
