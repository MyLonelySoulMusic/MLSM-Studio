/**
 * Queue state for the Streamer area.
 *
 * A local track deliberately carries both a serialisable `nativePath` (when
 * the desktop picker can provide one) and an optional Blob. The path is only
 * metadata; the bytes are kept in IndexedDB and never written into the
 * repository or another project-local directory.
 */

export type StreamerProvider = "local" | "spotify" | "youtube";
export type RemoteStreamerProvider = Exclude<StreamerProvider, "local">;
export type SpotifyResourceKind = "track" | "album" | "playlist";
export type ParsedProviderKind = SpotifyResourceKind;

export interface Track {
  id: string;
  provider: StreamerProvider;
  title: string;
  artist?: string;
  album?: string;
  artwork?: string;
  duration?: number;
  format?: string;
  codec?: string;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
  bitrate?: number;
  url?: string;
  nativePath?: string;
  file?: Blob;
}

export interface FavoritePlaylist {
  id: string;
  name: string;
  tracks: Track[];
  createdAt: number;
  updatedAt: number;
}

export interface QueueState {
  tracks: Track[];
  currentId: string | null;
  autoAdvance: boolean;
  favorites: FavoritePlaylist[];
}

export interface ParsedProviderUrl {
  provider: RemoteStreamerProvider;
  kind: ParsedProviderKind;
  id: string;
  /** The URL supplied by the caller, after URL parsing. */
  url: string;
  /** A stable provider URL without tracking parameters. */
  canonicalUrl: string;
  /** The official provider embed URL for the validated id. */
  embedUrl: string;
}

export const STREAMER_DATABASE_NAME = "mlsm-streamer-queue-db";
export const STREAMER_QUEUE_STORE = "queue";
export const STREAMER_FILE_STORE = "files";
export const STREAMER_QUEUE_ID = "primary";

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const SPOTIFY_HOSTS = new Set(["open.spotify.com"]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/u;
const SPOTIFY_ID = /^[A-Za-z0-9]{10,64}$/u;

const emptyQueue = (): QueueState => ({ tracks: [], currentId: null, autoAdvance: false, favorites: [] });
let memoryFallback: QueueState = emptyQueue();

function createPrefixedId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

/** Create a stable-enough id for a track or a favourite in this browser. */
export function createId(prefix = "track"): string { return createPrefixedId(prefix); }
export function createTrackId(): string { return createPrefixedId("track"); }
export function createFavoriteId(): string { return createPrefixedId("favorite"); }

function isBlob(value: unknown): value is Blob {
  if (typeof Blob !== "undefined" && value instanceof Blob) return true;
  // IndexedDB can return a Blob from another realm (notably fake-indexeddb
  // under jsdom), where `instanceof Blob` is false despite the same contract.
  return Boolean(value && typeof value === "object" && typeof (value as Blob).arrayBuffer === "function" && typeof (value as Blob).size === "number" && typeof (value as Blob).type === "string");
}

function blobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  if (typeof FileReader !== "undefined") return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result instanceof ArrayBuffer ? reader.result : new ArrayBuffer(0));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read the local audio blob."));
    reader.readAsArrayBuffer(blob);
  });
  if (typeof Response !== "undefined") return new Response(blob as BodyInit).arrayBuffer();
  return Promise.reject(new Error("This browser cannot read a local audio blob."));
}

function isProvider(value: unknown): value is StreamerProvider {
  return value === "local" || value === "spotify" || value === "youtube";
}

function copyTrack(track: Track): Track { return { ...track }; }

function copyFavorite(favorite: FavoritePlaylist): FavoritePlaylist {
  return { ...favorite, tracks: favorite.tracks.map(copyTrack) };
}

function copyQueue(state: QueueState): QueueState {
  return {
    tracks: state.tracks.map(copyTrack),
    currentId: state.currentId,
    autoAdvance: state.autoAdvance,
    favorites: state.favorites.map(copyFavorite),
  };
}

function optionalString(target: Track, source: Record<string, unknown>, key: keyof Track): void {
  if (typeof source[key] === "string") target[key] = source[key] as never;
}

function optionalNumber(target: Track, source: Record<string, unknown>, key: keyof Track): void {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) target[key] = value as never;
}

