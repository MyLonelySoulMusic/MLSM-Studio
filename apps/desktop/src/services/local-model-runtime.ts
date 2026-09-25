import { verifiedFeatureExtractor } from "./verified-feature-extractor";

export interface LocalChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LocalGeneratedText {
  generated_text?: string | { content?: string }[];
}

export type LocalTextGenerator = (input: LocalChatMessage[], options: Record<string, unknown>) => Promise<LocalGeneratedText[]>;
export interface LocalFeatureTensor { data: Float32Array | number[]; dims: number[]; tolist: () => unknown; }
export type LocalFeatureExtractor = ((input: string | string[], options: { pooling: "mean"; normalize: true }) => Promise<LocalFeatureTensor>) & { embeddingSpace?: string; dispose?: () => Promise<void> };
export type LocalModelPhase = "idle" | "loading" | "ready" | "error";
export interface LocalModelStatus { phase: LocalModelPhase; message: string; }

const remoteModelRepositories = {
  "whisper-tiny_timestamped": "onnx-community/whisper-tiny_timestamped",
  "whisper-base_timestamped": "onnx-community/whisper-base_timestamped",
  "whisper-medium_timestamped": "onnx-community/whisper-medium_timestamped",
  "qwen2.5-0.5b-instruct": "onnx-community/Qwen2.5-0.5B-Instruct",
  "detr-resnet-50": "Xenova/detr-resnet-50",
  "Xenova/detr-resnet-50": "Xenova/detr-resnet-50",
  "paraphrase-multilingual-MiniLM-L12-v2": "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2": "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
} as const;

export const preferredLocalAssistantModel = "qwen2.5-0.5b-instruct";
export const preferredLocalAssistantLabel = "Qwen2.5 0.5B";

const transcriberPromises = new Map<string, Promise<unknown>>();
const textGeneratorPromises = new Map<string, Promise<unknown>>();
const objectDetectorPromises = new Map<string, Promise<unknown>>();
const featureExtractorPromises = new Map<string, Promise<unknown>>();
const readyTextGenerators = new Set<string>();
const localModelStatuses = new Map<string, LocalModelStatus>();
let persistentStorageRequest: Promise<boolean> | undefined;

interface ModelEnvironment {
  allowRemoteModels: boolean;
  allowLocalModels: boolean;
  useBrowserCache: boolean;
  localModelPath: string;
  backends?: { onnx?: { wasm?: { numThreads?: number; proxy?: boolean } } };
}

export const localModelMaximumCpuThreads = 2;

export function configureLocalModelCpu(environment: ModelEnvironment, logicalCores = typeof navigator === "undefined" ? localModelMaximumCpuThreads : navigator.hardwareConcurrency): number {
  const wasm = environment.backends?.onnx?.wasm;
  if (!wasm) return 0;
  const available = Number.isFinite(logicalCores) ? Math.max(1, Math.floor(logicalCores)) : localModelMaximumCpuThreads;
  const threads = Math.min(localModelMaximumCpuThreads, Math.max(1, Math.floor(available / 2)));
  wasm.numThreads = threads;
  // ONNX Runtime runs WASM inference in a worker so a fallback cannot freeze
  // the WebView UI thread while it is consuming its bounded CPU allowance.
  wasm.proxy = true;
  return threads;
}

function configureModelDownloads(environment: ModelEnvironment): void {
  const persistentDevelopmentCache = import.meta.env.DEV;
  environment.allowRemoteModels = true;
  environment.allowLocalModels = persistentDevelopmentCache;
  environment.localModelPath = persistentDevelopmentCache ? "/__local-models/" : "/models/";
  environment.useBrowserCache = !persistentDevelopmentCache && typeof caches !== "undefined";
  configureLocalModelCpu(environment);
}

function setLocalModelStatus(model: string, phase: LocalModelPhase, message: string, progress?: (message: string) => void): void {
  localModelStatuses.set(model, { phase, message });
  progress?.(message);
}

export function getLocalModelStatus(model: string): LocalModelStatus {
  return localModelStatuses.get(model) ?? { phase: "idle", message: `${model} is not initialized` };
}

export function remoteModelRepository(model: string): string {
  const repository = remoteModelRepositories[model as keyof typeof remoteModelRepositories];
  if (!repository) throw new Error(`Unsupported local model: ${model}`);
  return repository;
}

/** Converts the common Vite HTML fallback/invalid JSON response into an
 * actionable error instead of exposing the opaque `Unexpected token '<'` text. */
export function localModelErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed|failed to fetch|unexpected token\s*['"]?e\b.*(?:fetch failed|not valid json)/i.test(message)) {
    return "The local model download failed due to a network error. Check your connection and retry.";
  }
  return /unexpected token\s*['"]?<|<!doctype\s+html|returned html|invalid json/i.test(message)
    ? "The local model server returned an HTML or invalid JSON response. Restart the development server and retry the model download."
    : message;
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
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes("json")) throw new Error("Local model cache returned invalid JSON.");
        const data = await response.json().catch(() => { throw new Error("Local model cache returned invalid JSON."); }) as { files?: unknown };
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
  const source = fullFile && cachedFiles.has(fullFile) ? "Loading from cache" : "Initial download";
  if (progress !== null) return `${source} ${model} · ${Math.round(progress)}%${file ? ` · ${file}` : ""}`;
  if (data.status === "ready") return `${model} ready · persistent local cache`;
  return null;
}

