import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingInfo, SavedRecording } from "./streamer-recording";

const mocks = vi.hoisted(() => ({ arm: vi.fn(), list: vi.fn(async () => [] as SavedRecording[]), download: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) }));
vi.mock("./streamer-recording", () => ({ StreamerRecording: { arm: mocks.arm }, listRecordings: mocks.list, downloadRecording: mocks.download, deleteRecording: mocks.remove }));
import { useStreamerRecording } from "./use-streamer-recording";
const take: SavedRecording = { id: "take-1", created: "2026-10-03T10:00:00.000Z", mimeType: "video/webm", width: 1920, height: 1080, fps: 60, videoBitrate: 24e6, audioBitrate: 512000, sampleRate: 48000, seconds: 30, videoBytes: 2000000, audioBytes: 480000, complete: true };
let updated: (info: RecordingInfo) => void, complete: (item: SavedRecording | null) => void;
let session: { start: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; finish: ReturnType<typeof vi.fn> };
beforeEach(() => {
  mocks.arm.mockReset(); mocks.list.mockReset().mockResolvedValue([]); mocks.download.mockReset().mockResolvedValue(undefined); mocks.remove.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "storage", { configurable: true, value: { getDirectory: async () => undefined } });
  session = { start: vi.fn(async () => updated({ phase: "recording", seconds: 0 })), pause: vi.fn(() => updated({ phase: "paused", seconds: 1 })), finish: vi.fn(async () => { updated({ phase: "idle", seconds: 30 }); complete(take); return take; }) };
  mocks.arm.mockImplementation(async (update: typeof updated, completed: typeof complete) => { updated = update; complete = completed; update({ phase: "armed", seconds: 0 }); return session; });
});
afterEach(cleanup);
describe("recording hook", () => {
  it("stays off until armed and publishes save buttons only after finalization", async () => {
    const { result } = renderHook(useStreamerRecording);
    expect(result.current.info.phase).toBe("idle"); expect(mocks.arm).not.toHaveBeenCalled();
    await act(async () => { await result.current.arm(); }); expect(result.current.info.phase).toBe("armed"); expect(session.start).not.toHaveBeenCalled();
    act(() => result.current.start({ subscribePcm: () => () => undefined })); expect(result.current.info.phase).toBe("recording");
    act(() => result.current.pause()); expect(result.current.info.phase).toBe("paused");
    await act(async () => { await result.current.stop(); }); expect(result.current.info.phase).toBe("idle"); expect(result.current.takes).toEqual([take]);
    await act(async () => { await result.current.save(take, "audio"); }); expect(mocks.download).toHaveBeenCalledWith(take, "audio");
  });
  it("cancels pending permission/preparation safely, even if it resolves after Stop", async () => {
    let prepared!: (value: typeof session) => void;
    mocks.arm.mockImplementation(() => new Promise(resolve => { prepared = resolve; }));
    const { result } = renderHook(useStreamerRecording);
    let arming!: Promise<void>; act(() => { arming = result.current.arm(); }); expect(result.current.info.phase).toBe("arming");
    await act(async () => { await result.current.stop(); }); expect(result.current.info.phase).toBe("idle");
    session.finish.mockResolvedValue(null);
    await act(async () => { prepared(session); await arming; }); expect(session.finish).toHaveBeenCalledOnce(); expect(result.current.takes).toEqual([]);
  });
  it("finalizes on area exit, rather than discarding the recording", async () => {
    const { result, unmount } = renderHook(useStreamerRecording); await act(async () => { await result.current.arm(); });
    unmount(); expect(session.finish).toHaveBeenCalledOnce();
  });
  it("does not overwrite a new saved take when the earlier library read resolves later", async () => {
    let loaded!: (items: SavedRecording[]) => void; mocks.list.mockImplementation(() => new Promise(resolve => { loaded = resolve; }));
    const { result } = renderHook(useStreamerRecording); await act(async () => { await result.current.arm(); await result.current.stop(); });
    await act(async () => { loaded([{ ...take, id: "older" }]); }); expect(result.current.takes.map(item => item.id)).toEqual(["take-1", "older"]);
    await act(async () => { await result.current.remove(take); }); expect(result.current.takes.map(item => item.id)).toEqual(["older"]);
  });
});
