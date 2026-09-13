import { invoke, isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { ReportDashboard } from "./types";
import { exportDashboard } from "./storage";

function fileStem(dashboard: ReportDashboard): string {
  return dashboard.name.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 80) || "dashboard";
}

async function downloadContent(content: string, filename: string, mimeType: string, filterName: string, extension: string): Promise<boolean> {
  if (isTauri()) {
    const path = await save({ defaultPath: filename, filters: [{ name: filterName, extensions: [extension] }] });
    if (!path) return false;
    await invoke("write_project", { path, content });
    return true;
  }
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export async function downloadDashboard(dashboard: ReportDashboard): Promise<boolean> {
  const content = exportDashboard(dashboard);
  return downloadContent(content, `${fileStem(dashboard)}.mlsm-report.json`, "application/json", "MLSM Reports JSON", "json");
}

export function dashboardEmbedCode(dashboard: ReportDashboard): string {
  const filename = `${fileStem(dashboard)}.html`;
  const title = dashboard.name.replace(/["<>]/g, "");
  return `<iframe src="./${filename}" title="${title}" loading="lazy" style="width:100%;min-height:720px;border:0" allowfullscreen></iframe>`;
}

export async function downloadDashboardHtml(dashboard: ReportDashboard): Promise<boolean> {
  const { createDashboardHtml } = await import("./html-export");
  return downloadContent(createDashboardHtml(dashboard), `${fileStem(dashboard)}.html`, "text/html;charset=utf-8", "Dashboard HTML", "html");
}
