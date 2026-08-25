import { describe, expect, it, vi } from "vitest";
import { LatestOperation } from "./latest-operation";

describe("LatestOperation", () => {
  it("invalidates and aborts every older intent", () => { const operations = new LatestOperation(); const first = operations.begin(); const aborted = vi.fn(); first.signal.addEventListener("abort", aborted); const second = operations.begin(); expect(aborted).toHaveBeenCalledOnce(); expect(first.isCurrent()).toBe(false); expect(second.isCurrent()).toBe(true); expect(operations.isCurrent(second.id)).toBe(true); operations.invalidate(); expect(second.isCurrent()).toBe(false); });
});
