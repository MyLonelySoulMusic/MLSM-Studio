import { videoEditorAsset, videoEditorClipEnd, videoEditorClipGain, videoEditorPresentationTime, videoEditorSourceTime, videoEditorVisibleLayers, type VideoEditorAsset, type VideoEditorClip, type VideoEditorLayer, type VideoEditorSettings } from "./video-editor";
import { videoEditorEffectCssFilter, videoEditorEffectFrameState, videoEditorEffectFrameStateIsNeutral, type VideoEditorEffectFrameState } from "./video-editor-effects";
import { videoEditorAdjustmentsAreNeutral, videoEditorFilter, type VideoEditorFrameSource } from "./video-editor-renderer";
import { mediaDrawRect, type ExportMediaFit } from "./offline-video-exporter";

/** Le sorgenti vengono preparate poco prima del loro attacco: evita il fotogramma nero al taglio. */
const preloadWindowSeconds = .4;
/** Tolleranza di riallineamento: durante Play il decoder deve scorrere, non essere cercato a ogni frame. */
const seekToleranceSeconds = { starting: .08, playing: .45, paused: .018 } as const;

function playbackErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as { name?: unknown; message?: unknown };
    const name = typeof candidate.name === "string" && candidate.name ? candidate.name : "PlaybackError";
    const message = typeof candidate.message === "string" && candidate.message ? candidate.message : "riproduzione rifiutata dal browser";
    return `${name}: ${message}`;
  }
  return typeof error === "string" && error ? error : "riproduzione rifiutata dal browser";
}

function audioPlaybackEnabled(clip: VideoEditorClip, track: VideoEditorSettings["tracks"][number] | null): boolean {
  return !clip.muted && !track?.muted && clip.volume > 0 && (track?.volume ?? 1) > 0;
}

export interface VideoEditorPlaybackSyncInput {
  armed: boolean;
  inside: boolean;
  playing: boolean;
  ready: boolean;
  paused: boolean;
  seeking: boolean;
  currentTime: number;
  targetTime: number;
}

export interface VideoEditorPlaybackSyncDecision { seek: boolean; play: boolean; pause: boolean }

/**
 * Politica di sincronizzazione testabile separatamente dal DOM. In riproduzione il
 * video è il decoder continuo della propria clip: lo si riallinea solo per uno scarto
 * reale o un salto del playhead. Questo evita il nero prodotto da seek sovrapposti.
 */
export function videoEditorPlaybackSyncDecision(input: VideoEditorPlaybackSyncInput): VideoEditorPlaybackSyncDecision {
  if (!input.armed) return { seek: false, play: false, pause: !input.paused };
  const drift = Math.abs(input.currentTime - input.targetTime);
  const tolerance = input.playing
    ? input.paused ? seekToleranceSeconds.starting : seekToleranceSeconds.playing
    : seekToleranceSeconds.paused;
  return {
    seek: input.ready && !input.seeking && drift > tolerance,
    play: input.playing && input.inside && input.paused,
    pause: (!input.playing || !input.inside) && !input.paused
  };
}

type MediaKind = VideoEditorAsset["kind"];

interface PoolEntry {
  clipId: string;
  assetId: string;
  url: string;
  kind: MediaKind;
  element: HTMLVideoElement | HTMLImageElement | HTMLAudioElement;
  ready: boolean;
  gain: GainNode | null;
  routed: boolean;
  playPromise: Promise<void> | null;
  primePromise: Promise<void> | null;
  wantedPlaying: boolean;
  lastFrame: HTMLCanvasElement | null;
  lastFrameTime: number;
  frameCallbackId: number | null;
  playbackError: string | null;
  effectOverlay: HTMLDivElement | null;
}

export interface VideoEditorMediaPoolStatus { expectedVisuals: number; readyVisuals: number; pendingNames: string[]; errors: string[] }
export interface VideoEditorPlaybackStartResult { startedMedia: number; startedVideos: number; startedAudio: number }

/**
 * Un layer DOM mantiene il decoder video nel compositor hardware del browser. Il
 * numero d'ordine segue esattamente `videoEditorVisibleLayers`: zero e il fondo,
 * valori crescenti sono via via piu vicini allo spettatore.
 */
