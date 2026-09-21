import { useCallback, useEffect, useRef, useState } from "react";
import { getMlxDlssCapabilities, type MlxDlssCapabilities } from "./mlx-dlss-client";

export function useMlxDlssCapabilities(enabled = true) {
  const [capabilities, setCapabilities] = useState<MlxDlssCapabilities | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (!enabled) {
      request.current?.abort();
      request.current = null;
      setCapabilities(null);
      setError("");
      setLoading(false);
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError("");
    try {
      const value = await getMlxDlssCapabilities(controller.signal);
      if (!controller.signal.aborted) setCapabilities(value);
    } catch (reason) {
      if (!controller.signal.aborted) {
        setCapabilities(null);
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [enabled]);
  useEffect(() => { void refresh(); return () => request.current?.abort(); }, [refresh]);
  return { capabilities, error, loading, refresh, setCapabilities };
}
