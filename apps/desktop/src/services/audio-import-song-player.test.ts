import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));

import { importFullTrackLocal } from "./audio-import";

describe("Song Player full-track import ownership", () => {
  beforeEach(() => { mocks.invoke.mockReset(); mocks.open.mockReset(); });

  it("checks ownership after the native capability probe and before opening the picker", async () => {
    let resolveStatus!: (value: { ffmpeg: boolean; ffprobe: boolean }) => void;
    let current = true;
    mocks.invoke.mockReturnValueOnce(new Promise((resolve) => { resolveStatus = resolve; }));
    const importing = importFullTrackLocal({ isCurrent: () => current });
    current = false; resolveStatus({ ffmpeg: true, ffprobe: true });
    await expect(importing).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("checks ownership after the picker and never starts a stale decode", async () => {
    let resolvePicker!: (value: string) => void;
    let current = true;
    mocks.invoke.mockResolvedValueOnce({ ffmpeg: true, ffprobe: true });
    mocks.open.mockReturnValueOnce(new Promise((resolve) => { resolvePicker = resolve; }));
    const importing = importFullTrackLocal({ isCurrent: () => current });
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalled());
    current = false; resolvePicker("/music/full.wav");
    await expect(importing).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("revokes a decoded blob if ownership changes during the decode", async () => {
    let resolveMetadata!: (value: Record<string, unknown>) => void;
    let current = true;
    const revoke = vi.fn(); const create = vi.fn(() => "blob:decoded-full-track");
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
    mocks.open.mockResolvedValueOnce("/music/full.wav");
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "detect_audio_tools") return Promise.resolve({ ffmpeg: true, ffprobe: true });
      if (command === "probe_audio") return new Promise((resolve) => { resolveMetadata = resolve; });
      if (command === "generate_waveform") return Promise.resolve({ sampleRate: 44_100, peaks: [0] });
      if (command === "read_audio_data") return Promise.resolve(new ArrayBuffer(2));
      return Promise.reject(new Error(`unexpected ${command}`));
    });
    const importing = importFullTrackLocal({ isCurrent: () => current });
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("probe_audio", { path: "/music/full.wav" }));
    current = false;
    resolveMetadata({ path: "/music/full.wav", fileName: "full.wav", hash: "a".repeat(64), durationSeconds: 30, sampleRate: 44_100, channels: 2, codec: "wav", fileSize: 2 });
    await expect(importing).rejects.toMatchObject({ name: "AbortError" });
    expect(revoke).toHaveBeenCalledWith("blob:decoded-full-track");
  });
});