function trackFromUnknown(value: unknown): Track | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (typeof source.id !== "string" || !source.id || !isProvider(source.provider) || typeof source.title !== "string") return null;
  const track: Track = { id: source.id, provider: source.provider, title: source.title };
  for (const key of ["artist", "album", "artwork", "format", "codec", "url", "nativePath"] as const) optionalString(track, source, key);
  for (const key of ["duration", "sampleRate", "bitDepth", "channels", "bitrate"] as const) optionalNumber(track, source, key);
  if (isBlob(source.file)) track.file = source.file;
  return track;
}

function favoriteFromUnknown(value: unknown, now = Date.now()): FavoritePlaylist | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (typeof source.id !== "string" || !source.id || typeof source.name !== "string") return null;
  const tracks = Array.isArray(source.tracks) ? source.tracks.map(trackFromUnknown).filter((track): track is Track => Boolean(track)) : [];
  const createdAt = typeof source.createdAt === "number" && Number.isFinite(source.createdAt) ? source.createdAt : now;
  const updatedAt = typeof source.updatedAt === "number" && Number.isFinite(source.updatedAt) ? source.updatedAt : createdAt;
  return { id: source.id, name: source.name, tracks, createdAt, updatedAt };
}

function normalizeQueue(value: unknown, now = Date.now()): QueueState {
  if (!value || typeof value !== "object") return emptyQueue();
  const source = value as Record<string, unknown>;
  const tracks = Array.isArray(source.tracks) ? source.tracks.map(trackFromUnknown).filter((track): track is Track => Boolean(track)) : [];
  const favorites = Array.isArray(source.favorites) ? source.favorites.map((favorite) => favoriteFromUnknown(favorite, now)).filter((item): item is FavoritePlaylist => Boolean(item)) : [];
  const requestedCurrentId = typeof source.currentId === "string" ? source.currentId : null;
  return {
    tracks,
    currentId: requestedCurrentId && tracks.some((track) => track.id === requestedCurrentId) ? requestedCurrentId : null,
    autoAdvance: source.autoAdvance === true,
    favorites,
  };
}

interface StoredQueueRecord {
  id: string;
  tracks: Array<Omit<Track, "file">>;
  currentId: string | null;
  autoAdvance: boolean;
  favorites: Array<Omit<FavoritePlaylist, "tracks"> & { tracks: Array<Omit<Track, "file">> }>;
}

interface StoredFileRecord { id: string; data: ArrayBuffer; type: string; name?: string; lastModified?: number; }
interface CachedFileRecord { source: Blob; record: StoredFileRecord; persisted: boolean; }

/** Blob objects are immutable, so identity is a safe cheap change detector. */
const fileCache = new Map<string, CachedFileRecord>();

function toStoredTrack(track: Track): Omit<Track, "file"> {
  const metadata = { ...track };
  delete metadata.file;
  return metadata;
}

function toStoredState(state: QueueState): StoredQueueRecord {
  return {
    id: STREAMER_QUEUE_ID,
    tracks: state.tracks.map(toStoredTrack),
    currentId: state.currentId,
    autoAdvance: state.autoAdvance,
    favorites: state.favorites.map((favorite) => ({
      id: favorite.id,
      name: favorite.name,
      createdAt: favorite.createdAt,
      updatedAt: favorite.updatedAt,
      tracks: favorite.tracks.map(toStoredTrack),
    })),
  };
}

async function localFilesIn(state: QueueState): Promise<Map<string, StoredFileRecord>> {
  const files = new Map<string, StoredFileRecord>();
  const allTracks = [...state.tracks, ...state.favorites.flatMap((favorite) => favorite.tracks)];
  for (const track of allTracks) {
    if (track.provider !== "local" || !isBlob(track.file)) continue;
    if (files.has(track.id)) continue;
    const cached = fileCache.get(track.id);
    if (cached?.source === track.file) {
      files.set(track.id, cached.record);
      continue;
    }
    const record: StoredFileRecord = { id: track.id, data: await blobArrayBuffer(track.file), type: track.file.type };
    if ("name" in track.file && typeof track.file.name === "string" && track.file.name) record.name = track.file.name;
    if ("lastModified" in track.file && typeof track.file.lastModified === "number") record.lastModified = track.file.lastModified;
    fileCache.set(track.id, { source: track.file, record, persisted: false });
    files.set(track.id, record);
  }
  return files;
}

