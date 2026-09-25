import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ status: vi.fn(), answer: vi.fn() }));
vi.mock("../services/studio-settings", () => ({
  providerLabels: { nvidia: "NVIDIA", openai: "OpenAI", gemini: "Google Gemini", xai: "xAI / Grok" },
  getLlmSettings: runtime.status,
  requestRemoteAnswer: runtime.answer,
}));

import { getAutoPostAiStatus, mapAutoPostCategories, validateAutoPostCategoryMapping } from "./category-ai";

const source = { id: "source", name: "Newsfield", siteUrl: "https://news.example", username: "a", defaultStatus: "publish" as const, hasPassword: true, categories: [{ id: 7, name: "Sport", slug: "sport", parent: 0, count: 66 }], categoriesSyncedAt: null };
const target = { id: "target", name: "Music TodAI", siteUrl: "https://music.example", username: "a", defaultStatus: "publish" as const, hasPassword: true, categories: [{ id: 2, name: "NEWS MUSIC AI", slug: "news-music-ai", parent: 0, count: 1 }, { id: 5, name: "INDUSTRIA MUSICALE", slug: "industria-musicale", parent: 0, count: 6 }], categoriesSyncedAt: null };

describe("AutoPost category AI", () => {
  beforeEach(() => {
    runtime.status.mockResolvedValue({ activeProvider: "nvidia", providers: { nvidia: { configured: true, enabled: true, model: "openai/gpt-oss-20b" }, openai: { configured: false, enabled: false }, gemini: { configured: false, enabled: false }, xai: { configured: false, enabled: false } } });
    runtime.answer.mockResolvedValue({ source: "nvidia", model: "openai/gpt-oss-20b", content: '{"categoryIds":[2]}' });
  });

  it("uses the API provider configured in Studio", async () => {
    await expect(getAutoPostAiStatus()).resolves.toEqual({ provider: "nvidia", label: "NVIDIA", model: "openai/gpt-oss-20b" });
  });

  it("ignores a conflicting source category and returns only a real target ID", async () => {
    const article = { title: "Suno v6 cambia la musica AI", content: "<p>Nuovi strumenti di musica generativa.</p>", excerpt: "Suno v6 divide gli utenti", slug: "suno-v6", categories: [7], tags: [], media: [] };
    const result = await mapAutoPostCategories(article, source, target);
    expect(result.categoryIds).toEqual([2]);
    expect(runtime.answer).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ role: "system", content: expect.stringContaining("ignorale se generiche, errate o incoerenti") }),
      expect.objectContaining({ role: "user", content: expect.stringContaining("NEWS MUSIC AI") }),
      expect.objectContaining({ role: "user", content: expect.stringContaining("Sport") }),
    ]), expect.objectContaining({ provider: "nvidia", maxTokens: 256 }));
    const userPayload = String(runtime.answer.mock.calls[0]?.[0]?.find((message: { role?: string }) => message.role === "user")?.content);
    expect(userPayload).not.toContain('"slug"');
    expect(userPayload).not.toContain('"parent"');
    expect(userPayload.length).toBeLessThan(2_000);
  });

  it("rejects IDs that do not exist in the target blog", () => {
    expect(validateAutoPostCategoryMapping('{"categoryIds":[2,999,2]}', target.categories)).toEqual([2]);
    expect(validateAutoPostCategoryMapping('[2]', target.categories)).toEqual([2]);
    expect(() => validateAutoPostCategoryMapping('{"categoryIds":[999]}', target.categories)).toThrow(/categoria valida/);
  });
});
