import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadMemoryPreview, releaseMemoryPreview } from "./memory-native";
import type { MemoryRecord } from "./memory-types";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const record = (kind: MemoryRecord["kind"]): MemoryRecord => ({
  id: "record", path: "/missing/demo.bin", name: "demo.bin", kind, mimeType: "application/octet-stream", description: "", tags: [], categoryIds: [], embedding: [], embeddingVersion: "test", createdAt: "2026-01-01", updatedAt: "2026-01-01"
});

describe("Memory native bridge", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());
  it("spiega quando un file browser persistito non è più riapribile", async () => {
    await expect(loadMemoryPreview(record("video"))).resolves.toMatchObject({ kind: "video", unavailableCode: "browser-relink" });
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
