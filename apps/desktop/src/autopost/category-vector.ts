import { getLocalFeatureExtractor, type LocalFeatureExtractor } from "../services/local-model-runtime";
import { featureRows } from "../services/verified-feature-extractor";
import type { ArticleInput, BlogConnection, WordPressCategory } from "./types";

export type CategoryAssociationMode = "vector" | "llm";
export type CategorySelectionMode = "first" | "all";
export const CATEGORY_VECTOR_MODEL = "paraphrase-multilingual-MiniLM-L12-v2";
export const CATEGORY_VECTOR_MODEL_LABEL = "MiniLM multilingua";
export const CATEGORY_VECTOR_THRESHOLD = 0.4;
const THRESHOLD_STORAGE_KEY = "mlsm-autopost.category-vector-threshold.v1";
const SELECTION_MODE_STORAGE_KEY = "mlsm-autopost.category-vector-selection-mode.v1";

function validThreshold(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : CATEGORY_VECTOR_THRESHOLD;
}

export function readCategoryVectorThreshold(): number {
  try {
    const stored = window.localStorage.getItem(THRESHOLD_STORAGE_KEY);
    return stored === null || stored.trim() === "" ? CATEGORY_VECTOR_THRESHOLD : validThreshold(Number(stored));
  } catch { return CATEGORY_VECTOR_THRESHOLD; }
}

export function writeCategoryVectorThreshold(value: number): void {
  try { window.localStorage.setItem(THRESHOLD_STORAGE_KEY, String(validThreshold(value))); } catch { /* Session state remains usable. */ }
}
export function readCategorySelectionMode(): CategorySelectionMode {
  try { return window.localStorage.getItem(SELECTION_MODE_STORAGE_KEY) === "all" ? "all" : "first"; }
  catch { return "first"; }
}
export function writeCategorySelectionMode(value: CategorySelectionMode): void {
  try { window.localStorage.setItem(SELECTION_MODE_STORAGE_KEY, value === "all" ? "all" : "first"); } catch { /* Session state remains usable. */ }
}

const MODE_STORAGE_KEY = "mlsm-autopost.category-association-mode.v1";
const DATABASE_NAME = "mlsm-autopost-vector-db";
const STORE_NAME = "category-collections";
const DATABASE_VERSION = 1;

export interface StoredCategoryVector { id: number; name: string; embedding: number[]; }
interface StoredBlogCollection {
  blogId: string;
  fingerprint: string;
  model: string;
  embeddingSpace: string;
  siteUrl: string;
  updatedAt: string;
  categories: StoredCategoryVector[];
}

export interface VectorCategoryMapping {
  categoryIds: number[];
  categoryName: string;
  score: number;
  fallback: boolean;
  model: string;
  ranking: CategoryScore[];
  bestCategoryName: string;
  threshold: number;
  selectionMode: CategorySelectionMode;
}
export interface CategoryScore { id: number; name: string; score: number; evidence?: string; }

const pendingCollections = new Map<string, Promise<StoredBlogCollection>>();

export function readCategoryAssociationMode(): CategoryAssociationMode {
  if (typeof window === "undefined") return "vector";
  try { return window.localStorage.getItem(MODE_STORAGE_KEY) === "llm" ? "llm" : "vector"; }
  catch { return "vector"; }
}

export function writeCategoryAssociationMode(mode: CategoryAssociationMode): void {
  try { window.localStorage.setItem(MODE_STORAGE_KEY, mode); } catch { /* The current session still keeps the selected mode. */ }
}