interface PresentedVisualLayer { layer: VideoEditorLayer; stackIndex: number }

function combinedTransform(
  clip: VideoEditorClip,
  effect: VideoEditorEffectFrameState,
  width: number,
  height: number
): string {
  const transform = clip.transform ?? { x: 0, y: 0, scale: 1, rotation: 0 };
  const xPixels = transform.x * width / 2 + effect.translateX;
  const yPixels = transform.y * height / 2 + effect.translateY;
  const rotation = transform.rotation + effect.rotationDegrees;
  const scale = transform.scale * effect.scale;
  if (xPixels === 0 && yPixels === 0 && rotation === 0 && scale === 1) return "none";
  return `translate(${xPixels.toFixed(3)}px, ${yPixels.toFixed(3)}px) rotate(${rotation.toFixed(3)}deg) scale(${scale.toFixed(5)})`;
}

/** CSS non offre temperatura/tinta/nitidezza native: queste componenti mantengono
 * comunque il monitor reattivo alle regolazioni, mentre l'export usa le passate 2D. */
function videoEditorDomAdjustmentFilter(clip: VideoEditorClip): string {
  const { temperature, tint, sharpness } = clip.adjustments;
  const filters = [videoEditorFilter(clip.adjustments)];
  if (temperature !== 0) {
    filters.push(`sepia(${Math.min(.32, Math.abs(temperature) / 310).toFixed(4)})`);
    filters.push(`hue-rotate(${(-temperature * .08).toFixed(3)}deg)`);
  }
  if (tint !== 0) filters.push(`hue-rotate(${(tint * .16).toFixed(3)}deg)`);
  if (sharpness > 0) filters.push(`contrast(${(1 + sharpness / 360).toFixed(4)}) saturate(${(1 + sharpness / 900).toFixed(4)})`);
  return filters.join(" ");
}

function videoEditorDomBlendMode(clip: VideoEditorClip): string {
  if (clip.blendMode === "normal" || clip.blendIntensity <= 0) return "normal";
  // CSS non consente di interpolare due blend mode sullo stesso replaced element.
  // Gli estremi sono esatti; i valori intermedi scelgono il blend richiesto senza
  // duplicare decoder video (operazione instabile e costosa su WKWebView).
  return clip.blendMode;
}

function opticalOverlayBackground(effect: VideoEditorEffectFrameState): string {
  const layers: string[] = [];
  if (effect.scanlines > 0) {
    const alpha = Math.min(.36, effect.scanlines * .08).toFixed(4);
    layers.push(`repeating-linear-gradient(180deg, rgb(5 2 8 / ${alpha}) 0 1px, transparent 1px 5px)`);
  }
  if (effect.vignette > 0) {
    const alpha = Math.min(.88, effect.vignette * .82).toFixed(4);
    layers.push(`radial-gradient(circle at center, transparent 0 58%, rgb(0 0 0 / ${alpha}) 100%)`);
  }
  if (effect.lightLeak > 0) {
    const alpha = Math.min(.72, effect.lightLeak * .68).toFixed(4);
    layers.push(`radial-gradient(circle at 12% 18%, rgb(255 247 220 / ${alpha}) 0, rgb(255 143 92 / ${alpha}) 24%, rgb(216 57 168 / ${alpha}) 48%, transparent 75%)`);
  }
  return layers.join(", ");
}

/**
 * Le sorgenti della preview vivono per clip, non per media: due clip che usano lo stesso
 * file possono suonare o scorrere in istanti diversi, quindi ognuna tiene il proprio
 * decoder. L’audio passa da un nodo di guadagno dedicato, così il volume per clip può
 * superare il 100% come in un mixer, cosa impossibile con il solo volume dell’elemento.
 */
export class VideoEditorMediaPool {
  private readonly entries = new Map<string, PoolEntry>();
  private readonly onSourceReady: () => void;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private host: HTMLElement | null = null;

  constructor(onSourceReady: () => void) {
    this.onSourceReady = onSourceReady;
  }

