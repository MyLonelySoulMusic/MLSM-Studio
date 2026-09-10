import { describe, expect, it } from "vitest";
import { centerEmbeddedImages, parseArticleDocument, parseLibraryDocument, recognizeMedia, renderEmbedSection, selectLibraryMedia, weightedSample } from "./media.mjs";

describe("media recognition", () => {
  it("recognizes YouTube videos and playlists", () => {
    expect(recognizeMedia("https://youtu.be/M7lc1UVf-VE")).toMatchObject({ provider: "youtube", kind: "track", id: "M7lc1UVf-VE" });
    expect(recognizeMedia("https://www.youtube.com/watch?v=M7lc1UVf-VE&list=PLC77007E23FF423C6")).toMatchObject({ provider: "youtube", kind: "playlist", id: "PLC77007E23FF423C6" });
  });

  it("recognizes Spotify tracks and playlists including localized URLs", () => {
    expect(recognizeMedia("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT")).toMatchObject({ provider: "spotify", kind: "track" });
    expect(recognizeMedia("https://open.spotify.com/intl-it/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x")).toMatchObject({ provider: "spotify", kind: "playlist" });
  });

  it("validates article documents and the three-embed limit", () => {
    expect(parseArticleDocument({ intervalMinutes: 15, postsPerRun: 3, articles: [{ title: "Post", content: "<p>Body</p>", embeds: ["https://youtu.be/M7lc1UVf-VE"] }] })).toMatchObject({ intervalMinutes: 15, postsPerRun: 3, articles: [{ title: "Post" }] });
    expect(parseArticleDocument({ articles: [{ title: "Post", content: "Body" }] })).toMatchObject({ intervalMinutes: undefined, postsPerRun: undefined });
    expect(() => parseArticleDocument([{ title: "", content: "Body" }])).toThrow(/titolo mancante/);
    expect(() => parseArticleDocument([{ title: "Post", content: "Body", embeds: Array(4).fill("https://youtu.be/M7lc1UVf-VE") }])).toThrow(/massimo 3/);
  });

  it("renders professional responsive embeds after the article", () => {
    const track = recognizeMedia("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT");
    const video = recognizeMedia("https://youtu.be/M7lc1UVf-VE");
    const html = renderEmbedSection([track, video], "Blog Demo");
    expect(html).toContain("scroll-snap-type:x mandatory");
    expect(html).toContain("BLOG DEMO SELECTION");
    expect(html).not.toContain("MLSM Selection");
    expect(html).toContain("open.spotify.com/embed/track");
    expect(html).toContain("youtube-nocookie.com/embed");
    expect(html).toContain('loading="lazy"');
  });

  it("centers article images while preserving existing inline styles", () => {
    const html = centerEmbeddedImages('<p><img src="one.jpg"><img src="two.jpg" style="width:320px"></p>');
    expect(html.match(/margin-left:auto/g)).toHaveLength(2);
    expect(html).toContain('style="display:block;margin-left:auto;margin-right:auto;max-width:100%;height:auto;"');
    expect(html).toContain('height:auto;width:320px');
  });

  it("uses priorities as weighted tickets without duplicates", () => {
    const low = { id: "low", priority: 1 };
    const high = { id: "high", priority: 100 };
    expect(weightedSample([low, high], 1, () => 0.5)).toEqual([high]);
    expect(weightedSample([low, high], 2, () => 0.5)).toHaveLength(2);
  });

  it("publishes one playlist by itself after the configured number of tracks", () => {
    const track = { ...recognizeMedia("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"), priority: 50, createdAt: "now" };
    const secondTrack = { ...recognizeMedia("https://youtu.be/M7lc1UVf-VE"), priority: 50, createdAt: "now" };
    const playlist = { ...recognizeMedia("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"), priority: 50, createdAt: "now" };
    const tracks = selectLibraryMedia([track, secondTrack, playlist], { tracksPerPost: 2, playlistEveryTracks: 4, tracksSincePlaylist: 0 }, () => 0);
    expect(tracks.media).toHaveLength(2);
    expect(tracks.media.every((item) => item.kind === "track")).toBe(true);
    const playlistTurn = selectLibraryMedia([track, secondTrack, playlist], { tracksPerPost: 2, playlistEveryTracks: 4, tracksSincePlaylist: 4 }, () => 0);
    expect(playlistTurn.media).toEqual([playlist]);
    expect(playlistTurn.tracksSincePlaylist).toBe(0);
    const html = renderEmbedSection([track, playlist, secondTrack]);
    expect(html).toContain("embed/playlist");
    expect(html).not.toContain("youtube-nocookie.com/embed/M7lc1UVf-VE");
  });

  it("imports library backups and removes canonical duplicates", () => {
    const parsed = parseLibraryDocument({
      settings: { tracksPerPost: 3, playlistEveryTracks: 12 },
      items: [
        { url: "https://youtu.be/M7lc1UVf-VE", priority: 80 },
        { url: "https://www.youtube.com/watch?v=M7lc1UVf-VE", priority: 20 },
        { url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", priority: 60 },
      ],
    });
    expect(parsed.items).toHaveLength(2);
    expect(parsed.duplicateCount).toBe(1);
    expect(parsed.items[0]?.priority).toBe(80);
    expect(parsed.settings).toEqual({ tracksPerPost: 3, playlistEveryTracks: 12 });
  });
});
