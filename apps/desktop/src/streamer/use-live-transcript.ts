import { useEffect, useRef, useState } from "react";
import { emptyLiveTranscript, LiveTranscriptSession, type LiveTranscriptState } from "./live-transcript";
import type { StreamerAudioRuntime } from "./streamer-audio";

/** Area-owned: fullscreen/maximize does not restart the Whisper session. */
export function useLiveTranscript(runtime: StreamerAudioRuntime | null, sourceKey: string, active: boolean, enabled: boolean, language: string) {
  const [state, setState] = useState<LiveTranscriptState>(emptyLiveTranscript);
  const [revision, setRevision] = useState(0);
  const session = useRef<LiveTranscriptSession | null>(null);
  const activeRef = useRef(active); activeRef.current = active;
  useEffect(() => {
    setState({ ...emptyLiveTranscript(), phase: enabled ? "idle" : "off" });
    if (!runtime || !enabled) return;
    const current = new LiveTranscriptSession(setState, language); session.current = current;
    current.setActive(activeRef.current);
    const unsubscribe = runtime.subscribePcm((pcm, rate) => current.push(pcm, rate));
    const reset = () => setRevision(value => value + 1);
    runtime.audio.addEventListener("seeking", reset);
    const close = () => current.dispose(); window.addEventListener("pagehide", close);
    return () => { unsubscribe(); runtime.audio.removeEventListener("seeking", reset); window.removeEventListener("pagehide", close); current.dispose(); if (session.current === current) session.current = null; };
  }, [runtime, sourceKey, enabled, language, revision]);
  useEffect(() => {
    if (active && runtime && enabled && !session.current) setRevision(value => value + 1);
    session.current?.setActive(active);
    if (active) return;
    // Release native model memory during long pauses; resume with a fresh session.
    const pausedSession = session.current;
    const timer = setTimeout(() => {
      pausedSession?.dispose();
      if (session.current === pausedSession) session.current = null;
    }, 60000);
    return () => clearTimeout(timer);
  }, [active, runtime, sourceKey, enabled, language, revision]);
  return state;
}
