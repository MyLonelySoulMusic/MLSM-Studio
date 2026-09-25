import { getLlmSettings, providerLabels, requestRemoteAnswer, type LlmProvider } from "../services/studio-settings";
import type { ArticleInput, BlogConnection, WordPressCategory } from "./types";

export interface AutoPostAiStatus { provider: LlmProvider; label: string; model: string }
export interface AutoPostCategoryMapping extends AutoPostAiStatus { categoryIds: number[] }

function availableProvider(settings: Awaited<ReturnType<typeof getLlmSettings>>): LlmProvider | null {
  const usable = (provider: LlmProvider | "local"): provider is LlmProvider => provider !== "local" && Boolean(settings.providers[provider]?.configured && settings.providers[provider]?.enabled);
  if (usable(settings.activeProvider)) return settings.activeProvider;
  return (Object.keys(settings.providers) as LlmProvider[]).find(usable) ?? null;
}

export async function getAutoPostAiStatus(): Promise<AutoPostAiStatus> {
  const settings = await getLlmSettings();
  const provider = availableProvider(settings);
  if (!provider) throw new Error("Configura e abilita un provider LLM via API nelle impostazioni di MLSM Studio.");
  return { provider, label: providerLabels[provider], model: settings.providers[provider].model };
}

function plainText(value: unknown, maximum = 1_000): string {
  return String(value ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ").trim().slice(0, maximum);
}

export function validateAutoPostCategoryMapping(content: string, targetCategories: WordPressCategory[]): number[] {
  const clean = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  let parsed: unknown;
  try {
    const object = clean.match(/\{[\s\S]*\}/)?.[0];
    const array = clean.match(/\[[\s\S]*\]/)?.[0];
    parsed = JSON.parse(object ?? array ?? clean);
  }
  catch { throw new Error("Il provider LLM non ha restituito una mappatura JSON valida."); }
  const rawIds = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).categoryIds : null;
  if (!Array.isArray(rawIds)) throw new Error("La risposta LLM non contiene categoryIds.");
  const allowed = new Set(targetCategories.map(category => category.id));
  const categoryIds = [...new Set(rawIds.map(Number).filter(id => Number.isInteger(id) && allowed.has(id)))];
  if (!categoryIds.length) throw new Error("L’LLM non ha individuato una categoria valida nel blog di destinazione.");
  return categoryIds.slice(0, 12);
}

export async function mapAutoPostCategories(article: ArticleInput, sourceBlog: BlogConnection, targetBlog: BlogConnection): Promise<AutoPostCategoryMapping> {
  const status = await getAutoPostAiStatus();
  if (!targetBlog.categories.length) throw new Error(`Il blog ${targetBlog.name} non espone categorie WordPress utilizzabili.`);
  const sourceIds = new Set(article.categories);
  const excerpt = plainText(article.excerpt, 450);
  const content = excerpt ? "" : plainText(article.content, 900);
  const payload = {
    article: { title: plainText(article.title, 220), ...(excerpt ? { excerpt } : { content }) },
    sourceBlog: sourceBlog.name,
    sourceCategories: sourceBlog.categories.filter(category => sourceIds.has(category.id)).map(({ id, name }) => ({ id, name: plainText(name, 120) })),
    targetBlog: targetBlog.name,
    targetCategories: targetBlog.categories.map(({ id, name }) => ({ id, name: plainText(name, 120) })),
  };
  const messages = [
    { role: "system" as const, content: "Sei un taxonomy editor WordPress. Associa l'articolo alle categorie semanticamente più pertinenti del blog destinazione. Ricava il tema da titolo e breve testo. Le categorie sorgente sono solo indizi: ignorale se generiche, errate o incoerenti. Usa esclusivamente ID presenti in targetCategories. Rispondi soltanto con JSON compatto: {\"categoryIds\":[1,2]}. Non inventare ID e non aggiungere testo." },
    { role: "user" as const, content: JSON.stringify(payload) },
  ];
  const reply = await requestRemoteAnswer(messages, { provider: status.provider, maxTokens: 256 });
  return { ...status, model: reply.model, categoryIds: validateAutoPostCategoryMapping(reply.content, targetBlog.categories) };
}
