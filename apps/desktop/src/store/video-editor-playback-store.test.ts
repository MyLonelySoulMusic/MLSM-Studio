import { afterEach, describe, expect, it, vi } from "vitest";
import { registerVideoEditorTransport, requestVideoEditorTransport, useVideoEditorPlayback } from "./video-editor-playback-store";

afterEach(() => useVideoEditorPlayback.setState({ currentTime: 0, playing: false, looping: false, zoom: 1 }));

describe("Video Editor · trasporto unico", () => {
  it("inoltra Play e Stop in modo sincrono al monitor", () => {
    const handler = vi.fn();
    const unregister = registerVideoEditorTransport(handler);
    requestVideoEditorTransport("toggle");
    requestVideoEditorTransport("stop");
    expect(handler.mock.calls).toEqual([["toggle"], ["stop"]]);
    unregister();
  });

  it("mantiene un fallback sicuro se il monitor non è ancora montato", () => {
    requestVideoEditorTransport("toggle");
    expect(useVideoEditorPlayback.getState().playing).toBe(true);
    requestVideoEditorTransport("stop");
    expect(useVideoEditorPlayback.getState()).toMatchObject({ playing: false, currentTime: 0 });
  });
});