async function createLocalPipeline(task: "automatic-speech-recognition" | "text-generation" | "object-detection" | "feature-extraction", model: string, progress?: (message: string) => void): Promise<unknown> {
  const transformers = await import("@huggingface/transformers");
  configureModelDownloads(transformers.env);
  await preserveModelCache();
  const repository = remoteModelRepository(model);
  const cachedFiles = await cachedFilesForRepository(repository);
  setLocalModelStatus(model, "loading", cachedFiles.size
    ? `Persistent disk cache for ${model} found · ${cachedFiles.size} files available`
    : `${import.meta.env.DEV ? "Persistent disk cache" : "Local cache"} for ${model} is empty · one-time download required`, progress);
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
  if (task === "feature-extraction") {
    return verifiedFeatureExtractor(
      async device => await transformers.pipeline("feature-extraction", repository, { dtype: "q8", device, progress_callback: reportProgress }) as unknown as LocalFeatureExtractor,
      Boolean(adapter), repository,
      message => setLocalModelStatus(model, "loading", message, progress),
    );
  }
  if (adapter) {
    const dtype = task === "text-generation" && adapter.features?.has("shader-f16") ? "q4f16" : "q4";
    try {
      setLocalModelStatus(model, "loading", `Initializing ${model} on WebGPU · ${dtype}`, progress);
      return await transformers.pipeline(task, repository, { dtype, device: "webgpu", progress_callback: reportProgress });
    } catch (error) {
      setLocalModelStatus(model, "loading", `WebGPU is not compatible with ${model}: ${localModelErrorMessage(error)} · retrying with WASM`, progress);
    }
  }
  setLocalModelStatus(model, "loading", `Initializing ${model} on WASM · q4`, progress);
  return transformers.pipeline(task, repository, { dtype: "q4", device: "wasm", progress_callback: reportProgress });
}

export async function getLocalFeatureExtractor(model: string, progress?: (message: string) => void): Promise<LocalFeatureExtractor> {
  let pipeline = featureExtractorPromises.get(model);
  if (!pipeline) {
    pipeline = createLocalPipeline("feature-extraction", model, progress).then((extractor) => {
      setLocalModelStatus(model, "ready", `${model} ready for local embeddings`, progress);
      return extractor;
    }).catch((error: unknown) => {
      featureExtractorPromises.delete(model);
      const message = localModelErrorMessage(error);
      setLocalModelStatus(model, "error", `${model} unavailable: ${message}`, progress);
      throw new Error(message, { cause: error });
    });
    featureExtractorPromises.set(model, pipeline);
  } else if (progress) {
    progress(getLocalModelStatus(model).message);
  }
  return pipeline as Promise<LocalFeatureExtractor>;
}

export function getLocalTranscriber(model: string, progress?: (message: string) => void): Promise<unknown> {
  let pipeline = transcriberPromises.get(model);
  if (!pipeline) { pipeline = createLocalPipeline("automatic-speech-recognition", model, progress).catch((error: unknown) => { transcriberPromises.delete(model); const message = localModelErrorMessage(error); setLocalModelStatus(model, "error", `${model} unavailable: ${message}`, progress); throw new Error(message, { cause: error }); }); transcriberPromises.set(model, pipeline); }
  return pipeline;
}

export async function getLocalTextGenerator(model: string, progress?: (message: string) => void): Promise<LocalTextGenerator> {
  let pipeline = textGeneratorPromises.get(model);
  if (!pipeline) {
    pipeline = createLocalPipeline("text-generation", model, progress).then((generator) => {
      readyTextGenerators.add(model);
      setLocalModelStatus(model, "ready", `${model} ready for responses`, progress);
      return generator;
    }).catch((error: unknown) => {
      textGeneratorPromises.delete(model); readyTextGenerators.delete(model);
      const message = localModelErrorMessage(error);
      setLocalModelStatus(model, "error", `${model} unavailable: ${message}`, progress);
      throw new Error(message, { cause: error });
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

export type LocalObjectDetector = (input: unknown, options?: Record<string, unknown>) => Promise<unknown>;

/** Lazy, cached DETR object detector. WebGPU is attempted first and the pipeline
 * falls back to WASM inside createLocalPipeline; failed promises are evicted so a
 * retry from the panel can recover after a transient model/cache error. */
export async function getLocalObjectDetector(model = "detr-resnet-50", progress?: (message: string) => void): Promise<LocalObjectDetector> {
  let pipeline = objectDetectorPromises.get(model);
  if (!pipeline) {
    pipeline = createLocalPipeline("object-detection", model, progress).then((detector) => {
      setLocalModelStatus(model, "ready", `${model} ready for object detection`, progress);
      return detector;
    }).catch((error: unknown) => {
      objectDetectorPromises.delete(model);
      const message = localModelErrorMessage(error);
      setLocalModelStatus(model, "error", `${model} unavailable: ${message}`, progress);
      throw new Error(message, { cause: error });
    });
    objectDetectorPromises.set(model, pipeline);
  } else if (progress) progress(getLocalModelStatus(model).message);
  return pipeline as Promise<LocalObjectDetector>;
}

export async function warmLocalTextGenerator(model: string, progress?: (message: string) => void): Promise<boolean> {
  try {
    await getLocalTextGenerator(model, progress);
    return true;
  } catch {
    progress?.(`${model} unavailable · using local knowledge base`);
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
    if (timedOut) throw new Error(`Local model timed out after ${Math.round(timeoutMs / 1_000)} seconds`);
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
