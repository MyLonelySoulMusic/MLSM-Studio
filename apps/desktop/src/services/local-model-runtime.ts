export interface LocalChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LocalGeneratedText {
  generated_text?: string | { content?: string }[];
}

export type LocalTextGenerator = (input: LocalChatMessage[], options: Record<string, unknown>) => Promise<LocalGeneratedText[]>;
export type LocalModelPhase = "idle" | "loading" | "ready" | "error";
export interface LocalModelStatus { phase: LocalModelPhase; message: string; }

const remoteModelRepositories = {
  "whisper-tiny_timestamped": "onnx-community/whisper-tiny_timestamped",
  "whisper-base_timestamped": "onnx-community/whisper-base_timestamped",
  "whisper-medium_timestamped": "onnx-community/whisper-medium_timestamped",
  "qwen2.5-0.5b-instruct": "onnx-community/Qwen2.5-0.5B-Instruct"
} as const;

export const preferredLocalAssistantModel = "qwen2.5-0.5b-instruct";
export const preferredLocalAssistantLabel = "Qwen2.5 0.5B";

const transcriberPromises = new Map<string, Promise<unknown>>();
const textGeneratorPromises = new Map<string, Promise<unknown>>();
const readyTextGenerators = new Set<string>();
const localModelStatuses = new Map<string, LocalModelStatus>();
let persistentStorageRequest: Promise<boolean> | undefined;

interface ModelEnvironment {
  allowRemoteModels: boolean;
  allowLocalModels: boolean;
  useBrowserCache: boolean;
  localModelPath: string;
}

function configureModelDownloads(environment: ModelEnvironment): void {
  const persistentDevelopmentCache = import.meta.env.DEV;
  environment.allowRemoteModels = true;
  environment.allowLocalModels = persistentDevelopmentCache;
  environment.localModelPath = persistentDevelopmentCache ? "/__local-models/" : "/models/";
  environment.useBrowserCache = !persistentDevelopmentCache && typeof caches !== "undefined";
}

function setLocalModelStatus(model: string, phase: LocalModelPhase, message: string, progress?: (message: string) => void): void {
  localModelStatuses.set(model, { phase, message });
  progress?.(message);
}

export function getLocalModelStatus(model: string): LocalModelStatus {
  return localModelStatuses.get(model) ?? { phase: "idle", message: `${model} non ancora inizializzato` };
}

export function remoteModelRepository(model: string): string {
  const repository = remoteModelRepositories[model as keyof typeof remoteModelRepositories];
  if (!repository) throw new Error(`Modello locale non supportato: ${model}`);
  return repository;
}

async function preserveModelCache(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return;
  persistentStorageRequest ??= navigator.storage.persist().catch(() => false);
  await persistentStorageRequest;
}

async function cachedFilesForRepository(repository: string): Promise<Set<string>> {
  if (import.meta.env.DEV) {
    try {
      const response = await fetch(`/__local-model-cache/status?repository=${encodeURIComponent(repository)}`);
      if (response.ok) {
        const data = await response.json() as { files?: unknown };
        if (Array.isArray(data.files)) return new Set(data.files.filter((file): file is string => typeof file === "string"));
      }
    } catch {
      // La pipeline segnalerà in modo esplicito l'eventuale indisponibilità del server locale.
    }
  }
  if (typeof caches === "undefined") return new Set();
  try {
    const cache = await caches.open("transformers-cache");
    const requests = await cache.keys();
    const marker = `/${repository}/resolve/`;
    return new Set(requests.flatMap((request) => {
      const url = decodeURIComponent(request.url);
      const markerIndex = url.indexOf(marker);
      if (markerIndex < 0) return [];
      const revisionAndFile = url.slice(markerIndex + marker.length);
      const fileSeparator = revisionAndFile.indexOf("/");
      return fileSeparator < 0 ? [] : [revisionAndFile.slice(fileSeparator + 1)];
    }));
  } catch {
    return new Set();
  }
}

export function modelProgressMessage(model: string, event: unknown, cachedFiles: ReadonlySet<string> = new Set()): string | null {
  if (!event || typeof event !== "object") return null;
  const data = event as Record<string, unknown>; const progress = typeof data.progress === "number" ? data.progress : null; const file = typeof data.file === "string" ? data.file.split("/").at(-1) : null;
  const fullFile = typeof data.file === "string" ? data.file : null;
  const source = fullFile && cachedFiles.has(fullFile) ? "Caricamento dalla cache" : "Download iniziale";
  if (progress !== null) return `${source} ${model} · ${Math.round(progress)}%${file ? ` · ${file}` : ""}`;
  if (data.status === "ready") return `${model} pronto · cache locale persistente`;
  return null;
}

