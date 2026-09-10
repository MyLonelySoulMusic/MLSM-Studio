import type { AppState, LibraryExportDocument } from "./types";
import { ensureAutoPostService } from "./runtime";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  await ensureAutoPostService();
  const base = "__TAURI_INTERNALS__" in window ? "http://127.0.0.1:1430/api" : "/autopost/api";
  const response = await fetch(`${base}${path.replace(/^\/api/, "")}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload as T;
}
export const api = {
  state: () => request<AppState>("/api/state"),
  saveBlog: (value: { id?: string; name?: string; siteUrl: string; username: string; password: string; defaultStatus: "publish" | "draft" }) => request<AppState>("/api/blogs", { method: "POST", body: JSON.stringify(value) }),
  testBlog: (value: { id?: string; siteUrl?: string; username?: string; password?: string }) => request<{ ok: true; latencyMs: number; name: string; roles: string[] }>("/api/blogs/test", { method: "POST", body: JSON.stringify(value) }),
  removeBlog: (id: string) => request<AppState>(`/api/blogs/${encodeURIComponent(id)}/remove`, { method: "POST", body: "{}" }),
  refreshBlogCategories: (id: string) => request<AppState>(`/api/blogs/${encodeURIComponent(id)}/categories`, { method: "POST", body: "{}" }),
  import: (document: unknown, blogIdsByArticle: string[][], categoriesByArticle: Array<Record<string, number[]>>) => request<{ imported: number; state: AppState }>("/api/import", { method: "POST", body: JSON.stringify({ document, blogIdsByArticle, categoriesByArticle }) }),
  addLibraryItem: (url: string, priority: number) => request<AppState>("/api/library/item", { method: "POST", body: JSON.stringify({ url, priority }) }),
  updateLibraryItem: (key: string, priority: number) => request<AppState>(`/api/library/${encodeURIComponent(key)}/update`, { method: "POST", body: JSON.stringify({ priority }) }),
  removeLibraryItem: (key: string) => request<AppState>(`/api/library/${encodeURIComponent(key)}/remove`, { method: "POST", body: "{}" }),
  librarySettings: (tracksPerPost: number, playlistEveryTracks: number) => request<AppState>("/api/library/settings", { method: "POST", body: JSON.stringify({ tracksPerPost, playlistEveryTracks }) }),
  exportLibrary: () => request<LibraryExportDocument>("/api/library/export"),
  importLibrary: (document: unknown, mode: "append" | "replace") => request<{ imported: number; duplicates: number; mode: "append" | "replace"; state: AppState }>("/api/library/import", { method: "POST", body: JSON.stringify({ document, mode }) }),
  schedule: (enabled: boolean, intervalMinutes: number, postsPerRun: number, publishNow = false) => request<AppState>("/api/schedule", { method: "POST", body: JSON.stringify({ enabled, intervalMinutes, postsPerRun, publishNow }) }),
  publishNext: () => request<{ state: AppState }>("/api/publish-next", { method: "POST", body: "{}" }),
  queueAction: (id: string, action: "retry" | "remove") => request<AppState>(`/api/queue/${encodeURIComponent(id)}/${action}`, { method: "POST", body: "{}" }),
  clearQueue: () => request<AppState>("/api/queue/clear", { method: "POST", body: "{}" }),
  clearHistory: () => request<AppState>("/api/clear-history", { method: "POST", body: "{}" }),
};