  /**
   * Mantiene i decoder nel documento senza mostrarli. Alcuni WebView sospendono o
   * declassano i video completamente scollegati dal DOM durante la riproduzione.
   */
  attach(host: HTMLElement): void {
    this.host = host;
    for (const entry of this.entries.values()) {
      if (entry.element.parentElement !== host) host.append(entry.element);
      if (entry.effectOverlay && entry.effectOverlay.parentElement !== host) host.append(entry.effectOverlay);
    }
  }

  /**
   * Presenta tutti i media visivi realmente visibili, dal fondo verso l'alto. Il vecchio
   * fast path sceglieva un solo candidato: dopo import, tagli o sovrapposizioni il
   * suo nodo poteva restare sopra il canvas e mostrare un media non piu in timeline.
   *
   * Il risultato e un insieme, non un singolo id: il canvas salta esclusivamente i
   * media che il compositor DOM sta gia mostrando; il canvas resta lo sfondo e il
   * fallback per sorgenti non ancora montabili.
   */
  present(settings: VideoEditorSettings, timeSeconds: number): ReadonlySet<string> {
    const presentationTime = videoEditorPresentationTime(settings, timeSeconds);
    const visible = videoEditorVisibleLayers(settings, timeSeconds);
    const visibleById = new Map(visible.map((layer) => [layer.clip.id, layer] as const));
    const presented = new Map<string, PresentedVisualLayer>();
    const orderedTracks = [...settings.tracks].reverse();
    for (const track of orderedTracks) {
      if (track.kind !== "video" || track.hidden) continue;
      for (const clip of settings.clips) {
        if (clip.trackId !== track.id) continue;
        if (presentationTime < clip.startSeconds || presentationTime >= videoEditorClipEnd(clip)) continue;
        const asset = videoEditorAsset(settings, clip.assetId);
        if (!asset || (asset.kind !== "video" && asset.kind !== "image")) continue;
        // Un Fade In completamente trasparente non entra in visibleLayers. Il
        // decoder resta nello stack con opacity 0 per essere gia promosso dal
        // browser al primo frame visibile, ma mantiene comunque l'ordine tracce.
        const layer = visibleById.get(clip.id)
          ?? { clip, track, opacity: 0, sourceTimeSeconds: videoEditorSourceTime(clip, presentationTime) };
        presented.set(clip.id, {
          layer,
          stackIndex: presented.size
        });
      }
    }

    for (const entry of this.entries.values()) {
      const element = entry.element;
      const presentation = entry.kind === "audio" ? undefined : presented.get(entry.clipId);
      if (entry.kind !== "audio" && presentation) {
        const { clip, opacity } = presentation.layer;
        const bounds = this.host?.getBoundingClientRect();
        const previewWidth = Math.max(1, bounds?.width || settings.outputWidth);
        const previewHeight = Math.max(1, bounds?.height || settings.outputHeight);
        const asset = videoEditorAsset(settings, clip.assetId);
        const effect = videoEditorEffectFrameState(
          settings.effectClips,
          clip.id,
          presentationTime,
          previewWidth,
          previewHeight
        );
        // React puo ricostruire il contenitore della preview (StrictMode e cambio
        // area). `present` e auto-riparante e rimonta ogni layer nel rack corrente.
        if (this.host && element.parentElement !== this.host) this.host.append(element);
        element.className = `video-editor-presented-media video-editor-presented-${entry.kind}`;
        element.dataset.clipId = clip.id;
        const stackIndex = presentation.stackIndex * 2 + 1;
        element.style.zIndex = String(stackIndex);
        element.style.opacity = String(opacity);
        element.style.objectFit = clip.fit;
        element.style.mixBlendMode = videoEditorDomBlendMode(clip);
        const filters: string[] = [];
        if (!videoEditorAdjustmentsAreNeutral(clip.adjustments)) filters.push(videoEditorDomAdjustmentFilter(clip));
        if (!videoEditorEffectFrameStateIsNeutral(effect)) filters.push(videoEditorEffectCssFilter(effect));
        if (effect.chromaticOffsetPixels > 0) {
          const offset = Math.max(.5, effect.chromaticOffsetPixels).toFixed(2);
          filters.push(`drop-shadow(-${offset}px 0 rgb(0 238 255 / .28)) drop-shadow(${offset}px 0 rgb(255 28 118 / .28))`);
        }
        element.style.filter = filters.join(" ") || "none";
        element.style.transform = combinedTransform(clip, effect, previewWidth, previewHeight);
        element.style.clipPath = "none";
        element.style.visibility = "visible";

        if (entry.effectOverlay) {
          const background = opticalOverlayBackground(effect);
          const contentRect = clip.fit === "contain" && asset && asset.width > 0 && asset.height > 0
            ? mediaDrawRect(asset.width, asset.height, previewWidth, previewHeight, clip.fit as ExportMediaFit)
            : { x: 0, y: 0, width: previewWidth, height: previewHeight };
          entry.effectOverlay.className = "video-editor-layer-effect-overlay";
          entry.effectOverlay.dataset.clipId = clip.id;
          entry.effectOverlay.style.zIndex = String(stackIndex + 1);
          entry.effectOverlay.style.opacity = background ? String(opacity) : "0";
          entry.effectOverlay.style.background = background;
          entry.effectOverlay.style.left = `${contentRect.x}px`;
          entry.effectOverlay.style.top = `${contentRect.y}px`;
          entry.effectOverlay.style.right = "auto";
          entry.effectOverlay.style.bottom = "auto";
          entry.effectOverlay.style.width = `${contentRect.width}px`;
          entry.effectOverlay.style.height = `${contentRect.height}px`;
          entry.effectOverlay.style.mixBlendMode = videoEditorDomBlendMode(clip);
          entry.effectOverlay.style.transform = combinedTransform(clip, effect, previewWidth, previewHeight);
          entry.effectOverlay.style.visibility = background ? "visible" : "hidden";
        }
      } else {
        // Visibility e opacity vengono azzerate nello stesso passaggio che calcola
        // la timeline: nessun decoder vecchio puo rimanere sospeso sopra il monitor.
        element.className = "video-editor-decoder-media";
        delete element.dataset.clipId;
        element.style.zIndex = "0";
        element.style.opacity = "0";
        element.style.objectFit = "fill";
        element.style.mixBlendMode = "normal";
        element.style.filter = "none";
        element.style.transform = "none";
        element.style.clipPath = "inset(50%)";
        // Deve restare renderizzato: WKWebView puo sospendere decodifica e rVFC se
        // visibility e hidden. Le dimensioni 2px + clip-path garantiscono che non
        // copra mai la composizione mentre continua a preparare il prossimo taglio.
        element.style.visibility = "visible";
        if (entry.effectOverlay) {
          entry.effectOverlay.className = "video-editor-layer-effect-overlay is-hidden";
          delete entry.effectOverlay.dataset.clipId;
          entry.effectOverlay.style.opacity = "0";
          entry.effectOverlay.style.background = "none";
          entry.effectOverlay.style.transform = "none";
          entry.effectOverlay.style.visibility = "hidden";
        }
      }
    }
    return new Set(presented.keys());
  }

