import { cosineSimilarity, DeterministicMemoryEmbedder } from "../services/memory-embedding";

export interface PostItNote {
  id: string;
  title: string;
  link: string;
  faviconUrl: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  vector: number[];
}

export interface PostItFlow {
  id: string;
  title: string;
  description: string;
  postItIds: string[];
  createdAt: number;
  updatedAt: number;
  vector: number[];
}

export interface PostItWorkspaceData {
  postIts: PostItNote[];
  flows: PostItFlow[];
}

export interface RankedPostIt<T> {
  item: T;
  score: number | null;
}

const DATABASE_NAME = "mlsm-post-it-vector-db";
const STORE_NAME = "workspace";
const WORKSPACE_ID = "primary";
const embedder = new DeterministicMemoryEmbedder(384);
let memoryFallback: PostItWorkspaceData = { postIts: [], flows: [] };

function id(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function clean(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }

export function normalizePostItLink(value: string): string {
  const candidate = value.trim();
  if (!candidate) return "";
  try { return new URL(candidate).href; } catch { /* Try a conventional HTTPS URL below. */ }
  try { return new URL(`https://${candidate}`).href; } catch { return ""; }
}

export function faviconUrlForLink(value: string): string {
  const link = normalizePostItLink(value);
  if (!link) return "";
  try {
    const hostname = new URL(link).hostname.replace(/^www\./u, "");
    const initial = (hostname[0] ?? "L").toLocaleUpperCase();
    let hue = 0;
    for (const character of hostname) hue = (hue * 31 + character.charCodeAt(0)) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="hsl(${hue} 52% 26%)"/><text x="32" y="43" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="white">${initial.replace(/[<>&"']/gu, "")}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } catch { return ""; }
}

function noteText(note: Pick<PostItNote, "title" | "link" | "text">): string {
  let host = "";
  try { host = note.link ? new URL(note.link).hostname.replace(/^www\./u, "") : ""; } catch { /* Invalid legacy link: omit host. */ }
  return [note.title, host, note.text].filter(Boolean).join(" \n");
}

function flowText(flow: Pick<PostItFlow, "title" | "description" | "postItIds">, postIts: readonly PostItNote[]): string {
  const byId = new Map(postIts.map((postIt) => [postIt.id, postIt]));
  return [flow.title, flow.description, ...flow.postItIds.map((postItId) => byId.get(postItId)).filter((postIt): postIt is PostItNote => Boolean(postIt)).map(noteText)].filter(Boolean).join(" \n");
}

function vectorFor(text: string): number[] { return [...embedder.embed(text)]; }

export function createPostIt(input: { title: string; link?: string; text: string }, now = Date.now()): PostItNote {
  const link = normalizePostItLink(input.link ?? "");
  const postIt: PostItNote = { id: id("note"), title: clean(input.title), link, faviconUrl: faviconUrlForLink(link), text: clean(input.text), createdAt: now, updatedAt: now, vector: [] };
  return { ...postIt, vector: vectorFor(noteText(postIt)) };
}

export function createPostItFlow(input: { title: string; description: string; postItIds: string[] }, postIts: readonly PostItNote[], now = Date.now()): PostItFlow {
  const flow: PostItFlow = { id: id("flow"), title: clean(input.title), description: clean(input.description), postItIds: [...new Set(input.postItIds)], createdAt: now, updatedAt: now, vector: [] };
  return { ...flow, vector: vectorFor(flowText(flow, postIts)) };
}

export function refreshPostItVectors(data: PostItWorkspaceData): PostItWorkspaceData {
  const postIts = data.postIts.map((postIt) => ({ ...postIt, link: normalizePostItLink(postIt.link), faviconUrl: postIt.faviconUrl || faviconUrlForLink(postIt.link), vector: vectorFor(noteText(postIt)) }));
  const validIds = new Set(postIts.map((postIt) => postIt.id));
  const flows = data.flows.map((flow) => ({ ...flow, postItIds: flow.postItIds.filter((postItId) => validIds.has(postItId)), vector: vectorFor(flowText(flow, postIts)) }));
  return { postIts, flows };
}

function rank<T extends { updatedAt: number; vector: readonly number[] }>(items: readonly T[], query: string): RankedPostIt<T>[] {
  const normalized = query.trim();
  if (!normalized) return [...items].sort((left, right) => right.updatedAt - left.updatedAt).map((item) => ({ item, score: null }));
  const queryVector = embedder.embed(normalized);
  return items.map((item) => ({ item, score: cosineSimilarity(queryVector, item.vector) }))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || right.item.updatedAt - left.item.updatedAt);
}

export function rankPostIts(postIts: readonly PostItNote[], query: string): RankedPostIt<PostItNote>[] { return rank(postIts, query); }

export function rankPostItFlows(flows: readonly PostItFlow[], postIts: readonly PostItNote[], query: string): RankedPostIt<PostItFlow>[] {
  const refreshed = flows.map((flow) => ({ ...flow, vector: vectorFor(flowText(flow, postIts)) }));
  return rank(refreshed, query);
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadPostItWorkspace(): Promise<PostItWorkspaceData> {
  try {
    const database = await openDatabase();
    if (!database) return refreshPostItVectors(memoryFallback);
    const stored = await new Promise<Partial<PostItWorkspaceData> | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(WORKSPACE_ID);
      request.onsuccess = () => resolve(request.result as Partial<PostItWorkspaceData> | undefined);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
    });
    const data = refreshPostItVectors({ postIts: Array.isArray(stored?.postIts) ? stored.postIts as PostItNote[] : [], flows: Array.isArray(stored?.flows) ? stored.flows as PostItFlow[] : [] });
    memoryFallback = data;
    return data;
  } catch { return refreshPostItVectors(memoryFallback); }
}

export async function savePostItWorkspace(next: PostItWorkspaceData): Promise<PostItWorkspaceData> {
  const data = refreshPostItVectors(next);
  memoryFallback = data;
  try {
    const database = await openDatabase();
    if (!database) return data;
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({ id: WORKSPACE_ID, ...data });
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    });
  } catch { /* The in-memory copy remains available for this session. */ }
  return data;
}

export function resetPostItWorkspaceForTests(): void { memoryFallback = { postIts: [], flows: [] }; }
