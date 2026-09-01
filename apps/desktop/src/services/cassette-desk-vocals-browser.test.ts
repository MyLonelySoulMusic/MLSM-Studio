import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBrowserVocalService } from "./cassette-desk-vocals-browser";

describe("browser vocal service transport", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("recupera un errore di connessione transitorio senza perdere l’analisi", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock); vi.useFakeTimers();
    const request = fetchBrowserVocalService("/status", {}, "runtime Demucs");
    await vi.advanceTimersByTimeAsync(180);
    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sostituisce Failed to fetch con un errore che identifica servizio e route", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))); vi.useFakeTimers();
    const request = fetchBrowserVocalService("/refine", {}, "micro-allineamento MFCC/DTW");
    const assertion = expect(request).rejects.toThrow(/micro-allineamento MFCC\/DTW.*3 volte.*\/refine/iu);
    await vi.advanceTimersByTimeAsync(600);
    await assertion;
  });
});