  /** Allinea il pool alle clip presenti: crea le sorgenti nuove e libera quelle rimosse. */
  sync(settings: VideoEditorSettings): void {
    const live = new Set<string>();
    for (const clip of settings.clips) {
      const asset = videoEditorAsset(settings, clip.assetId);
      if (!asset) continue;
      live.add(clip.id);
      const existing = this.entries.get(clip.id);
      if (existing && existing.url === asset.url && existing.assetId === asset.id) continue;
      if (existing) this.release(existing);
      const entry = this.create(clip.id, asset);
      this.entries.set(clip.id, entry);
      if (this.context) this.route(entry);
    }
    for (const [clipId, entry] of [...this.entries]) {
      if (live.has(clipId)) continue;
      this.release(entry);
      this.entries.delete(clipId);
    }
  }

  /** Fotogramma corrente della clip, pronto per il compositor; `null` se non è ancora decodificato. */
  frame(clip: VideoEditorClip): VideoEditorFrameSource | null {
    const entry = this.entries.get(clip.id);
    if (!entry || entry.kind === "audio") return null;
    if (entry.kind === "image") {
      const image = entry.element as HTMLImageElement;
      return image.naturalWidth > 0 ? { width: image.naturalWidth, height: image.naturalHeight, source: image } : null;
    }
    // Il compositor non legge mai direttamente la superficie hardware del video:
    // WebKit può restituirla nera mentre sta suonando. Il canvas viene aggiornato
    // esclusivamente quando il browser consegna davvero un nuovo frame video.
    if (entry.lastFrame) return { width: entry.lastFrame.width, height: entry.lastFrame.height, source: entry.lastFrame };
    // In pausa il decoder non cambia sotto i piedi del canvas: il frame nativo e
    // quindi un fallback affidabile anche quando WebKit non ha mai consegnato una
    // requestVideoFrameCallback (regressione che lasciava il monitor tutto nero).
    const video = entry.element as HTMLVideoElement;
    return video.paused && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0
      ? { width: video.videoWidth, height: video.videoHeight, source: video }
      : null;
  }

