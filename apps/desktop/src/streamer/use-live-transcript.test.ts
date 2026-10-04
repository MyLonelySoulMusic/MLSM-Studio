import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamerAudioRuntime } from "./streamer-audio";
const instances = vi.hoisted(() => [] as Array<{ dispose: ReturnType<typeof vi.fn>; setActive: ReturnType<typeof vi.fn>; push: ReturnType<typeof vi.fn> }>);
vi.mock("./live-transcript", async importOriginal => ({
  ...await importOriginal<typeof import("./live-transcript")>(),
  LiveTranscriptSession: class {
    dispose = vi.fn(); setActive = vi.fn(); push = vi.fn();
    constructor() { instances.push(this); }
  },
}));
import { useLiveTranscript } from "./use-live-transcript";
describe("area-owned live transcript", () => {
  beforeEach(() => { vi.useFakeTimers(); instances.length = 0; });
  afterEach(() => { vi.useRealTimers(); });
  it("releases resources on long pause and resumes without an expired session", () => {
    const unsubscribe = vi.fn();
    const runtime = { audio: document.createElement("audio"), subscribePcm: vi.fn(() => unsubscribe) } as unknown as StreamerAudioRuntime;
    const { rerender, unmount } = renderHook(({ active }) => useLiveTranscript(runtime, "track", active, true, "auto"), { initialProps: { active: true } });
    expect(instances).toHaveLength(1);
    rerender({ active: true }); expect(instances).toHaveLength(1);
    rerender({ active: false }); act(() => vi.advanceTimersByTime(59000)); expect(instances[0]!.dispose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000)); expect(instances[0]!.dispose).toHaveBeenCalledOnce();
    rerender({ active: true }); expect(instances).toHaveLength(2); expect(unsubscribe).toHaveBeenCalledOnce();
    unmount(); expect(instances[1]!.dispose).toHaveBeenCalledOnce(); expect(unsubscribe).toHaveBeenCalledTimes(2);
  });
  it("preserves the session during a short pause and closes it on navigation", () => {
    const runtime = { audio: document.createElement("audio"), subscribePcm: () => vi.fn() } as unknown as StreamerAudioRuntime;
    const { rerender, unmount } = renderHook(({ active }) => useLiveTranscript(runtime, "track", active, true, "auto"), { initialProps: { active: true } });
    rerender({ active: false }); act(() => vi.advanceTimersByTime(30000)); rerender({ active: true });
    act(() => vi.advanceTimersByTime(60000)); expect(instances).toHaveLength(1); expect(instances[0]!.dispose).not.toHaveBeenCalled();
    unmount(); expect(instances[0]!.dispose).toHaveBeenCalledOnce();
  });
});
