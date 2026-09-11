import { describe, expect, it } from "vitest";
import { createDashboardViewUrl, reportViewIdFromHash } from "./url";

describe("Reports view URLs", () => {
  it("creates and parses a dedicated read-only dashboard route", () => {
    const url = createDashboardViewUrl("dashboard_123", { origin: "https://studio.example", pathname: "/app", search: "?theme=light" });
    expect(url).toBe("https://studio.example/app?theme=light#/reports/view/dashboard_123");
    expect(reportViewIdFromHash(new URL(url).hash)).toBe("dashboard_123");
  });

  it("rejects malformed or unrelated routes", () => {
    expect(reportViewIdFromHash("#/reports/view/%20bad")).toBeNull();
    expect(reportViewIdFromHash("#/reports/edit/dashboard_123")).toBeNull();
    expect(() => createDashboardViewUrl("bad/id", { origin: "https://studio.example", pathname: "/", search: "" })).toThrow(/non valido/);
  });
});
