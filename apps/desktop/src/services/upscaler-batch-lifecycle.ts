import { useUpscalerBatchStore } from "../store/upscaler-batch-store";
import { clearUpscalerSourceFile, getUpscalerSourceFileOwner } from "./upscaler-source-file";

export const UPSCALER_PROJECT_REPLACED_EVENT = "upscaler:project-replaced";

/** Clears runtime-only Upscaler state after a project replacement is committed. */
export function resetUpscalerRuntimeForProjectReplacement(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(UPSCALER_PROJECT_REPLACED_EVENT));
  const sourceOwner = getUpscalerSourceFileOwner();
  const releasedSourceUrl = sourceOwner ? clearUpscalerSourceFile(sourceOwner) : null;
  useUpscalerBatchStore.getState().resetForProjectReplacement(releasedSourceUrl ? new Set([releasedSourceUrl]) : undefined);
}
