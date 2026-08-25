import { describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));
import { getSongPlayerCapabilities } from "./song-player-native";

describe("Song Player browser capabilities", () => {
  it("keeps real FFT analysis and automatic matching enabled", async () => { await expect(getSongPlayerCapabilities()).resolves.toMatchObject({ desktop: false, analysis: true, matching: true, download: false, nativeAnalysis: false, nativeMatching: false }); });
});
