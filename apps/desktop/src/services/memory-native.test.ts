import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyMemoryRecords, loadMemoryPreview, releaseMemoryPreview, selectAndScanMemorySources } from "./memory-native";
import type { MemoryRecord } from "./memory-types";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const record = (kind: MemoryRecord["kind"]): MemoryRecord => ({
  id: "record", path: "/missing/demo.bin", name: "demo.bin", kind, mimeType: "application/octet-stream", description: "", tags: [], categoryIds: [], embedding: [], embeddingVersion: "test", createdAt: "2026-01-01", updatedAt: "2026-01-01"
});

describe("Memory native bridge", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());
  it("usa il servizio filesystem locale e conserva il percorso assoluto del computer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ entries: [{ path: "/Users/demo/cover.png", name: "cover.png" }], skippedCount: 0, truncated: false, errors: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(selectAndScanMemorySources("files")).resolves.toMatchObject({ entries: [{ path: "/Users/demo/cover.png" }] });
    expect(fetchMock).toHaveBeenCalledWith("/__mlsm/memory/select", expect.objectContaining({ method: "POST" }));
  });
  it("carica l’anteprima dal percorso locale anche prima della catalogazione", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Blob(["video"]), { status: 200, headers: { "Content-Type": "video/mp4" } })));
    const createObjectURL = vi.fn().mockReturnValue("blob:local-preview");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    await expect(loadMemoryPreview({ ...record("video"), path: "/Users/demo/video.mp4", mimeType: "video/mp4" })).resolves.toMatchObject({ url: "blob:local-preview" });
    expect(createObjectURL).toHaveBeenCalledOnce();
  });
  it("copia un risultato in una cartella scelta dal servizio locale", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ sourcePath: "/Users/demo/video.mp4", destinationPath: "/Users/demo/Export/video.mp4", copiedFiles: 1, copiedBytes: 5 }], failures: [], copiedFiles: 1, copiedBytes: 5 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(copyMemoryRecords([{ ...record("video"), path: "/Users/demo/video.mp4" }])).resolves.toMatchObject({ copiedFiles: 1 });
    expect(fetchMock).toHaveBeenCalledWith("/__mlsm/memory/copy", expect.objectContaining({ body: JSON.stringify({ sourcePaths: ["/Users/demo/video.mp4"] }) }));
  });
  it("non tenta anteprime binarie per cartelle e archivi", async () => {
    await expect(loadMemoryPreview(record("folder"))).resolves.toMatchObject({ unavailableCode: "unsupported" });
  });
  it("revoca soltanto gli URL temporanei", () => {
    const revoke = vi.fn();
    vi.stubGlobal("URL", { revokeObjectURL: revoke });
    releaseMemoryPreview({ kind: "image", mimeType: "image/png", url: "blob:preview" });
    releaseMemoryPreview({ kind: "image", mimeType: "image/png", url: "https://example.test/image.png" });
    expect(revoke).toHaveBeenCalledOnce();
  });
});