async function createLocalPipeline(task: "automatic-speech-recognition" | "text-generation", model: string, progress?: (message: string) => void): Promise<unknown> {
  const transformers = await import("@huggingface/transformers");
  configureModelDownloads(transformers.env);
  await preserveModelCache();
  const repository = remoteModelRepository(model);
  const cachedFiles = await cachedFilesForRepository(repository);
  setLocalModelStatus(model, "loading", cachedFiles.size
    ? `Cache persistente su disco ${model} trovata · ${cachedFiles.size} file disponibili`
    : `${import.meta.env.DEV ? "Cache persistente su disco" : "Cache locale"} ${model} vuota · download necessario solo questa volta`, progress);
  const reportProgress = (event: unknown) => {
    const message = modelProgressMessage(model, event, cachedFiles);
    if (message) setLocalModelStatus(model, "loading", message, progress);
  };
  const gpu = typeof navigator === "undefined" ? undefined : (navigator as Navigator & {
    gpu?: { requestAdapter: () => Promise<{ features?: { has: (feature: string) => boolean } } | null> };
  }).gpu;
  let adapter: { features?: { has: (feature: string) => boolean } } | null = null;
  if (gpu) {
    try { adapter = await gpu.requestAdapter(); } catch { adapter = null; }
  }
  if (adapter) {
    const dtype = task === "text-generation" && adapter.features?.has("shader-f16") ? "q4f16" : "q4";
    try {
      setLocalModelStatus(model, "loading", `Inizializzazione ${model} su WebGPU · ${dtype}`, progress);
      return await transformers.pipeline(task, repository, { dtype, device: "webgpu", progress_callback: reportProgress });
    } catch (error) {
      setLocalModelStatus(model, "loading", `WebGPU non compatibile con ${model}: ${error instanceof Error ? error.message : String(error)} · nuovo tentativo WASM`, progress);
    }
  }
  setLocalModelStatus(model, "loading", `Inizializzazione ${model} su WASM · q4`, progress);
  return transformers.pipeline(task, repository, { dtype: "q4", device: "wasm", progress_callback: reportProgress });
}

export function getLocalTranscriber(model: string, progress?: (message: string) => void): Promise<unknown> {
  let pipeline = transcriberPromises.get(model);
  if (!pipeline) { pipeline = createLocalPipeline("automatic-speech-recognition", model, progress).catch((error: unknown) => { transcriberPromises.delete(model); throw error; }); transcriberPromises.set(model, pipeline); }
  return pipeline;
}

export async function getLocalTextGenerator(model: string, progress?: (message: string) => void): Promise<LocalTextGenerator> {
  let pipeline = textGeneratorPromises.get(model);
  if (!pipeline) {
    pipeline = createLocalPipeline("text-generation", model, progress).then((generator) => {
      readyTextGenerators.add(model);
      setLocalModelStatus(model, "ready", `${model} pronto per rispondere`, progress);
      return generator;
    }).catch((error: unknown) => {
      textGeneratorPromises.delete(model); readyTextGenerators.delete(model);
      setLocalModelStatus(model, "error", `${model} non disponibile: ${error instanceof Error ? error.message : String(error)}`, progress);
      throw error;
    });
    textGeneratorPromises.set(model, pipeline);
  } else if (progress) {
    progress(getLocalModelStatus(model).message);
  }
  return pipeline as Promise<LocalTextGenerator>;
}

export function isLocalTextGeneratorReady(model: string): boolean {
  return readyTextGenerators.has(model);
}

export async function warmLocalTextGenerator(model: string, progress?: (message: string) => void): Promise<boolean> {
  try {
    await getLocalTextGenerator(model, progress);
    return true;
  } catch {
    progress?.(`${model} non disponibile · uso knowledge base locale`);
    return false;
  }
}

export async function runLocalTextGeneration(generator: LocalTextGenerator, input: LocalChatMessage[], options: Record<string, unknown>, timeoutMs: number): Promise<LocalGeneratedText[]> {
  const { InterruptableStoppingCriteria, StoppingCriteriaList } = await import("@huggingface/transformers");
  const interrupt = new InterruptableStoppingCriteria();
  const stoppingCriteria = new StoppingCriteriaList();
  stoppingCriteria.push(interrupt);
  let timedOut = false;
  const timer = globalThis.setTimeout(() => { timedOut = true; interrupt.interrupt(); }, timeoutMs);
  try {
    const output = await generator(input, { ...options, stopping_criteria: stoppingCriteria });
    if (timedOut) throw new Error(`Timeout modello locale dopo ${Math.round(timeoutMs / 1_000)} secondi`);
    return output;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export function localGeneratedAnswer(output: LocalGeneratedText[]): string {
  const generated = output[0]?.generated_text;
  if (typeof generated === "string") return generated.trim();
  return generated?.at(-1)?.content?.trim() ?? "";
}
