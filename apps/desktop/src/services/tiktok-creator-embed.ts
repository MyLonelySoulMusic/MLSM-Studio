import { artistMedia } from "./artist-socials";

const SESSION_CACHE_KEY = "mlsm-studio.tiktok-creator-oembed.v1";
export const TIKTOK_EMBED_REFRESH_MS = 60 * 60 * 1_000;

export interface TikTokCreatorEmbedProfile {
  profileUrl: string;
  uniqueId: string;
  authorName: string;
  title: string;
}

interface TikTokOEmbedResponse {
  type?: unknown;
  title?: unknown;
  author_url?: unknown;
  author_name?: unknown;
  provider_name?: unknown;
  embed_product_id?: unknown;
  embed_type?: unknown;
}

interface CachedTikTokCreatorEmbedProfile extends TikTokCreatorEmbedProfile {
  cachedAt: number;
}

export const defaultTikTokCreatorProfile: TikTokCreatorEmbedProfile = {
  profileUrl: artistMedia.tiktokProfile,
  uniqueId: "mylonelysoulmusic",
  authorName: "My Lonely Soul Music",
  title: "My Lonely Soul Music's Creator Profile"
};

function readCachedProfile(now: number): TikTokCreatorEmbedProfile | null {
  try {
    const cached = JSON.parse(window.sessionStorage.getItem(SESSION_CACHE_KEY) ?? "null") as Partial<CachedTikTokCreatorEmbedProfile> | null;
    return cached && cached.profileUrl === defaultTikTokCreatorProfile.profileUrl && typeof cached.uniqueId === "string" && typeof cached.authorName === "string" && typeof cached.title === "string"
      && typeof cached.cachedAt === "number" && now - cached.cachedAt < TIKTOK_EMBED_REFRESH_MS
      ? cached as TikTokCreatorEmbedProfile
      : null;
  } catch {
    return null;
  }
}

/** Resolves the official Creator Profile oEmbed and refreshes its session cache hourly. */
export async function loadTikTokCreatorProfile(fetcher: typeof fetch = fetch, now = Date.now()): Promise<TikTokCreatorEmbedProfile> {
  const cached = readCachedProfile(now);
  if (cached) return cached;
  const response = await fetcher(artistMedia.tiktokOEmbed, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`TikTok oEmbed non disponibile (HTTP ${response.status}).`);
  const payload = await response.json() as TikTokOEmbedResponse;
  if (payload.provider_name !== "TikTok" || payload.type !== "rich" || payload.embed_type !== "profile") throw new Error("Risposta TikTok oEmbed non valida.");
  const profileUrl = typeof payload.author_url === "string" && payload.author_url.startsWith("https://www.tiktok.com/@") ? payload.author_url : defaultTikTokCreatorProfile.profileUrl;
  const profile: TikTokCreatorEmbedProfile = {
    profileUrl,
    uniqueId: typeof payload.embed_product_id === "string" && payload.embed_product_id ? payload.embed_product_id : defaultTikTokCreatorProfile.uniqueId,
    authorName: typeof payload.author_name === "string" && payload.author_name ? payload.author_name : defaultTikTokCreatorProfile.authorName,
    title: typeof payload.title === "string" && payload.title ? payload.title : defaultTikTokCreatorProfile.title
  };
  try { window.sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ ...profile, cachedAt: now })); } catch { /* La cache è un’ottimizzazione, non un requisito. */ }
  return profile;
}
