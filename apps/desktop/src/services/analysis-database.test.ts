import { afterEach, describe, expect, it, vi } from "vitest";
import { ANALYSIS_DATABASE_NAME, ANALYSIS_STORE_NAME, openAnalysisDatabase, SONG_PLAYER_ANALYSIS_STORE_NAME } from "./analysis-database";

const originalIndexedDb = globalThis.indexedDB;

function database(version: number, stores: string[]) {
  const names = new Set(stores);
  return {
    version,
    objectStoreNames: { contains: (name: string) => names.has(name) },
    createObjectStore: vi.fn((name: string) => { names.add(name); return {}; }),
    close: vi.fn(),
  } as unknown as IDBDatabase;
}

function successfulRequest(result: IDBDatabase, upgrade = false): IDBOpenDBRequest {
  const request = { result } as IDBOpenDBRequest;
  queueMicrotask(() => {
    if (upgrade) request.onupgradeneeded?.(new Event("upgradeneeded") as IDBVersionChangeEvent);
    request.onsuccess?.(new Event("success"));
  });
  return request;
}

afterEach(() => {
  if (originalIndexedDb === undefined) Reflect.deleteProperty(globalThis, "indexedDB");
  else Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: originalIndexedDb });
});

describe("analysis database", () => {
  it("adotta una cache già alla versione 2 senza richiedere il downgrade alla versione 1", async () => {
    const existing = database(2, [ANALYSIS_STORE_NAME, SONG_PLAYER_ANALYSIS_STORE_NAME]);
    const open = vi.fn(() => successfulRequest(existing));
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open } });

    await expect(openAnalysisDatabase()).resolves.toBe(existing);
    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0]).toEqual([ANALYSIS_DATABASE_NAME]);
  });

  it("migra la versione corrente quando manca uno store condiviso", async () => {
    const existing = database(7, [ANALYSIS_STORE_NAME]);
    const upgraded = database(8, [ANALYSIS_STORE_NAME]);
    const open = vi.fn()
      .mockImplementationOnce(() => successfulRequest(existing))
      .mockImplementationOnce(() => successfulRequest(upgraded, true));
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open } });

    await expect(openAnalysisDatabase()).resolves.toBe(upgraded);
    expect(existing.close).toHaveBeenCalledOnce();
    expect(open.mock.calls).toEqual([[ANALYSIS_DATABASE_NAME], [ANALYSIS_DATABASE_NAME, 8]]);
    expect(upgraded.objectStoreNames.contains(SONG_PLAYER_ANALYSIS_STORE_NAME)).toBe(true);
  });
});
