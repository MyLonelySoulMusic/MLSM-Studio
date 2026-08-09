export type MemoryAssetKind = "image" | "video" | "audio" | "text" | "document" | "archive" | "folder" | "other";

export type MemoryCategoryKind = "custom" | "folder" | "media";

export interface MemoryCategory {
  id: string;
  name: string;
  kind: MemoryCategoryKind;
  description: string;
  color: string;
  path?: string;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryRecord {
  id: string;
  path: string;
  name: string;
  kind: MemoryAssetKind;
  mimeType: string;
  description: string;
  tags: string[];
  categoryIds: string[];
  sizeBytes?: number;
  modifiedAt?: string;
  previewUrl?: string;
  embedding: number[];
  embeddingVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryRecordInput {
  id?: string;
  path: string;
  name?: string;
  kind?: MemoryAssetKind;
  mimeType?: string;
  description?: string;
  tags?: readonly string[];
  categoryIds?: readonly string[];
  sizeBytes?: number;
  modifiedAt?: string;
  previewUrl?: string;
}

export interface MemoryCategoryInput {
  id?: string;
  name: string;
  kind?: MemoryCategoryKind;
  description?: string;
  color?: string;
  path?: string;
  parentId?: string;
}

export interface MemorySearchFilters {
  kinds?: readonly MemoryAssetKind[];
  categoryIds?: readonly string[];
  categoryMode?: "any" | "all";
  tags?: readonly string[];
  pathPrefix?: string;
}

export interface MemorySearchOptions extends MemorySearchFilters {
  limit?: number;
  minScore?: number;
}

export type MemorySearchReason = "name" | "description" | "tag" | "category" | "path" | "semantic";

export interface MemorySearchResult {
  record: MemoryRecord;
  score: number;
  semanticScore: number;
  lexicalScore: number;
  reasons: MemorySearchReason[];
}

export type MemoryGraphNodeKind = "record" | "category";

export interface MemoryGraphNode {
  id: string;
  kind: MemoryGraphNodeKind;
  label: string;
  color: string;
  size: number;
  details: {
    description: string;
    path: string;
    assetKind?: MemoryAssetKind;
    mimeType?: string;
    categoryKind?: MemoryCategoryKind;
  };
}

export type MemoryGraphEdgeKind = "category" | "folder" | "semantic";

export interface MemoryGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: MemoryGraphEdgeKind;
  weight: number;
  label: string;
}

export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
}

export interface MemoryGraphOptions {
  similarityThreshold?: number;
  maxSemanticNeighbors?: number;
  maxRecords?: number;
  includeCategories?: boolean;
}
