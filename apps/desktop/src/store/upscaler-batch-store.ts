import { create } from "zustand";
import type { RhythmBallProject } from "@rbs/project-schema";
import { createUpscalerBatchItems, resolveUpscalerBatchTarget, type UpscalerBatchImportFailure, type UpscalerBatchItem, type UpscalerBatchItemStatus, type UpscalerBatchSettingsSnapshot } from "../services/upscaler-batch";
import { upscalerImageFileName } from "../services/upscaler-image-exporter";

type UpscalerSettings = RhythmBallProject["animation"]["upscaler"];

interface OperationOwnerBase {
  readonly projectEpoch: number;
  readonly id: number;
}

export interface UpscalerImportOwner extends OperationOwnerBase {
  readonly kind: "import";
  readonly controller: AbortController;
}

export interface UpscalerBatchOwner extends OperationOwnerBase {
  readonly kind: "batch";
  readonly controller: AbortController;
}

export interface UpscalerSingleOperationOwner extends OperationOwnerBase {
  readonly kind: "single";
}

interface UpscalerBatchState {
  items: UpscalerBatchItem[];
  /** Runtime-only gallery source. It is intentionally independent from queue selection. */
  previewItemId: string | null;
  /** Monotonic boundary shared by every runtime-only Upscaler owner. */
  projectEpoch: number;
  running: boolean;
  importing: boolean;
  singleOperations: number;
  singleOperationOwners: UpscalerSingleOperationOwner[];
  importFailures: UpscalerBatchImportFailure[];
  controller: AbortController | null;
  batchOwner: UpscalerBatchOwner | null;
  importOwner: UpscalerImportOwner | null;
  outputNotice: string | null;
  beginImport: (supersede?: boolean) => UpscalerImportOwner | null;
  isImportActive: (owner: UpscalerImportOwner) => boolean;
  endImport: (owner: UpscalerImportOwner) => boolean;
  addFiles: (files: readonly File[], settings: UpscalerSettings, owner?: UpscalerImportOwner) => Promise<string[]>;
  setPreviewItem: (id: string | null) => void;
  removeItem: (id: string) => void;
  setSelected: (id: string, selected: boolean) => void;
  updateItem: (id: string, patch: Partial<Pick<UpscalerBatchItem, "status" | "progress" | "error" | "outputName" | "selected" | "target">>) => void;
  updateBatchItem: (owner: UpscalerBatchOwner, id: string, patch: Partial<Pick<UpscalerBatchItem, "status" | "progress" | "error" | "outputName" | "selected" | "target">>) => boolean;
  startBatch: (settings: UpscalerBatchSettingsSnapshot) => UpscalerBatchOwner | null;
  isBatchOwnerActive: (owner: UpscalerBatchOwner) => boolean;
  finishBatch: (owner: UpscalerBatchOwner) => boolean;
  cancelBatch: (owner: UpscalerBatchOwner) => boolean;
  beginSingleOperation: () => UpscalerSingleOperationOwner | null;
  endSingleOperation: (owner: UpscalerSingleOperationOwner) => boolean;
  retryFailed: () => void;
  syncSettings: (settings: UpscalerSettings) => void;
  clear: () => void;
  resetForProjectReplacement: (alreadyRevokedUrls?: ReadonlySet<string>) => void;
  setOutputNotice: (notice: string | null) => void;
}

function revoke(item: UpscalerBatchItem, alreadyRevokedUrls: ReadonlySet<string> = new Set()): void {
  if (typeof URL.revokeObjectURL !== "function") return;
  const ownedUrls = new Set([item.url, item.thumbnailUrl].filter((url): url is string => Boolean(url?.startsWith("blob:"))));
  for (const url of ownedUrls) if (!alreadyRevokedUrls.has(url)) URL.revokeObjectURL(url);
}

function abortError(): DOMException {
  return new DOMException("Operazione annullata.", "AbortError");
}

let operationId = 0;

