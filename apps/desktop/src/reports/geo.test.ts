import { describe, expect, it } from "vitest";
import { buildGeoPoints, resolveGeoLocation } from "./geo";

describe("Reports geographic resolution", () => {
  it("recognizes country codes and localized country names offline", () => {
    const iso2 = resolveGeoLocation("IT");
    const iso3 = resolveGeoLocation("ITA");
    const italian = resolveGeoLocation("Italia");
    expect(iso2).toMatchObject({ kind: "country", canonicalName: "Italia" });
    expect(iso3).toMatchObject({ latitude: iso2?.latitude, longitude: iso2?.longitude });
    expect(italian).toMatchObject({ latitude: iso2?.latitude, longitude: iso2?.longitude });
    expect(resolveGeoLocation("United States of America")?.kind).toBe("country");
  });

  it("recognizes common city names, compound labels and explicit coordinates", () => {
    expect(resolveGeoLocation("Roma")?.canonicalName).toBe("Roma");
    expect(resolveGeoLocation("New York, USA")?.canonicalName).toBe("New York");
    expect(resolveGeoLocation("41.9028, 12.4964")).toMatchObject({ kind: "coordinates", latitude: 41.9028, longitude: 12.4964 });
    expect(resolveGeoLocation("Atlantide")).toBeNull();
  });

  it("groups equivalent locations and reports unresolved values", () => {
    const result = buildGeoPoints([
      { label: "IT", value: 10 }, { label: "Italia", value: 5 }, { label: "Roma", value: 2 }, { label: "Atlantide", value: 7 },
    ]);
    expect(result.points).toHaveLength(2);
    expect(result.points.find(point => point.kind === "country")?.value).toBe(15);
    expect(result.unresolved).toEqual(["Atlantide"]);
  });
});
