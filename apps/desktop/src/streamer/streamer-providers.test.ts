import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => tauri);

import { loadProviderMetadata, normalizeProviderMetadata, parseSpotifyUrl, parseYouTubeUrl, spotifyTrackUrlFromUri } from "./streamer-providers";

const spotifyUrl = "https://open.spotify.com/track/1234567890ABCDEFGHIJKL?si=ignored";
const youtubeUrl = "https://music.youtube.com/watch?v=dQw4w9WgXcQ&feature=share";

describe("streamer provider URLs and oEmbed metadata", () => {
  beforeEach(() => {
    tauri.invoke.mockReset();
    tauri.isTauri.mockReset().mockReturnValue(false);
  });

  it("canonicalizza solo risorse Spotify ufficiali supportate", () => {
    expect(parseSpotifyUrl("https://open.spotify.com/intl-it/album/1234567890ABCDEFGHIJKL?si=x")).toEqual({
      provider: "spotify", kind: "album", id: "1234567890ABCDEFGHIJKL",
      uri: "spotify:album:1234567890ABCDEFGHIJKL", canonicalUrl: "https://open.spotify.com/album/1234567890ABCDEFGHIJKL"
    });
    expect(() => parseSpotifyUrl("https://open.spotify.com.evil.example/track/1234567890ABCDEFGHIJKL")).toThrow("URL Spotify non valido");
    expect(() => parseSpotifyUrl("http://open.spotify.com/track/1234567890ABCDEFGHIJKL")).toThrow("HTTPS");
    expect(() => parseSpotifyUrl("https://open.spotify.com/artist/1234567890ABCDEFGHIJKL")).toThrow("traccia, album o playlist");
    expect(spotifyTrackUrlFromUri("spotify:track:1234567890ABCDEFGHIJKL")).toBe("https://open.spotify.com/track/1234567890ABCDEFGHIJKL");
    expect(spotifyTrackUrlFromUri("spotify:episode:1234567890ABCDEFGHIJKL")).toBeNull();
  });

  it("accetta video YouTube e YouTube Music senza interpolare host non attendibili", () => {
    expect(parseYouTubeUrl(youtubeUrl)).toEqual({
      provider: "youtube", videoId: "dQw4w9WgXcQ", canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      artwork: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
    });
    expect(parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ?t=2").videoId).toBe("dQw4w9WgXcQ");
    expect(() => parseYouTubeUrl("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toThrow("URL YouTube non valido");
    expect(() => parseYouTubeUrl("https://www.youtube.com/playlist?list=abc")).toThrow("link a un video");
  });

  it("normalizza camelCase nativo e snake_case oEmbed, con thumbnail YouTube ufficiale di riserva", () => {
    const spotify = parseSpotifyUrl(spotifyUrl);
    expect(normalizeProviderMetadata("spotify", spotify, { title: "Track", authorName: "Artist", thumbnailUrl: "https://i.scdn.co/image/cover", durationSeconds: 12 })).toEqual({
      title: "Track", artist: "Artist", artwork: "https://i.scdn.co/image/cover", duration: 12
    });
    const youtube = parseYouTubeUrl(youtubeUrl);
    expect(normalizeProviderMetadata("youtube", youtube, { title: "Video", author_name: "Channel", thumbnail_url: "http://unsafe.example/image.jpg" })).toEqual({
      title: "Video", artist: "Channel", artwork: youtube.artwork
    });
  });

  it("usa streamer_oembed nel desktop con URL canonico", async () => {
    tauri.isTauri.mockReturnValue(true);
    tauri.invoke.mockResolvedValue({ title: "Track", authorName: "Artist", thumbnailUrl: "https://i.scdn.co/cover.jpg" });
    await expect(loadProviderMetadata("spotify", spotifyUrl)).resolves.toMatchObject({ title: "Track", artist: "Artist" });
    expect(tauri.invoke).toHaveBeenCalledWith("streamer_oembed", { url: "https://open.spotify.com/track/1234567890ABCDEFGHIJKL" });
  });

  it("usa l'oEmbed ufficiale nel browser e rende espliciti i fallimenti di rete", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ title: "Video", author_name: "Channel" }) });
    await expect(loadProviderMetadata("youtube", youtubeUrl, fetcher as unknown as typeof fetch)).resolves.toEqual({
      title: "Video", artist: "Channel", artwork: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
    });
    expect(fetcher.mock.calls[0]?.[0]).toContain("https://www.youtube.com/oembed?url=");
    const offline = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(loadProviderMetadata("youtube", youtubeUrl, offline as unknown as typeof fetch)).rejects.toThrow("player resta utilizzabile");
  });
});
