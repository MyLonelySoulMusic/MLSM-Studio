import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { loadProviderMetadata, parseSpotifyUrl, parseYouTubeUrl, spotifyTrackUrlFromUri, type ProviderMetadata, type StreamProvider } from "./streamer-providers";

export type PlaybackState = "IDLE" | "LOADING" | "READY" | "PLAYING" | "PAUSED" | "BUFFERING" | "ENDED" | "ERROR";

export interface ProviderPlayerTrack {
  id: string;
  provider: StreamProvider;
  url: string;
}

export interface PlayerHandle {
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
  setVolume: (value: number) => void;
}

export interface ProviderPlayerProps {
  track: ProviderPlayerTrack;
  onState: (state: PlaybackState) => void;
  onProgress: (positionSeconds: number, durationSeconds: number) => void;
  onMetadata: (metadata: Partial<ProviderMetadata>) => void;
  onError: (message: string) => void;
  autoAdvance?: boolean;
}

export interface SpotifyPlaybackData {
  playingURI?: string;
  isPaused?: boolean;
  isBuffering?: boolean;
  duration?: number;
  position?: number;
}

export interface SpotifyEmbedController {
  addListener: (event: "ready" | "playback_update" | "playback_started", listener: (event: { data: SpotifyPlaybackData }) => void) => void;
  removeListener?: (event: "ready" | "playback_update" | "playback_started", listener?: (event: { data: SpotifyPlaybackData }) => void) => void;
  play: () => void | Promise<void>;
  pause: () => void | Promise<void>;
  seek: (positionSeconds: number) => void | Promise<void>;
  destroy: () => void;
  setVolume?: (value: number) => void | Promise<void>;
}

export interface SpotifyIFrameAPI {
  createController: (
    element: HTMLElement,
    options: { uri: string; width: string; height: string },
    callback: (controller: SpotifyEmbedController) => void
  ) => void;
}

interface YouTubePlayerEvent { target: YouTubePlayer }
interface YouTubeStateEvent extends YouTubePlayerEvent { data: number }
interface YouTubeErrorEvent extends YouTubePlayerEvent { data: number }

export interface YouTubePlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volumePercent: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  destroy: () => void;
}

export interface YouTubePlayerOptions {
  videoId: string;
  width: string;
  height: string;
  host: string;
  playerVars: Record<string, string | number>;
  events: {
    onReady: (event: YouTubePlayerEvent) => void;
    onStateChange: (event: YouTubeStateEvent) => void;
    onError: (event: YouTubeErrorEvent) => void;
  };
}

export interface YouTubeIFrameAPI {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
}

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: SpotifyIFrameAPI) => void;
    onYouTubeIframeAPIReady?: () => void;
    YT?: YouTubeIFrameAPI;
  }
}

const SPOTIFY_API_URL = "https://open.spotify.com/embed/iframe-api/v1";
const YOUTUBE_API_URL = "https://www.youtube.com/iframe_api";
const API_TIMEOUT_MS = 15_000;
const YOUTUBE_PROGRESS_MS = 250;

let spotifyApiPromise: Promise<SpotifyIFrameAPI> | undefined;
let youtubeApiPromise: Promise<YouTubeIFrameAPI> | undefined;

function appendApiScript(provider: StreamProvider, source: string, reject: (reason: Error) => void): void {
  const existing = document.querySelector<HTMLScriptElement>(`script[data-streamer-provider="${provider}"]`);
  if (existing) {
    existing.addEventListener("error", () => reject(new Error(`Impossibile caricare l’API ${provider === "spotify" ? "Spotify" : "YouTube"}.`)), { once: true });
    return;
  }
  const script = document.createElement("script");
  script.src = source;
  script.async = true;
  script.referrerPolicy = "strict-origin-when-cross-origin";
  script.dataset.streamerProvider = provider;
  script.addEventListener("error", () => reject(new Error(`Impossibile caricare l’API ${provider === "spotify" ? "Spotify" : "YouTube"}.`)), { once: true });
  document.head.append(script);
}

function loadSpotifyIframeApi(): Promise<SpotifyIFrameAPI> {
  if (spotifyApiPromise) return spotifyApiPromise;
  spotifyApiPromise = new Promise<SpotifyIFrameAPI>((resolve, reject) => {
    const previous = window.onSpotifyIframeApiReady;
    const timeout = window.setTimeout(() => reject(new Error("Timeout durante il caricamento dell’API Spotify Embed.")), API_TIMEOUT_MS);
    window.onSpotifyIframeApiReady = (api) => {
      window.clearTimeout(timeout);
      try { previous?.(api); } catch { /* An external consumer must not block this player. */ }
      resolve(api);
    };
    appendApiScript("spotify", SPOTIFY_API_URL, (error) => { window.clearTimeout(timeout); reject(error); });
  });
  return spotifyApiPromise;
}

