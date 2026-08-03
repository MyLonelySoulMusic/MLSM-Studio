export type UpscalerModelId = "canvas" | "RealESRGAN_x4plus" | "RealESRGAN_x2plus" | "RealESRNet_x4plus" | "RealESRGAN_x4plus_anime_6B" | "realesr-general-x4v3" | "realesr-animevideov3";
export type UpscalerBackend = "auto" | "cuda" | "metal" | "webgpu" | "cpu";

export interface UpscalerModelDefinition {
  id: UpscalerModelId; label: string; nativeScale: 1 | 2 | 4; bestFor: string; pros: string; cons: string; speed: "fast" | "balanced" | "slow"; videoOptimized: boolean; modelUrl?: string; modelSizeMb: number; webExecutable: boolean;
}

export const upscalerModels: readonly UpscalerModelDefinition[] = [
  { id: "canvas", label: "Canvas Enhanced", nativeScale: 1, bestFor: "Anteprime rapide, correzione e ridimensionamento tradizionale", pros: "Immediato, offline e senza download.", cons: "Non ricostruisce nuovi dettagli mediante una rete neurale.", speed: "fast", videoOptimized: true, modelSizeMb: 0, webExecutable: true },
  { id: "RealESRGAN_x4plus", label: "RealESRGAN x4plus", nativeScale: 4, bestFor: "Fotografie, cinema e scene reali", pros: "Checkpoint RRDB 23 blocchi completo; massimo recupero di texture.", cons: "Più lento e pesante; può enfatizzare rumore o pelle.", speed: "slow", videoOptimized: false, modelUrl: "https://huggingface.co/notaneimu/onnx-image-models/resolve/main/RealESRGAN_x4plus.onnx", modelSizeMb: 67.2, webExecutable: true },
  { id: "RealESRGAN_x2plus", label: "RealESRGAN x2plus", nativeScale: 2, bestFor: "Foto e video già discreti, output 2×", pros: "Checkpoint RRDB 23 blocchi completo; dettaglio naturale.", cons: "Incremento di risoluzione limitato a 2×.", speed: "balanced", videoOptimized: false, modelUrl: "https://huggingface.co/notaneimu/onnx-image-models/resolve/main/2x-realesrgan-x2plus.onnx", modelSizeMb: 67.2, webExecutable: true },
  { id: "RealESRNet_x4plus", label: "RealESRNet x4plus", nativeScale: 4, bestFor: "Scene reali pulite, volti e materiali delicati", pros: "Risultato conservativo, stabile e con pochi dettagli inventati.", cons: "Richiede il servizio PyTorch locale collegato all’app web.", speed: "slow", videoOptimized: false, modelUrl: "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.1/RealESRNet_x4plus.pth", modelSizeMb: 67, webExecutable: false },
  { id: "RealESRGAN_x4plus_anime_6B", label: "RealESRGAN x4plus Anime 6B", nativeScale: 4, bestFor: "Anime, illustrazioni, fumetti e cartoon", pros: "Linee nette, checkpoint ufficiale compatto a 6 blocchi.", cons: "Sconsigliato per pelle e texture fotografiche.", speed: "fast", videoOptimized: false, modelUrl: "https://huggingface.co/deepghs/imgutils-models/resolve/main/real_esrgan/RealESRGAN_x4plus_anime_6B.onnx", modelSizeMb: 17.9, webExecutable: true },
  { id: "realesr-general-x4v3", label: "RealESR General x4v3", nativeScale: 4, bestFor: "Hardware modesto e contenuti reali misti", pros: "Poca memoria, elaborazione rapida e denoise regolabile.", cons: "Modello volutamente leggero: meno ricostruzione di x4plus.", speed: "fast", videoOptimized: true, modelUrl: "https://huggingface.co/notaneimu/onnx-image-models/resolve/main/realesr-general-x4v3.onnx", modelSizeMb: 4.87, webExecutable: true },
  { id: "realesr-animevideov3", label: "RealESR AnimeVideo v3", nativeScale: 4, bestFor: "Video anime e animazione 2D", pros: "Coerenza temporale, velocità e contorni puliti.", cons: "Richiede il servizio PyTorch locale collegato all’app web.", speed: "fast", videoOptimized: true, modelUrl: "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-animevideov3.pth", modelSizeMb: 2.4, webExecutable: false }
] as const;

export interface UpscalerHardware {
  platform: string; architecture: string; appleSilicon: boolean; cuda: boolean; webgpu: boolean; gpuName: string | null; recommendedBackend: Exclude<UpscalerBackend, "auto">;
}

interface NativeHardwareResult { platform: string; architecture: string; appleSilicon: boolean; cuda: boolean; gpuName: string | null }
interface PythonHardwareResult { mps?: boolean; cuda?: boolean; gpuName?: string }

export function chooseUpscalerBackend(hardware: Omit<UpscalerHardware, "recommendedBackend">): Exclude<UpscalerBackend, "auto"> {
  if (hardware.cuda) return "cuda";
  if (hardware.appleSilicon) return "metal";
  if (hardware.webgpu) return "webgpu";
  return "cpu";
}

export async function detectUpscalerHardware(): Promise<UpscalerHardware> {
  let native: NativeHardwareResult | null = null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    native = await invoke<NativeHardwareResult>("detect_upscaler_hardware");
  } catch { /* Browser build: continue with WebGPU and user-agent detection. */ }
  const gpu = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ info?: { vendor?: string; description?: string; device?: string } } | null> } }).gpu;
  let adapter: { info?: { vendor?: string; description?: string; device?: string } } | null = null;
  if (gpu) try { adapter = await gpu.requestAdapter(); } catch { adapter = null; }
  let python: PythonHardwareResult | null = null; try { const response = await fetch("http://127.0.0.1:8765/health", { signal: AbortSignal.timeout(800) }); if (response.ok) python = await response.json() as PythonHardwareResult; } catch { python = null; }
  const gpuName = native?.gpuName ?? python?.gpuName ?? adapter?.info?.description ?? adapter?.info?.device ?? adapter?.info?.vendor ?? null;
  const platform = native?.platform ?? (typeof navigator === "undefined" ? "unknown" : navigator.platform || "browser");
  const architecture = native?.architecture ?? "browser";
  const appleSilicon = native?.appleSilicon ?? Boolean(python?.mps || (/mac/i.test(platform) && /apple/i.test(gpuName ?? "")));
  const cuda = native?.cuda ?? Boolean(python?.cuda || /nvidia/i.test(gpuName ?? ""));
  const base = { platform, architecture, appleSilicon, cuda, webgpu: Boolean(adapter), gpuName };
  return { ...base, recommendedBackend: chooseUpscalerBackend(base) };
}

export function effectiveUpscalerBackend(selected: UpscalerBackend, hardware: UpscalerHardware): Exclude<UpscalerBackend, "auto"> {
  return selected === "auto" ? hardware.recommendedBackend : selected;
}

export function backendLabel(backend: Exclude<UpscalerBackend, "auto">): string {
  return ({ cuda: "NVIDIA CUDA", metal: "Apple Silicon · Metal", webgpu: "WebGPU", cpu: "CPU · WASM" } as const)[backend];
}
