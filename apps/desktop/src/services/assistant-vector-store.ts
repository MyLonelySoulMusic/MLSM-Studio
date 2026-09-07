import { applicationHelpKnowledgeBase } from "../knowledge/application-help";

export interface AssistantVectorHit {
  id: string;
  title: string;
  content: string;
  score: number;
}

interface StoredVectorDocument extends AssistantVectorHit {
  modeIds: readonly string[];
  vector: number[];
  score: number;
}

const DIMENSIONS = 384;
const DATABASE_NAME = "mlsm-lonely-bot-vector-db";
const STORE_NAME = "knowledge";
let memoryIndex: StoredVectorDocument[] | null = null;
let persisted = false;
let hydratePromise: Promise<void> | null = null;

function tokens(value: string): string[] {
  const words = value.normalize("NFKD").toLocaleLowerCase().replace(/[\u0300-\u036f]/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...words, ...words.slice(0, -1).map((word, index) => `${word}_${words[index + 1]}`)];
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/** Deterministic local feature embedding; no text or vectors leave the device. */
export function assistantTextVector(value: string): number[] {
  const vector = Array<number>(DIMENSIONS).fill(0);
  const values = tokens(value);
  for (const token of values) {
    const valueHash = hash(token);
    const index = valueHash % DIMENSIONS;
    vector[index] = (vector[index] ?? 0) + (valueHash & 1 ? 1 : -1) / Math.sqrt(Math.max(1, token.length));
  }
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1;
  return vector.map((item) => item / norm);
}

function similarity(left: readonly number[], right: readonly number[]): number {
  let result = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) result += (left[index] ?? 0) * (right[index] ?? 0);
  return result;
}

function seedIndex(): StoredVectorDocument[] {
  if (memoryIndex) return memoryIndex;
  memoryIndex = applicationHelpKnowledgeBase.map((article) => ({
    id: article.id,
    title: article.title,
    content: article.content,
    modeIds: article.modeIds,
    vector: assistantTextVector(`${article.title} ${article.keywords.join(" ")} ${article.content}`),
    score: 0,
  }));
  return memoryIndex;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function persistSeed(): Promise<void> {
  if (persisted) return;
  persisted = true;
  try {
    const database = await openDatabase();
    if (!database) return;
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      for (const document of seedIndex()) store.put(document);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    });
  } catch {
    // The in-memory vector index remains fully functional in private browsing.
  }
}

async function hydrateIndex(): Promise<void> {
  hydratePromise ??= (async () => {
    try {
      const database = await openDatabase(); if (!database) return;
      const rows = await new Promise<StoredVectorDocument[]>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readonly"); const request = transaction.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result as StoredVectorDocument[]); request.onerror = () => reject(request.error);
        transaction.oncomplete = () => database.close();
      });
      const index = seedIndex();
      for (const row of rows) if ((row.id.startsWith("source:") || row.id.startsWith("learned:")) && typeof row.content === "string" && Array.isArray(row.vector) && !index.some(item => item.id === row.id)) index.push(row);
    } catch { /* In-memory retrieval remains available. */ }
  })();
  await hydratePromise;
}

/** Update only code-backed knowledge, never promote unverified model prose to facts. */
export async function syncAssistantSource(modeId: string, revision: string, source: string): Promise<boolean> {
  await hydrateIndex();
  const index = seedIndex(); const id = `source:${modeId}`; const title = `Source ${modeId} · ${revision}`;
  const old = index.find(item => item.id === id);
  if (old?.title === title) return false;
  const document = { id, title, content: source, modeIds: [modeId], vector: assistantTextVector(source), score: 0 };
  memoryIndex = [...index.filter(item => item.id !== id && item.id !== `learned:${modeId}`), document];
  try {
    const database = await openDatabase(); if (database) await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite"); transaction.objectStore(STORE_NAME).put(document); transaction.objectStore(STORE_NAME).delete(`learned:${modeId}`);
      transaction.oncomplete = () => { database.close(); resolve(); }; transaction.onerror = () => { database.close(); reject(transaction.error); };
    });
  } catch { /* Session knowledge was updated even if persistence is unavailable. */ }
  return true;
}

export function resetAssistantVectorMemory() { memoryIndex = null; persisted = false; hydratePromise = null; }

export async function saveVerifiedAssistantNote(modeId: string, revision: string, text: string, evidence: string, source: string): Promise<boolean> {
  if (text.length < 40 || text.length > 3000 || evidence.length < 30 || !source.includes(evidence)) return false;
  await hydrateIndex();
  const current = seedIndex().find(item => item.id === `source:${modeId}`);
  if (current?.title !== `Source ${modeId} · ${revision}`) return false;
  const content = `Spiegazione verificata sul codice ${revision}: ${text}\nEvidenza testuale: ${evidence}`;
  const document: StoredVectorDocument = { id: `learned:${modeId}`, title: `Nota verificata ${modeId}`, content, modeIds: [modeId], vector: assistantTextVector(content), score: 0 };
  if (seedIndex().some(item => item.id === document.id && item.content === content)) return false;
  memoryIndex = [...seedIndex().filter(item => item.id !== document.id), document];
  try {
    const database = await openDatabase(); if (database) await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite"); transaction.objectStore(STORE_NAME).put(document);
      transaction.oncomplete = () => { database.close(); resolve(); }; transaction.onerror = () => { database.close(); reject(transaction.error); };
    });
  } catch { /* The verified note is still available for this session. */ }
  return true;
}

export async function retrieveAssistantVectors(query: string, modeId: string, pageDetails = "", limit = 4): Promise<AssistantVectorHit[]> {
  await hydrateIndex();
  const index = [...seedIndex()];
  if (pageDetails.trim()) index.push({
    id: `page:${modeId}`,
    title: `Controlli visibili nella pagina ${modeId}`,
    content: pageDetails,
    modeIds: [modeId],
    vector: assistantTextVector(`${modeId} ${pageDetails}`),
    score: 0,
  });
  void persistSeed();
  const queryVector = assistantTextVector(`${query} ${modeId}`);
  return index
    .map((document) => ({ ...document, score: similarity(queryVector, document.vector) + (document.modeIds.includes(modeId) ? 0.18 : 0) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, limit))
    .map(({ id, title, content, score }) => ({ id, title, content, score }));
}
