import { canEncodeAudio, type ConversionAudioOptions, type InputAudioTrack } from "mediabunny";

export type OfflineAacMode = "copy" | "native" | "software";
export interface OfflineAacPlan { mode: OfflineAacMode; options: ConversionAudioOptions }

let softwareRegistration: Promise<void> | null = null;

/** Load the bundled worker/WASM encoder only when native AAC is unavailable. */
export async function ensureOfflineAacEncoder(config: { numberOfChannels: number; sampleRate: number; bitrate: number }): Promise<"native" | "software"> {
  // A registered software encoder is shared by all Mediabunny conversions.
  if (!softwareRegistration) {
    try { if (await canEncodeAudio("aac", config)) return "native"; }
    catch { /* Some WebViews throw instead of reporting unsupported AAC. */ }
  }
  if (!softwareRegistration) {
    softwareRegistration = import("@mediabunny/aac-encoder").then(({ registerAacEncoder }) => {
      registerAacEncoder();
      console.info("[Offline export] Fallback AAC software registrato: worker/WASM incluso nell’app, nessun servizio esterno.");
    }).catch((error: unknown) => { softwareRegistration = null; throw error; });
  }
  try {
    await softwareRegistration;
    if (!await canEncodeAudio("aac", config)) throw new Error(`Formato non supportato: ${config.numberOfChannels} canali, ${config.sampleRate} Hz.`);
    return "software";
  } catch (error) {
    throw new Error(`Impossibile preparare l’encoder AAC software incluso nell’app. ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Preserve encoded AAC where possible, including stereo and original timestamps. */
export async function prepareOfflineAacAudio(track: Pick<InputAudioTrack, "getCodec" | "getFirstTimestamp" | "getNumberOfChannels" | "getSampleRate">): Promise<OfflineAacPlan> {
  const [codec, firstTimestamp] = await Promise.all([track.getCodec(), track.getFirstTimestamp()]);
  // Negative preroll needs sample-accurate trimming, so Conversion must transcode it.
  if (codec === "aac" && firstTimestamp >= 0) return { mode: "copy", options: { codec: "aac" } };
  const [numberOfChannels, sampleRate] = await Promise.all([track.getNumberOfChannels(), track.getSampleRate()]);
  const config = { numberOfChannels, sampleRate, bitrate: 320_000 };
  const mode = await ensureOfflineAacEncoder(config);
  return { mode, options: { codec: "aac", ...config, forceTranscode: true } };
}
