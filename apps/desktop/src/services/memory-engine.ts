import { DeterministicMemoryEmbedder, cosineSimilarity, memoryCanonicalTokens, memoryKindTerms, type MemoryEmbedder } from "./memory-embedding";
import { buildMemoryGraph } from "./memory-graph";
import { createMemoryRepository, type MemoryRepository, type MemoryRepositoryOptions } from "./memory-repository";
import type { MemoryAssetKind, MemoryCategory, MemoryCategoryInput, MemoryGraph, MemoryGraphOptions, MemoryRecord, MemoryRecordInput, MemorySearchOptions, MemorySearchReason, MemorySearchResult } from "./memory-types";

const extensions: Record<string, MemoryAssetKind> = {
  jpg: "image", jpeg: "image", png: "image", webp: "image", gif: "image", bmp: "image", tif: "image", tiff: "image", heic: "image", svg: "image",
  mp4: "video", mov: "video", webm: "video", mkv: "video", avi: "video", m4v: "video",
  mp3: "audio", wav: "audio", flac: "audio", aac: "audio", m4a: "audio", ogg: "audio", aiff: "audio",
  txt: "text", md: "text", srt: "text", vtt: "text", json: "text", csv: "text", log: "text",
  pdf: "document", doc: "document", docx: "document", odt: "document", rtf: "document", xls: "document", xlsx: "document", ppt: "document", pptx: "document",
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive"
};

const mimeTypes: Record<MemoryAssetKind, string> = { image: "image/*", video: "video/*", audio: "audio/*", text: "text/plain", document: "application/octet-stream", archive: "application/x-archive", folder: "inode/directory", other: "application/octet-stream" };
const categoryColors = ["#ec4899", "#8b5cf6", "#22d3ee", "#f59e0b", "#10b981", "#fb7185"];

function unique(values: readonly string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }

export function normalizeMemoryPath(path: string): string {
  const slashPath = path.trim().replace(/\\/gu, "/");
  const uri = slashPath.match(/^([a-z][a-z0-9+.-]*):\/\/(.*)$/iu);
  const normalized = uri ? `${uri[1]}://${uri[2]?.replace(/\/{2,}/gu, "/") ?? ""}` : slashPath.replace(/\/{2,}/gu, "/");
  if (normalized.length > 1 && normalized.endsWith("/") && !/^[a-z][a-z0-9+.-]*:\/\/$/iu.test(normalized)) return normalized.slice(0, -1);
  return normalized;
}

function pathName(path: string): string { return path.split("/").filter(Boolean).at(-1) ?? path; }
function parentPath(path: string): string {
  const normalized = normalizeMemoryPath(path); const slash = normalized.lastIndexOf("/");
  if (slash <= 0) return slash === 0 ? "/" : "";
  return normalized.slice(0, slash);
}
function stableHash(value: string): string {
  let first = 2166136261; let second = 3335557771;
  for (let index = 0; index < value.length; index += 1) { const code = value.charCodeAt(index); first = Math.imul(first ^ code, 16777619); second = Math.imul(second ^ code, 2246822519); }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}
function categoryIdForPath(path: string): string { return `memory-folder-${stableHash(normalizeMemoryPath(path))}`; }
function recordIdForPath(path: string): string { return `memory-record-${stableHash(normalizeMemoryPath(path))}`; }

export function inferMemoryAssetKind(path: string, mimeType = ""): MemoryAssetKind {
  if (mimeType.startsWith("image/")) return "image"; if (mimeType.startsWith("video/")) return "video"; if (mimeType.startsWith("audio/")) return "audio"; if (mimeType.startsWith("text/")) return "text";
  const extension = pathName(path).split(".").at(-1)?.toLocaleLowerCase() ?? "";
  return extensions[extension] ?? "other";
}

function searchableText(record: Pick<MemoryRecord, "name" | "path" | "description" | "tags" | "kind">, categories: readonly MemoryCategory[]): string {
  const pathParts = record.path.split("/").join(" ");
  return [record.name, record.description, record.tags.join(" "), pathParts, memoryKindTerms(record.kind), categories.map((category) => `${category.name} ${category.description}`).join(" ")].join(" ");
}

