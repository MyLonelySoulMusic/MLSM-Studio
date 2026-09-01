import { afterEach, describe, expect, it, vi } from "vitest";
import { requestMediaPlayback } from "./media-playback";

describe("requestMediaPlayback", () => {
  afterEach(() => vi.useRealTimers());

  function mediaWithPlay(implementation: () => Promise<void>) {
    const element = document.createElement("audio");
    const play = vi.spyOn(element, "play").mockImplementation(implementation);
    return { element, play };
  }

  it("ripete una richiesta Play interrotta da pause", async () => {
    const { element, play } = mediaWithPlay(vi.fn().mockRejectedValueOnce(new DOMException("The play() request was interrupted by a call to pause().", "AbortError")).mockResolvedValueOnce(undefined));
    await expect(requestMediaPlayback(element, () => true)).resolves.toBe(true);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("recupera anche più interruzioni consecutive della WebView", async () => {
    const interrupted = new DOMException("The play() request was interrupted by a call to pause().", "AbortError");
    const { element, play } = mediaWithPlay(vi.fn().mockRejectedValueOnce(interrupted).mockRejectedValueOnce(interrupted).mockRejectedValueOnce(interrupted).mockResolvedValueOnce(undefined));
    await expect(requestMediaPlayback(element, () => true)).resolves.toBe(true);
    expect(play).toHaveBeenCalledTimes(4);
  });

  it("non riavvia il media se l'intento Play è stato superato", async () => {
    let current = true;
    const { element, play } = mediaWithPlay(vi.fn().mockImplementationOnce(() => { current = false; return Promise.reject(new DOMException("interrupted", "AbortError")); }));
    await expect(requestMediaPlayback(element, () => current)).resolves.toBe(false);
    expect(play).toHaveBeenCalledOnce();
  });

  it("accetta l'evento playing quando WKWebView lascia pendente la Promise", async () => {
    const { element, play } = mediaWithPlay(() => new Promise<void>(() => undefined));
    const requested = requestMediaPlayback(element, () => true);
    element.dispatchEvent(new Event("playing"));
    await expect(requested).resolves.toBe(true);
    expect(play).toHaveBeenCalledOnce();
  });

  it("non resta appeso per sempre se non arrivano né Promise né eventi media", async () => {
    vi.useFakeTimers();
    const { element, play } = mediaWithPlay(() => new Promise<void>(() => undefined));
    const pause = vi.spyOn(element, "pause").mockImplementation(() => undefined);
    const requested = requestMediaPlayback(element, () => true);
    const assertion = expect(requested).rejects.toThrow("tempo previsto");
    await vi.runAllTimersAsync();
    await assertion;
    expect(play).toHaveBeenCalledTimes(4);
    expect(pause).toHaveBeenCalledOnce();
  });
});
