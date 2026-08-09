let activeSource: { url: string; file: File } | null = null;

/**
 * Conserva il File originale fuori dal progetto serializzabile. In questo modo
 * l'export video non dipende da un fetch del blob URL, che può essere invalidato
 * da un remount/HMR pur continuando a risultare visibile nel tag <video>.
 */
export function registerUpscalerSourceFile(url: string, file: File): void {
  activeSource = { url, file };
}

export function getUpscalerSourceFile(url: string | null): File | null {
  return activeSource?.url === url ? activeSource.file : null;
}