function matchesFilters(record: MemoryRecord, options: MemorySearchOptions): boolean {
  if (options.kinds?.length && !options.kinds.includes(record.kind)) return false;
  if (options.pathPrefix && !record.path.startsWith(normalizeMemoryPath(options.pathPrefix))) return false;
  if (options.tags?.length && !options.tags.every((tag) => record.tags.some((recordTag) => recordTag.toLocaleLowerCase() === tag.toLocaleLowerCase()))) return false;
  if (options.categoryIds?.length) {
    const matches = options.categoryIds.map((categoryId) => record.categoryIds.includes(categoryId));
    if (options.categoryMode === "all" ? matches.some((value) => !value) : matches.every((value) => !value)) return false;
  }
  return true;
}

function lexicalScore(query: string, record: MemoryRecord, categories: readonly MemoryCategory[]): { score: number; reasons: MemorySearchReason[] } {
  const queryTokens = unique(memoryCanonicalTokens(query)); if (!queryTokens.length) return { score: 1, reasons: [] };
  const fields = {
    name: new Set(memoryCanonicalTokens(record.name)), description: new Set(memoryCanonicalTokens(record.description)),
    tag: new Set(memoryCanonicalTokens(record.tags.join(" "))), category: new Set(memoryCanonicalTokens(categories.map((category) => category.name).join(" "))), path: new Set(memoryCanonicalTokens(record.path))
  };
  const weights = { name: 1, description: .75, tag: .95, category: .9, path: .65 } as const;
  const reasons: MemorySearchReason[] = []; let total = 0;
  for (const [field, tokens] of Object.entries(fields) as Array<[keyof typeof fields, Set<string>]>) {
    const matches = queryTokens.filter((token) => tokens.has(token)).length;
    if (matches) { total += matches / queryTokens.length * weights[field]; reasons.push(field); }
  }
  const exact = record.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) || record.description.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  return { score: Math.min(1, total / 1.8 + (exact ? .2 : 0)), reasons };
}

export interface MemoryEngineOptions {
  repository?: MemoryRepository;
  repositoryOptions?: MemoryRepositoryOptions;
  embedder?: MemoryEmbedder;
  now?: () => Date;
}

export class MemoryEngine {
  readonly repository: MemoryRepository;
  readonly embedder: MemoryEmbedder;
  private readonly now: () => Date;

  constructor(options: MemoryEngineOptions = {}) {
    this.repository = options.repository ?? createMemoryRepository(options.repositoryOptions);
    this.embedder = options.embedder ?? new DeterministicMemoryEmbedder();
    this.now = options.now ?? (() => new Date());
  }

  async createCategory(input: MemoryCategoryInput): Promise<MemoryCategory> {
    const name = input.name.trim(); if (!name) throw new Error("A Memory category must have a name.");
    const path = input.path ? normalizeMemoryPath(input.path) : undefined; const id = input.id?.trim() || (path ? categoryIdForPath(path) : `memory-category-${stableHash(name.toLocaleLowerCase())}`);
    const existing = await this.repository.getCategory(id); const timestamp = this.now().toISOString();
    const category: MemoryCategory = {
      id, name, kind: input.kind ?? "custom", description: input.description?.trim() ?? "", color: input.color?.trim() || categoryColors[Math.abs(parseInt(stableHash(id).slice(0, 4), 16)) % categoryColors.length] || "#ec4899",
      ...(path ? { path } : {}), ...(input.parentId ? { parentId: input.parentId } : {}), createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp
    };
    await this.repository.putCategory(category); return category;
  }

  async upsertRecord(input: MemoryRecordInput): Promise<MemoryRecord> {
    const record = await this.prepareRecord(input);
    await this.repository.putRecord(record);
    return record;
  }

