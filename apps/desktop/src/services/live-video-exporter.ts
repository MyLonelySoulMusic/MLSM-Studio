import type { ExportProgress } from "@rbs/export-engine";
import type { BackgroundAppearance, BallAppearance } from "../store/scene-store";

export interface SharedViewportRenderer {
  canvas: HTMLCanvasElement;
  setExportSize: (width: number, height: number) => void;
  restorePreviewSize: () => void;
  renderNow: () => void;
}

export type ExportQuality = "high" | "maximum";
export interface LiveVideoExportSettings { width: number; height: number; fps: number; durationSeconds: number; projectName: string; quality: ExportQuality; }
export interface RecordingFormat { mimeType: string; extension: ".mp4" | ".webm"; label: string; }
export interface CanvasFrameCapture { stream: MediaStream; requestFrame: () => void; manual: boolean; }

const formats: readonly RecordingFormat[] = [
  { mimeType: "video/mp4;codecs=avc1.640028,mp4a.40.2", extension: ".mp4", label: "MP4 H.264/AAC" },
  { mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", extension: ".mp4", label: "MP4 H.264/AAC" },
  { mimeType: "video/webm;codecs=vp9,opus", extension: ".webm", label: "WebM VP9/Opus" },
  { mimeType: "video/webm;codecs=vp8,opus", extension: ".webm", label: "WebM VP8/Opus" }
];

export function selectRecordingFormat(supports: (mimeType: string) => boolean): RecordingFormat | null { return formats.find((format) => supports(format.mimeType)) ?? null; }
export function recordingBitrate(width: number, height: number, fps: number, quality: ExportQuality = "maximum"): number {
  const bitsPerPixel = quality === "maximum" ? .24 : .14; const minimum = quality === "maximum" ? 12_000_000 : 8_000_000; const maximum = quality === "maximum" ? 160_000_000 : 100_000_000;
  return Math.round(Math.max(minimum, Math.min(maximum, width * height * fps * bitsPerPixel)));
}

function loadImage(source: string | null): Promise<HTMLImageElement | null> {
  if (!source) return Promise.resolve(null);
  return new Promise((resolve) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => resolve(null); image.src = source; });
}

function drawMedia(context: CanvasRenderingContext2D, source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number, opacity: number, fit: "cover" | "contain" = "cover"): void {
  if (!sourceWidth || !sourceHeight) return; const scale = fit === "contain" ? Math.min(width / sourceWidth, height / sourceHeight) : Math.max(width / sourceWidth, height / sourceHeight); const drawWidth = sourceWidth * scale; const drawHeight = sourceHeight * scale;
  context.save(); context.globalAlpha = opacity; context.drawImage(source, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight); context.restore();
}

function drawBackground(context: CanvasRenderingContext2D, width: number, height: number, background: BackgroundAppearance, image: HTMLImageElement | null, video: HTMLVideoElement | null, frame: number, mediaFit: "cover" | "contain" = "cover"): void {
  const gradient = context.createLinearGradient(0, 0, 0, height); gradient.addColorStop(0, background.colors[0]); gradient.addColorStop(1, background.colors[1]); context.fillStyle = gradient; context.fillRect(0, 0, width, height);
  if (background.mediaType === "image" && image) drawMedia(context, image, image.naturalWidth, image.naturalHeight, width, height, background.opacity, mediaFit);
  if (background.mediaType === "video" && video?.videoWidth) drawMedia(context, video, video.videoWidth, video.videoHeight, width, height, background.opacity, mediaFit);
  if (background.effects.glow) { const glow = context.createRadialGradient(width * .5, height * .36, 0, width * .5, height * .36, width * .68); glow.addColorStop(0, "rgba(117,168,255,.15)"); glow.addColorStop(.42, "rgba(128,82,255,.08)"); glow.addColorStop(1, "rgba(0,0,0,0)"); context.fillStyle = glow; context.fillRect(0, 0, width, height); }
  if (background.effects.particles) { context.fillStyle = "rgba(214,236,255,.42)"; const size = Math.max(1, width / 1100); for (let index = 0; index < 80; index += 1) { const x = (Math.sin(index * 91.17) * .5 + .5) * width; const y = ((Math.cos(index * 37.31) * .5 + .5) * height + frame * .32) % height; context.beginPath(); context.arc(x, y, size, 0, Math.PI * 2); context.fill(); } }
  if (background.finish === "worn") { context.strokeStyle = "rgba(238,218,181,.09)"; context.lineWidth = Math.max(1, width / 1300); for (let index = 0; index < 32; index += 1) { const x = (Math.sin(index * 43.71) * .5 + .5) * width; const y = (Math.cos(index * 19.33) * .5 + .5) * height; context.beginPath(); context.moveTo(x, y); context.lineTo(x + width * (.018 + index % 4 * .008), y - height * .05); context.stroke(); } }
}

