import { describe, expect, it } from "vitest";
import { knownFaviconCandidates } from "./vite-postit-favicon";

describe("Post-it favicon backend", () => {
  it("usa il CDN statico ufficiale per i link ChatGPT protetti da Cloudflare", () => {
    const candidates = knownFaviconCandidates(new URL("https://chatgpt.com/share/00000000-0000-0000-0000-000000000000"));
    expect(candidates.map((candidate) => candidate.href)).toEqual(["https://cdn.oaistatic.com/assets/favicon-miwirzcw.ico"]);
  });

  it("non applica il fallback ChatGPT agli altri domini", () => {
    expect(knownFaviconCandidates(new URL("https://example.com"))).toEqual([]);
  });
});
