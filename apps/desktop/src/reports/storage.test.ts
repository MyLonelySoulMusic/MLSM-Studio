import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createDemoDashboard } from "./data";
import { deleteDashboard, exportDashboard, importDashboard, listDashboards, saveDashboard, validateDashboard } from "./storage";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));

const REPORT_DATABASE = "mlsm-studio-reports";
const REPORT_STORE = "dashboards";
const reportsIndexedDb = new IDBFactory();
let sharedDashboards: unknown[] = [];

function resetReportsDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = reportsIndexedDb.deleteDatabase(REPORT_DATABASE);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Il database Reports è ancora aperto."));
  });
}

function openReportsDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = reportsIndexedDb.open(REPORT_DATABASE, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(REPORT_STORE)) request.result.createObjectStore(REPORT_STORE, { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putStoredDashboard(value: unknown): Promise<void> {
  return openReportsDatabase().then(database => new Promise((resolve, reject) => {
    const transaction = database.transaction(REPORT_STORE, "readwrite");
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    transaction.onabort = () => { database.close(); reject(transaction.error); };
    transaction.objectStore(REPORT_STORE).put(value);
  }));
}

function readStoredDashboard(id: string): Promise<unknown> {
  return openReportsDatabase().then(database => new Promise((resolve, reject) => {
    let value: unknown;
    const transaction = database.transaction(REPORT_STORE, "readonly");
    transaction.objectStore(REPORT_STORE).get(id).onsuccess = event => { value = (event.target as IDBRequest<unknown>).result; };
    transaction.oncomplete = () => { database.close(); resolve(value); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    transaction.onabort = () => { database.close(); reject(transaction.error); };
  }));
}

beforeEach(async () => {
  sharedDashboards = [];
  vi.stubGlobal("indexedDB", reportsIndexedDb);
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body ?? "{}")) as { action?: string; dashboard?: unknown; dashboardId?: string };
    if (request.action === "list") return new Response(JSON.stringify({ result: structuredClone(sharedDashboards) }), { status: 200, headers: { "Content-Type": "application/json" } });
    if (request.action === "save" && request.dashboard && typeof request.dashboard === "object" && "id" in request.dashboard) {
      const savedDashboard = request.dashboard as Record<string, unknown>;
      sharedDashboards = [structuredClone(savedDashboard), ...sharedDashboards.filter(item => !item || typeof item !== "object" || !("id" in item) || item.id !== savedDashboard.id)];
      return new Response(JSON.stringify({ result: null }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (request.action === "delete") {
      sharedDashboards = sharedDashboards.filter(item => !item || typeof item !== "object" || !("id" in item) || item.id !== request.dashboardId);
      return new Response(JSON.stringify({ result: null }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "Bad request" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }));
  await resetReportsDatabase();
});

afterEach(() => vi.unstubAllGlobals());

describe("Reports portable JSON", () => {
  it("round-trips data, layout, filters and custom palette while importing a separate copy", () => {
    const original = createDemoDashboard();
    original.theme = { accent: "#123ABC", ink: "#212121", paper: "#F7F7F7" };
    original.filters = [{ id: "filter-1", datasetId: original.datasets[0]!.id, fieldId: "field-2", value: "Instagram", defaultValue: "Instagram", includeAll: true, targetMode: "selected", widgetIds: [original.widgets[0]!.id] }];
    original.layoutRows[0]!.columns = 7;
    original.widgets[0]!.width = 5;
    original.widgets[0]!.aggregation = "median";
    original.widgets[0]!.format = "currency";
    original.widgets[0]!.currency = "USD";
    original.widgets[0]!.decimals = 3;
    const serialized = exportDashboard(original);
    const imported = importDashboard(serialized);
    expect(imported.id).not.toBe(original.id);
    expect(imported.datasets).toEqual(original.datasets);
    expect(imported.widgets).toEqual(original.widgets);
    expect(imported.filters).toEqual(original.filters);
    expect(imported.theme).toEqual(original.theme);
    expect(importDashboard(serialized).id).not.toBe(imported.id);
    imported.datasets[0]!.rows[0]!["field-3"] = 999;
    expect(original.datasets[0]!.rows[0]!["field-3"]).toBe(42000);
  });

  it("rejects malformed JSON, unsupported versions and unknown properties", () => {
    expect(() => importDashboard("{broken")).toThrow(/JSON valido/);
    expect(() => importDashboard("null")).toThrow(/oggetto/);
    const dashboard = createDemoDashboard();
    expect(() => importDashboard(JSON.stringify({ ...dashboard, schemaVersion: 6 }))).toThrow(/versione non supportata/);
    expect(() => importDashboard(JSON.stringify({ ...dashboard, executable: "alert(1)" }))).toThrow(/struttura/);
  });

  it("rejects duplicate ids and dangling dataset, field or filter references", () => {
    const dashboard = createDemoDashboard();
    dashboard.widgets[1]!.id = dashboard.widgets[0]!.id;
    expect(() => exportDashboard(dashboard)).toThrow(/duplicati/);
    dashboard.widgets[1]!.id = "unique-widget";
    dashboard.widgets[0]!.datasetId = "missing-dataset";
    expect(() => exportDashboard(dashboard)).toThrow(/dataset inesistente/);
    dashboard.widgets[0]!.datasetId = dashboard.datasets[0]!.id;
    dashboard.widgets[0]!.measure = "missing-field";
    expect(() => exportDashboard(dashboard)).toThrow(/campo inesistente/);
    dashboard.widgets[0]!.measure = "field-3";
    dashboard.filters = [{ id: "filter-1", datasetId: dashboard.datasets[0]!.id, fieldId: "missing-field", value: "x", defaultValue: "x", includeAll: true, targetMode: "all", widgetIds: [] }];
    expect(() => exportDashboard(dashboard)).toThrow(/filtro/);
  });

  it("migrates Reports v1 JSON to time grouping and global filter defaults", () => {
    const legacy = JSON.parse(JSON.stringify(createDemoDashboard()));
    legacy.schemaVersion = 1;
    delete legacy.layoutRows;
    legacy.widgets.forEach((widget: Record<string, unknown>) => { delete widget.secondaryDimension; delete widget.timeGrain; delete widget.rowId; delete widget.currency; delete widget.decimals; delete widget.xSort; });
    legacy.filters = [{ id: "legacy-filter", datasetId: legacy.datasets[0].id, fieldId: "field-2", value: "Instagram" }];
    const migrated = importDashboard(JSON.stringify(legacy));
    expect(migrated.schemaVersion).toBe(5);
    expect(migrated.widgets.every(widget => widget.timeGrain === "exact" && widget.secondaryDimension === "")).toBe(true);
    expect(migrated.layoutRows).toHaveLength(1);
    expect(migrated.widgets.every(widget => widget.rowId === migrated.layoutRows[0]!.id && widget.currency === "EUR" && widget.decimals === 2 && widget.xSort === "asc")).toBe(true);
    expect(migrated.filters[0]).toMatchObject({ targetMode: "all", widgetIds: [], defaultValue: "Instagram", includeAll: true });
  });

  it("migrates Reports v2 JSON to rows, currency and manual widths", () => {
    const legacy = JSON.parse(JSON.stringify(createDemoDashboard()));
    legacy.schemaVersion = 2;
    delete legacy.layoutRows;
    legacy.widgets.forEach((widget: Record<string, unknown>) => { delete widget.rowId; delete widget.currency; delete widget.decimals; delete widget.xSort; });
    const migrated = importDashboard(JSON.stringify(legacy));
    expect(migrated.schemaVersion).toBe(5);
    expect(migrated.layoutRows).toEqual([{ id: "row-main", columns: null }]);
    expect(migrated.widgets.every(widget => widget.rowId === "row-main" && widget.currency === "EUR" && widget.decimals === 2 && widget.xSort === "asc")).toBe(true);
  });

  it("migrates Reports v3 JSON to explicit X-axis sorting", () => {
    const legacy = JSON.parse(JSON.stringify(createDemoDashboard()));
    legacy.schemaVersion = 3;
    legacy.widgets.forEach((widget: Record<string, unknown>) => { delete widget.xSort; });
    const migrated = importDashboard(JSON.stringify(legacy));
    expect(migrated.schemaVersion).toBe(5);
    expect(migrated.widgets.every(widget => widget.xSort === "asc")).toBe(true);
  });

  it("migrates Reports v4 filters to explicit initial-value configuration", () => {
    const legacy = JSON.parse(JSON.stringify(createDemoDashboard()));
    legacy.schemaVersion = 4;
    legacy.filters = [{ id: "legacy-filter", datasetId: legacy.datasets[0].id, fieldId: "field-2", value: "Instagram", targetMode: "all", widgetIds: [] }];
    const migrated = importDashboard(JSON.stringify(legacy));
    expect(migrated.schemaVersion).toBe(5);
    expect(migrated.filters[0]).toMatchObject({ value: "Instagram", defaultValue: "Instagram", includeAll: true });
  });

  it("rejects unsafe colors, nonfinite numbers, object cells and inconsistent field types", () => {
    const dashboard = createDemoDashboard();
    dashboard.theme.accent = "url(https://example.test/track)";
    expect(() => exportDashboard(dashboard)).toThrow(/esadecimale/);
    dashboard.theme.accent = "#FF4F9A";
    dashboard.datasets[0]!.rows[0]!["field-3"] = Infinity;
    expect(() => exportDashboard(dashboard)).toThrow(/numerico non valido/);
    dashboard.datasets[0]!.rows[0]!["field-3"] = "123";
    expect(() => exportDashboard(dashboard)).toThrow(/valore non valido/);
    const value = JSON.parse(JSON.stringify(createDemoDashboard()));
    value.datasets[0].rows[0]["field-3"] = { formula: "1 + 1" };
    expect(() => validateDashboard(value)).toThrow(/celle devono contenere/);
  });

  it("rejects invalid row layouts, manual widths and currency details", () => {
    const invalidRow = JSON.parse(JSON.stringify(createDemoDashboard()));
    invalidRow.layoutRows[0].columns = 13;
    expect(() => validateDashboard(invalidRow)).toThrow(/elementi per riga/);
    const invalidWidth = JSON.parse(JSON.stringify(createDemoDashboard()));
    invalidWidth.widgets[0].width = 0;
    expect(() => validateDashboard(invalidWidth)).toThrow(/larghezza/);
    const invalidCurrency = JSON.parse(JSON.stringify(createDemoDashboard()));
    invalidCurrency.widgets[0].currency = "BTC";
    expect(() => validateDashboard(invalidCurrency)).toThrow(/valuta/);
  });

  it("does not silently discard unknown cell keys or missing values", () => {
    const dashboard = createDemoDashboard();
    dashboard.datasets[0]!.rows[0]!["unknown-field"] = "hidden";
    expect(() => exportDashboard(dashboard)).toThrow(/struttura/);
    delete dashboard.datasets[0]!.rows[0]!["unknown-field"];
    delete dashboard.datasets[0]!.rows[0]!["field-3"];
    expect(() => exportDashboard(dashboard)).toThrow(/struttura/);
  });

  it("reports an unavailable shared local archive instead of claiming a save succeeded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(saveDashboard(createDemoDashboard())).rejects.toThrow(/archivio locale condiviso/);
    await expect(listDashboards()).rejects.toThrow(/archivio locale condiviso/);
  });

  it("persists, updates, orders and deletes dashboards in the shared local archive", async () => {
    const older = createDemoDashboard();
    const newer = createDemoDashboard();
    older.name = "Dashboard precedente";
    newer.name = "Dashboard recente";
    older.updatedAt = "2026-09-01T10:00:00.000Z";
    newer.updatedAt = "2026-09-02T10:00:00.000Z";

    await saveDashboard(older);
    await saveDashboard(newer);
    expect((await listDashboards()).map(item => item.id)).toEqual([newer.id, older.id]);

    const updatedOlder = { ...older, name: "Dashboard precedente aggiornata", updatedAt: "2026-09-03T10:00:00.000Z" };
    await saveDashboard(updatedOlder);
    expect(await listDashboards()).toEqual([updatedOlder, newer]);

    await deleteDashboard(newer.id);
    expect((await listDashboards()).map(item => item.id)).toEqual([older.id]);
    await deleteDashboard(older.id);
    await expect(listDashboards()).resolves.toEqual([]);
  });

  it("keeps a corrupt dashboard stored while reporting an explicit read error", async () => {
    const dashboard = createDemoDashboard();
    dashboard.name = "Dashboard da conservare";
    await saveDashboard(dashboard);
    sharedDashboards = [{ ...dashboard, theme: { ...dashboard.theme, accent: "javascript:alert(1)" } }];

    await expect(listDashboards()).rejects.toThrow(/dashboard salvata non può essere letta.*colore principale/);
    expect(sharedDashboards[0]).toMatchObject({
      id: dashboard.id,
      theme: { accent: "javascript:alert(1)" },
    });
  });

  it("migrates a previous browser-only dashboard into the shared archive", async () => {
    const legacy = createDemoDashboard();
    await putStoredDashboard(legacy);
    await expect(listDashboards()).resolves.toEqual([legacy]);
    expect(sharedDashboards).toEqual([legacy]);
    await expect(readStoredDashboard(legacy.id)).resolves.toBeUndefined();
  });
});