  /** Stato esplicito dei decoder visivi attivi: evita una preview nera senza spiegazione. */
  status(settings: VideoEditorSettings, timeSeconds: number): VideoEditorMediaPoolStatus {
    const presentationTime = videoEditorPresentationTime(settings, timeSeconds);
    const pendingNames: string[] = [];
    const errors: string[] = [];
    let expectedVisuals = 0;
    let readyVisuals = 0;
    for (const clip of settings.clips) {
      if (presentationTime < clip.startSeconds || presentationTime >= videoEditorClipEnd(clip)) continue;
      const asset = videoEditorAsset(settings, clip.assetId);
      const track = settings.tracks.find((item) => item.id === clip.trackId);
      if (!asset || asset.kind === "audio" || track?.hidden) continue;
      expectedVisuals += 1;
      const entry = this.entries.get(clip.id);
      if (entry?.playbackError) errors.push(`${asset.name}: ${entry.playbackError}`);
      // Nel fast path WebKit il video nativo è già il frame: una copia canvas può
      // legittimamente non esistere (in particolare sui 9:16), senza significare che
      // il monitor sia ancora in decodifica.
      const nativeVideoReady = entry?.kind === "video" && entry.ready
        && (entry.element as HTMLVideoElement).readyState >= 2;
      if (nativeVideoReady || this.frame(clip)) readyVisuals += 1;
      else pendingNames.push(asset.name);
    }
    return { expectedVisuals, readyVisuals, pendingNames, errors };
  }

  /** Porta ogni sorgente all’istante richiesto e applica dissolvenze e volumi audio. */
  update(settings: VideoEditorSettings, timeSeconds: number, playing: boolean): void {
    const presentationTime = videoEditorPresentationTime(settings, timeSeconds);
    for (const clip of settings.clips) {
      const entry = this.entries.get(clip.id);
      if (!entry || entry.kind === "image") continue;
      const element = entry.element as HTMLMediaElement;
      const track = settings.tracks.find((item) => item.id === clip.trackId) ?? null;
      const clipEnd = videoEditorClipEnd(clip);
      const timelineInside = presentationTime >= clip.startSeconds && presentationTime < clipEnd;
      const timelineArmed = presentationTime >= clip.startSeconds - preloadWindowSeconds && presentationTime < clipEnd;
      const timelineGain = timelineInside ? videoEditorClipGain(clip, track, presentationTime) : 0;
      // Una traccia video nascosta non deve bloccare l'handshake di Play. Un audio
      // muto non ha bisogno di un decoder in corsa; un video muto invece resta visivo.
      const playbackNeeded = entry.kind === "video"
        ? track?.kind === "video" && !track.hidden
        : audioPlaybackEnabled(clip, track);
      const inside = timelineInside && playbackNeeded;
      const armed = timelineArmed && playbackNeeded;
      const gainValue = playbackNeeded ? timelineGain : 0;
      if (entry.routed && entry.gain && this.context) entry.gain.gain.setTargetAtTime(gainValue, this.context.currentTime, .012);
      else {
        // Senza grafo audio si ricade sul volume nativo dell’elemento, che si ferma a 100%.
        element.muted = gainValue <= 0;
        element.volume = Math.max(0, Math.min(1, gainValue));
      }
      const target = videoEditorSourceTime(clip, presentationTime);
      const decision = videoEditorPlaybackSyncDecision({
        armed,
        inside,
        playing,
        ready: element.readyState >= 1,
        paused: element.paused,
        seeking: element.seeking,
        currentTime: element.currentTime,
        targetTime: target
      });
      entry.wantedPlaying = playing && inside;
      // Non interrompere con seek/pause un play() di priming ancora pendente: su
      // WebKit produrrebbe AbortError e perderebbe l'autorizzazione ottenuta nel click.
      if (decision.seek && (!entry.primePromise || inside)) element.currentTime = target;
      if (decision.play) void this.requestPlay(entry, element).catch(() => undefined);
      else if (decision.pause && !entry.primePromise) element.pause();
    }
  }

