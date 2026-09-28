import { describe, expect, it } from "vitest";
import type { ArticleInput } from "./types";
import { articleImageUrl, articlePreviewDocument, replaceArticleImage } from "./article-preview";

const article = (content: string): ArticleInput => ({ title: "Suno & musica", content, excerpt: "Riassunto", slug: "suno", categories: [], tags: [], media: [] });

describe("AutoPost article preview", () => {
  it("finds the first real article image including lazy-loaded markup", () => {
    expect(articleImageUrl(article('<figure><img data-src="https://cdn.example/cover.jpg" alt="Cover"></figure>'))).toBe("https://cdn.example/cover.jpg");
  });

  it("builds a complete WordPress-like preview without executable article scripts", () => {
    const output = articlePreviewDocument(article('<figure><img src="https://cdn.example/cover.jpg"></figure><p onclick="bad()">Testo</p><script>alert(1)</script>'), "it", "Music TodAI");
    expect(output).toContain("Suno &amp; musica");
    expect(output).toContain("https://cdn.example/cover.jpg");
    expect(output).toContain("Testo");
    expect(output).not.toContain("onclick=");
    expect(output).not.toContain("alert(1)");
  });

  it("rejects javascript image URLs", () => {
    expect(articleImageUrl(article('<img src="javascript:alert(1)">'))).toBe("");
  });

  it("replaces, adds and removes the main image without losing the article text", () => {
    expect(replaceArticleImage('<figure><img src="https://old.example/image.jpg"></figure><p>Testo</p>', "https://new.example/image.jpg")).toContain("https://new.example/image.jpg");
    expect(replaceArticleImage("<p>Testo</p>", "https://new.example/image.jpg")).toContain("<figure>");
    expect(replaceArticleImage('<figure><img src="https://old.example/image.jpg"></figure><p>Testo</p>', "")).toBe("<p>Testo</p>");
    expect(() => replaceArticleImage("<p>Testo</p>", "javascript:alert(1)")).toThrow(/http/);
  });
});
