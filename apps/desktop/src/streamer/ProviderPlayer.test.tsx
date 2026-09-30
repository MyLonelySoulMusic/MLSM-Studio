import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const metadata = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./streamer-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./streamer-providers")>();
  return { ...actual, loadProviderMetadata: metadata.load };
});

import { ProviderPlayer, type PlayerHandle, type SpotifyEmbedController, type SpotifyIFrameAPI, type SpotifyPlaybackData, type YouTubeIFrameAPI, type YouTubePlayer, type YouTubePlayerOptions } from "./ProviderPlayer";

const youtubeUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe("ProviderPlayer", () => {
  beforeEach(() => {
    metadata.load.mockReset().mockResolvedValue({ title: "Title", artist: "Artist" });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("segue il lifecycle Spotify, non parte automaticamente e distrugge il controller al cambio traccia", async () => {
    const listeners = new Map<string, (event: { data: SpotifyPlaybackData }) => void>();
    const controller: SpotifyEmbedController = {
      addListener: vi.fn((event, listener) => listeners.set(event, listener)),
      removeListener: vi.fn((event) => listeners.delete(event)),
      play: vi.fn(), pause: vi.fn(), seek: vi.fn(), destroy: vi.fn()
    };
    const createController = vi.fn((_element, _options, callback: (value: SpotifyEmbedController) => void) => callback(controller));
    const api: SpotifyIFrameAPI = { createController };
    const onState = vi.fn(); const onProgress = vi.fn(); const onMetadata = vi.fn(); const onError = vi.fn();
    const ref = createRef<PlayerHandle>();
    const view = render(<ProviderPlayer ref={ref} track={{ id: "one", provider: "spotify", url: "https://open.spotify.com/album/ABCDEFGHIJKL1234567890" }} autoAdvance={false} onState={onState} onProgress={onProgress} onMetadata={onMetadata} onError={onError} />);

    expect(onState).toHaveBeenCalledWith("LOADING");
    expect(controller.play).not.toHaveBeenCalled();
    await act(async () => window.onSpotifyIframeApiReady?.(api));
    await flush();
    expect(createController).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ uri: "spotify:album:ABCDEFGHIJKL1234567890" }), expect.any(Function));
    act(() => listeners.get("ready")?.({ data: {} }));
    expect(onState).toHaveBeenLastCalledWith("READY");
    act(() => listeners.get("playback_update")?.({ data: { isPaused: false, isBuffering: false, position: 2_500, duration: 10_000 } }));
    expect(onState).toHaveBeenLastCalledWith("PLAYING");
    expect(onProgress).toHaveBeenLastCalledWith(2.5, 10);
    expect(onMetadata).toHaveBeenCalledWith({ duration: 10 });

    metadata.load.mockResolvedValueOnce({ title: "First song" });
    act(() => listeners.get("playback_started")?.({ data: { playingURI: "spotify:track:1234567890ABCDEFGHIJKL" } }));
    await flush();
    expect(controller.pause).not.toHaveBeenCalled();
    expect(metadata.load).toHaveBeenLastCalledWith("spotify", "https://open.spotify.com/track/1234567890ABCDEFGHIJKL");
    expect(onMetadata).toHaveBeenCalledWith({ title: "First song" });

    metadata.load.mockResolvedValueOnce({ title: "Second song" });
    act(() => listeners.get("playback_started")?.({ data: { playingURI: "spotify:track:ABCDEFGHIJKL1234567890" } }));
    await flush();
    expect(controller.pause).toHaveBeenCalledOnce();
    expect(onState).toHaveBeenLastCalledWith("PAUSED");
    expect(onProgress).toHaveBeenCalledWith(0, 0);
    expect(onMetadata).toHaveBeenCalledWith({ title: "Second song" });

    act(() => { ref.current?.play(); ref.current?.pause(); ref.current?.seek(3.25); ref.current?.setVolume(.4); });
    expect(controller.play).toHaveBeenCalledOnce();
    expect(controller.pause).toHaveBeenCalledTimes(2);
    expect(controller.seek).toHaveBeenCalledWith(3.25);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("non espone un controllo volume"));

    view.rerender(<ProviderPlayer ref={ref} track={{ id: "two", provider: "spotify", url: "https://open.spotify.com/album/ABCDEFGHIJKL1234567890" }} onState={onState} onProgress={onProgress} onMetadata={onMetadata} onError={onError} />);
    await flush();
    expect(controller.removeListener).toHaveBeenCalledTimes(3);
    expect(controller.destroy).toHaveBeenCalled();
    expect(controller.play).toHaveBeenCalledTimes(1);
  });

  it("mappa gli stati e i comandi YouTube, usa origin e ferma timer/player allo smontaggio", async () => {
    vi.useFakeTimers();
    let options: YouTubePlayerOptions | undefined;
    const player: YouTubePlayer = {
      playVideo: vi.fn(), pauseVideo: vi.fn(), stopVideo: vi.fn(), seekTo: vi.fn(), setVolume: vi.fn(),
      getCurrentTime: vi.fn(() => 4), getDuration: vi.fn(() => 20), destroy: vi.fn()
    };
    const Player = vi.fn(function (_element: HTMLElement, received: YouTubePlayerOptions) { options = received; return player; });
    const api = { Player: Player as unknown as YouTubeIFrameAPI["Player"] };
    const onState = vi.fn(); const onProgress = vi.fn(); const onMetadata = vi.fn(); const onError = vi.fn();
    const ref = createRef<PlayerHandle>();
    const view = render(<ProviderPlayer ref={ref} track={{ id: "yt", provider: "youtube", url: youtubeUrl }} onState={onState} onProgress={onProgress} onMetadata={onMetadata} onError={onError} />);

    act(() => { window.YT = api; window.onYouTubeIframeAPIReady?.(); });
    await flush();
    expect(Player).toHaveBeenCalledOnce();
    expect(options?.playerVars).toMatchObject({ autoplay: 0, enablejsapi: 1, origin: window.location.origin });
    expect(options?.host).toBe("https://www.youtube-nocookie.com");
    expect(player.playVideo).not.toHaveBeenCalled();
    act(() => options?.events.onReady({ target: player }));
    expect(onState).toHaveBeenLastCalledWith("READY");
    expect(onMetadata).toHaveBeenCalledWith({ duration: 20 });
    act(() => options?.events.onStateChange({ target: player, data: 1 }));
    expect(onState).toHaveBeenLastCalledWith("PLAYING");
    act(() => vi.advanceTimersByTime(500));
    expect(onProgress).toHaveBeenCalledWith(4, 20);
    act(() => options?.events.onStateChange({ target: player, data: 3 }));
    expect(onState).toHaveBeenLastCalledWith("BUFFERING");
    act(() => options?.events.onStateChange({ target: player, data: 0 }));
    expect(onState).toHaveBeenLastCalledWith("ENDED");

    act(() => { ref.current?.play(); ref.current?.pause(); ref.current?.seek(7); ref.current?.setVolume(.42); ref.current?.stop(); });
    expect(player.playVideo).toHaveBeenCalledOnce();
    expect(player.pauseVideo).toHaveBeenCalledOnce();
    expect(player.seekTo).toHaveBeenCalledWith(7, true);
    expect(player.setVolume).toHaveBeenCalledWith(42);
    expect(player.stopVideo).toHaveBeenCalledOnce();
    act(() => options?.events.onStateChange({ target: player, data: 1 }));
    const progressCallsBeforeUnmount = onProgress.mock.calls.length;
    view.unmount();
    expect(player.destroy).toHaveBeenCalledOnce();
    act(() => {
      vi.advanceTimersByTime(1_000);
      options?.events.onError({ target: player, data: 100 });
    });
    expect(onProgress).toHaveBeenCalledTimes(progressCallsBeforeUnmount);
    expect(onError).not.toHaveBeenCalled();
  });

  it("rifiuta URL non ufficiali prima di creare iframe o script", () => {
    const onState = vi.fn(); const onError = vi.fn();
    render(<ProviderPlayer track={{ id: "bad", provider: "youtube", url: "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ" }} onState={onState} onProgress={vi.fn()} onMetadata={vi.fn()} onError={onError} />);
    expect(onState).toHaveBeenLastCalledWith("ERROR");
    expect(onError).toHaveBeenCalledWith("URL YouTube non valido.");
  });
});
