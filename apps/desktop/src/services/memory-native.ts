import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { MemoryAssetKind, MemoryRecord } from "./memory-types";
import { inferMemoryAssetKind } from "./memory-engine";

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

const browserFiles = new Map<string, File>();

function browserFilePath(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath?.replace(/^\/+/, "");
  return relative ? `browser://${relative}` : `browser://${file.name}`;
}

function browserEntry(file: File): MemorySourceEntry {
  const path = browserFilePath(file); const slash = path.lastIndexOf("/"); const kind = inferMemoryAssetKind(file.name, file.type);
  const extension = file.name.includes(".") ? file.name.split(".").at(-1)?.toLocaleLowerCase() : undefined;
  browserFiles.set(path, file);
  return {
    path, parentPath: slash > "browser://".length ? path.slice(0, slash) : "browser://", name: file.name,
    ...(extension ? { extension } : {}),
    entryType: "file", mediaKind: kind, mimeType: file.type || "application/octet-stream", sizeBytes: file.size,
    modifiedAtMs: file.lastModified, isHidden: file.name.startsWith("."), previewSupported: true
  };
}

function chooseBrowserFiles(directory: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input"); input.type = "file"; input.multiple = true;
    if (directory) input.setAttribute("webkitdirectory", "");
    let settled = false; const finish = (files: File[]) => { if (settled) return; settled = true; resolve(files); };
    input.onchange = () => finish([...input.files ?? []]); input.addEventListener("cancel", () => finish([]), { once: true }); input.click();
  });
}

async function selectedNativePaths(directory: boolean): Promise<string[]> {
  const selected = await open({ multiple: !directory, directory });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export async function selectAndScanMemorySources(mode: "files" | "folder", maxEntries = 20_000): Promise<MemoryScanResult | null> {
  const directory = mode === "folder";
  if (!isTauri()) {
    const files = await chooseBrowserFiles(directory); if (!files.length) return null;
    const entries = files.map(browserEntry);
    if (directory) {
      const first = entries[0]?.path.replace(/^browser:\/\//, "").split("/")[0];
      if (first) entries.unshift({ path: `browser://${first}`, parentPath: "browser://", name: first, entryType: "folder", mediaKind: "folder", mimeType: "inode/directory", sizeBytes: 0, isHidden: false, previewSupported: false });
    }
    return { entries, skippedCount: 0, truncated: false, errors: [] };
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
    const file = browserFiles.get(record.path);
    if (!file) return { kind: record.kind, mimeType: record.mimeType, unavailableCode: "browser-relink" };
    if (record.kind === "text") return { kind: record.kind, mimeType: record.mimeType, text: (await file.text()).slice(0, 256 * 1024), truncated: file.size > 256 * 1024 };
    return { kind: record.kind, mimeType: record.mimeType, url: URL.createObjectURL(file) };
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

async function availableBrowserDestinationName(destination: FileSystemDirectoryHandle, name: string): Promise<string> {
  const dot = name.lastIndexOf("."); const stem = dot > 0 ? name.slice(0, dot) : name; const extension = dot > 0 ? name.slice(dot) : "";
  for (let index = 1; index <= 10_000; index += 1) {
    const candidate = index === 1 ? name : `${stem} (${index})${extension}`;
    try { await destination.getFileHandle(candidate); } catch (error) { if (error instanceof DOMException && error.name === "NotFoundError") return candidate; throw error; }
  }
  throw new Error(`Impossibile trovare un nome disponibile per ${name}.`);
}

export async function copyMemoryRecords(records: readonly MemoryRecord[]): Promise<MemoryCopyResult | null> {
  if (!records.length) return null;
  if (isTauri()) {
    const destination = await open({ multiple: false, directory: true, title: "Scegli la cartella di destinazione" });
    if (typeof destination !== "string") return null;
    return invoke<MemoryCopyResult>("memory_copy_entries", { sourcePaths: records.map((record) => record.path), destinationDirectory: destination });
  }
  if (!window.showDirectoryPicker) throw new Error("La copia in un’altra cartella richiede la build desktop o un browser compatibile con File System Access.");
  const destination = await window.showDirectoryPicker({ mode: "readwrite" }); const failures: MemoryCopyResult["failures"] = []; const items: MemoryCopyResult["items"] = [];
  for (const record of records) {
    const file = browserFiles.get(record.path);
    if (!file) { failures.push({ sourcePath: record.path, message: "File non più accessibile nella sessione browser." }); continue; }
    const destinationName = await availableBrowserDestinationName(destination, record.name); const handle = await destination.getFileHandle(destinationName, { create: true }); const writable = await handle.createWritable(); await writable.write(file); await writable.close();
    items.push({ sourcePath: record.path, destinationPath: destinationName, copiedFiles: 1, copiedBytes: file.size });
  }
  return { items, failures, copiedFiles: items.length, copiedBytes: items.reduce((total, item) => total + item.copiedBytes, 0) };
}
