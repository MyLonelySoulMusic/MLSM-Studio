import { IDBFactory, IDBObjectStore as FakeIDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearQueue,
  createTrackId,
  favoriteQueue,
  loadQueue,
  moveTrack,
  nextTrackId,
  parseProviderUrl,
  removeFavorite,
  removeTrack,
  resetStreamerQueueForTests,
  restoreFavorite,
  saveQueue,
  STREAMER_DATABASE_NAME,
  STREAMER_FILE_STORE,
  type QueueState,
  type Track,
} from "./streamer-store";

function track(id: string, title = id): Track { return { id, provider: "local", title }; }
function state(overrides: Partial<QueueState> = {}): QueueState {
  return { tracks: [], currentId: null, autoAdvance: false, favorites: [], ...overrides };
}
async function readBlob(blob: Blob): Promise<string> {
  if (typeof blob.text === "function") return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}
async function storedFileIds(): Promise<string[]> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(STREAMER_DATABASE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STREAMER_FILE_STORE, "readonly");
    const request = transaction.objectStore(STREAMER_FILE_STORE).getAllKeys();
    request.onsuccess = () => resolve((request.result as IDBValidKey[]).map(String).sort());
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

describe("Streamer queue store", () => {
  beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); resetStreamerQueueForTests(); });
  afterEach(() => { vi.unstubAllGlobals(); resetStreamerQueueForTests(); });

  it("round-trips a local Blob and keeps a shared queue file after deleting its favourite", async () => {
    const shared = { ...track(createTrackId(), "Shared recording"), nativePath: "/Users/me/Music/shared.wav", file: new Blob(["audio bytes"], { type: "audio/wav" }) };
    const withFavourite = favoriteQueue(state({ tracks: [shared], currentId: shared.id }), "Night set", 10);
    await saveQueue(withFavourite);

    resetStreamerQueueForTests();
    const loaded = await loadQueue();
    expect(loaded.tracks[0]?.nativePath).toBe("/Users/me/Music/shared.wav");
    expect(loaded.tracks[0]?.file).toBeInstanceOf(Blob);
    expect(await readBlob(loaded.tracks[0]!.file!)).toBe("audio bytes");
    expect(loaded.favorites).toHaveLength(1);

    const withoutFavourite = removeFavorite(loaded, loaded.favorites[0]!.id);
    await saveQueue(withoutFavourite);
    resetStreamerQueueForTests();
    const reloaded = await loadQueue();
    expect(reloaded.favorites).toEqual([]);
    expect(reloaded.tracks[0]?.file).toBeInstanceOf(Blob);
    expect(await readBlob(reloaded.tracks[0]!.file!)).toBe("audio bytes");
  });

  it("restores a favourite as a queue without mutating the saved snapshot", () => {
    const first = track("first", "First");
    const second = track("second", "Second");
    const saved = favoriteQueue(state({ tracks: [first, second], currentId: second.id, autoAdvance: true }), "Two tracks", 12);
    const favorite = saved.favorites[0]!;
    const cleared = clearQueue(saved);
    expect(cleared).toMatchObject({ tracks: [], currentId: null, autoAdvance: true });
    const restored = restoreFavorite(cleared, favorite.id);
    expect(restored.tracks.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(restored.currentId).toBe(first.id);
    expect(restored.favorites[0]?.tracks.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(removeFavorite(restored, "missing")).toEqual(restored);
  });

  it("handles reorder, removal and automatic-advance edge cases without mutation", () => {
    const first = track("first");
    const second = track("second");
    const third = track("third");
    const initial = state({ tracks: [first, second, third], currentId: second.id, autoAdvance: true });
    expect(moveTrack(initial, second.id, 0).tracks.map((item) => item.id)).toEqual([second.id, first.id, third.id]);
    expect(initial.tracks.map((item) => item.id)).toEqual([first.id, second.id, third.id]);
    expect(removeTrack(initial, second.id).currentId).toBe(third.id);
    expect(removeTrack(state({ tracks: [first], currentId: first.id }), first.id).currentId).toBeNull();
    expect(nextTrackId(initial, false)).toBe(second.id);
    expect(nextTrackId(initial, true)).toBe(third.id);
    expect(nextTrackId(state({ tracks: [first, second], currentId: second.id, autoAdvance: true }), true)).toBeNull();
    expect(nextTrackId(state({ tracks: [first], currentId: first.id }), true)).toBeNull();
    expect(nextTrackId(state({ tracks: [first], currentId: null, autoAdvance: true }), true)).toBe(first.id);
  });

  it("accepts official provider links and rejects unsafe or unsupported URLs", () => {
    expect(parseProviderUrl("https://youtu.be/M7lc1UVf-VE")).toMatchObject({ provider: "youtube", kind: "track", id: "M7lc1UVf-VE", embedUrl: "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE" });
    expect(parseProviderUrl("https://www.youtube.com/watch?v=M7lc1UVf-VE&list=private")).toMatchObject({ provider: "youtube", id: "M7lc1UVf-VE" });
    expect(parseProviderUrl("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT")).toMatchObject({ provider: "spotify", kind: "track", id: "4cOdK2wGLETKBW3PvgPWqT", embedUrl: "https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT" });
    expect(parseProviderUrl("https://open.spotify.com/album/4cOdK2wGLETKBW3PvgPWqT")).toMatchObject({ provider: "spotify", kind: "album", id: "4cOdK2wGLETKBW3PvgPWqT", embedUrl: "https://open.spotify.com/embed/album/4cOdK2wGLETKBW3PvgPWqT" });
    expect(parseProviderUrl("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")).toMatchObject({ provider: "spotify", kind: "playlist", id: "37i9dQZF1DXcBWIGoYBM5M", embedUrl: "https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M" });
    expect(parseProviderUrl("https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT")).toMatchObject({ provider: "spotify", kind: "track", id: "4cOdK2wGLETKBW3PvgPWqT" });
    expect(parseProviderUrl("https://open.spotify.com/intl-it/playlist/37i9dQZF1DXcBWIGoYBM5M?si=private")).toMatchObject({ provider: "spotify", kind: "playlist", id: "37i9dQZF1DXcBWIGoYBM5M" });
    expect(parseProviderUrl("javascript:alert(1)")).toBeNull();
    expect(parseProviderUrl("http://youtu.be/M7lc1UVf-VE")).toBeNull();
    expect(parseProviderUrl("https://youtube.com.evil.test/watch?v=M7lc1UVf-VE")).toBeNull();
    expect(parseProviderUrl("https://open.spotify.com/show/37i9dQZF1DXcBWIGoYBM5M")).toBeNull();
    expect(parseProviderUrl("https://www.youtube.com/watch?v=not-an-id")).toBeNull();
  });

  it("surfaces IndexedDB write failures while retaining an in-memory session copy", async () => {
    const request = {} as IDBOpenDBRequest;
    vi.stubGlobal("indexedDB", { open: vi.fn(() => { queueMicrotask(() => request.onerror?.(new Event("error"))); return request; }) });
    const next = state({ tracks: [track("quota-track")] });
    await expect(saveQueue(next)).rejects.toThrow();

    vi.stubGlobal("indexedDB", undefined);
    expect(await loadQueue()).toEqual(next);
  });

  it("rejects IndexedDB read failures instead of replacing the queue with an empty fallback", async () => {
    const request = {} as IDBOpenDBRequest;
    vi.stubGlobal("indexedDB", { open: vi.fn(() => { queueMicrotask(() => request.onerror?.(new Event("error"))); return request; }) });
    await expect(loadQueue()).rejects.toThrow();
  });

  it("does not reread unchanged Blob objects and prunes only orphaned file records", async () => {
    const readSpy = typeof Blob.prototype.arrayBuffer === "function"
      ? vi.spyOn(Blob.prototype, "arrayBuffer")
      : vi.spyOn(FileReader.prototype, "readAsArrayBuffer");
    const putSpy = vi.spyOn(FakeIDBObjectStore.prototype, "put");
    const filePutCount = () => putSpy.mock.instances.filter((instance) => (instance as unknown as IDBObjectStore).name === STREAMER_FILE_STORE).length;
    const source = { ...track("cached-file", "Cached file"), file: new Blob(["cached"], { type: "audio/wav" }) };
    const initial = state({ tracks: [source], currentId: source.id });
    await saveQueue(initial);
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(filePutCount()).toBe(1);

    await saveQueue({ ...initial, autoAdvance: true });
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(filePutCount()).toBe(1);
    expect(await storedFileIds()).toEqual([source.id]);

    const changed = { ...source, file: new Blob(["changed"], { type: "audio/wav" }) };
    await saveQueue({ ...initial, tracks: [changed] });
    expect(readSpy).toHaveBeenCalledTimes(2);
    expect(filePutCount()).toBe(2);

    await saveQueue(clearQueue({ ...initial, tracks: [changed] }));
    expect(await storedFileIds()).toEqual([]);
    readSpy.mockRestore();
    putSpy.mockRestore();
  });
});
