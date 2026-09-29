import { describe, expect, it } from "vitest";
import { directUpscalerOrigin, localUpscalerApiBaseUrl, viteUpscalerProxy } from "./local-python-api";

describe("routing servizio Python locale", () => {
  it("usa il proxy same-origin in browser/Vite", () => {
    expect(localUpscalerApiBaseUrl({} as typeof globalThis)).toBe(viteUpscalerProxy);
  });

  it("usa IPv4 diretto nell'app Tauri, dove Vite non esiste", () => {
    expect(localUpscalerApiBaseUrl({ __TAURI_INTERNALS__: {} } as unknown as typeof globalThis)).toBe(directUpscalerOrigin);
  });
});
