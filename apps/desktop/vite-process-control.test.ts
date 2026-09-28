import { describe, expect, it } from "vitest";
import { commandLineMatchesEntry } from "./vite-process-control";

describe("verified local process control", () => {
  it("riconosce lo stesso entrypoint con separatori Windows o macOS", () => {
    expect(commandLineMatchesEntry("node C:\\MLSM Studio\\tools\\ai-quantizer\\server.cjs", "C:/MLSM Studio/tools/ai-quantizer/server.cjs")).toBe(true);
    expect(commandLineMatchesEntry("/opt/node /Users/me/MLSM Studio/tools/autopost/server.mjs", "/Users/me/MLSM Studio/tools/autopost/server.mjs")).toBe(true);
  });

  it("non termina un processo estraneo che usa la stessa porta", () => {
    expect(commandLineMatchesEntry("node /tmp/foreign/server.cjs", "/Users/me/MLSM Studio/tools/ai-quantizer/server.cjs")).toBe(false);
  });
});
