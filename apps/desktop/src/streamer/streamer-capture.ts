export interface BrowserCaptureSource { kind: "system" | "application" | "outputDevice" | "input"; id?: string; }
export interface CaptureInfo {
  backend: "browser" | "native";
  trackChannels: number | null;
  receivedChannels: number | null;
  sampleRate: number | null;
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
  constraintError: string | null;
}

/** Ask for music PCM at acquisition, before the browser can fold it to mono. */
export async function requestBrowserCapture(source: BrowserCaptureSource): Promise<{ stream: MediaStream; info: CaptureInfo }> {
  const audio: MediaTrackConstraints = { channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  const displayAudio = { ...audio, suppressLocalAudioPlayback: false, restrictOwnAudio: false };
  const stream = source.kind === "input"
    ? await navigator.mediaDevices.getUserMedia({ audio: { ...audio, ...(source.id ? { deviceId: { exact: source.id } } : {}) }, video: false })
    : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: displayAudio });
  try {
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error("No audio was shared by this browser / Nessun audio condiviso dal browser");
    let constraintError: string | null = null;
    const initial = track.getSettings();
    // Chrome display tracks can reject applyConstraints even when acquisition
    // already delivered the requested stereo/processing settings. Do not
    // reconfigure a good track or show a spurious failure for it.
    if (initial.channelCount !== 2 || initial.echoCancellation || initial.noiseSuppression || initial.autoGainControl) {
      try { await track.applyConstraints(audio); }
      catch (error) { constraintError = error instanceof Error ? error.message : String(error); }
    }
    const settings = track.getSettings();
    const info: CaptureInfo = {
      backend: "browser", trackChannels: settings.channelCount ?? null, receivedChannels: null,
      sampleRate: settings.sampleRate ?? null, echoCancellation: settings.echoCancellation ?? null,
      noiseSuppression: settings.noiseSuppression ?? null, autoGainControl: settings.autoGainControl ?? null, constraintError,
    };
    // No URLs, device IDs or PCM are logged.
    console.info("[Streamer capture] Negotiated audio", { kind: source.kind, ...info });
    return { stream, info };
  } catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
}
