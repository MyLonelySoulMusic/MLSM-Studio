import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createDemoDashboard } from "./data";
import { deleteDashboard, exportDashboard, importDashboard, listDashboards, saveDashboard, validateDashboard } from "./storage";
import { DEFAULT_MAP_BACKGROUND } from "./types";
import { createCalculatedField } from "./calculated-fields";

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
    original.widgets[0]!.mapBackground = "#E8E8E8";
    original.widgets[3]!.xAxisLabel = "Periodo personalizzato";
    original.widgets[3]!.yAxisLabel = "Valore personalizzato";
    original.datasets[0] = createCalculatedField(original.datasets[0]!, { id: "engagement-rate", name: "Engagement rate", formula: "SUM([Interazioni]) / SUM([Visualizzazioni])" });
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
    expect(() => importDashboard(JSON.stringify({ ...dashboard, schemaVersion: 15 }))).toThrow(/versione non supportata/);
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
    expect(migrated.schemaVersion).toBe(14);
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
    expect(migrated.schemaVersion).toBe(14);
    expect(migrated.tabs).toEqual([{ id: "tab-main", name: "Pagina 1" }]);
    expect(migrated.layoutRows).toEqual([{ id: "row-main", tabId: "tab-main", columns: null }]);
    expect(migrated.widgets.every(widget => widget.rowId === "row-main" && widget.currency === "EUR" && widget.decimals === 2 && widget.xSort === "asc")).toBe(true);
  });

  it("migrates Reports v3 JSON to explicit X-axis sorting", () => {
    const legacy = JSON.parse(JSON.stringify(createDemoDashboard()));
    legacy.schemaVersion = 3;
    legacy.widgets.forEach((widget: Record<string, unknown>) => { delete widget.xSort; });
    const migrated = importDashboard(JSON.stringify(legacy));
    expect(migrated.schemaVersion).toBe(14);
    expect(migrated.widgets.every(widget => widget.xSort === "asc")).toBe(true);
  });

  it("migrates Reports v4 filters to explicit initial-value configuration", () => {
    const legacy = JSON.parse(JSON.stringify(createDemoDashboard()));
    legacy.schemaVersion = 4;
    legacy.filters = [{ id: "legacy-filter", datasetId: legacy.datasets[0].id, fieldId: "field-2", value: "Instagram", targetMode: "all", widgetIds: [] }];
    const migrated = importDashboard(JSON.stringify(legacy));
    expect(migrated.schemaVersion).toBe(14);
    expect(migrated.filters[0]).toMatchObject({ value: "Instagram", defaultValue: "Instagram", includeAll: true });
  });

  it("migrates Reports v5 to tabs and removes the old implicit 12-category cap", () => {
    const legacy = JSON.parse(JSON.stringify(createDemoDashboard()));
    legacy.schemaVersion = 5;
    delete legacy.tabs;
    legacy.layoutRows.forEach((row: Record<string, unknown>) => { delete row.tabId; });
    legacy.widgets[0].limit = 12;
    legacy.widgets[1].limit = 7;

    const migrated = importDashboard(JSON.stringify(legacy));

    expect(migrated.schemaVersion).toBe(14);
    expect(migrated.tabs).toEqual([{ id: "tab-main", name: "Pagina 1" }]);
    expect(migrated.layoutRows.every(row => row.tabId === "tab-main")).toBe(true);
    expect(migrated.widgets[0]!.limit).toBeNull();
    expect(migrated.widgets[1]!.limit).toBe(7);
  });

  it("migrates Reports v6 adding the neutral map background", () => {
    const legacy = JSON.parse(JSON.stringify(createDemoDashboard()));
    legacy.schemaVersion = 6;
    legacy.widgets.forEach((widget: Record<string, unknown>) => { delete widget.mapBackground; });

    const migrated = importDashboard(JSON.stringify(legacy));

    expect(migrated.schemaVersion).toBe(14);
    expect(migrated.widgets.every(widget => widget.mapBackground === DEFAULT_MAP_BACKGROUND)).toBe(true);
  });

  it("migrates Reports v7 adding an empty widget animation", () => {
    const legacy = JSON.parse(JSON.stringify(createDemoDashboard()));
    legacy.schemaVersion = 7;
    legacy.widgets.forEach((widget: Record<string, unknown>) => { delete widget.animation; });

    const migrated = importDashboard(JSON.stringify(legacy));

    expect(migrated.schemaVersion).toBe(14);
    expect(migrated.widgets.every(widget => widget.animation === null)).toBe(true);
  });

  it("migrates Reports v8 animations to period values", () => {
    const legacy = JSON.parse(JSON.stringify(createDemoDashboard()));
    legacy.schemaVersion = 8;
    legacy.widgets[0].animation = {
      type: "timeSeries", chartType: "line", dimension: "field-1", timeGrain: "month",
      showTrendLine: false, highlightMaximum: true,
    };

    const migrated = importDashboard(JSON.stringify(legacy));

    expect(migrated.schemaVersion).toBe(14);
    expect(migrated.widgets[0]!.animation?.valueMode).toBe("period");
  });

  it("migrates Reports v9 category limits to the first-N mode", () => {
    const legacy = JSON.parse(JSON.stringify(createDemoDashboard()));
    legacy.schemaVersion = 9;
    legacy.widgets.forEach((widget: Record<string, unknown>) => { delete widget.categoryLimitMode; });

    const migrated = importDashboard(JSON.stringify(legacy));

    expect(migrated.schemaVersion).toBe(14);
    expect(migrated.widgets.every(widget => widget.categoryLimitMode === "first")).toBe(true);
  });

  it("migrates Reports v10 to the animation-aware v11 schema", () => {
    const legacy = JSON.parse(JSON.stringify(createDemoDashboard()));
    legacy.schemaVersion = 10;

    const migrated = importDashboard(JSON.stringify(legacy));

    expect(migrated.schemaVersion).toBe(14);
    expect(migrated.widgets.every(widget => widget.animation === null)).toBe(true);
  });

  it("migrates Reports v12 with hidden KPI details and automatic axis ticks", () => {
    const legacy = JSON.parse(JSON.stringify(createDemoDashboard()));
    legacy.schemaVersion = 12;
    legacy.widgets.forEach((widget: Record<string, unknown>) => {
      delete widget.showKpiLabel; delete widget.showKpiMeta;
      delete widget.showXTicks; delete widget.showYTicks; delete widget.xTickCount; delete widget.yTickCount;
      delete widget.xAxisMin; delete widget.xAxisMax; delete widget.yAxisMin; delete widget.yAxisMax;
    });

    const migrated = importDashboard(JSON.stringify(legacy));

    expect(migrated.schemaVersion).toBe(14);
    expect(migrated.widgets.every(widget => !widget.showKpiLabel && !widget.showKpiMeta)).toBe(true);
    expect(migrated.widgets.every(widget => widget.showXTicks && widget.showYTicks && widget.xTickCount === null && widget.yTickCount === null)).toBe(true);
    expect(migrated.widgets.every(widget => widget.xAxisMin === null && widget.xAxisMax === null && widget.yAxisMin === null && widget.yAxisMax === null)).toBe(true);
  });

  it("validates KPI details and Cartesian axis settings", () => {
    const dashboard = createDemoDashboard();
    dashboard.widgets[0]!.showKpiLabel = true;
    dashboard.widgets[0]!.showKpiMeta = true;
    dashboard.widgets[3]!.xTickCount = 9;
    dashboard.widgets[3]!.yTickCount = 5;
    dashboard.widgets[3]!.yAxisMin = 10;
    dashboard.widgets[3]!.yAxisMax = 100_000;
    expect(validateDashboard(dashboard).widgets[3]).toMatchObject({ xTickCount: 9, yTickCount: 5, yAxisMin: 10, yAxisMax: 100_000 });

    const invalidTicks = JSON.parse(JSON.stringify(dashboard));
    invalidTicks.widgets[3].xTickCount = 1;
    expect(() => validateDashboard(invalidTicks)).toThrow(/tacche X/);
    const invalidRange = JSON.parse(JSON.stringify(dashboard));
    invalidRange.widgets[3].yAxisMin = 100;
    invalidRange.widgets[3].yAxisMax = 10;
    expect(() => validateDashboard(invalidRange)).toThrow(/minimo dell’asse Y/);
  });

  it("migrates Reports v13 with automatic editable axis labels", () => {
    const legacy = JSON.parse(JSON.stringify(createDemoDashboard()));
    legacy.schemaVersion = 13;
    legacy.widgets.forEach((widget: Record<string, unknown>) => { delete widget.xAxisLabel; delete widget.yAxisLabel; });

    const migrated = importDashboard(JSON.stringify(legacy));

    expect(migrated.schemaVersion).toBe(14);
    expect(migrated.widgets.every(widget => widget.xAxisLabel === "" && widget.yAxisLabel === "")).toBe(true);
  });

  it("validates Time Series animation configuration and its date axis", () => {
    const dashboard = createDemoDashboard();
    dashboard.widgets[0]!.animation = {
      type: "timeSeries", chartType: "area", dimension: "field-1", timeGrain: "month",
      valueMode: "cumulative", showTrendLine: true, highlightMaximum: true,
    };
    expect(validateDashboard(dashboard).widgets[0]!.animation).toEqual(dashboard.widgets[0]!.animation);

    const invalidAxis = JSON.parse(JSON.stringify(dashboard));
    invalidAxis.widgets[0].animation.dimension = "field-2";
    expect(() => validateDashboard(invalidAxis)).toThrow(/campo data/);
    const invalidChart = JSON.parse(JSON.stringify(dashboard));
    invalidChart.widgets[0].animation.chartType = "pie";
    expect(() => validateDashboard(invalidChart)).toThrow(/grafico animazione/);
  });

  it("validates Bar Chart Race fields, aggregation and step duration", () => {
    const dashboard = createDemoDashboard();
    dashboard.widgets[0]!.animation = {
      type: "barRace", dateDimension: "field-1", groupDimension: "field-2", measure: "field-3",
      aggregation: "avg", timeGrain: "month", valueMode: "cumulative", orientation: "vertical", sort: "desc", stepDurationMs: 1750,
    };
    expect(validateDashboard(dashboard).widgets[0]!.animation).toEqual(dashboard.widgets[0]!.animation);

    const invalidMeasure = JSON.parse(JSON.stringify(dashboard));
    invalidMeasure.widgets[0].animation.measure = "field-2";
    expect(() => validateDashboard(invalidMeasure)).toThrow(/misura numerica/);
    const invalidDuration = JSON.parse(JSON.stringify(dashboard));
    invalidDuration.widgets[0].animation.stepDurationMs = 50;
    expect(() => validateDashboard(invalidDuration)).toThrow(/durata di ogni step/);
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
    const invalidMapBackground = JSON.parse(JSON.stringify(createDemoDashboard()));
    invalidMapBackground.widgets[0].mapBackground = "transparent";
    expect(() => validateDashboard(invalidMapBackground)).toThrow(/colore sfondo mappa/);
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