  /**
   * Avvia in modo transazionale tutti i media presenti sotto il playhead. La Promise
   * si risolve soltanto quando `HTMLMediaElement.play()` è realmente riuscito per
   * ciascuna sorgente attiva: il clock della timeline non può quindi correre davanti
   * a un decoder ancora bloccato dalle policy del browser o dal buffering iniziale.
   */
  async start(settings: VideoEditorSettings, timeSeconds: number): Promise<VideoEditorPlaybackStartResult> {
    // Il click può arrivare immediatamente dopo l'inserimento di una clip, prima che
    // l'effect React abbia sincronizzato il pool. Rendere start autosufficiente evita
    // una falsa partenza senza media.
    this.sync(settings);
    this.update(settings, timeSeconds, false);

    const active: { entry: PoolEntry; element: HTMLMediaElement; kind: "video" | "audio" }[] = [];
    const future: { entry: PoolEntry; element: HTMLMediaElement }[] = [];
    for (const clip of settings.clips) {
      const entry = this.entries.get(clip.id);
      if (!entry || entry.kind === "image") continue;
      const track = settings.tracks.find((item) => item.id === clip.trackId) ?? null;
      if (entry.kind === "video" && (track?.kind !== "video" || track.hidden)) continue;
      if (entry.kind === "audio" && !audioPlaybackEnabled(clip, track)) continue;
      const element = entry.element as HTMLMediaElement;
      if (timeSeconds >= clip.startSeconds && timeSeconds < videoEditorClipEnd(clip)) {
        entry.wantedPlaying = true;
        active.push({ entry, element, kind: entry.kind });
      } else if (clip.startSeconds > timeSeconds) future.push({ entry, element });
    }

    // Entrambi i map sono eseguiti prima del primo await: play() cade ancora nel
    // gesto utente. I decoder futuri vengono autorizzati in silenzio, ma la loro
    // Promise non puo bloccare l'handshake dei soli media attivi.
    const activeStarts = active.map(({ entry, element }) => this.requestPlay(entry, element));
    for (const item of future) this.prime(item.entry, item.element);
    if (!active.length) return { startedMedia: 0, startedVideos: 0, startedAudio: 0 };

    const settled = await Promise.allSettled(activeStarts);
    const failures = settled.flatMap((result, index) => {
      if (result.status === "fulfilled") return [];
      const item = active[index]!;
      const asset = videoEditorAsset(settings, item.entry.assetId);
      const reason = playbackErrorMessage(result.reason);
      return [`${asset?.name ?? item.entry.assetId}: ${reason}`];
    });
    if (failures.length) {
      this.pauseAll();
      throw new Error(`Impossibile avviare la preview. ${failures.join(" · ")}`);
    }
    return {
      startedMedia: active.length,
      startedVideos: active.filter((item) => item.kind === "video").length,
      startedAudio: active.filter((item) => item.kind === "audio").length
    };
  }