function referencedLocalFileIds(state: QueueState): Set<string> {
  const ids = new Set<string>();
  for (const track of [...state.tracks, ...state.favorites.flatMap((favorite) => favorite.tracks)]) {
    if (track.provider === "local") ids.add(track.id);
  }
  return ids;
}

function blobFromStoredFile(record: StoredFileRecord): Blob | null {
  if (!record || typeof record !== "object") return null;
  const isArrayBuffer = Object.prototype.toString.call(record.data) === "[object ArrayBuffer]";
  if (isArrayBuffer) {
    const data = new Uint8Array(record.data as ArrayBuffer).slice().buffer;
    if (record.name && typeof File !== "undefined") {
      const options: FilePropertyBag = { type: record.type };
      if (record.lastModified !== undefined) options.lastModified = record.lastModified;
      return new File([data], record.name, options);
    }
    return new Blob([data], { type: record.type });
  }
  return null;
}

function addStoredFile(track: Track, fileById: Map<string, Blob>): Track {
  const copy = copyTrack(track);
  const blob = fileById.get(copy.id);
  if (blob) copy.file = blob;
  return copy;
}

function withStoredFiles(state: QueueState, fileById: Map<string, Blob>): QueueState {
  return {
    ...state,
    tracks: state.tracks.map((track) => track.provider === "local" ? addStoredFile(track, fileById) : copyTrack(track)),
    favorites: state.favorites.map((favorite) => ({ ...favorite, tracks: favorite.tracks.map((track) => track.provider === "local" ? addStoredFile(track, fileById) : copyTrack(track)) })),
  };
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(STREAMER_DATABASE_NAME, 1); } catch (error) { reject(error); return; }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STREAMER_QUEUE_STORE)) database.createObjectStore(STREAMER_QUEUE_STORE, { keyPath: "id" });
      if (!database.objectStoreNames.contains(STREAMER_FILE_STORE)) database.createObjectStore(STREAMER_FILE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open the Streamer database."));
    request.onblocked = () => reject(new Error("The Streamer database is blocked by another tab."));
  });
}

/** Load the queue without starting playback. */
export async function loadQueue(): Promise<QueueState> {
  try {
    const database = await openDatabase();
    if (!database) return copyQueue(memoryFallback);
    const state = await new Promise<QueueState>((resolve, reject) => {
      let closed = false;
      const close = () => { if (!closed) { closed = true; database.close(); } };
      try {
        const transaction = database.transaction([STREAMER_QUEUE_STORE, STREAMER_FILE_STORE], "readonly");
        let storedState: StoredQueueRecord | undefined;
        let storedFiles: StoredFileRecord[] = [];
        const stateRequest = transaction.objectStore(STREAMER_QUEUE_STORE).get(STREAMER_QUEUE_ID);
        const filesRequest = transaction.objectStore(STREAMER_FILE_STORE).getAll();
        stateRequest.onsuccess = () => { storedState = stateRequest.result as StoredQueueRecord | undefined; };
        filesRequest.onsuccess = () => { storedFiles = Array.isArray(filesRequest.result) ? filesRequest.result as StoredFileRecord[] : []; };
        const fail = (error: unknown) => { close(); reject(error instanceof Error ? error : new Error("Unable to read the Streamer queue.")); };
        stateRequest.onerror = () => fail(stateRequest.error);
        filesRequest.onerror = () => fail(filesRequest.error);
        transaction.onerror = () => fail(transaction.error);
        transaction.onabort = () => fail(transaction.error ?? new Error("Streamer queue transaction aborted."));
        transaction.oncomplete = () => {
          close();
          const fileById = new Map<string, Blob>();
          for (const record of storedFiles) {
            const blob = blobFromStoredFile(record);
            if (record && typeof record.id === "string" && blob) {
              fileById.set(record.id, blob);
              fileCache.set(record.id, { source: blob, record, persisted: true });
            }
          }
          resolve(withStoredFiles(normalizeQueue(storedState), fileById));
        };
      } catch (error) { close(); reject(error); }
    });
    memoryFallback = copyQueue(state);
    return copyQueue(state);
  } catch (error) {
    // A real IndexedDB failure must not look like an empty queue: callers can
    // keep the in-memory state visible and decide when it is safe to retry.
    throw error instanceof Error ? error : new Error("Unable to load the Streamer queue.");
  }
}

