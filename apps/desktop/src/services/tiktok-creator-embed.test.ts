import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTikTokCreatorProfile } from "./tiktok-creator-embed";

describe("TikTok Creator Profile oEmbed", () => {
  beforeEach(() => sessionStorage.clear());

  it("valida la risposta ufficiale, usa la cache e la aggiorna dopo un'ora", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ type: "rich", provider_name: "TikTok", embed_type: "profile", embed_product_id: "mylonelysoulmusic", author_url: "https://www.tiktok.com/@mylonelysoulmusic", author_name: "My Lonely Soul Music", title: "Creator Profile" })
    });
    await expect(loadTikTokCreatorProfile(fetcher as unknown as typeof fetch, 1_000)).resolves.toMatchObject({ uniqueId: "mylonelysoulmusic", authorName: "My Lonely Soul Music" });
    await expect(loadTikTokCreatorProfile(fetcher as unknown as typeof fetch, 3_600_999)).resolves.toMatchObject({ title: "Creator Profile" });
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(loadTikTokCreatorProfile(fetcher as unknown as typeof fetch, 3_601_000)).resolves.toMatchObject({ title: "Creator Profile" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toContain("https://www.tiktok.com/oembed?url=");
  });

  it("rifiuta payload che non provengono dal Creator Profile Embed", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ provider_name: "Other", type: "video" }) });
    await expect(loadTikTokCreatorProfile(fetcher as unknown as typeof fetch)).rejects.toThrow("non valida");
  });
});
