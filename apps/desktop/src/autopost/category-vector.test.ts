import { describe, expect, it } from "vitest";
import { articlePassages, rankCategoryPassages, cosineSimilarity, readCategoryAssociationMode, readCategorySelectionMode, selectCategoryByCosine, selectRankedCategories, readCategoryVectorThreshold, writeCategorySelectionMode, writeCategoryVectorThreshold } from "./category-vector";
import type { ArticleInput } from "./types";

describe("AutoPost local category Vector DB", () => {
  it("defaults to 0.40 and persists custom thresholds including zero", () => {
    localStorage.clear();
    expect(readCategoryVectorThreshold()).toBe(0.4);
    writeCategoryVectorThreshold(0.65);
    expect(readCategoryVectorThreshold()).toBe(0.65);
    writeCategoryVectorThreshold(0);
    expect(readCategoryVectorThreshold()).toBe(0);
    writeCategoryVectorThreshold(NaN);
    expect(readCategoryVectorThreshold()).toBe(0.4);
    localStorage.clear();
  });
  it("applies custom thresholds without changing cosine scores", () => {
    const categories = [{ id: 12, name: "Musica", embedding: [0.45, Math.sqrt(1 - 0.45 ** 2)] }];
    expect(selectCategoryByCosine([1, 0], categories).fallback).toBe(false);
    const strict = selectCategoryByCosine([1, 0], categories, undefined, 0.5);
    expect(strict.fallback).toBe(true);
    expect(strict.score).toBeCloseTo(0.45);
  });
  it("selects either the first category or all categories above threshold", () => {
    const ranking = [{ id: 2, name: "Musica", score: 0.74 }, { id: 3, name: "Tecnologia", score: 0.58 }, { id: 4, name: "Cultura", score: 0.39 }];
    expect(selectRankedCategories(ranking, { id: 1, name: "Uncategorized" }, 0.4, "first").categoryIds).toEqual([2]);
    expect(selectRankedCategories(ranking, { id: 1, name: "Uncategorized" }, 0.4, "all").categoryIds).toEqual([2, 3]);
    expect(selectRankedCategories(ranking, { id: 1, name: "Uncategorized" }, 0.8, "all")).toMatchObject({ categoryIds: [1], fallback: true, score: 0.74 });
  });
  it("persists FIRST or ALL locally", () => {
    localStorage.clear(); expect(readCategorySelectionMode()).toBe("first");
    writeCategorySelectionMode("all"); expect(readCategorySelectionMode()).toBe("all");
    writeCategorySelectionMode("first"); expect(readCategorySelectionMode()).toBe("first");
  });
  it("keeps the title independent and covers the end of long articles with bounded passages", () => {
    const article = { title: "Suno e musica", excerpt: "Una nuova canzone", content: `<script>ignore me</script>${Array.from({ length: 200 }, (_, i) => `<p>Passaggio ${i} con contenuto distinto.</p>`).join("")}<p>Ultima frase.</p>` } as ArticleInput;
    const parts = articlePassages(article);
    expect(parts[0]).toBe(article.title);
    expect(parts).toContain("Ultima frase.");
    expect(parts.length).toBeLessThanOrEqual(66);
    expect(parts.every(part => part.length <= 300 && !part.includes("ignore me"))).toBe(true);
    expect(articlePassages({ title: "", content: "", excerpt: "" } as ArticleInput)).toEqual([]);
  });
  it("returns unscaled cosine and the matching passage for every category", () => {
    const result = rankCategoryPassages([[1, 0], [0, 1]], ["Musica nel titolo", "Novità tecniche"], [
      { id: 12, name: "Musica", embedding: [0.8, 0.6] },
      { id: 6, name: "Tecnologia", embedding: [-0.6, 0.8] },
    ]);
    expect(result.find(r => r.id === 12)).toMatchObject({ score: 0.8, evidence: "Musica nel titolo" });
    expect(result.find(r => r.id === 6)).toMatchObject({ score: 0.8, evidence: "Novità tecniche" });
  });
  it("does not classify image credits and source footers as article topics", () => {
    const parts = articlePassages({ title: "Musica", excerpt: "", content: "<figure><figcaption>Foto illustrativa: Unsplash.</figcaption></figure><p>Una canzone.</p><small>Fonti: sito esterno.</small>" } as ArticleInput);
    expect(parts).toEqual(["Musica", "Una canzone."]);
  });
  it("uses Vector DB as the default association mode", () => {
    localStorage.clear();
    expect(readCategoryAssociationMode()).toBe("vector");
  });

  it("selects the category with the highest cosine above threshold", () => {
    const result = selectCategoryByCosine([1, 0], [
      { id: 2, name: "NEWS MUSIC AI", embedding: [0.8, 0.6] },
      { id: 5, name: "INDUSTRIA MUSICALE", embedding: [0.2, 0.98] },
    ], 1);
    expect(result).toMatchObject({ categoryIds: [2], categoryName: "NEWS MUSIC AI", fallback: false });
    expect(result.score).toBeCloseTo(0.8);
  });

  it("uses Uncategorized below the configured cosine threshold", () => {
    const result = selectCategoryByCosine([1, 0], [
      { id: 1, name: "Uncategorized", embedding: [0, 1] },
      { id: 3, name: "TOOLS & TECNOLOGIA", embedding: [0.39, Math.sqrt(1 - 0.39 ** 2)] },
    ], 1);
    expect(result).toMatchObject({ categoryIds: [1], categoryName: "Uncategorized", fallback: true });
    expect(result.score).toBeCloseTo(0.39);
  });

  it("calculates cosine defensively", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1], [1, 0])).toBe(0);
  });
});
