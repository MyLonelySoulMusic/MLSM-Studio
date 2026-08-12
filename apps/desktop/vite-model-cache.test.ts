import { describe, expect, it } from "vitest";
import { modelCacheErrorResponse } from "./src/services/model-cache-errors";

describe("cache locale dei modelli", () => {
  it("tratta fetch failed come cache miss per consentire il fallback remoto", () => {
    const failure = modelCacheErrorResponse(new TypeError("fetch failed"));

    expect(failure).toMatchObject({
      statusCode: 404,
      contentType: "text/plain; charset=utf-8",
      diagnostic: "network-transient",
      fallbackToRemote: true
    });
    expect(failure.body).not.toContain("fetch failed");
    expect(failure.contentType).not.toContain("json");
  });

  it("mantiene il 404 reale del repository come cache miss", () => {
    const failure = modelCacheErrorResponse(Object.assign(new Error("Hugging Face 404 per config.json"), { status: 404 }));
    expect(failure.statusCode).toBe(404);
    expect(failure.diagnostic).toBe("remote-404");
    expect(failure.fallbackToRemote).toBe(true);
  });

  it.each([400, 429, 500, 503])("non nasconde una risposta HTTP %s come cache miss", (status) => {
    const failure = modelCacheErrorResponse(Object.assign(new Error(`Hugging Face ${status}`), { status }));
    expect(failure).toMatchObject({ statusCode: status, diagnostic: "cache-error", fallbackToRemote: false });
    expect(failure.contentType).toBe("text/plain; charset=utf-8");
    expect(failure.body).not.toContain("Hugging Face");
  });
});