function drawVignette(context: CanvasRenderingContext2D, width: number, height: number): void { const vignette = context.createRadialGradient(width / 2, height / 2, width * .3, width / 2, height / 2, width * .82); vignette.addColorStop(0, "rgba(0,0,0,0)"); vignette.addColorStop(.72, "rgba(0,0,0,0)"); vignette.addColorStop(1, "rgba(2,4,11,.24)"); context.fillStyle = vignette; context.fillRect(0, 0, width, height); }

function revealProgress(ball: BallAppearance, time: number, sourceDuration: number): number {
  if (!ball.endRevealEnabled || !ball.innerImageUrl) return 0; const start = ball.revealMode === "end" ? Math.max(0, sourceDuration - 1.15) : Math.max(0, Math.min(sourceDuration, ball.revealTimeSeconds)); return Math.max(0, Math.min(1, (time - start) / 1.15));
}

function drawFinalImage(context: CanvasRenderingContext2D, image: HTMLImageElement | null, ball: BallAppearance, time: number, sourceDuration: number, width: number, height: number): void {
  if (!image) return; const reveal = revealProgress(ball, time, sourceDuration); const progress = Math.max(0, Math.min(1, (reveal - .16) / .84)); if (progress <= 0) return; const eased = 1 - Math.pow(1 - progress, 3); const scale = .9 * Math.min(width / image.naturalWidth, height / image.naturalHeight); const drawWidth = image.naturalWidth * scale; const drawHeight = image.naturalHeight * scale;
  context.save(); context.fillStyle = `rgba(3,5,12,${eased * .68})`; context.fillRect(0, 0, width, height); context.globalAlpha = eased; context.translate(width / 2, height / 2); context.scale(Math.max(.04, Math.sin(eased * Math.PI / 2)), 1); context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight); context.restore();
}

const audioNodes = new WeakMap<HTMLAudioElement, { context: AudioContext; destination: MediaStreamAudioDestinationNode; monitor: GainNode }>();
async function audioTracks(audio: HTMLAudioElement): Promise<MediaStreamTrack[]> {
  let nodes = audioNodes.get(audio);
  if (!nodes) {
    const context = new AudioContext();
    const source = context.createMediaElementSource(audio);
    const destination = context.createMediaStreamDestination();
    const monitor = context.createGain();
    monitor.gain.value = 0;
    source.connect(destination);
    source.connect(monitor);
    monitor.connect(context.destination);
    nodes = { context, destination, monitor };
    audioNodes.set(audio, nodes);
  }
  nodes.monitor.gain.setValueAtTime(0, nodes.context.currentTime);
  if (nodes.context.state === "suspended") await nodes.context.resume();
  // La registrazione riceve una copia: fermare lo stream di export non rende
  // inutilizzabile il nodo audio permanente per gli export successivi.
  return nodes.destination.stream.getAudioTracks().map((track) => track.clone());
}

function setAudioMonitoring(audio: HTMLAudioElement, enabled: boolean): void {
  const nodes = audioNodes.get(audio);
  if (nodes) nodes.monitor.gain.setValueAtTime(enabled ? 1 : 0, nodes.context.currentTime);
}

async function createTempTarget(): Promise<{ directory: FileSystemDirectoryHandle; name: string; handle: FileSystemFileHandle; writable: FileSystemWritableFileStream } | null> {
  try { const root = await navigator.storage.getDirectory(); const directory = await root.getDirectoryHandle("dynamic-sound-animation-studio-temp", { create: true }); const name = `render-${crypto.randomUUID()}.part`; const handle = await directory.getFileHandle(name, { create: true }); return { directory, name, handle, writable: await handle.createWritable() }; } catch { return null; }
}

async function cleanupOrphanedTempTargets(): Promise<void> {
  const folderNames = ["dynamic-sound-animation-studio-temp", "rhythm-ball-studio-temp"];
  for (const folderName of folderNames) {
    try { const root = await navigator.storage.getDirectory(); const directory = await root.getDirectoryHandle(folderName); if (!directory.keys) continue; for await (const name of directory.keys()) if (name.startsWith("render-") && name.endsWith(".part")) await directory.removeEntry(name).catch(() => undefined); } catch { /* La cartella può non esistere ancora o non supportare l'iterazione. */ }
  }
}

