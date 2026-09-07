import { invoke, isTauri } from "@tauri-apps/api/core";
import type { LocalChatMessage } from "./local-model-runtime";

export type LlmProvider = "nvidia" | "openai" | "gemini" | "xai";
export const providerLabels: Record<LlmProvider, string> = { nvidia: "NVIDIA", openai: "OpenAI", gemini: "Google Gemini", xai: "xAI / Grok" };
export interface LlmModelOption { id: string; label: string; note?: string; disabled?: boolean }
// Chat-capable model IDs checked against each provider's official catalog on 2026-09-07.
// Keeping this list in the client makes model selection useful before an API key exists.
export const llmModelCatalog: Record<LlmProvider, readonly LlmModelOption[]> = {
  nvidia: [
    { id: "moonshotai/kimi-k3", label: "Kimi K3", note: "verificato su NVIDIA" },
    { id: "nvidia/nemotron-3.5-lightning-30b-a3b", label: "Nemotron 3.5 Lightning 30B A3B", note: "veloce · verificato" },
    { id: "nvidia/nemotron-3-super-120b-a12b", label: "Nemotron 3 Super 120B A12B", note: "verificato" },
    { id: "minimaxai/minimax-m3", label: "MiniMax M3", note: "verificato" },
    { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", note: "compatto · verificato" },
  ],
  openai: [
    { id: "gpt-6-astra", label: "GPT-6 Astra", note: "most capable" },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", note: "professional work" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", note: "balanced" },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", note: "fast / economical" },
    { id: "gpt-5.5", label: "GPT-5.5" },
    { id: "gpt-5.4", label: "GPT-5.4" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
    { id: "gpt-5.4-nano", label: "GPT-5.4 nano" },
    { id: "gpt-4.1", label: "GPT-4.1", note: "non-reasoning" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
  ],
  gemini: [
    { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "recommended" },
    { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", note: "fast / economical" },
    { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview", note: "advanced reasoning" },
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemma-4-31b-it", label: "Gemma 4 31B IT" },
    { id: "gemma-4-26b-a4b-it", label: "Gemma 4 26B A4B IT" },
  ],
  xai: [
    { id: "grok-4.6", label: "Grok 4.6", note: "flagship / recommended" },
    { id: "grok-4.3", label: "Grok 4.3", note: "fast / balanced" },
    { id: "grok-build-0.1", label: "Grok Build 0.1", note: "coding" },
  ],
};
export const providerCatalogUrls: Record<LlmProvider, string> = {
  nvidia: "https://docs.api.nvidia.com/nim/reference/llm-apis",
  openai: "https://developers.openai.com/api/docs/models",
  gemini: "https://ai.google.dev/gemini-api/docs/models",
  xai: "https://docs.x.ai/developers/models",
};
export interface ProviderSettings { configured: boolean; enabled: boolean; model: string; keySource: "settings" | "environment" | "none"; endpoint: string; provider: LlmProvider }
export interface LlmSettings { activeProvider: LlmProvider | "local"; providers: Record<LlmProvider, ProviderSettings> }
export interface DiskCache { id: string; label: string; path: string; bytes: number }
export interface RemoteLlmReply { content: string; model: string; source: LlmProvider }
export async function settingsRequest<T>(request: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (isTauri()) return invoke<T>("studio_settings", { request });
  const response = await fetch("/__mlsm/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: signal ?? AbortSignal.timeout(65_000) });
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Settings backend unavailable");
  const payload = await response.json() as { result?: T; error?: string };
  if (!response.ok || payload.error || payload.result === undefined) throw new Error(payload.error ?? `Settings HTTP ${response.status}`);
  return payload.result;
}
export const getLlmSettings = () => settingsRequest<LlmSettings>({ action: "status" });
export const saveLlmSettings = (settings: { provider: LlmProvider; activeProvider?: LlmProvider | "local"; model: string; enabled: boolean; apiKey?: string; removeKey?: boolean }) => settingsRequest<LlmSettings>({ action: "configure", ...settings });
export const requestRemoteAnswer = (messages: LocalChatMessage[]) => settingsRequest<RemoteLlmReply>({ action: "chat", messages });
