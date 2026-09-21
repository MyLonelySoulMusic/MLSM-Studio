import * as ort from "onnxruntime-web";
import type { RhythmBallProject } from "@rbs/project-schema";
import ortWasmJsepUrl from "../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url";
import { upscalerModels } from "./upscaler-runtime";
import { generatePythonUpscale, pythonUpscalerHealth, shouldUsePythonUpscaler } from "./upscaler-python-client";
import { canvasImageSourceSize } from "./canvas-image-source";
import { generateRemoteUpscale, usesRemoteUpscaler } from "./remote-upscaler-client";
import { generateMlxDlssImage } from "./mlx-dlss-client";

type Settings = RhythmBallProject["animation"]["upscaler"];
export interface ModelLoadProgress { phase: "cache" | "download" | "initializing" | "inference" | "ready"; progress: number; loadedBytes?: number; totalBytes?: number }

const cacheName = "dynamic-sound-upscaler-models-v1";
const sessions = new Map<string, Promise<ort.InferenceSession>>();

// The bundled ONNX module cannot infer its WASM location after Vite hashes the
// asset. Without this explicit URL the SPA fallback returns index.html and the
// runtime tries to compile "<!doctype" as WebAssembly.
ort.env.wasm.wasmPaths = { wasm: ortWasmJsepUrl };
ort.env.wasm.proxy = false;

function definition(model: Settings["model"]) { return upscalerModels.find((item) => item.id === model); }

async function cachedModel(url: string, onProgress: (status: ModelLoadProgress) => void, signal?: AbortSignal): Promise<ArrayBuffer> {
  const cache = typeof caches === "undefined" ? null : await caches.open(cacheName);
  const cached = await cache?.match(url);
  if (cached) { onProgress({ phase: "cache", progress: 1 }); return cached.arrayBuffer(); }
  const response = await fetch(url, signal ? { signal } : undefined); if (!response.ok) throw new Error(`Download modello fallito: HTTP ${response.status}.`);
  const total = Number(response.headers.get("content-length")) || 0; const reader = response.body?.getReader();
  if (!reader) { const buffer = await response.arrayBuffer(); onProgress({ phase: "download", progress: 1, loadedBytes: buffer.byteLength, totalBytes: buffer.byteLength }); return buffer; }
  const chunks: Uint8Array[] = []; let loaded = 0;
  while (true) { const item = await reader.read(); if (item.done) break; chunks.push(item.value); loaded += item.value.byteLength; onProgress(total ? { phase: "download", progress: loaded / total, loadedBytes: loaded, totalBytes: total } : { phase: "download", progress: 0, loadedBytes: loaded }); }
  const blob = new Blob(chunks as BlobPart[], { type: "application/octet-stream" }); if (cache) await cache.put(url, new Response(blob, { headers: { "Content-Type": "application/octet-stream" } }));
  onProgress({ phase: "download", progress: 1, loadedBytes: loaded, totalBytes: total || loaded }); return blob.arrayBuffer();
}

async function sessionFor(settings: Settings, onProgress: (status: ModelLoadProgress) => void, signal?: AbortSignal): Promise<ort.InferenceSession> {
  const model = definition(settings.model); if (!model?.modelUrl) throw new Error("Questo profilo non possiede un checkpoint configurato.");
  if (!model.webExecutable) throw new Error(`${model.label} usa il checkpoint PyTorch ufficiale e sarà eseguibile nella build desktop; nel browser scegli un modello ONNX oppure Canvas Enhanced.`);
  const key = `${settings.model}:${settings.backend}`; const existing = sessions.get(key); if (existing) { onProgress({ phase: "cache", progress: 1 }); return existing; }
  const pending = (async () => {
    const bytes = await cachedModel(model.modelUrl!, onProgress, signal); onProgress({ phase: "initializing", progress: 0 });
    const useGpu = settings.backend !== "cpu"; const executionProviders = useGpu ? ["webgpu", "wasm"] : ["wasm"];
    const session = await ort.InferenceSession.create(bytes, { executionProviders }); onProgress({ phase: "initializing", progress: 1 }); return session;
  })(); sessions.set(key, pending);
  try { return await pending; } catch (error) { sessions.delete(key); throw error; }
}

