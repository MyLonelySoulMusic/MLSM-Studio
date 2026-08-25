import { beforeEach, describe, expect, it, vi } from "vitest";
const { start, getJob, cancel } = vi.hoisted(() => ({ start: vi.fn(), getJob: vi.fn(), cancel: vi.fn() }));
vi.mock("../services/song-player-native", () => ({
  startSongPlayerJob: start, getSongPlayerJob: getJob, cancelSongPlayerJob: cancel, subscribeSongPlayerJob: vi.fn(() => vi.fn()),
  isSongPlayerJobTerminal: (status: string) => ["completed", "succeeded", "failed", "cancelled"].includes(status)
}));
import { useSongPlayerJobStore } from "./song-player-job-store";

describe("song player job store", () => {
  beforeEach(() => { useSongPlayerJobStore.getState().dispose(); useSongPlayerJobStore.getState().replaceProject("p1"); start.mockReset().mockResolvedValue({ jobId: "job-1", kind: "match", status: "queued" }); getJob.mockReset().mockResolvedValue({ jobId: "job-1", kind: "match", status: "running" }); cancel.mockReset().mockResolvedValue(undefined); });
  it("prevents overlapping jobs and cancels polling ownership on project replacement", async () => { await useSongPlayerJobStore.getState().begin({ kind: "match", referencePath: "/full.wav", targetPath: "/fragment.wav" }, { projectId: "p1", fragmentHash: "a", fullTrackHash: "b" }); await expect(useSongPlayerJobStore.getState().begin({ kind: "analyze", inputPath: "/full.wav" }, { projectId: "p1" })).rejects.toThrow(/già in corso/); useSongPlayerJobStore.getState().replaceProject("p2"); expect(useSongPlayerJobStore.getState().jobs).toEqual({}); expect(cancel).toHaveBeenCalledWith("job-1"); });
  it("rejects owners from a stale project", async () => { await expect(useSongPlayerJobStore.getState().begin({ kind: "analyze", inputPath: "/full.wav" }, { projectId: "old" })).rejects.toThrow(/progetto è cambiato/); expect(start).not.toHaveBeenCalled(); });
  it("turns a cancellation command failure into a terminal job", async () => { await useSongPlayerJobStore.getState().begin({ kind: "match", referencePath: "/full.wav", targetPath: "/fragment.wav" }, { projectId: "p1", fragmentHash: "a", fullTrackHash: "b" }); cancel.mockRejectedValueOnce(new Error("cancel unavailable")); await expect(useSongPlayerJobStore.getState().cancelActive()).rejects.toThrow("cancel unavailable"); expect(useSongPlayerJobStore.getState().jobs["job-1"]).toMatchObject({ status: "failed", error: { code: "cancel_failed" } }); });
  it("does not let a late poll resurrect a cancelled job", async () => { let resolvePoll!: (value: unknown) => void; getJob.mockReturnValueOnce(new Promise((resolve) => { resolvePoll = resolve; })); await useSongPlayerJobStore.getState().begin({ kind: "match", referencePath: "/full.wav", targetPath: "/fragment.wav" }, { projectId: "p1", fragmentHash: "a", fullTrackHash: "b" }); await useSongPlayerJobStore.getState().cancelActive(); resolvePoll({ jobId: "job-1", kind: "match", status: "running" }); await vi.waitFor(() => expect(useSongPlayerJobStore.getState().jobs["job-1"]?.status).toBe("cancelled")); });
});