export const useUpscalerBatchStore = create<UpscalerBatchState>((set, get) => ({
  items: [], previewItemId: null, projectEpoch: 0, running: false, importing: false, singleOperations: 0, singleOperationOwners: [], importFailures: [], controller: null, batchOwner: null, importOwner: null, outputNotice: null,
  beginImport: (supersede = false) => {
    const state = get();
    if (state.running || (state.importing && !supersede)) return null;
    state.importOwner?.controller.abort();
    const owner: UpscalerImportOwner = { kind: "import", projectEpoch: state.projectEpoch, id: ++operationId, controller: new AbortController() };
    set({ importing: true, importFailures: [], importOwner: owner });
    return owner;
  },
  isImportActive: (owner) => {
    const state = get();
    return state.importing && state.projectEpoch === owner.projectEpoch && state.importOwner === owner && !owner.controller.signal.aborted;
  },
  endImport: (owner) => {
    if (!get().isImportActive(owner)) return false;
    set({ importing: false, importOwner: null });
    return true;
  },
  addFiles: async (files, settings, activeOwner) => {
    if (!files.length) throw new Error("Nessun file da importare.");
    const ownsImport = activeOwner === undefined;
    const owner = activeOwner ?? get().beginImport();
    if (!owner || !get().isImportActive(owner)) throw new Error("Importazione batch non disponibile.");
    try {
      const result = await createUpscalerBatchItems(files, settings, {
        signal: owner.controller.signal,
        isGenerationCurrent: () => get().isImportActive(owner)
      });
      if (!get().isImportActive(owner)) {
        for (const item of result.items) revoke(item);
        throw abortError();
      }
      set((state) => ({ items: [...state.items, ...result.items], importFailures: result.failures, outputNotice: null }));
      return result.items.map((item) => item.id);
    } finally {
      if (ownsImport) get().endImport(owner);
    }
  },
  setPreviewItem: (id) => set((state) => ({ previewItemId: id === null || state.items.some((item) => item.id === id) ? id : null })),
  removeItem: (id) => {
    if (get().running || get().importing) return;
    const item = get().items.find((candidate) => candidate.id === id); if (!item) return;
    revoke(item); set((state) => {
      const index = state.items.findIndex((candidate) => candidate.id === id);
      const items = state.items.filter((candidate) => candidate.id !== id);
      // Keep the gallery useful after removing its current card. Prefer the
      // next card at the same position, then fall back to the previous card.
      const previewItemId = state.previewItemId !== id
        ? state.previewItemId
        : items[Math.min(Math.max(index, 0), Math.max(0, items.length - 1))]?.id ?? null;
      return { items, previewItemId };
    });
  },
  setSelected: (id, selected) => { if (!get().running && !get().importing) set((state) => ({ items: state.items.map((item) => item.id === id ? { ...item, selected } : item) })); },
  updateItem: (id, patch) => set((state) => ({ items: state.items.map((item) => item.id === id ? { ...item, ...patch } : item) })),
  updateBatchItem: (owner, id, patch) => {
    if (!get().isBatchOwnerActive(owner)) return false;
    set((state) => ({ items: state.items.map((item) => item.id === id ? { ...item, ...patch } : item) }));
    return true;
  },
  startBatch: (settings) => {
    void settings;
    const state = get();
    if (state.running || state.importing || state.singleOperations > 0 || !state.items.some((item) => item.selected && item.status !== "done")) return null;
    const owner: UpscalerBatchOwner = { kind: "batch", projectEpoch: state.projectEpoch, id: ++operationId, controller: new AbortController() };
    set({ running: true, controller: owner.controller, batchOwner: owner });
    return owner;
  },
  isBatchOwnerActive: (owner) => {
    const state = get();
    return state.running && state.projectEpoch === owner.projectEpoch && state.batchOwner === owner && state.controller === owner.controller;
  },
  finishBatch: (owner) => {
    if (!get().isBatchOwnerActive(owner)) return false;
    set({ running: false, controller: null, batchOwner: null });
    return true;
  },
  cancelBatch: (owner) => {
    if (!get().isBatchOwnerActive(owner)) return false;
    owner.controller.abort();
    return true;
  },
  beginSingleOperation: () => {
    const state = get();
    if (state.running) return null;
    const owner: UpscalerSingleOperationOwner = { kind: "single", projectEpoch: state.projectEpoch, id: ++operationId };
    set((current) => ({ singleOperationOwners: [...current.singleOperationOwners, owner], singleOperations: current.singleOperations + 1 }));
    return owner;
  },
  endSingleOperation: (owner) => {
    const state = get();
    if (owner.projectEpoch !== state.projectEpoch || !state.singleOperationOwners.includes(owner)) return false;
    set((current) => {
      const singleOperationOwners = current.singleOperationOwners.filter((candidate) => candidate !== owner);
      return { singleOperationOwners, singleOperations: singleOperationOwners.length };
    });
    return true;
  },
  retryFailed: () => { if (!get().running && !get().importing) set((state) => ({ items: state.items.map((item) => item.status === "error" || item.status === "cancelled" ? { ...item, status: "queued" as UpscalerBatchItemStatus, progress: 0, error: null, selected: true } : item) })); },
  syncSettings: (settings) => {
    if (get().running) return;
    set((state) => ({ items: state.items.map((item) => {
      const target = resolveUpscalerBatchTarget(item.sourceWidth, item.sourceHeight, settings);
      return { ...item, target, outputName: upscalerImageFileName(item.name, target.width, target.height) };
    }) }));
  },
  clear: () => {
    if (get().running || get().importing) return;
    for (const item of get().items) revoke(item);
    set({ items: [], previewItemId: null, importFailures: [], outputNotice: null });
  },
  resetForProjectReplacement: (alreadyRevokedUrls = new Set<string>()) => {
    // Project replacement is the hard ownership boundary. Abort active work,
    // invalidate every token by advancing the epoch, then release runtime URLs.
    const state = get();
    state.batchOwner?.controller.abort();
    state.importOwner?.controller.abort();
    // Preserve compatibility with states injected by tests/devtools without an owner.
    if (!state.batchOwner) state.controller?.abort();
    for (const item of state.items) revoke(item, alreadyRevokedUrls);
    set({
      items: [], previewItemId: null, projectEpoch: state.projectEpoch + 1,
      running: false, importing: false, singleOperations: 0, singleOperationOwners: [],
      importFailures: [], controller: null, batchOwner: null, importOwner: null, outputNotice: null
    });
  },
  setOutputNotice: (outputNotice) => set({ outputNotice })
}));

export const upscalerBatchStore = useUpscalerBatchStore;
