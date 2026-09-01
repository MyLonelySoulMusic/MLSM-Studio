function interruptedPlay(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /play\(\) request was interrupted|interrupted by a call to pause/i.test(message);
}

class PlaybackStartTimeoutError extends Error {
  constructor() {
    super("La riproduzione non ha risposto entro il tempo previsto.");
    this.name = "PlaybackStartTimeoutError";
  }
}

const PLAYBACK_START_TIMEOUT_MS = 1_500;

function mediaPlaybackError(element: HTMLMediaElement): Error {
  const detail = element.error?.message?.trim();
  return new Error(detail ? `Riproduzione audio non riuscita: ${detail}` : "Riproduzione audio non riuscita.");
}

/**
 * A successful `play()` may be reported either by its Promise or by the media
 * `playing` event. WKWebView can leave the Promise pending forever, therefore
 * neither the global animation clock nor retries may depend on that Promise
 * alone.
 */
function startPlaybackAttempt(element: HTMLMediaElement): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;
    const cleanup = () => {
      if (timeout !== null) globalThis.clearTimeout(timeout);
      element.removeEventListener("playing", onPlaying);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("error", onError);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onPlaying = () => succeed();
    const onPause = () => fail(new DOMException("The play() request was interrupted by a call to pause().", "AbortError"));
    const onError = () => fail(mediaPlaybackError(element));

    element.addEventListener("playing", onPlaying);
    element.addEventListener("pause", onPause);
    element.addEventListener("error", onError);
    timeout = globalThis.setTimeout(() => fail(new PlaybackStartTimeoutError()), PLAYBACK_START_TIMEOUT_MS);
    try {
      void Promise.resolve(element.play()).then(succeed, fail);
    } catch (error) {
      fail(error);
    }
  });
}

function retryDelay(attempt: number): Promise<void> {
  const delays = [0, 50, 150] as const;
  return new Promise((resolve) => globalThis.setTimeout(resolve, delays[Math.min(attempt, delays.length - 1)]));
}

/** Retries the WebKit/Chromium play→pause race, but never revives a stale user intent. */
export async function requestMediaPlayback(element: HTMLMediaElement, ownsIntent: () => boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await startPlaybackAttempt(element);
      return ownsIntent();
    } catch (error) {
      if (!interruptedPlay(error) && !(error instanceof PlaybackStartTimeoutError)) throw error;
      if (!ownsIntent()) return false;
      if (attempt === 3) {
        // Le Promise native dei tentativi scaduti possono restare pendenti e
        // partire più tardi. La pausa terminale le neutralizza prima che la UI
        // torni allo stato idle.
        element.pause();
        throw error;
      }
      await retryDelay(attempt);
      if (!ownsIntent()) return false;
    }
  }
  return false;
}