export async function generateAiUpscalerPreview(source: CanvasImageSource, settings: Settings, onProgress: (status: ModelLoadProgress) => void, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  if (settings.provider === "mlx-dlss") return generateMlxDlssImage(source, settings, onProgress, signal);
  if (usesRemoteUpscaler(settings)) return generateRemoteUpscale(source, settings, onProgress, signal);
  const model = definition(settings.model); if (!model || model.id === "canvas") throw new Error("Canvas Enhanced non richiede un modello AI.");
  const python = await pythonUpscalerHealth(); const preferPython = shouldUsePythonUpscaler(model.webExecutable, settings.backend, python);
  if (preferPython) return generatePythonUpscale(source, settings, onProgress, signal);
  const session = await sessionFor(settings, onProgress, signal); if (signal?.aborted) throw new DOMException("Operazione annullata", "AbortError");
  const dimensions = canvasImageSourceSize(source); const tileSize = Math.max(64, Math.min(1024, settings.tileSize)); const tilePad = 10; const columns = Math.ceil(dimensions.width / tileSize); const rows = Math.ceil(dimensions.height / tileSize); const totalPasses = columns * rows * (settings.tta ? 2 : 1); let completedPasses = 0;
  const result = document.createElement("canvas"); result.width = settings.finalWidth; result.height = settings.finalHeight; const resultContext = result.getContext("2d", { alpha: false }); if (!resultContext) throw new Error("Canvas risultato non disponibile."); resultContext.imageSmoothingEnabled = true; resultContext.imageSmoothingQuality = "high";
  const inputName = session.inputNames[0]; const outputName = session.outputNames[0]; if (!inputName || !outputName) throw new Error("Input/output ONNX non riconosciuti.");
  const inferTile = async (tile: HTMLCanvasElement, flip: boolean): Promise<HTMLCanvasElement> => {
    const width = tile.width; const height = tile.height; let inputTile = tile;
    if (flip) { inputTile = document.createElement("canvas"); inputTile.width = width; inputTile.height = height; const flippedContext = inputTile.getContext("2d"); if (!flippedContext) throw new Error("Canvas TTA non disponibile."); flippedContext.translate(width, 0); flippedContext.scale(-1, 1); flippedContext.drawImage(tile, 0, 0); }
    const context = inputTile.getContext("2d", { willReadFrequently: true }); if (!context) throw new Error("Canvas tile non disponibile.");
    const pixels = context.getImageData(0, 0, width, height).data; const plane = width * height; const data = new Float32Array(plane * 3);
    for (let index = 0; index < plane; index += 1) { data[index] = pixels[index * 4]! / 255; data[plane + index] = pixels[index * 4 + 1]! / 255; data[plane * 2 + index] = pixels[index * 4 + 2]! / 255; }
    const outputs = await session.run({ [inputName]: new ort.Tensor("float32", data, [1, 3, height, width]) }); const output = outputs[outputName]; if (!output || output.dims.length < 4) throw new Error("Output ONNX non riconosciuto.");
    const outputHeight = Number(output.dims[2]); const outputWidth = Number(output.dims[3]); const values = output.data as Float32Array; const outputPlane = outputWidth * outputHeight; const canvas = document.createElement("canvas"); canvas.width = outputWidth; canvas.height = outputHeight; const outputContext = canvas.getContext("2d"); if (!outputContext) throw new Error("Canvas tile risultato non disponibile.");
    const image = outputContext.createImageData(outputWidth, outputHeight); for (let index = 0; index < outputPlane; index += 1) { image.data[index * 4] = Math.max(0, Math.min(255, Math.round(values[index]! * 255))); image.data[index * 4 + 1] = Math.max(0, Math.min(255, Math.round(values[outputPlane + index]! * 255))); image.data[index * 4 + 2] = Math.max(0, Math.min(255, Math.round(values[outputPlane * 2 + index]! * 255))); image.data[index * 4 + 3] = 255; } outputContext.putImageData(image, 0, 0);
    let corrected = canvas; if (flip) { corrected = document.createElement("canvas"); corrected.width = outputWidth; corrected.height = outputHeight; const correctedContext = corrected.getContext("2d"); if (!correctedContext) throw new Error("Canvas TTA risultato non disponibile."); correctedContext.translate(outputWidth, 0); correctedContext.scale(-1, 1); correctedContext.drawImage(canvas, 0, 0); }
    completedPasses += 1; onProgress({ phase: "inference", progress: completedPasses / totalPasses }); return corrected;
  };
  onProgress({ phase: "inference", progress: 0 });
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    if (signal?.aborted) throw new DOMException("Operazione annullata", "AbortError"); const x = column * tileSize; const y = row * tileSize; const coreWidth = Math.min(tileSize, dimensions.width - x); const coreHeight = Math.min(tileSize, dimensions.height - y); const left = Math.max(0, x - tilePad); const top = Math.max(0, y - tilePad); const right = Math.min(dimensions.width, x + coreWidth + tilePad); const bottom = Math.min(dimensions.height, y + coreHeight + tilePad); const sampledWidth = right - left; const sampledHeight = bottom - top; const paddedWidth = Math.ceil(sampledWidth / 4) * 4; const paddedHeight = Math.ceil(sampledHeight / 4) * 4;
    const tile = document.createElement("canvas"); tile.width = paddedWidth; tile.height = paddedHeight; const tileContext = tile.getContext("2d", { alpha: false }); if (!tileContext) throw new Error("Canvas tile non disponibile."); tileContext.drawImage(source, left, top, sampledWidth, sampledHeight, 0, 0, sampledWidth, sampledHeight);
    const first = await inferTile(tile, false); let enhanced = first; if (settings.tta) { const second = await inferTile(tile, true); const firstContext = first.getContext("2d"); if (firstContext) { firstContext.globalAlpha = .5; firstContext.drawImage(second, 0, 0); firstContext.globalAlpha = 1; } enhanced = first; }
    const nativeScaleX = enhanced.width / paddedWidth; const nativeScaleY = enhanced.height / paddedHeight; const cropX = (x - left) * nativeScaleX; const cropY = (y - top) * nativeScaleY; const cropWidth = coreWidth * nativeScaleX; const cropHeight = coreHeight * nativeScaleY; const destinationX = x / dimensions.width * result.width; const destinationY = y / dimensions.height * result.height; const destinationWidth = coreWidth / dimensions.width * result.width; const destinationHeight = coreHeight / dimensions.height * result.height;
    resultContext.drawImage(enhanced, cropX, cropY, cropWidth, cropHeight, destinationX, destinationY, destinationWidth, destinationHeight);
  }
  onProgress({ phase: "ready", progress: 1 }); return result;
}

export async function isUpscalerModelCached(modelId: Settings["model"]): Promise<boolean> {
  const model = definition(modelId); if (!model?.modelUrl || typeof caches === "undefined") return modelId === "canvas"; const cache = await caches.open(cacheName); return Boolean(await cache.match(model.modelUrl));
}
