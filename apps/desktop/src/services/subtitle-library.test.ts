import { describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";
import { createSavedSubtitleTrack, exportSubtitleLibrary, importSubtitleLibrary, instantiateSubtitleTrack, loadSubtitleLibrary, persistSubtitleLibrary } from "./subtitle-library";

describe("subtitle reusable library", () => {
  it("salva e ricarica una traccia con stile e cue", () => {
    const project = createProject(); project.subtitles.cues = [{ id: "a", startSeconds: 1, endSeconds: 3, text: "Hello", confidence: 1, verified: true, manual: true }];
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("track") });
    const track = createSavedSubtitleTrack("Demo", project.subtitles, 10); let serialized = "";
    persistSubtitleLibrary([track], { setItem: (_key, value) => { serialized = value; } });
    const loaded = loadSubtitleLibrary({ getItem: () => serialized });
    expect(loaded[0]).toMatchObject({ name: "Demo", sourceDuration: 10, style: { animation: "ledFall", fontFamily: "Orbitron" } });
    expect(loaded[0]?.cues[0]?.text).toBe("Hello");
    vi.unstubAllGlobals();
  });

  it("adatta i tempi o inserisce la traccia al playhead", () => {
    const track = { id: "track", name: "Demo", createdAt: new Date(0).toISOString(), sourceDuration: 10, style: { animation: "slideUp" as const, fontFamily: "Orbitron", fontSize: 64, color: "#ffffff", glowColor: "#00ffff", fallSpeed: 1 }, cues: [{ id: "a", startSeconds: 2, endSeconds: 4, text: "Test", confidence: 1, verified: true, manual: true }] };
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("cue") });
    expect(instantiateSubtitleTrack(track, 20, "stretch")[0]).toMatchObject({ startSeconds: 4, endSeconds: 8 });
    expect(instantiateSubtitleTrack(track, 20, "insert", 7)[0]).toMatchObject({ startSeconds: 7, endSeconds: 9 });
    vi.unstubAllGlobals();
  });

  it("esporta e importa il formato portabile", () => {
    const project = createProject(); project.subtitles.cues = [{ id: "a", startSeconds: 0, endSeconds: 1, text: "Portable", confidence: 1, verified: false, manual: true }];
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("id") });
    const imported = importSubtitleLibrary(exportSubtitleLibrary([createSavedSubtitleTrack("Portable", project.subtitles, 2)]));
    expect(imported).toHaveLength(1); expect(imported[0]?.cues[0]?.text).toBe("Portable");
    vi.unstubAllGlobals();
  });
});
