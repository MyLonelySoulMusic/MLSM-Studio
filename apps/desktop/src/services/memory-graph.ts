import { cosineSimilarity } from "./memory-embedding";
import type { MemoryCategory, MemoryGraph, MemoryGraphEdge, MemoryGraphOptions, MemoryRecord } from "./memory-types";

const assetColors = { image: "#ec4899", video: "#8b5cf6", audio: "#22d3ee", text: "#f59e0b", document: "#fb7185", archive: "#94a3b8", folder: "#facc15", other: "#a3a3a3" } as const;

export function buildMemoryGraph(records: readonly MemoryRecord[], categories: readonly MemoryCategory[], options: MemoryGraphOptions = {}): MemoryGraph {
  const maxRecords = Math.max(1, Math.round(options.maxRecords ?? 500));
  const selectedRecords = [...records].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, maxRecords);
  const categoryIds = new Set(selectedRecords.flatMap((record) => record.categoryIds));
  const selectedCategories = options.includeCategories === false ? [] : categories.filter((category) => categoryIds.has(category.id));
  const selectedCategoryIds = new Set(selectedCategories.map((category) => category.id));
  const nodes = [
    ...selectedRecords.map((record) => ({ id: `record:${record.id}`, kind: "record" as const, label: record.name, color: assetColors[record.kind], size: record.kind === "folder" ? 15 : 11, details: { description: record.description, path: record.path, assetKind: record.kind, mimeType: record.mimeType } })),
    ...selectedCategories.map((category) => ({ id: `category:${category.id}`, kind: "category" as const, label: category.name, color: category.color, size: category.kind === "folder" ? 18 : 16, details: { description: category.description, path: category.path ?? "", categoryKind: category.kind } }))
  ];
  const edges: MemoryGraphEdge[] = [];

  for (const record of selectedRecords) {
    for (const categoryId of record.categoryIds) {
      if (!selectedCategoryIds.has(categoryId)) continue;
      edges.push({ id: `category:${record.id}:${categoryId}`, source: `record:${record.id}`, target: `category:${categoryId}`, kind: "category", weight: 1, label: "Catalogato in" });
    }
  }
  for (const category of selectedCategories) {
    if (!category.parentId || !selectedCategoryIds.has(category.parentId)) continue;
    edges.push({ id: `folder:${category.id}:${category.parentId}`, source: `category:${category.id}`, target: `category:${category.parentId}`, kind: "folder", weight: 1, label: "Contenuto in" });
  }

  const threshold = Math.max(0, Math.min(1, options.similarityThreshold ?? .28));
  const maxNeighbors = Math.max(0, Math.round(options.maxSemanticNeighbors ?? 3));
  const candidates = new Map<string, Array<{ record: MemoryRecord; similarity: number }>>();
  for (let leftIndex = 0; leftIndex < selectedRecords.length; leftIndex += 1) {
    const left = selectedRecords[leftIndex]; if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < selectedRecords.length; rightIndex += 1) {
      const right = selectedRecords[rightIndex]; if (!right) continue;
      const similarity = cosineSimilarity(left.embedding, right.embedding);
      if (similarity < threshold) continue;
      candidates.set(left.id, [...(candidates.get(left.id) ?? []), { record: right, similarity }]);
      candidates.set(right.id, [...(candidates.get(right.id) ?? []), { record: left, similarity }]);
    }
  }
  const included = new Set<string>();
  for (const record of selectedRecords) {
    const neighbors = (candidates.get(record.id) ?? []).sort((left, right) => right.similarity - left.similarity).slice(0, maxNeighbors);
    for (const neighbor of neighbors) {
      const pair = [record.id, neighbor.record.id].sort().join(":");
      if (included.has(pair)) continue; included.add(pair);
      edges.push({ id: `semantic:${pair}`, source: `record:${record.id}`, target: `record:${neighbor.record.id}`, kind: "semantic", weight: neighbor.similarity, label: `${Math.round(neighbor.similarity * 100)}% simile` });
    }
  }
  return { nodes, edges };
}