/** Save queue metadata and local bytes, returning the normalised state. */
export async function saveQueue(next: QueueState): Promise<QueueState> {
  const state = normalizeQueue(next);
  memoryFallback = copyQueue(state);
  try {
    const files = await localFilesIn(state);
    const database = await openDatabase();
    if (!database) return copyQueue(state);
    await new Promise<void>((resolve, reject) => {
      let closed = false;
      const close = () => { if (!closed) { closed = true; database.close(); } };
      try {
        const transaction = database.transaction([STREAMER_QUEUE_STORE, STREAMER_FILE_STORE], "readwrite");
        transaction.objectStore(STREAMER_QUEUE_STORE).put(toStoredState(state));
        const fileStore = transaction.objectStore(STREAMER_FILE_STORE);
        const referenced = referencedLocalFileIds(state);
        const existingRequest = fileStore.getAllKeys();
        existingRequest.onsuccess = () => {
          const existingIds = new Set((Array.isArray(existingRequest.result) ? existingRequest.result : []).map(String));
          for (const id of existingIds) {
            if (!referenced.has(id)) {
              fileStore.delete(id);
              fileCache.delete(id);
            }
          }
          for (const [id, record] of files) {
            const cached = fileCache.get(id);
            if (!existingIds.has(id) || !cached?.persisted || cached.record !== record) fileStore.put(record);
          }
        };
        existingRequest.onerror = () => { close(); reject(existingRequest.error ?? new Error("Unable to inspect Streamer file records.")); };
        transaction.oncomplete = () => {
          for (const [id, record] of files) {
            const cached = fileCache.get(id);
            if (cached?.record === record) cached.persisted = true;
          }
          close();
          resolve();
        };
        transaction.onerror = () => { close(); reject(transaction.error ?? new Error("Unable to save the Streamer queue.")); };
        transaction.onabort = () => { close(); reject(transaction.error ?? new Error("Streamer queue transaction aborted.")); };
      } catch (error) { close(); reject(error); }
    });
  } catch (error) {
    // Keep the in-memory copy usable for this session, but do not report a
    // failed quota/transaction write as if it had been persisted.
    throw error instanceof Error ? error : new Error("Unable to persist the Streamer queue.");
  }
  return copyQueue(state);
}

/** Reset only the in-memory fallback; useful for tests and a fresh session. */
export function resetStreamerQueueForTests(): void { memoryFallback = emptyQueue(); fileCache.clear(); }

/** Parse official YouTube videos and Spotify track/album/playlist URLs into safe embed ids. */
export function parseProviderUrl(input: string): ParsedProviderUrl | null;
export function parseProviderUrl(provider: RemoteStreamerProvider, input: string): ParsedProviderUrl | null;
export function parseProviderUrl(providerOrInput: string, maybeInput?: string): ParsedProviderUrl | null {
  const expectedProvider = maybeInput ? providerOrInput : null;
  const input = maybeInput ?? providerOrInput;
  if (typeof input !== "string" || !input.trim()) return null;
  let url: URL;
  try { url = new URL(input.trim()); } catch { return null; }
  if (url.protocol !== "https:") return null;
  const hostname = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(hostname)) {
    const parts = url.pathname.split("/").filter(Boolean);
    const candidate = hostname === "youtu.be" || hostname === "www.youtu.be"
      ? parts[0]
      : url.searchParams.get("v") ?? (["embed", "shorts", "live"].includes(parts[0] ?? "") ? parts[1] : undefined);
    if (!candidate || !YOUTUBE_ID.test(candidate)) return null;
    const result: ParsedProviderUrl = {
      provider: "youtube",
      kind: "track",
      id: candidate,
      url: url.href,
      canonicalUrl: `https://www.youtube.com/watch?v=${candidate}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${candidate}`,
    };
    return expectedProvider && expectedProvider !== result.provider ? null : result;
  }
  if (SPOTIFY_HOSTS.has(hostname)) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0]?.startsWith("intl-")) parts.shift();
    if (parts[0] === "embed") parts.shift();
    const kind = parts[0] as SpotifyResourceKind | undefined;
    const id = parts[1];
    if (kind !== "track" && kind !== "album" && kind !== "playlist") return null;
    if (!id || parts.length !== 2 || !SPOTIFY_ID.test(id)) return null;
    const result: ParsedProviderUrl = {
      provider: "spotify",
      kind,
      id,
      url: url.href,
      canonicalUrl: `https://open.spotify.com/${kind}/${id}`,
      embedUrl: `https://open.spotify.com/embed/${kind}/${id}`,
    };
    return expectedProvider && expectedProvider !== result.provider ? null : result;
  }
  return null;
}

