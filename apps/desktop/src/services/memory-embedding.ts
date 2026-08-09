import type { MemoryAssetKind } from "./memory-types";

export interface MemoryEmbedder {
  readonly dimensions: number;
  readonly version: string;
  embed(text: string): readonly number[] | Promise<readonly number[]>;
}

const semanticFamilies = [
  ["foto", "fotografia", "immagine", "image", "photo", "picture", "ritratto", "portrait"],
  ["video", "film", "filmato", "clip", "movie", "footage"],
  ["audio", "musica", "music", "canzone", "song", "brano", "track", "voce", "voice"],
  ["testo", "text", "documento", "document", "nota", "notes", "lyrics", "testi"],
  ["cartella", "folder", "directory", "archivio", "archive"],
  ["copertina", "cover", "artwork", "album"],
  ["verticale", "vertical", "ritratto", "portrait"],
  ["orizzontale", "horizontal", "landscape", "panorama"],
  ["rosso", "red"], ["rosa", "pink"], ["nero", "black"], ["bianco", "white"],
  ["blu", "blue"], ["verde", "green"], ["giallo", "yellow"], ["viola", "purple"],
  ["notte", "night", "notturno"], ["giorno", "day", "diurno"],
  ["strada", "street", "road"], ["citta", "city", "urbano", "urban"],
  ["felice", "happy", "gioia", "joy"], ["triste", "sad", "malinconia", "melancholy"]
] as const;

const semanticAliases = new Map<string, string>();
for (const [canonical, ...aliases] of semanticFamilies) {
  semanticAliases.set(canonical, canonical);
  for (const alias of aliases) semanticAliases.set(alias, canonical);
}

const kindTerms: Record<MemoryAssetKind, string> = {
  image: "foto fotografia immagine image photo picture",
  video: "video film filmato clip movie footage",
  audio: "audio musica music canzone song brano track",
  text: "testo text nota notes lyrics",
  document: "documento document testo text pdf",
  archive: "archivio archive zip compresso",
  folder: "cartella folder directory",
  other: "file elemento asset"
};

function normalizedText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function memoryTokens(value: string): string[] {
  const normalized = normalizedText(value);
  return normalized ? normalized.split(/\s+/u).filter((token) => token.length > 1) : [];
}

export function memoryCanonicalTokens(value: string): string[] {
  return memoryTokens(value).map((token) => semanticAliases.get(token) ?? token);
}

export function memoryKindTerms(kind: MemoryAssetKind): string {
  return kindTerms[kind];
}

function hashFeature(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function addFeature(vector: number[], feature: string, weight: number): void {
  const first = hashFeature(feature) % vector.length;
  const second = hashFeature(`semantic:${feature}`) % vector.length;
  vector[first] = (vector[first] ?? 0) + weight;
  vector[second] = (vector[second] ?? 0) + weight * .35;
}

export class DeterministicMemoryEmbedder implements MemoryEmbedder {
  readonly dimensions: number;
  readonly version: string;

  constructor(dimensions = 384) {
    this.dimensions = Math.max(64, Math.round(dimensions));
    this.version = `mlsm-hash-semantic-v1-${this.dimensions}`;
  }

  embed(text: string): readonly number[] {
    const rawTokens = memoryTokens(text);
    const canonicalTokens = rawTokens.map((token) => semanticAliases.get(token) ?? token);
    const vector = Array.from<number>({ length: this.dimensions }).fill(0);
    canonicalTokens.forEach((token, index) => {
      addFeature(vector, `word:${token}`, 1);
      const raw = rawTokens[index];
      if (raw && raw !== token) addFeature(vector, `alias:${token}`, .45);
      const next = canonicalTokens[index + 1];
      if (next) addFeature(vector, `pair:${token}_${next}`, 1.3);
      if (token.length >= 5) {
        for (let offset = 0; offset <= token.length - 3; offset += 1) addFeature(vector, `char:${token.slice(offset, offset + 3)}`, .12);
      }
    });
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return magnitude > 0 ? vector.map((value) => value / magnitude) : vector;
  }
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;
  let dot = 0; let leftMagnitude = 0; let rightMagnitude = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0; const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue; leftMagnitude += leftValue * leftValue; rightMagnitude += rightValue * rightValue;
  }
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator > 0 ? Math.max(-1, Math.min(1, dot / denominator)) : 0;
}