function plainText(value: unknown, maximum: number): string {
  return String(value ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ").trim().slice(0, maximum);
}

// Encode short passages independently: pooling an entire article dilutes its topic
// and lets the model truncate away later sections. Never mix different articles.
export function articlePassages(article: ArticleInput): string[] {
  const split = (text: string): string[] => text.split(/(?<=[.!?])\s+/).flatMap(sentence => {
    const words = sentence.split(/\s+/);
    const chunks: string[] = [];
    let chunk = "";
    for (const word of words) {
      if (chunk && chunk.length + word.length + 1 > 300) { chunks.push(chunk); chunk = ""; }
      for (let offset = 0; offset < word.length; offset += 300) {
        const part = word.slice(offset, offset + 300);
        if (offset || (chunk && chunk.length + part.length + 1 > 300)) { if (chunk) chunks.push(chunk); chunk = ""; }
        chunk = chunk ? `${chunk} ${part}` : part;
      }
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  });
  const headings = [article.title, article.excerpt].flatMap(value => split(plainText(value, 2_000)));
  const content = String(article.content ?? "").replace(/<(figure|figcaption|small|footer|nav)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const body = split(plainText(content, 100_000));
  // Bound latency, but sample the full article instead of only its beginning.
  const sampled = body.length <= 64 ? body : Array.from({ length: 64 }, (_, i) => body[Math.round(i * (body.length - 1) / 63)]!);
  return [...new Set([...headings, ...sampled])].filter(Boolean);
}

function normalizedName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function fallbackCategory(categories: readonly WordPressCategory[]): WordPressCategory | undefined {
  return categories.find(category => ["uncategorized", "senza categoria", "non categorizzato", "non categorizzata"].includes(normalizedName(category.name)))
    ?? categories.find(category => category.id === 1);
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue; leftNorm += leftValue ** 2; rightNorm += rightValue ** 2;
  }
  return leftNorm > 0 && rightNorm > 0 ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

export function selectCategoryByCosine(query: readonly number[], categories: readonly StoredCategoryVector[], fallbackId?: number, threshold = CATEGORY_VECTOR_THRESHOLD): { categoryIds: number[]; categoryName: string; score: number; fallback: boolean } {
  let best: StoredCategoryVector | undefined; let score = -1;
  for (const category of categories) {
    const current = cosineSimilarity(query, category.embedding);
    if (current > score) { best = category; score = current; }
  }
  const safeScore = Math.max(0, score);
  if (!best || safeScore < threshold) {
    const fallback = categories.find(category => category.id === fallbackId);
    return { categoryIds: fallback ? [fallback.id] : [], categoryName: fallback?.name ?? "WordPress default", score: safeScore, fallback: true };
  }
  return { categoryIds: [best.id], categoryName: best.name, score: safeScore, fallback: false };
}

export function rankCategoryPassages(queries: readonly number[][], passages: readonly string[], categories: readonly StoredCategoryVector[]): CategoryScore[] {
  return categories.map(category => {
    let score = -1;
    let evidence = "";
    queries.forEach((query, index) => {
      const candidate = cosineSimilarity(query, category.embedding);
      if (candidate > score) { score = candidate; evidence = passages[index] ?? ""; }
    });
    return { id: category.id, name: category.name, score, evidence };
  }).sort((a, b) => b.score - a.score || a.id - b.id);
}
export function selectRankedCategories(ranking: readonly CategoryScore[], fallback: Pick<WordPressCategory, "id" | "name"> | undefined, threshold: number, selectionMode: CategorySelectionMode) {
  const eligible = ranking.filter(category => category.id !== fallback?.id && category.score >= threshold);
  const selected = selectionMode === "all" ? eligible : eligible.slice(0, 1);
  if (selected.length) return { categoryIds: selected.map(category => category.id), categoryName: selected.map(category => category.name).join(", "), score: selected[0]!.score, fallback: false };
  return { categoryIds: fallback ? [fallback.id] : [], categoryName: fallback?.name ?? "WordPress default", score: ranking.find(category => category.id !== fallback?.id)?.score ?? 0, fallback: true };
}

function fingerprint(blog: BlogConnection): string {
  return JSON.stringify([blog.siteUrl, blog.categories.map(({ id, name }) => [id, name]).sort((a, b) => Number(a[0]) - Number(b[0]))]);
}

function validStoredVector(category: StoredCategoryVector): boolean {
  return Array.isArray(category.embedding) && category.embedding.length === 384
    && category.embedding.every(Number.isFinite) && Math.abs(Math.hypot(...category.embedding) - 1) < 0.01;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "blogId" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Vector DB locale non disponibile."));
  });
}

async function readCollection(blogId: string): Promise<StoredBlogCollection | null> {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(blogId);
    request.onsuccess = () => resolve((request.result as StoredBlogCollection | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Lettura Vector DB non riuscita."));
    transaction.oncomplete = () => database.close();
  });
}

async function writeCollection(collection: StoredBlogCollection): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(collection);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => reject(transaction.error ?? new Error("Salvataggio Vector DB non riuscito."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Salvataggio Vector DB interrotto."));
  });
}

async function embedTexts(texts: string[], extractor: LocalFeatureExtractor): Promise<number[][]> {
  const tensor = await extractor(texts, { pooling: "mean", normalize: true });
  const rows = featureRows(tensor, texts.length);
  if (rows.length !== texts.length) throw new Error("Il modello locale ha restituito un numero inatteso di embeddings.");
  return rows;
}

