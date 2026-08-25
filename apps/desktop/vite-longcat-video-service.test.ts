import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { localLongCatVideoService, longCatVideoHealthUrl, longCatVideoServerPath } from "./vite-longcat-video-service";

describe("LongCat Video local service", () => {
  it("risolve il bridge interno e lo limita alla fase serve", () => {
    expect(longCatVideoServerPath("/tmp/mlsm")).toBe(resolve("/tmp/mlsm/tools/longcat-video/server.cjs"));
    expect(longCatVideoHealthUrl).toBe("http://127.0.0.1:8766/health");
    expect(localLongCatVideoService()).toMatchObject({ name: "mlsm-local-longcat-video", apply: "serve" });
  });
});
