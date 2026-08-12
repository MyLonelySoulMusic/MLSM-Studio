export interface ModelCacheErrorResponse {
  statusCode: number;
  contentType: "text/plain; charset=utf-8";
  body: string;
  diagnostic: string;
  fallbackToRemote: boolean;
}

/**
 * Converts a local cache download failure into the response expected by
 * Transformers.js. In particular, network failures must be reported as a
 * cache miss (404), otherwise Transformers.js tries to parse the plain-text
 * Vite error as a model JSON document before it can use the remote hub.
 */
export function modelCacheErrorResponse(error: unknown): ModelCacheErrorResponse {
  const message = error instanceof Error ? error.message : String(error);
  const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
    ? error.status
    : undefined;
  // Only transport failures are cache misses. A real HTTP response (including
  // 5xx/429) must remain visible instead of being disguised as a local miss.
  const transportFailure = status === undefined
    && /fetch failed|failed to fetch|network|timed? ?out|econn(reset|refused|aborted)|socket|dns|temporar|unavailable/i.test(message);
  const fallbackToRemote = status === 404 || transportFailure;
  const statusCode = fallbackToRemote ? 404 : status && status >= 400 && status < 600 ? status : 502;
  const diagnostic = status === 404 ? "remote-404" : transportFailure ? "network-transient" : "cache-error";
  const body = fallbackToRemote
    ? "Local model cache miss; retrying the remote model download."
    : "Unable to load the local model cache.";
  return { statusCode, contentType: "text/plain; charset=utf-8", body, diagnostic, fallbackToRemote };
}
