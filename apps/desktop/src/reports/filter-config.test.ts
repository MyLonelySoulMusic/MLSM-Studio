import { describe, expect, it } from "vitest";
import { filterOptions, resetFilterValue, resolveFilterDefault, type FilterConfig } from "./filter-config";

const values = ["Nord", "Sud", "Centro", "Nord"] as const;

describe("report filter configuration", () => {
  it("builds unique options and adds (Tutti) only when requested", () => {
    expect(filterOptions(values, { includeAll: true })).toEqual([null, "Nord", "Sud", "Centro"]);
    expect(filterOptions(values, { includeAll: false })).toEqual(["Nord", "Sud", "Centro"]);
  });

  it("uses null as the default for (Tutti), keeping empty cells distinguishable", () => {
    const config: FilterConfig = { includeAll: true, defaultValue: null };

    expect(resolveFilterDefault(values, config)).toBeNull();
  });

  it("keeps a specific default when it is still present in the options", () => {
    const config: FilterConfig = { includeAll: true, defaultValue: "Sud" };

    expect(resolveFilterDefault(values, config)).toBe("Sud");
  });

  it("falls back to (Tutti), or the first value when (Tutti) is excluded", () => {
    expect(resolveFilterDefault(values, { includeAll: true, defaultValue: "Scomparso" })).toBeNull();
    expect(resolveFilterDefault(values, { includeAll: false, defaultValue: "Scomparso" })).toBe("Nord");
    expect(resolveFilterDefault([], { includeAll: false, defaultValue: "Scomparso" })).toBeNull();
  });

  it("resets the active selection to the configured default", () => {
    expect(resetFilterValue(values, { includeAll: true, defaultValue: "Sud" }, "Nord")).toBe("Sud");
    expect(resetFilterValue(values, { includeAll: true, defaultValue: "Scomparso" }, "Sud")).toBeNull();
    expect(resetFilterValue(values, { includeAll: false, defaultValue: "Scomparso" }, "Sud")).toBe("Nord");
  });
});