function safeName(value: string): string { const normalized = value.normalize("NFKD").replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, ""); return normalized || "dynamic-sound-animation"; }
function nextFrame(): Promise<void> { return new Promise((resolve) => requestAnimationFrame(() => resolve())); }

export function createCanvasFrameCapture(canvas: HTMLCanvasElement, fps: number): CanvasFrameCapture {
  try { const manualStream = canvas.captureStream(0); const manualTrack = manualStream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined; if (manualTrack?.requestFrame) return { stream: manualStream, requestFrame: () => manualTrack.requestFrame?.(), manual: true }; manualStream.getTracks().forEach((track) => track.stop()); }
  catch { /* Alcuni WebKit meno recenti rifiutano frameRate=0. */ }
  const automaticStream = canvas.captureStream(fps); return { stream: automaticStream, requestFrame: () => undefined, manual: false };
}

export function exportFrameIndex(elapsedMs: number, fps: number, durationSeconds: number): number { const totalFrames = Math.max(1, Math.ceil(durationSeconds * fps)); return Math.min(totalFrames - 1, Math.max(0, Math.floor(elapsedMs / 1000 * fps))); }

export async function exportLiveVideo(settings: LiveVideoExportSettings, renderer: SharedViewportRenderer, audio: HTMLAudioElement, background: BackgroundAppearance, ball: BallAppearance, sourceDuration: number, setRenderTime: (time: number | null) => void, signal: AbortSignal, onProgress: (progress: ExportProgress) => void, videoDimming = 0, videoFit: "cover" | "contain" = "cover"): Promise<{ format: RecordingFormat; fileName: string }> {
  if (signal.aborted) throw new DOMException("Esportazione annullata", "AbortError");
  const format = selectRecordingFormat((mimeType) => MediaRecorder.isTypeSupported(mimeType)); if (!format) throw new Error("Il browser non dispone di un encoder video MediaRecorder compatibile.");
  const fileName = `${safeName(settings.projectName)}-${settings.width}x${settings.height}-${settings.fps}fps${format.extension}`;
  const destination = window.showSaveFilePicker ? await window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: format.label, accept: { [format.mimeType.split(";")[0] ?? format.mimeType]: [format.extension] } }] }) : null; await cleanupOrphanedTempTargets();
  const image = background.mediaType === "image" ? await loadImage(background.imageUrl) : null; const innerImage = await loadImage(ball.innerImageUrl);
  const composite = document.createElement("canvas"); composite.width = settings.width; composite.height = settings.height; const context = composite.getContext("2d", { alpha: false }); if (!context) throw new Error("Canvas di composizione non disponibile"); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
  const previousTime = audio.currentTime; const wasPlaying = !audio.paused; const chunks: Blob[] = []; const totalFrames = Math.ceil(settings.durationSeconds * settings.fps);
  let stream: MediaStream | null = null; let recorder: MediaRecorder | null = null; let stopped: Promise<void> | null = null; let temp: Awaited<ReturnType<typeof createTempTarget>> = null; let tempClosed = false; let destinationWritable: FileSystemWritableFileStream | null = null; let destinationClosed = false; let writeChain = Promise.resolve(); let started = performance.now();
  try {
    renderer.setExportSize(settings.width, settings.height); setRenderTime(0); await nextFrame(); renderer.renderNow();
    const previewFrame = renderer.canvas.closest(".preview-frame"); const backgroundVideo = previewFrame?.querySelector<HTMLVideoElement>(".scene-backdrop-video") ?? null;
    const frameCapture = createCanvasFrameCapture(composite, settings.fps); stream = frameCapture.stream; for (const track of await audioTracks(audio)) stream.addTrack(track);
    recorder = new MediaRecorder(stream, { mimeType: format.mimeType, videoBitsPerSecond: recordingBitrate(settings.width, settings.height, settings.fps, settings.quality), audioBitsPerSecond: 320_000 }); destinationWritable = destination ? await destination.createWritable() : null; temp = destinationWritable ? null : await createTempTarget(); const chunkWriter = destinationWritable ?? temp?.writable ?? null;
    recorder.ondataavailable = (event) => { if (!event.data.size) return; if (chunkWriter) writeChain = writeChain.then(() => chunkWriter.write(event.data)); else chunks.push(event.data); };
    stopped = new Promise<void>((resolve, reject) => { if (!recorder) return reject(new Error("Encoder video non disponibile")); recorder.onstop = () => resolve(); recorder.onerror = () => reject(new Error("Errore durante la codifica video")); });
    const renderCompositeFrame = (time: number, frame: number) => { setRenderTime(time); renderer.renderNow(); drawBackground(context, settings.width, settings.height, background, image, backgroundVideo, frame, videoFit); if (videoDimming > 0) { context.save(); context.globalAlpha = Math.max(0, Math.min(.8, videoDimming)); context.fillStyle = "#000000"; context.fillRect(0, 0, settings.width, settings.height); context.restore(); } context.drawImage(renderer.canvas, 0, 0, settings.width, settings.height); if (background.effects.vignette) drawVignette(context, settings.width, settings.height); drawFinalImage(context, innerImage, ball, time, sourceDuration, settings.width, settings.height); frameCapture.requestFrame(); };
    audio.pause(); audio.currentTime = 0; recorder.start(1000); await audio.play(); started = performance.now(); renderCompositeFrame(0, 0);
    await new Promise<void>((resolve, reject) => {
      let animationFrame = 0; let lastFrame = 0; const abort = () => { cancelAnimationFrame(animationFrame); reject(new DOMException("Esportazione annullata", "AbortError")); }; signal.addEventListener("abort", abort, { once: true });
      const tick = (now: number) => { try { const elapsedMs = now - started; const time = Math.min(settings.durationSeconds, elapsedMs / 1000); const targetFrame = exportFrameIndex(elapsedMs, settings.fps, settings.durationSeconds); if (targetFrame > lastFrame) { renderCompositeFrame(targetFrame / settings.fps, targetFrame); lastFrame = targetFrame; } const currentFrame = Math.min(totalFrames, lastFrame + 1); onProgress({ currentFrame, totalFrames, progress: currentFrame / Math.max(1, totalFrames), elapsedMs, estimatedRemainingMs: Math.max(0, settings.durationSeconds * 1000 - elapsedMs) }); if (time >= settings.durationSeconds) { if (lastFrame < totalFrames - 1) renderCompositeFrame(settings.durationSeconds, totalFrames - 1); signal.removeEventListener("abort", abort); resolve(); } else animationFrame = requestAnimationFrame(tick); } catch (error) { signal.removeEventListener("abort", abort); reject(error); } };
      if (signal.aborted) abort(); else animationFrame = requestAnimationFrame(tick);
    });
    recorder.stop(); await stopped; await writeChain;
    if (destinationWritable) { await destinationWritable.close(); destinationClosed = true; }
    else {
      if (temp) { await temp.writable.close(); tempClosed = true; }
      const finalBlob = temp ? await temp.handle.getFile() : new Blob(chunks, { type: format.mimeType }); const url = URL.createObjectURL(finalBlob); const link = document.createElement("a"); link.href = url; link.download = fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
    onProgress({ currentFrame: totalFrames, totalFrames, progress: 1, elapsedMs: performance.now() - started, estimatedRemainingMs: 0 }); return { format, fileName };
  } catch (error) {
    if (error instanceof DOMException && (error.name === "QuotaExceededError" || error.message.toLowerCase().includes("storage quota"))) throw new Error("Spazio temporaneo del browser insufficiente. Usa un browser con salvataggio diretto oppure riduci durata, risoluzione o qualità dell’export.");
    throw error;
  } finally {
    audio.pause();
    if (recorder?.state !== "inactive") { recorder?.stop(); await stopped?.catch(() => undefined); }
    await writeChain.catch(() => undefined);
    if (destinationWritable && !destinationClosed) { if (destinationWritable.abort) await destinationWritable.abort().catch(() => undefined); else await destinationWritable.close().catch(() => undefined); }
    if (temp && !tempClosed) { if (temp.writable.abort) await temp.writable.abort().catch(() => undefined); else await temp.writable.close().catch(() => undefined); }
    if (temp) await temp.directory.removeEntry(temp.name).catch(() => undefined);
    stream?.getTracks().forEach((track) => track.stop()); renderer.restorePreviewSize(); setRenderTime(null); setAudioMonitoring(audio, true); audio.currentTime = previousTime; if (wasPlaying) await audio.play().catch(() => undefined);
  }
}
