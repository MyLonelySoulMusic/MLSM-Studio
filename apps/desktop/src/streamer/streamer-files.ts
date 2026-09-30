import { Input, BlobSource, ALL_FORMATS } from "mediabunny";
import { createTrackId, type Track } from "./streamer-store";
import { importNativeTracks } from "./streamer-audio";

export async function nativeTracks(paths?: string[]): Promise<Track[]> {
  return (await importNativeTracks(paths)).map(file => ({ ...file, id: createTrackId(), provider: "local", nativePath: file.playbackPath ?? file.path }));
}
function dataUrl(blob: Blob): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); }
export async function browserTrack(file: File): Promise<Track> {
  const result: Track = { id: createTrackId(), provider: "local", title: file.name, file, format: file.name.split(".").at(-1)?.toUpperCase() ?? "Audio" };
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const audio = await input.getPrimaryAudioTrack(); if (!audio) throw new Error("No audio track");
    const tags = await input.getMetadataTags(); result.title = tags.title || file.name; if (tags.artist) result.artist = tags.artist; if (tags.album) result.album = tags.album;
    const cover = tags.images?.find(image => image.kind === "coverFront") ?? tags.images?.[0]; if (cover && cover.data.byteLength <= 4 * 1024 * 1024) result.artwork = await dataUrl(new Blob([Uint8Array.from(cover.data)], { type: cover.mimeType }));
    result.duration = await input.computeDuration(); result.sampleRate = await audio.getSampleRate(); result.channels = await audio.getNumberOfChannels(); const codec = await audio.getCodec(); if (codec) result.codec = codec;
  } catch {
    // Native FFmpeg handles additional formats. In browser keep the file for
    // HTMLMediaElement decoding; report its actual error if unsupported.
  } finally { input.dispose(); }
  return result;
}
