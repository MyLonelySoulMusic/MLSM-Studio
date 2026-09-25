import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoDashboard } from "./data";
import { dashboardEmbedCode, downloadDashboard } from "./files";

const nativeMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: nativeMocks.invoke, isTauri: nativeMocks.isTauri }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: nativeMocks.save }));

describe("Reports JSON file export", () => {
  beforeEach(() => {
    nativeMocks.isTauri.mockReturnValue(false);
    nativeMocks.invoke.mockResolvedValue(undefined);
    nativeMocks.save.mockResolvedValue(null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("downloads a portable JSON with a safe filename in the browser", async () => {
    const dashboard = createDemoDashboard();
    dashboard.name = "Report MLSM 2026";
    const createUrl = vi.fn(() => "blob:report-json");
    const revokeUrl = vi.fn();
    let download = "";
    vi.stubGlobal("URL", { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { download = this.download; });

    await expect(downloadDashboard(dashboard)).resolves.toBe(true);
    expect(download).toBe("Report-MLSM-2026.mlsm-report.json");
    expect(createUrl).toHaveBeenCalledWith(expect.any(Blob));
    vi.advanceTimersByTime(1000);
    expect(revokeUrl).toHaveBeenCalledWith("blob:report-json");
  });

  it("uses the native save dialog and preserves cancellation", async () => {
    const dashboard = createDemoDashboard();
    dashboard.name = "Report nativo";
    nativeMocks.isTauri.mockReturnValue(true);
    nativeMocks.save.mockResolvedValueOnce(null);
    await expect(downloadDashboard(dashboard)).resolves.toBe(false);
    expect(nativeMocks.invoke).not.toHaveBeenCalled();

    nativeMocks.save.mockResolvedValueOnce("/tmp/report.mlsm-report.json");
    await expect(downloadDashboard(dashboard)).resolves.toBe(true);
    expect(nativeMocks.invoke).toHaveBeenCalledWith("write_project", {
      path: "/tmp/report.mlsm-report.json",
      content: expect.stringContaining('"schemaVersion": 16'),
    });
  });

  it("creates a portable iframe snippet with a safe local filename", () => {
    const dashboard = createDemoDashboard();
    dashboard.name = 'Vendite Europa <2026> "Q1"';
    expect(dashboardEmbedCode(dashboard)).toBe('<iframe src="./Vendite-Europa-2026-Q1-.html" title="Vendite Europa 2026 Q1" loading="lazy" style="width:100%;min-height:720px;border:0" allowfullscreen></iframe>');
  });
});
