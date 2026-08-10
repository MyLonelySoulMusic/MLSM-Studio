import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { MemoryAssetKind, MemoryRecord } from "./memory-types";

export interface MemorySourceEntry {
  path: string;
  parentPath?: string;
  name: string;
  extension?: string;
  entryType: "file" | "folder";
  mediaKind: MemoryAssetKind;
  mimeType: string;
  sizeBytes: number;
  modifiedAtMs?: number;
  createdAtMs?: number;
  isHidden: boolean;
  previewSupported: boolean;
}

export interface MemoryScanResult {
  entries: MemorySourceEntry[];
  skippedCount: number;
  truncated: boolean;
  errors: string[];
}

export interface MemoryPreview {
  kind: MemoryAssetKind;
  mimeType: string;
  url?: string;
  text?: string;
  truncated?: boolean;
  unavailableCode?: "unsupported" | "browser-relink";
  unavailableReason?: string;
}

export interface MemoryCopyResult {
  items: Array<{ sourcePath: string; destinationPath: string; copiedFiles: number; copiedBytes: number }>;
  failures: Array<{ sourcePath: string; message: string }>;
  copiedFiles: number;
  copiedBytes: number;
}

const localMemoryApi = "/__mlsm/memory";

async function localMemoryRequest<T>(route: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${localMemoryApi}${route}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? `Servizio filesystem locale non disponibile (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

async function selectedNativePaths(directory: boolean): Promise<string[]> {
  const selected = await open({ multiple: !directory, directory });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export async function selectAndScanMemorySources(mode: "files" | "folder", maxEntries = 20_000): Promise<MemoryScanResult | null> {
  const directory = mode === "folder";
  if (!isTauri()) {
    const selected = await localMemoryRequest<MemoryScanResult | { cancelled: true }>("/select", { method: "POST", body: JSON.stringify({ mode, maxEntries }) });
    return "cancelled" in selected ? null : selected;
  }
  const paths = await selectedNativePaths(directory); if (!paths.length) return null;
  return invoke<MemoryScanResult>("memory_scan_paths", { paths, options: { includeHidden: false, maxEntries, maxDepth: 32 } });
}

async function previewBytes(path: string): Promise<ArrayBuffer> {
  const bytes = await invoke<ArrayBuffer | number[]>("memory_read_preview", { path, maxBytes: 128 * 1024 * 1024 });
  return bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer;
}

export async function loadMemoryPreview(record: MemoryRecord): Promise<MemoryPreview> {
  if (record.kind === "folder" || record.kind === "archive" || record.kind === "other") return { kind: record.kind, mimeType: record.mimeType, unavailableCode: "unsupported" };
  if (!isTauri()) {
    if (record.kind === "text") {
      const value = await localMemoryRequest<{ text: string; truncated: boolean }>("/text-preview", { method: "POST", body: JSON.stringify({ path: record.path, maxBytes: 256 * 1024 }) });
      return { kind: record.kind, mimeType: record.mimeType, ...value };
    }
    const response = await fetch(`${localMemoryApi}/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: record.path }) });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error ?? "Anteprima locale non disponibile.");
    }
    return { kind: record.kind, mimeType: record.mimeType, url: URL.createObjectURL(await response.blob()) };
  }
  if (record.kind === "text") {
    const preview = await invoke<{ text: string; truncated: boolean }>("memory_read_text_preview", { path: record.path, maxBytes: 256 * 1024 });
    return { kind: record.kind, mimeType: record.mimeType, text: preview.text, truncated: preview.truncated };
  }
  const bytes = await previewBytes(record.path);
  return { kind: record.kind, mimeType: record.mimeType, url: URL.createObjectURL(new Blob([bytes], { type: record.mimeType })) };
}

export function releaseMemoryPreview(preview: MemoryPreview | null): void {
  if (preview?.url?.startsWith("blob:")) URL.revokeObjectURL(preview.url);
}

export async function copyMemoryRecords(records: readonly MemoryRecord[]): Promise<MemoryCopyResult | null> {
  if (!records.length) return null;
  if (isTauri()) {
    const destination = await open({ multiple: false, directory: true, title: "Scegli la cartella di destinazione" });
    if (typeof destination !== "string") return null;
    return invoke<MemoryCopyResult>("memory_copy_entries", { sourcePaths: records.map((record) => record.path), destinationDirectory: destination });
  }
  const result = await localMemoryRequest<MemoryCopyResult | { cancelled: true }>("/copy", { method: "POST", body: JSON.stringify({ sourcePaths: records.map((record) => record.path) }) });
  return "cancelled" in result ? null : result;
}
