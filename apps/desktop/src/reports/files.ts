import { invoke, isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { ReportDashboard } from "./types";
import { exportDashboard } from "./storage";

export async function downloadDashboard(dashboard: ReportDashboard): Promise<boolean> {
  const content = exportDashboard(dashboard);
  const filename = `${dashboard.name.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0,80) || "dashboard"}.mlsm-report.json`;
  if (isTauri()) {
    const path = await save({ defaultPath: filename, filters: [{ name: "MLSM Reports JSON", extensions: ["json"] }] });
    if (!path) return false;
    await invoke("write_project", { path, content });
    return true;
  }
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
