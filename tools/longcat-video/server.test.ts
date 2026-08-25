import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const server = require("./server.cjs") as { isLocalOrigin(value?: string): boolean; safeName(value: string): string | null };

describe("LongCat browser bridge", () => {
  it("accetta soltanto origini locali e nomi media confinati", () => {
    expect(server.isLocalOrigin("http://localhost:1421")).toBe(true);
    expect(server.isLocalOrigin("https://evil.example")).toBe(false);
    expect(server.safeName("source video.mp4")).toBe("source video.mp4");
    expect(server.safeName("../source.mp4")).toBeNull();
  });
});
