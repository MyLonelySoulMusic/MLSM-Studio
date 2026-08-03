import { useCallback, useEffect, useState } from "react";

export function useFullscreenPreview() {
  const [fullscreenPreview, setFullscreenPreview] = useState(false);
  useEffect(() => {
    if (!fullscreenPreview) return;
    const exitOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setFullscreenPreview(false); };
    window.addEventListener("keydown", exitOnEscape);
    return () => window.removeEventListener("keydown", exitOnEscape);
  }, [fullscreenPreview]);
  const toggleFullscreenPreview = useCallback(() => setFullscreenPreview((value) => !value), []);
  return { fullscreenPreview, toggleFullscreenPreview };
}
