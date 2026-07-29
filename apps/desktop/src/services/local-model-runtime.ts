export interface LocalChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LocalGeneratedText {
  generated_text?: string | { content?: string }[];
}

export type LocalTextGenerator = (input: LocalChatMessage[], options: Record<string, unknown>) => Promise<LocalGeneratedText[]>;

const remoteModelRepositories = {
  "whisper-tiny_timestamped": "onnx-community/whisper-tiny_timestamped",
  "whisper-base_timestamped": "onnx-community/whisper-base_timestamped",
  "whisper-medium_timestamped": "onnx-community/whisper-medium_timestamped",
  "smollm2-135m-instruct": "onnx-community/SmolLM2-135M-Instruct-ONNX"
} as const;

const transcriberPromises = new Map<string, Promise<unknown>>();
const textGeneratorPromises = new Map<string, Promise<unknown>>();
const readyTextGenerators = new Set<string>();
let persistentStorageRequest: Promise<boolean> | undefined;

interface ModelEnvironment {
  allowRemoteModels: boolean;
  allowLocalModels: boolean;
  useBrowserCache: boolean;
}

function configureModelDownloads(environment: ModelEnvironment): void {
  environment.allowRemoteModels = true;
  environment.allowLocalModels = false;
  environment.useBrowserCache = true;
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

function modelProgressMessage(model: string, event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const data = event as Record<string, unknown>; const progress = typeof data.progress === "number" ? data.progress : null; const file = typeof data.file === "string" ? data.file.split("/").at(-1) : null;
  if (progress !== null) return `Download iniziale ${model} · ${Math.round(progress)}%${file ? ` · ${file}` : ""}`;
  if (data.status === "ready") return `${model} pronto · cache locale persistente`;
  return null;
}

async function createLocalPipeline(task: "automatic-speech-recognition" | "text-generation", model: string, progress?: (message: string) => void): Promise<unknown> {
  const transformers = await import("@huggingface/transformers");
  configureModelDownloads(transformers.env);
  await preserveModelCache();
  const supportsWebGpu = typeof navigator !== "undefined" && "gpu" in navigator;
  const repository = remoteModelRepository(model);
  progress?.(`Verifica cache locale ${model}…`);
  return transformers.pipeline(task, repository, { dtype: "q4", device: supportsWebGpu ? "webgpu" : "wasm", progress_callback: (event: unknown) => { const message = modelProgressMessage(model, event); if (message) progress?.(message); } });
}

export function getLocalTranscriber(model: string, progress?: (message: string) => void): Promise<unknown> {
  let pipeline = transcriberPromises.get(model);
  if (!pipeline) { pipeline = createLocalPipeline("automatic-speech-recognition", model, progress).catch((error: unknown) => { transcriberPromises.delete(model); throw error; }); transcriberPromises.set(model, pipeline); }
  return pipeline;
}

export async function getLocalTextGenerator(model: string, progress?: (message: string) => void): Promise<LocalTextGenerator> {
  let pipeline = textGeneratorPromises.get(model);
  if (!pipeline) {
    pipeline = createLocalPipeline("text-generation", model, progress).then((generator) => { readyTextGenerators.add(model); return generator; }).catch((error: unknown) => { textGeneratorPromises.delete(model); readyTextGenerators.delete(model); throw error; });
    textGeneratorPromises.set(model, pipeline);
  }
  return pipeline as Promise<LocalTextGenerator>;
}

export function isLocalTextGeneratorReady(model: string): boolean {
  return readyTextGenerators.has(model);
}

export function warmLocalTextGenerator(model: string, progress?: (message: string) => void): void {
  void getLocalTextGenerator(model, progress).catch(() => progress?.(`${model} non disponibile · uso knowledge base locale`));
}

export function localGeneratedAnswer(output: LocalGeneratedText[]): string {
  const generated = output[0]?.generated_text;
  if (typeof generated === "string") return generated.trim();
  return generated?.at(-1)?.content?.trim() ?? "";
}