  async upsertRecords(inputs: readonly MemoryRecordInput[], onProgress?: (completed: number, total: number) => void): Promise<MemoryRecord[]> {
    const records: MemoryRecord[] = []; const pending: MemoryRecord[] = []; const batchSize = 128;
    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index]; if (!input) continue;
      const record = await this.prepareRecord(input); records.push(record); pending.push(record);
      if (pending.length >= batchSize || index === inputs.length - 1) { await this.repository.putRecords(pending); pending.length = 0; }
      onProgress?.(index + 1, inputs.length);
    }
    return records;
  }

  private async prepareRecord(input: MemoryRecordInput): Promise<MemoryRecord> {
    const path = normalizeMemoryPath(input.path); if (!path) throw new Error("A Memory record must have a file or folder path.");
    const existing = await this.repository.getRecordByPath(path); const kind = input.kind ?? inferMemoryAssetKind(path, input.mimeType); const timestamp = this.now().toISOString();
    const folderPath = kind === "folder" ? path : parentPath(path); const folderCategory = folderPath ? await this.ensureFolderCategory(folderPath) : null;
    const requestedCategoryIds = input.categoryIds ? unique(input.categoryIds) : existing?.categoryIds ?? [];
    const categoryIds = unique([...requestedCategoryIds, ...(folderCategory ? [folderCategory.id] : [])]);
    const categories = (await Promise.all(categoryIds.map((id) => this.repository.getCategory(id)))).filter((category): category is MemoryCategory => Boolean(category));
    const base = {
      name: input.name?.trim() || existing?.name || pathName(path), path, description: input.description?.trim() ?? existing?.description ?? "",
      tags: input.tags ? unique(input.tags) : existing?.tags ?? [], kind
    };
    const embedding = [...await this.embedder.embed(searchableText(base, categories))];
    const record: MemoryRecord = {
      id: input.id?.trim() || existing?.id || recordIdForPath(path), ...base, mimeType: input.mimeType?.trim() || existing?.mimeType || mimeTypes[kind], categoryIds,
      ...(input.sizeBytes !== undefined ? { sizeBytes: Math.max(0, input.sizeBytes) } : existing?.sizeBytes !== undefined ? { sizeBytes: existing.sizeBytes } : {}),
      ...(input.modifiedAt ? { modifiedAt: input.modifiedAt } : existing?.modifiedAt ? { modifiedAt: existing.modifiedAt } : {}),
      ...(input.previewUrl ? { previewUrl: input.previewUrl } : existing?.previewUrl ? { previewUrl: existing.previewUrl } : {}),
      embedding, embeddingVersion: this.embedder.version, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp
    };
    return record;
  }

  async search(query: string, options: MemorySearchOptions = {}): Promise<MemorySearchResult[]> {
    const cleanQuery = query.trim(); const queryVector = cleanQuery ? [...await this.embedder.embed(cleanQuery)] : [];
    const records = (await this.repository.listRecords()).filter((record) => matchesFilters(record, options)); const categories = await this.repository.listCategories(); const categoryById = new Map(categories.map((category) => [category.id, category]));
    const results = records.flatMap((record): MemorySearchResult[] => {
      const recordCategories = record.categoryIds.flatMap((id) => { const category = categoryById.get(id); return category ? [category] : []; });
      const lexical = lexicalScore(cleanQuery, record, recordCategories); const semanticScore = cleanQuery ? Math.max(0, cosineSimilarity(queryVector, record.embedding)) : 1;
      const score = cleanQuery ? Math.min(1, semanticScore * .72 + lexical.score * .28) : 1;
      const minScore = options.minScore ?? (cleanQuery ? .045 : 0); if (score < minScore) return [];
      const reasons = unique([...lexical.reasons, ...(semanticScore > .08 ? ["semantic" as const] : [])]) as MemorySearchReason[];
      return [{ record, score, semanticScore, lexicalScore: lexical.score, reasons }];
    });
    results.sort((left, right) => right.score - left.score || right.record.updatedAt.localeCompare(left.record.updatedAt) || left.record.name.localeCompare(right.record.name));
    return results.slice(0, Math.max(1, Math.round(options.limit ?? 100)));
  }

  async graph(options: MemoryGraphOptions = {}): Promise<MemoryGraph> { return buildMemoryGraph(await this.repository.listRecords(), await this.repository.listCategories(), options); }
  async listRecords(): Promise<MemoryRecord[]> { return this.repository.listRecords(); }
  async listCategories(): Promise<MemoryCategory[]> { return this.repository.listCategories(); }
  async deleteRecord(id: string): Promise<void> { await this.repository.deleteRecord(id); }
  async deleteCategory(id: string): Promise<void> { await this.repository.deleteCategory(id); }
  async clear(): Promise<void> { await this.repository.clear(); }

  private async ensureFolderCategory(path: string): Promise<MemoryCategory> {
    const normalized = normalizeMemoryPath(path); const id = categoryIdForPath(normalized); const existing = await this.repository.getCategory(id); if (existing) return existing;
    const parent = parentPath(normalized); const parentId = parent && parent !== "/" ? categoryIdForPath(parent) : undefined;
    return this.createCategory({ id, name: pathName(normalized) || normalized, kind: "folder", description: `File nella cartella ${normalized}`, path: normalized, ...(parentId ? { parentId } : {}) });
  }
}

export function createMemoryEngine(options: MemoryEngineOptions = {}): MemoryEngine { return new MemoryEngine(options); }
