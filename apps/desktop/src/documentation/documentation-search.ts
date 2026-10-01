import { getLocalFeatureExtractor } from "../services/local-model-runtime";
import { featureRows } from "../services/verified-feature-extractor";
import { documentationSearchText, type DocumentationTopic } from "./documentation-content";

export const DOCUMENTATION_SEARCH_MODEL = "paraphrase-multilingual-MiniLM-L12-v2";
export type DocumentationSearchMode = "idle" | "lexical" | "semantic" | "fallback";
export interface DocumentationSearchResult { topic: DocumentationTopic; score: number; featureIndex?: number }

const vectorCache = new Map<string, number[][]>();

function normalized(value: string): string {
  return value.normalize("NFKD").toLocaleLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function terms(value: string): string[] { return [...new Set(normalized(value).split(/\s+/).filter((term) => term.length > 1))]; }

function lexicalScore(query: string, topic: DocumentationTopic): number {
  const needles = terms(query);
  if (!needles.length) return 0;
  const title = normalized(topic.title);
  const keywords = normalized(topic.keywords.join(" "));
  const body = normalized(documentationSearchText(topic));
  let score = 0;
  for (const needle of needles) {
    if (title.includes(needle)) score += 4;
    if (keywords.includes(needle)) score += 2.5;
    if (body.includes(needle)) score += 1;
  }
  if (body.includes(normalized(query))) score += 5;
  return score / (needles.length * 7 + 5);
}

export function lexicalDocumentationSearch(query: string, topics: DocumentationTopic[]): DocumentationSearchResult[] {
  if (!query.trim()) return topics.map((topic) => ({ topic, score: 1 }));
  return topics.map((topic) => {
    const score = lexicalScore(query, topic);
    const featureScores = topic.features.map((feature) => lexicalScore(query, { ...topic, title: feature.title, summary: feature.description, steps: [], features: [], keywords: topic.keywords }));
    const best = Math.max(0, ...featureScores);
    return { topic, score: Math.max(score, best), ...(best > score ? { featureIndex: featureScores.indexOf(best) } : {}) };
  }).filter((result) => result.score > 0).sort((a, b) => b.score - a.score || a.topic.title.localeCompare(b.topic.title));
}

function cosine(left: number[], right: number[]): number { return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0); }

export async function semanticDocumentationSearch(query: string, topics: DocumentationTopic[], progress?: (message: string) => void): Promise<DocumentationSearchResult[]> {
  const extractor = await getLocalFeatureExtractor(DOCUMENTATION_SEARCH_MODEL, progress);
  const key = `${extractor.embeddingSpace}:${topics.map((topic) => `${topic.id}:${documentationSearchText(topic)}`).join("|")}`;
  let vectors = vectorCache.get(key);
  if (!vectors) {
    progress?.("Indicizzazione locale della documentazione…");
    const texts = topics.map(documentationSearchText);
    vectors = [];
    for (let offset = 0; offset < texts.length; offset += 8) {
      progress?.(`Indicizzazione ${Math.min(offset + 8, texts.length)} / ${texts.length}…`);
      const tensor = await extractor(texts.slice(offset, offset + 8), { pooling: "mean", normalize: true });
      vectors.push(...featureRows(tensor, Math.min(8, texts.length - offset)));
    }
    vectorCache.set(key, vectors);
  }
  progress?.("Confronto semantico locale…");
  const [queryVector] = featureRows(await extractor([query], { pooling: "mean", normalize: true }), 1);
  if (!queryVector) throw new Error("Embedding della ricerca non disponibile.");
  const lexical = new Map(lexicalDocumentationSearch(query, topics).map((result) => [result.topic.id, result]));
  return topics.map((topic, index) => {
    const semantic = Math.max(0, cosine(queryVector, vectors![index] ?? []));
    const exact = lexical.get(topic.id);
    return { topic, score: semantic * .82 + (exact?.score ?? 0) * .18, ...(exact?.featureIndex !== undefined ? { featureIndex: exact.featureIndex } : {}) };
  }).sort((a, b) => b.score - a.score).slice(0, Math.min(8, topics.length));
}