export const parseTrackUrl = parseProviderUrl;
export const safeParseProviderUrl = parseProviderUrl;

/** Remove a track while keeping the current position meaningful. */
export function removeTrack(state: QueueState, trackId: string): QueueState {
  const index = state.tracks.findIndex((track) => track.id === trackId);
  if (index < 0) return copyQueue(state);
  const tracks = state.tracks.filter((track) => track.id !== trackId);
  let currentId = state.currentId;
  if (currentId === trackId) currentId = tracks[index]?.id ?? tracks[index - 1]?.id ?? null;
  return { ...copyQueue(state), tracks, currentId };
}

/** Move a track by id (or a source index) to a clamped destination index. */
export function moveTrack(state: QueueState, trackId: string | number, toIndex: number): QueueState {
  const fromIndex = typeof trackId === "number" ? trackId : state.tracks.findIndex((track) => track.id === trackId);
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= state.tracks.length || !Number.isFinite(toIndex)) return copyQueue(state);
  const destination = Math.max(0, Math.min(state.tracks.length - 1, Math.trunc(toIndex)));
  const tracks = [...state.tracks];
  const [moved] = tracks.splice(fromIndex, 1);
  if (!moved) return copyQueue(state);
  tracks.splice(destination, 0, moved);
  return { ...copyQueue(state), tracks };
}

export function clearQueue(state: QueueState): QueueState {
  return { ...copyQueue(state), tracks: [], currentId: null };
}

/** Save a named snapshot of the current queue, without changing playback. */
export function favoriteQueue(state: QueueState, name: string, now = Date.now()): QueueState {
  const timestamp = Number.isFinite(now) ? now : Date.now();
  const favorite: FavoritePlaylist = {
    id: createFavoriteId(),
    name: name.trim() || "Untitled queue",
    tracks: state.tracks.map(copyTrack),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return { ...copyQueue(state), favorites: [...state.favorites.map(copyFavorite), favorite] };
}

function favoriteId(value: string | Pick<FavoritePlaylist, "id">): string { return typeof value === "string" ? value : value.id; }

/** Restore a favourite as the active queue and select its first track. */
export function restoreFavorite(state: QueueState, favorite: string | Pick<FavoritePlaylist, "id">): QueueState {
  const selected = state.favorites.find((item) => item.id === favoriteId(favorite));
  if (!selected) return copyQueue(state);
  const tracks = selected.tracks.map(copyTrack);
  return { ...copyQueue(state), tracks, currentId: tracks[0]?.id ?? null };
}

/** Delete only a favourite snapshot; active queue files remain untouched. */
export function removeFavorite(state: QueueState, favorite: string | Pick<FavoritePlaylist, "id">): QueueState {
  const id = favoriteId(favorite);
  return { ...copyQueue(state), favorites: state.favorites.filter((item) => item.id !== id).map(copyFavorite) };
}

/**
 * Return the next id only when a track has ended and auto-advance is enabled.
 * At the end of a queue (or with auto-advance disabled) null tells the viewer
 * to stop. Calling with ended=false is intentionally side-effect free.
 */
export function nextTrackId(state: QueueState, ended: boolean): string | null {
  if (!ended) return state.currentId;
  if (!state.autoAdvance || state.tracks.length === 0) return null;
  if (!state.currentId) return state.tracks[0]?.id ?? null;
  const index = state.tracks.findIndex((track) => track.id === state.currentId);
  return index < 0 ? state.tracks[0]?.id ?? null : state.tracks[index + 1]?.id ?? null;
}