async function ensureCollection(blog: BlogConnection, extractor: LocalFeatureExtractor, progress?: (message: string) => void): Promise<StoredBlogCollection> {
  if (!extractor.embeddingSpace) throw new Error("Motore embedding non verificato.");
  const embeddingSpace = `${extractor.embeddingSpace}:category-label-v2`;
  const signature = fingerprint(blog);
  const key = `${blog.id}:${signature}:${embeddingSpace}`;
  let pending = pendingCollections.get(key);
  if (!pending) {
    pending = (async () => {
      const stored = await readCollection(blog.id);
      if (stored?.fingerprint === signature && stored.model === CATEGORY_VECTOR_MODEL && stored.embeddingSpace === embeddingSpace && stored.categories.length === blog.categories.length
        && stored.siteUrl === blog.siteUrl && stored.categories.every(validStoredVector)) {
        progress?.(`Vector DB · ${blog.name} · ${stored.categories.length} categorie in cache`);
        return stored;
      }
      const reusable = stored?.embeddingSpace === embeddingSpace && stored.model === CATEGORY_VECTOR_MODEL && stored.siteUrl === blog.siteUrl
        ? new Map(stored.categories.filter(validStoredVector).map(category => [category.id, category])) : new Map<number, StoredCategoryVector>();
      const changed = blog.categories.filter(category => reusable.get(category.id)?.name !== category.name);
      progress?.(`Vector DB · sincronizzazione di ${blog.name} · ${changed.length} categorie nuove o modificate`);
      const embeddings = changed.length ? await embedTexts(changed.map(category => plainText(category.name, 300)), extractor) : [];
      changed.forEach((category, index) => {
        const embedding = embeddings[index];
        if (!embedding || embedding.length !== 384) throw new Error("Embedding categoria non valido.");
        reusable.set(category.id, { id: category.id, name: category.name, embedding });
      });
      const collection: StoredBlogCollection = {
        blogId: blog.id,
        fingerprint: signature,
        model: CATEGORY_VECTOR_MODEL,
        embeddingSpace,
        siteUrl: blog.siteUrl,
        updatedAt: new Date().toISOString(),
        categories: blog.categories.map(category => {
          const vector = reusable.get(category.id);
          if (!vector) throw new Error("Categoria non indicizzata.");
          return vector;
        }),
      };
      await writeCollection(collection);
      return collection;
    })().finally(() => pendingCollections.delete(key));
    pendingCollections.set(key, pending);
  }
  return pending;
}

export async function mapAutoPostCategoriesWithVectorDb(article: ArticleInput, targetBlog: BlogConnection, progress?: (message: string) => void, threshold = readCategoryVectorThreshold(), selectionMode: CategorySelectionMode = readCategorySelectionMode()): Promise<VectorCategoryMapping> {
  threshold = validThreshold(threshold);
  if (!targetBlog.categories.length) throw new Error(`Il blog ${targetBlog.name} non espone categorie WordPress utilizzabili.`);
  const extractor = await getLocalFeatureExtractor(CATEGORY_VECTOR_MODEL, progress);
  const collection = await ensureCollection(targetBlog, extractor, progress);
  progress?.(`Vector DB · analisi semantica di “${plainText(article.title, 80)}”`);
  const passages = articlePassages(article);
  if (!passages.length) throw new Error("L'articolo non contiene testo da analizzare.");
  const queries: number[][] = [];
  for (let offset = 0; offset < passages.length; offset += 8) {
    progress?.(`Vector DB · analisi passaggi ${offset + 1}–${Math.min(offset + 8, passages.length)} / ${passages.length}`);
    queries.push(...await embedTexts(passages.slice(offset, offset + 8), extractor));
  }
  const fallback = fallbackCategory(targetBlog.categories);
  const ranking = rankCategoryPassages(queries, passages, collection.categories);
  const best = ranking.find(category => category.id !== fallback?.id);
  const selected = { ...selectRankedCategories(ranking, fallback, threshold, selectionMode), bestCategoryName: best?.name ?? "—", threshold, ranking, selectionMode };
  console.info("[AutoPost embeddings] Associazione", {
    title: article.title, blogId: targetBlog.id, embeddingSpace: collection.embeddingSpace,
    threshold, selectionMode, selectedIds: selected.categoryIds, fallback: selected.fallback,
    scoring: "maximum-passage-cosine-v1", passageCount: passages.length, scores: ranking,
  });
  return { ...selected, model: CATEGORY_VECTOR_MODEL };
}