function loadYouTubeIframeApi(): Promise<YouTubeIFrameAPI> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise<YouTubeIFrameAPI>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => reject(new Error("Timeout durante il caricamento dell’API YouTube Player.")), API_TIMEOUT_MS);
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      try { previous?.(); } catch { /* An external consumer must not block this player. */ }
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("L’API YouTube Player non ha esposto il player."));
    };
    appendApiScript("youtube", YOUTUBE_API_URL, (error) => { window.clearTimeout(timeout); reject(error); });
  });
  return youtubeApiPromise;
}

type ActivePlayer = { provider: "spotify"; player: SpotifyEmbedController } | { provider: "youtube"; player: YouTubePlayer };

function safeSeconds(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function browserOrigin(): string | undefined {
  const origin = window.location.origin;
  return /^https?:\/\//.test(origin) ? origin : undefined;
}

function youtubeError(code: number): string {
  if (code === 2) return "YouTube ha rifiutato l’identificativo del video.";
  if (code === 5) return "Il video non può essere riprodotto nel player HTML5.";
  if (code === 100) return "Il video YouTube non è disponibile.";
  if (code === 101 || code === 150) return "Il proprietario del video non consente la riproduzione incorporata.";
  return `Errore del player YouTube (${code}).`;
}

export const ProviderPlayer = forwardRef<PlayerHandle, ProviderPlayerProps>(function ProviderPlayer(props, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<ActivePlayer | null>(null);
  const stateRef = useRef<PlaybackState>("IDLE");
  const callbacksRef = useRef(props);
  const [metadataStatus, setMetadataStatus] = useState<string | null>(null);
  callbacksRef.current = props;

  const emitState = useCallback((state: PlaybackState) => {
    if (stateRef.current === state) return;
    stateRef.current = state;
    callbacksRef.current.onState(state);
  }, []);
  const emitError = useCallback((message: string, fatal: boolean) => {
    if (fatal) emitState("ERROR");
    callbacksRef.current.onError(message);
  }, [emitState]);
  const command = useCallback((operation: () => void | Promise<void>) => {
    try {
      const result = operation();
      if (result && typeof result.then === "function") void result.catch((reason: unknown) => emitError(reason instanceof Error ? reason.message : "Comando del player non riuscito.", true));
    } catch (reason) { emitError(reason instanceof Error ? reason.message : "Comando del player non riuscito.", true); }
  }, [emitError]);

  useImperativeHandle(ref, () => ({
    play: () => {
      const active = playerRef.current;
      if (!active) return;
      command(() => active.provider === "spotify" ? active.player.play() : active.player.playVideo());
    },
    pause: () => {
      const active = playerRef.current;
      if (!active) return;
      command(() => active.provider === "spotify" ? active.player.pause() : active.player.pauseVideo());
    },
    stop: () => {
      const active = playerRef.current;
      if (!active) return;
      if (active.provider === "spotify") command(async () => { await active.player.pause(); await active.player.seek(0); emitState("READY"); });
      else command(() => { active.player.stopVideo(); emitState("READY"); });
    },
    seek: (seconds) => {
      const active = playerRef.current;
      if (!active) return;
      const safe = safeSeconds(seconds);
      command(() => active.provider === "spotify" ? active.player.seek(safe) : active.player.seekTo(safe, true));
    },
    setVolume: (value) => {
      const active = playerRef.current;
      if (!active) return;
      const safe = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
      if (active.provider === "youtube") active.player.setVolume(safe * 100);
      else if (active.player.setVolume) command(() => active.player.setVolume!(safe));
      else emitError("Spotify Embed non espone un controllo volume tramite la IFrame API; usa il controllo nel player.", false);
    }
  }), [command, emitError, emitState]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;
    let progressTimer: number | undefined;
    let spotifyController: SpotifyEmbedController | undefined;
    let detachSpotifyListeners: (() => void) | undefined;
    let youtubePlayer: YouTubePlayer | undefined;
    mount.replaceChildren();
    playerRef.current = null;
    stateRef.current = "IDLE";
    emitState("LOADING");
    setMetadataStatus("Caricamento metadati ufficiali…");

    const stopProgress = () => {
      if (progressTimer !== undefined) window.clearInterval(progressTimer);
      progressTimer = undefined;
    };
    const reportYouTubeProgress = () => {
      if (!youtubePlayer || cancelled) return;
      const position = safeSeconds(youtubePlayer.getCurrentTime());
      const duration = safeSeconds(youtubePlayer.getDuration());
      callbacksRef.current.onProgress(position, duration);
    };
    const startProgress = () => {
      if (progressTimer !== undefined) return;
      reportYouTubeProgress();
      progressTimer = window.setInterval(reportYouTubeProgress, YOUTUBE_PROGRESS_MS);
    };

    let source: ReturnType<typeof parseSpotifyUrl> | ReturnType<typeof parseYouTubeUrl>;
    try { source = props.track.provider === "spotify" ? parseSpotifyUrl(props.track.url) : parseYouTubeUrl(props.track.url); }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : "URL del provider non valido.";
      setMetadataStatus(message);
      emitError(message, true);
      return () => { cancelled = true; };
    }

    void loadProviderMetadata(props.track.provider, props.track.url).then((metadata) => {
      if (cancelled) return;
      setMetadataStatus(null);
      callbacksRef.current.onMetadata(metadata);
    }).catch((reason: unknown) => {
      if (cancelled) return;
      const message = reason instanceof Error ? reason.message : "Metadati del provider non disponibili.";
      setMetadataStatus(message);
      emitError(message, false);
      if (source.provider === "youtube") callbacksRef.current.onMetadata({ artwork: source.artwork });
    });

    if (source.provider === "spotify") {
      void loadSpotifyIframeApi().then((api) => {
        if (cancelled) return;
        api.createController(mount, { uri: source.uri, width: "100%", height: "152" }, (controller) => {
          if (cancelled) { controller.destroy(); return; }
          spotifyController = controller;
          playerRef.current = { provider: "spotify", player: controller };
          const onReady = () => emitState("READY");
          let playingUri: string | undefined;
          const onPlaybackStarted = ({ data }: { data: SpotifyPlaybackData }) => {
            const nextUri = data.playingURI;
            if (!nextUri || nextUri === playingUri) return;
            const isCollectionTransition = playingUri !== undefined;
            playingUri = nextUri;
            const trackUrl = spotifyTrackUrlFromUri(nextUri);
            if (trackUrl) {
              void loadProviderMetadata("spotify", trackUrl).then((metadata) => {
                if (!cancelled && playingUri === nextUri) callbacksRef.current.onMetadata(metadata);
              }).catch(() => { /* Collection playback remains usable when per-track oEmbed is unavailable. */ });
            }
            if (isCollectionTransition) {
              callbacksRef.current.onProgress(0, 0);
              if (callbacksRef.current.autoAdvance === false) {
                command(() => controller.pause());
                emitState("PAUSED");
              }
            }
          };
          const onPlayback = ({ data }: { data: SpotifyPlaybackData }) => {
            const duration = safeSeconds((data.duration ?? 0) / 1_000);
            const position = safeSeconds((data.position ?? 0) / 1_000);
            callbacksRef.current.onProgress(position, duration);
            if (duration > 0) callbacksRef.current.onMetadata({ duration });
            if (data.isBuffering) emitState("BUFFERING");
            else if (!data.isPaused) emitState("PLAYING");
            else if (duration > 0 && position >= duration - .05) emitState("ENDED");
            else emitState("PAUSED");
          };
          controller.addListener("ready", onReady);
          controller.addListener("playback_started", onPlaybackStarted);
          controller.addListener("playback_update", onPlayback);
          detachSpotifyListeners = () => {
            controller.removeListener?.("ready", onReady);
            controller.removeListener?.("playback_started", onPlaybackStarted);
            controller.removeListener?.("playback_update", onPlayback);
          };
        });
      }).catch((reason: unknown) => {
        if (!cancelled) emitError(reason instanceof Error ? reason.message : "Player Spotify non disponibile.", true);
      });
    } else {
      void loadYouTubeIframeApi().then((api) => {
        if (cancelled) return;
        const origin = browserOrigin();
        const playerVars: Record<string, string | number> = { autoplay: 0, enablejsapi: 1, playsinline: 1, rel: 0 };
        if (origin) playerVars.origin = origin;
        youtubePlayer = new api.Player(mount, {
          videoId: source.videoId,
          width: "100%",
          height: "100%",
          host: "https://www.youtube-nocookie.com",
          playerVars,
          events: {
            onReady: (event) => {
              if (cancelled) return;
              youtubePlayer = event.target;
              playerRef.current = { provider: "youtube", player: event.target };
              const duration = safeSeconds(event.target.getDuration());
              if (duration > 0) callbacksRef.current.onMetadata({ duration });
              reportYouTubeProgress();
              emitState("READY");
            },
            onStateChange: ({ data }) => {
              if (cancelled) return;
              reportYouTubeProgress();
              if (data === 1) { emitState("PLAYING"); startProgress(); }
              else {
                stopProgress();
                if (data === 0) emitState("ENDED");
                else if (data === 2) emitState("PAUSED");
                else if (data === 3) emitState("BUFFERING");
                else if (data === 5 || data === -1) emitState("READY");
              }
            },
            onError: ({ data }) => {
              if (cancelled) return;
              stopProgress();
              emitError(youtubeError(data), true);
            }
          }
        });
      }).catch((reason: unknown) => {
        if (!cancelled) emitError(reason instanceof Error ? reason.message : "Player YouTube non disponibile.", true);
      });
    }

    return () => {
      cancelled = true;
      stopProgress();
      detachSpotifyListeners?.();
      if (spotifyController) spotifyController.destroy();
      if (youtubePlayer) youtubePlayer.destroy();
      playerRef.current = null;
      mount.replaceChildren();
    };
  }, [command, emitError, emitState, props.track.id, props.track.provider, props.track.url]);

  return <div className={`streamer-provider-player is-${props.track.provider}`}>
    <div ref={mountRef} className="streamer-provider-frame" aria-label={`Player ${props.track.provider === "spotify" ? "Spotify" : "YouTube"}`} />
    {metadataStatus ? <p className="streamer-provider-status" role="status">{metadataStatus}</p> : null}
  </div>;
});
