import { invoke, isTauri } from "@tauri-apps/api/core";

export type StreamProvider = "spotify" | "youtube";
export type SpotifyResourceKind = "track" | "album" | "playlist";

export interface ProviderMetadata {
  title: string;
  artist?: string;
  artwork?: string;
  duration?: number;
}

export interface SpotifySource {
  provider: "spotify";
  kind: SpotifyResourceKind;
  id: string;
  uri: string;
  canonicalUrl: string;
}

export interface YouTubeSource {
  provider: "youtube";
  videoId: string;
  canonicalUrl: string;
  artwork: string;
}

export type ParsedProviderSource = SpotifySource | YouTubeSource;

type UnknownRecord = Record<string, unknown>;

const SPOTIFY_ID = /^[A-Za-z0-9]{10,64}$/;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const SPOTIFY_HOSTS = new Set(["open.spotify.com"]);
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);

function parseHttpsUrl(value: string, label: string): URL {
  let parsed: URL;
  try { parsed = new URL(value.trim()); } catch { throw new Error(`URL ${label} non valido.`); }
  if (parsed.protocol !== "https:") throw new Error(`L’URL ${label} deve usare HTTPS.`);
  return parsed;
}

export function parseSpotifyUrl(value: string): SpotifySource {
  const parsed = parseHttpsUrl(value, "Spotify");
  if (!SPOTIFY_HOSTS.has(parsed.hostname.toLowerCase())) throw new Error("URL Spotify non valido.");
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts[0]?.toLowerCase().startsWith("intl-") || parts[0]?.toLowerCase() === "embed") parts.shift();
  const kind = parts[0] as SpotifyResourceKind | undefined;
  const id = parts[1];
  if (!kind || !(["track", "album", "playlist"] as const).includes(kind) || !id || !SPOTIFY_ID.test(id)) throw new Error("URL Spotify non valido: usa un link a traccia, album o playlist.");
  return { provider: "spotify", kind, id, uri: `spotify:${kind}:${id}`, canonicalUrl: `https://open.spotify.com/${kind}/${id}` };
}

export function youtubeArtworkUrl(videoId: string): string {
  if (!YOUTUBE_VIDEO_ID.test(videoId)) throw new Error("ID video YouTube non valido.");
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function parseYouTubeUrl(value: string): YouTubeSource {
  const parsed = parseHttpsUrl(value, "YouTube");
  if (!YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) throw new Error("URL YouTube non valido.");
  const parts = parsed.pathname.split("/").filter(Boolean);
  let videoId: string | null | undefined;
  if (parsed.hostname.toLowerCase() === "youtu.be") videoId = parts[0];
  else if (parsed.pathname === "/watch") videoId = parsed.searchParams.get("v");
  else if (["embed", "shorts", "live"].includes(parts[0] ?? "")) videoId = parts[1];
  if (!videoId || !YOUTUBE_VIDEO_ID.test(videoId)) throw new Error("URL YouTube non valido: usa un link a un video.");
  return { provider: "youtube", videoId, canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`, artwork: youtubeArtworkUrl(videoId) };
}

export function parseProviderUrl(provider: StreamProvider, value: string): ParsedProviderSource {
  return provider === "spotify" ? parseSpotifyUrl(value) : parseYouTubeUrl(value);
}

/** Converts only track URIs emitted by Spotify's playback_started event. */
export function spotifyTrackUrlFromUri(uri: string): string | null {
  const match = /^spotify:track:([A-Za-z0-9]{10,64})$/.exec(uri);
  return match?.[1] ? `https://open.spotify.com/track/${match[1]}` : null;
}

function optionalText(payload: UnknownRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function optionalDuration(payload: UnknownRecord): number | undefined {
  const value = payload.duration ?? payload.durationSeconds ?? payload.duration_seconds;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

export function normalizeProviderMetadata(provider: StreamProvider, source: ParsedProviderSource, payload: unknown): ProviderMetadata {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(`Risposta oEmbed ${provider === "spotify" ? "Spotify" : "YouTube"} non valida.`);
  const record = payload as UnknownRecord;
  const title = optionalText(record, "title");
  if (!title) throw new Error(`I metadati ${provider === "spotify" ? "Spotify" : "YouTube"} non contengono un titolo.`);
  const artist = optionalText(record, "authorName", "author_name", "artist");
  const remoteArtwork = optionalText(record, "thumbnailUrl", "thumbnail_url", "artwork");
  const artwork = remoteArtwork && remoteArtwork.startsWith("https://") ? remoteArtwork : source.provider === "youtube" ? source.artwork : undefined;
  const duration = optionalDuration(record);
  return {
    title,
    ...(artist ? { artist } : {}),
    ...(artwork ? { artwork } : {}),
    ...(duration ? { duration } : {})
  };
}

function oEmbedEndpoint(source: ParsedProviderSource): string {
  const target = encodeURIComponent(source.canonicalUrl);
  return source.provider === "spotify"
    ? `https://open.spotify.com/oembed?url=${target}`
    : `https://www.youtube.com/oembed?url=${target}&format=json`;
}

/** Loads only legitimate embed metadata. Desktop requests go through the native allow-listed proxy. */
export async function loadProviderMetadata(provider: StreamProvider, value: string, fetcher: typeof fetch = fetch): Promise<ProviderMetadata> {
  const source = parseProviderUrl(provider, value);
  let payload: unknown;
  if (isTauri()) {
    payload = await invoke<unknown>("streamer_oembed", { url: source.canonicalUrl });
  } else {
    let response: Response;
    try { response = await fetcher(oEmbedEndpoint(source), { headers: { Accept: "application/json" } }); }
    catch { throw new Error(`Metadati ${provider === "spotify" ? "Spotify" : "YouTube"} non raggiungibili nel browser. Il player resta utilizzabile.`); }
    if (!response.ok) throw new Error(`Metadati ${provider === "spotify" ? "Spotify" : "YouTube"} non disponibili nel browser (HTTP ${response.status}). Il player resta utilizzabile.`);
    payload = await response.json();
  }
  return normalizeProviderMetadata(provider, source, payload);
}

export const fetchProviderMetadata = loadProviderMetadata;
