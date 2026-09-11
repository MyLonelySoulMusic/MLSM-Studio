import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyReportsRequest } from "./vite-reports-service";

describe("local Reports archive", () => {
  it("persists dashboards atomically outside the repository and shares list/update/delete operations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mlsm-reports-"));
    const path = join(directory, "reports", "dashboards.json");
    const first = { id: "dashboard-one", name: "Prima" };
    const updated = { id: "dashboard-one", name: "Aggiornata" };
    const second = { id: "dashboard-two", name: "Seconda" };

    await expect(applyReportsRequest(path, { action: "list" })).resolves.toEqual([]);
    await applyReportsRequest(path, { action: "save", dashboard: first });
    await applyReportsRequest(path, { action: "save", dashboard: second });
    await applyReportsRequest(path, { action: "save", dashboard: updated });
    await expect(applyReportsRequest(path, { action: "list" })).resolves.toEqual([updated, second]);
    await applyReportsRequest(path, { action: "delete", dashboardId: second.id });
    await expect(applyReportsRequest(path, { action: "list" })).resolves.toEqual([updated]);
    await expect(readFile(path, "utf8")).resolves.toContain('"schemaVersion":1');
  });

  it("rejects invalid identifiers and preserves a corrupt archive", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mlsm-reports-corrupt-"));
    const path = join(directory, "dashboards.json");
    await expect(applyReportsRequest(path, { action: "save", dashboard: { id: "../escape" } })).rejects.toThrow(/ID dashboard/);
    await writeFile(path, "not-json", "utf8");
    await expect(applyReportsRequest(path, { action: "list" })).rejects.toThrow();
    await expect(readFile(path, "utf8")).resolves.toBe("not-json");
  });
});
