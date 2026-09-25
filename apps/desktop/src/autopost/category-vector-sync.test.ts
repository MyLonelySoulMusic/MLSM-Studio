import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArticleInput, BlogConnection } from "./types";
const mocks = vi.hoisted(() => ({ get: vi.fn(), extract: vi.fn() }));
vi.mock("../services/local-model-runtime", () => ({ getLocalFeatureExtractor: mocks.get }));
import { mapAutoPostCategoriesWithVectorDb } from "./category-vector";

const category = (id: number, name: string) => ({ id, name, slug: name, parent: 0, count: 0 });
const blog: BlogConnection = { id: "test-blog", siteUrl: "https://example.com", name: "Music", username: "", hasPassword: false, defaultStatus: "draft", categoriesSyncedAt: null, categories: [category(2, "Musica"), category(3, "Tecnologia"), category(1, "Uncategorized")] };
const article: ArticleInput = { title: "Cucina antispreco", content: "Ricette di verdure", excerpt: "", slug: "", categories: [], tags: [], media: [] };
const axis = (i: number) => Array.from({ length: 384 }, (_, k) => k === i ? 1 : 0);
const queries = () => mocks.extract.mock.calls.map(call => call[0]);

describe("vector category collection synchronization", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    mocks.get.mockReset(); mocks.extract.mockReset();
    mocks.extract.mockImplementation(async (texts: string[]) => {
      const rows = texts.map(text => axis(/Cucina|Ricette/.test(text) ? 0 : text === "Musica" ? 1 : 2));
      return { dims: [rows.length, 384], data: [], tolist: () => rows };
    });
    mocks.get.mockResolvedValue(Object.assign(mocks.extract, { embeddingSpace: "MiniLM:q8:mean:webgpu:verified-v1" }));
  });
  afterEach(() => vi.unstubAllGlobals());
  it("adds, renames and removes categories without recomputing unchanged vectors", async () => {
    const first = await mapAutoPostCategoriesWithVectorDb(article, blog);
    expect(first.fallback).toBe(true);
    mocks.extract.mockClear();
    const added = { ...blog, categories: [...blog.categories, category(4, "Cucina")] };
    expect((await mapAutoPostCategoriesWithVectorDb(article, added)).categoryIds).toEqual([4]);
    expect(queries()[0]).toEqual(["Cucina"]);
    mocks.extract.mockClear();
    const renamed = { ...added, categories: added.categories.map(c => c.id === 4 ? category(4, "Cucina italiana") : c) };
    await mapAutoPostCategoriesWithVectorDb(article, renamed);
    expect(queries()[0]).toEqual(["Cucina italiana"]);
    mocks.extract.mockClear();
    expect((await mapAutoPostCategoriesWithVectorDb(article, blog)).categoryIds).toEqual([1]);
    expect(queries()).toHaveLength(1); // Only the article: deleted category no longer participates.
  });
  it("rebuilds cached categories if the embedding backend changes", async () => {
    await mapAutoPostCategoriesWithVectorDb(article, blog);
    Object.assign(mocks.extract, { embeddingSpace: "MiniLM:q8:mean:wasm:verified-v1" });
    mocks.extract.mockClear();
    await mapAutoPostCategoriesWithVectorDb(article, blog);
    expect(queries()[0]).toEqual(blog.categories.map(c => c.name));
  });
  it("refuses invalid article embeddings instead of producing a category score", async () => {
    await mapAutoPostCategoriesWithVectorDb(article, blog);
    mocks.extract.mockResolvedValueOnce({ dims: [2, 384], data: [], tolist: () => [Array(384).fill(0), Array(384).fill(0)] });
    await expect(mapAutoPostCategoriesWithVectorDb(article, blog)).rejects.toThrow("vettore nullo");
  });
});