  /** Da chiamare al primo gesto di riproduzione: apre e riprende il contesto audio. */
  enableAudio(): void {
    if (!this.context) {
      const constructor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!constructor) return;
      this.context = new constructor();
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
    }
    void this.context.resume().catch(() => undefined);
    for (const entry of this.entries.values()) this.route(entry);
  }

  pauseAll(): void {
    for (const entry of this.entries.values()) {
      if (entry.kind === "image") continue;
      entry.wantedPlaying = false;
      (entry.element as HTMLMediaElement).pause();
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
    this.master?.disconnect();
    this.master = null;
    const context = this.context;
    this.context = null;
    this.host = null;
    if (context) void context.close().catch(() => undefined);
  }

  private create(clipId: string, asset: VideoEditorAsset): PoolEntry {
    const entry: PoolEntry = {
      clipId, assetId: asset.id, url: asset.url, kind: asset.kind, element: new Image(),
      ready: false, gain: null, routed: false, playPromise: null, lastFrame: null, lastFrameTime: -1,
      primePromise: null, wantedPlaying: false,
      frameCallbackId: null, playbackError: null,
      effectOverlay: asset.kind === "audio" ? null : document.createElement("div")
    };
    if (asset.kind === "image") {
      const image = entry.element as HTMLImageElement;
      image.onload = () => { entry.ready = true; this.onSourceReady(); };
      image.onerror = () => { entry.ready = false; };
      image.src = asset.url;
      if (this.host) {
        this.host.append(image);
        if (entry.effectOverlay) this.host.append(entry.effectOverlay);
      }
      return entry;
    }
    const media = asset.kind === "audio" ? new Audio() : document.createElement("video");
    if (media instanceof HTMLVideoElement) { media.playsInline = true; media.disablePictureInPicture = true; }
    media.preload = "auto";
    // Si parte in silenzio: il suono arriva solo dopo che il nodo di guadagno è collegato
    // oppure dopo che `update` ha calcolato il volume reale della clip.
    media.muted = true;
    // Assegna subito l'elemento all'entry e registra il frame callback prima del
    // caricamento: è il percorso affidabile anche per Blob URL in WebKit.
    entry.element = media;
    if (this.host) {
      this.host.append(media);
      if (entry.effectOverlay) this.host.append(entry.effectOverlay);
    }
    if (entry.kind === "video") this.watchVideoFrames(entry);
    const ready = (capture: boolean) => {
      entry.ready = true;
      if (capture && entry.kind === "video") this.captureVideoFrame(entry);
      this.onSourceReady();
    };
    media.onloadedmetadata = () => ready(false);
    media.onloadeddata = () => ready(true);
    media.oncanplay = () => ready(true);
    media.ontimeupdate = () => {
      // Fallback per WebView privi di requestVideoFrameCallback.
      if (entry.kind === "video" && typeof (media as HTMLVideoElement).requestVideoFrameCallback !== "function") this.captureVideoFrame(entry);
      this.onSourceReady();
    };
    media.onseeked = () => ready(true);
    media.onerror = () => { entry.ready = false; entry.playbackError = media.error?.message || `errore media ${media.error?.code ?? "sconosciuto"}`; this.onSourceReady(); };
    media.src = asset.url;
    media.load();
    return entry;
  }

  private route(entry: PoolEntry): void {
    if (entry.routed || entry.kind === "image" || !this.context || !this.master) return;
    try {
      const source = this.context.createMediaElementSource(entry.element as HTMLMediaElement);
      const gain = this.context.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(this.master);
      entry.gain = gain;
      entry.routed = true;
      const element = entry.element as HTMLMediaElement;
      element.muted = false;
      element.volume = 1;
    } catch {
      // Elemento non instradabile: `update` continuerà a usarne il volume nativo.
      entry.routed = false;
    }
  }

  private requestPlay(entry: PoolEntry, element: HTMLMediaElement): Promise<void> {
    if (!element.paused) return Promise.resolve();
    if (entry.playPromise) return entry.playPromise;
    if (entry.primePromise) {
      return entry.primePromise.then(() => element.paused ? this.requestPlay(entry, element) : undefined);
    }
    entry.playbackError = null;
    let requested: Promise<void>;
    try { requested = Promise.resolve(element.play()); }
    catch (error) { requested = Promise.reject(error); }
    const pending = requested
      .then(() => {
        if (element.paused) throw new Error("il browser non ha avviato il decoder");
      })
      .catch((error: unknown) => {
        const message = playbackErrorMessage(error);
        entry.playbackError = message;
        throw new Error(message);
      })
      .finally(() => {
        if (entry.playPromise === pending) entry.playPromise = null;
        this.onSourceReady();
      });
    entry.playPromise = pending;
    return pending;
  }

  /**
   * Autorizza un decoder futuro nel gesto Play senza renderlo udibile e senza
   * includerlo nella transazione dei media attivi. Una volta partito viene fermato;
   * se nel frattempo il playhead vi e entrato, continua invece senza interruzioni.
   */
  private prime(entry: PoolEntry, element: HTMLMediaElement): void {
    if (!element.paused || entry.primePromise) return;
    const previousMuted = element.muted;
    element.muted = true;
    let requested: Promise<void>;
    try { requested = Promise.resolve(element.play()); }
    catch {
      element.muted = previousMuted;
      return;
    }
    const pending = requested
      .then(() => {
        if (!entry.wantedPlaying) element.pause();
      })
      .catch(() => undefined)
      .finally(() => {
        if (entry.primePromise === pending) entry.primePromise = null;
        element.muted = entry.wantedPlaying ? false : previousMuted;
      });
    entry.primePromise = pending;
  }

  /** Copia ogni frame nel momento esatto in cui il decoder lo presenta. */
  private watchVideoFrames(entry: PoolEntry): void {
    if (entry.kind !== "video") return;
    const video = entry.element as HTMLVideoElement;
    if (typeof video.requestVideoFrameCallback !== "function" || entry.frameCallbackId !== null) return;
    entry.frameCallbackId = video.requestVideoFrameCallback((_now, metadata) => {
      entry.frameCallbackId = null;
      this.captureVideoFrame(entry, metadata.mediaTime);
      this.onSourceReady();
      // Una callback pendente resta valida anche in pausa e si riattiva al seek.
      this.watchVideoFrames(entry);
    });
  }

  /** Salva l'ultimo fotogramma decodificato a risoluzione di monitor, non di export. */
  private captureVideoFrame(entry: PoolEntry, presentedTime?: number): void {
    if (entry.kind !== "video") return;
    const video = entry.element as HTMLVideoElement;
    if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    try {
      const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.max(2, Math.round(video.videoWidth * scale));
      const height = Math.max(2, Math.round(video.videoHeight * scale));
      const snapshot = entry.lastFrame ?? document.createElement("canvas");
      if (snapshot.width !== width) snapshot.width = width;
      if (snapshot.height !== height) snapshot.height = height;
      const context = snapshot.getContext("2d", { alpha: false });
      if (!context) return;
      context.drawImage(video, 0, 0, width, height);
      entry.lastFrame = snapshot;
      entry.lastFrameTime = presentedTime ?? video.currentTime;
    } catch { /* Il frame diretto resta disponibile anche se il browser vieta la copia. */ }
  }

  private release(entry: PoolEntry): void {
    if (entry.kind === "image") {
      const image = entry.element as HTMLImageElement;
      image.onload = null;
      image.onerror = null;
      image.remove();
      image.removeAttribute("src");
      entry.effectOverlay?.remove();
      entry.effectOverlay = null;
      return;
    }
    const element = entry.element as HTMLMediaElement;
    element.pause();
    const video = entry.kind === "video" ? entry.element as HTMLVideoElement : null;
    if (video && entry.frameCallbackId !== null && typeof video.cancelVideoFrameCallback === "function") video.cancelVideoFrameCallback(entry.frameCallbackId);
    entry.frameCallbackId = null;
    entry.playPromise = null;
    entry.primePromise = null;
    entry.wantedPlaying = false;
    entry.lastFrame = null;
    element.onloadedmetadata = null;
    element.onloadeddata = null;
    element.oncanplay = null;
    element.ontimeupdate = null;
    element.onseeked = null;
    element.onerror = null;
    entry.gain?.disconnect();
    entry.gain = null;
    entry.routed = false;
    element.remove();
    entry.effectOverlay?.remove();
    entry.effectOverlay = null;
    element.removeAttribute("src");
    element.load();
  }
}
