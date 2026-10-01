import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Documentation viewport", () => {
  it("owns a bounded vertical scroll container without changing the app shell", () => {
    const css = readFileSync("apps/desktop/src/documentation/documentation.css", "utf8");
    const area = css.match(/\.documentation-workspace\s*\{([^}]*)\}/)?.[1];
    expect(area).toBeDefined();
    expect(area).toMatch(/height:\s*100vh;/);
    expect(area).toMatch(/height:\s*100dvh;/);
    expect(area).toMatch(/min-height:\s*0;/);
    expect(area).toMatch(/overflow-y:\s*auto;/);
    expect(area).toMatch(/overflow-x:\s*hidden;/);
    expect(css).toMatch(/\.documentation-topbar\s*\{[^}]*position:\s*sticky;/);
  });
});
