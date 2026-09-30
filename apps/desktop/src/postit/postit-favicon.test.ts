import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRealPostItFavicon, isGeneratedPostItFavicon } from "./postit-favicon";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));

describe("Post-it favicon client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("salva soltanto immagini data restituite dal servizio locale", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ faviconUrl: "data:image/png;base64,AA==" }) });
    vi.stubGlobal("fetch", fetch);
    await expect(fetchRealPostItFavicon("https://example.com")).resolves.toBe("data:image/png;base64,AA==");
    expect(fetch).toHaveBeenCalledWith("/__mlsm/postit/favicon", expect.objectContaining({ method: "POST", body: JSON.stringify({ url: "https://example.com" }) }));
  });

  it("riconosce le vecchie icone generate senza confonderle con favicon reali", () => {
    expect(isGeneratedPostItFavicon(`data:image/svg+xml,${encodeURIComponent('<svg><text font-family="Arial,sans-serif">E</text></svg>')}`)).toBe(true);
    expect(isGeneratedPostItFavicon("data:image/png;base64,AA==")).toBe(false);
  });
});
