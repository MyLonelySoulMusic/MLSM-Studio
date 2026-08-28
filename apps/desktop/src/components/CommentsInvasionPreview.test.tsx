import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";

const renderFrame = vi.hoisted(() => vi.fn());
vi.mock("../services/comments-invasion-renderer", async () => {
  const actual = await vi.importActual<typeof import("../services/comments-invasion-renderer")>("../services/comments-invasion-renderer");
  return { ...actual, renderCommentsInvasionFrame: renderFrame };
});

import { CommentsInvasionPreview } from "./CommentsInvasionPreview";

describe("CommentsInvasionPreview", () => {
  let frames: Map<number, FrameRequestCallback>; let nextFrameId: number;

  const flushNextFrame = (time: number) => {
    const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!entry) return; frames.delete(entry[0]); entry[1](time);
  };

  beforeEach(() => {
    frames = new Map(); nextFrameId = 1; renderFrame.mockClear();
    vi.stubGlobal("ResizeObserver", class { observe() { /* noop */ } disconnect() { /* noop */ } });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = nextFrameId++; frames.set(id, callback); return id; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, toJSON: () => ({}) });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("ridisegna senza interruzioni durante play usando il frame corrente del video", () => {
    const settings = { ...createProject().animation.commentsInvasion, videoUrl: "blob:comments-video", videoName: "comments.mp4" };
    const { container } = render(<CommentsInvasionPreview settings={settings} timeSeconds={1} durationSeconds={12} playing aspectRatio="9:16" customWidth={540} customHeight={960} projectSeed={7} onPlayPause={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()} />);
    const video = container.querySelector("video")!;
    Object.defineProperties(video, { readyState: { configurable: true, value: 2 }, currentTime: { configurable: true, writable: true, value: 2.25 } });
    fireEvent.loadedData(video);
    const before = renderFrame.mock.calls.length;
    act(() => flushNextFrame(16));
    const afterFirstFrame = renderFrame.mock.calls.length;
    act(() => flushNextFrame(32));
    expect(afterFirstFrame).toBeGreaterThan(before);
    expect(renderFrame.mock.calls.length).toBeGreaterThan(afterFirstFrame);
    expect(renderFrame).toHaveBeenLastCalledWith(expect.any(HTMLCanvasElement), expect.objectContaining({ timeSeconds: 2.25, videoFrame: video }));
  });
});
