import { useCallback, useEffect, useRef, useState } from "react";
import { deleteRecording, downloadRecording, listRecordings, StreamerRecording, type PcmSource, type RecordingInfo, type SavedRecording } from "./streamer-recording";

export function useStreamerRecording() {
  const [info, setInfo] = useState<RecordingInfo>({ phase: "idle", seconds: 0 });
  const [takes, setTakes] = useState<SavedRecording[]>([]), [error, setError] = useState("");
  const session = useRef<StreamerRecording | null>(null), alive = useRef(false), generation = useRef(0);
  useEffect(() => {
    alive.current = true; let active = true;
    if (typeof navigator.storage?.getDirectory === "function") void listRecordings().then(items => { if (active) setTakes(previous => [...previous, ...items.filter(item => !previous.some(value => value.id === item.id))]); }).catch(() => undefined);
    return () => { active = false; alive.current = false; void session.current?.finish(); session.current = null; };
  }, []);
  useEffect(() => {
    if (info.phase === "idle") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [info.phase]);
  const stop = useCallback(async () => {
    if (session.current) await session.current.finish();
    else { generation.current++; if (alive.current) setInfo({ phase: "idle", seconds: 0 }); }
  }, []);
  const arm = useCallback(async () => {
    setError(""); setInfo({ phase: "arming", seconds: 0 }); const token = ++generation.current;
    try {
      const recording = await StreamerRecording.arm(
        state => { if (alive.current && token === generation.current) setInfo(state); },
        (item, failure) => {
          if (token === generation.current) session.current = null;
          if (!alive.current || token !== generation.current) return;
          if (item) setTakes(values => [item, ...values.filter(value => value.id !== item.id)]);
          if (failure) setError(String(failure));
        }
      );
      if (!alive.current || token !== generation.current) { await recording.finish(); return; }
      session.current = recording;
    } catch (failure) {
      if (!alive.current || token !== generation.current) return;
      setInfo({ phase: "idle", seconds: 0 });
      if (!(failure instanceof DOMException && (failure.name === "NotAllowedError" || failure.name === "AbortError"))) setError(String(failure));
    }
  }, []);
  const start = useCallback((runtime: PcmSource) => { void session.current?.start(runtime).catch(failure => { if (alive.current) setError(String(failure)); }); }, []);
  const pause = useCallback(() => session.current?.pause(), []);
  const save = async (item: SavedRecording, kind: "video" | "audio") => {
    setError(""); try { await downloadRecording(item, kind); }
    catch (failure) { if (!(failure instanceof DOMException && failure.name === "AbortError")) setError(String(failure)); }
  };
  const remove = async (item: SavedRecording) => {
    try { await deleteRecording(item.id); setTakes(values => values.filter(value => value.id !== item.id)); }
    catch (failure) { setError(String(failure)); }
  };
  return { info, takes, error, arm, start, pause, stop, save, remove, clearError: () => setError("") };
}
