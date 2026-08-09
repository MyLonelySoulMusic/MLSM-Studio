import {
  videoEditorAsset,
  videoEditorClip,
  videoEditorClipEnd,
  videoEditorFadeCurveValue,
  videoEditorFrameSeconds,
  type VideoEditorEffectClip,
  type VideoEditorFadeCurve,
  type VideoEditorSettings
} from "./video-editor";

export const videoEditorEffectDragType = "application/x-mlsm-video-editor-effect";

export type VideoEditorEffectCategory = "transitions" | "motion" | "color" | "distortion" | "light";
export type VideoEditorEffectPreviewStyle =
  | "fade-in" | "fade-out" | "zoom-in" | "zoom-out" | "slide-up" | "slide-right"
  | "shake" | "rgb-split" | "glitch" | "flicker" | "noir" | "bloom" | "light-leak" | "vignette";

export interface VideoEditorEffectParameterOption { value: string; label: string }
export interface VideoEditorEffectParameterControl {
  key: string;
  label: string;
  kind: "range" | "select";
  minimum?: number;
  maximum?: number;
  step?: number;
  unit?: string;
  options?: readonly VideoEditorEffectParameterOption[];
}

export interface VideoEditorEffectDefinition {
  id: string;
  label: string;
  description: string;
  category: VideoEditorEffectCategory;
  defaultDurationSeconds: number;
  minimumDurationSeconds: number;
  maximumDurationSeconds: number;
  previewStyle: VideoEditorEffectPreviewStyle;
  defaultParameters: Readonly<Record<string, number | string | boolean>>;
  parameterControls: readonly VideoEditorEffectParameterControl[];
  defaultPlacement: "clip-start" | "clip-end";
}

export const videoEditorEffectCategories: readonly { id: VideoEditorEffectCategory; label: string; description: string }[] = [
  { id: "transitions", label: "Transizioni", description: "Entrate, uscite e movimenti di raccordo" },
  { id: "motion", label: "Movimento", description: "Movimenti camera controllati e fluidi" },
  { id: "color", label: "Colore", description: "Look cinematografici temporizzati" },
  { id: "distortion", label: "Distorsione", description: "Glitch e separazioni cromatiche" },
  { id: "light", label: "Luce", description: "Bloom, flare e profondità" }
] as const;

const curveControl: readonly VideoEditorEffectParameterControl[] = [{
  key: "curve", label: "Curva", kind: "select", options: [
    { value: "smooth", label: "Morbida" }, { value: "linear", label: "Lineare" }, { value: "exponential", label: "Esponenziale" }
  ]
}];
const amount = (label = "Ampiezza", minimum = .01, maximum = .5, step = .01): VideoEditorEffectParameterControl => ({
  key: "amount", label, kind: "range", minimum, maximum, step
});
const frequency: VideoEditorEffectParameterControl = { key: "frequency", label: "Frequenza", kind: "range", minimum: 1, maximum: 20, step: 1, unit: " Hz" };

/**
 * Catalogo editoriale reale: ogni voce è risolta da `videoEditorEffectFrameState`
 * e quindi usa la stessa matematica in preview DOM, compositor canvas ed export.
 */
export const videoEditorEffectCatalog: readonly VideoEditorEffectDefinition[] = [
  {
    id: "fade-in", label: "Fade In", description: "Ingresso progressivo dal trasparente al fotogramma completo.",
    category: "transitions", defaultDurationSeconds: .65, minimumDurationSeconds: 2 / 60, maximumDurationSeconds: 8,
    previewStyle: "fade-in", defaultParameters: { curve: "smooth" }, parameterControls: curveControl, defaultPlacement: "clip-start"
  },
  {
    id: "fade-out", label: "Fade Out", description: "Uscita progressiva dal fotogramma completo al trasparente.",
    category: "transitions", defaultDurationSeconds: .65, minimumDurationSeconds: 2 / 60, maximumDurationSeconds: 8,
    previewStyle: "fade-out", defaultParameters: { curve: "smooth" }, parameterControls: curveControl, defaultPlacement: "clip-end"
  },
  {
    id: "zoom-in", label: "Push In", description: "Avvicinamento ottico morbido con atterraggio stabile sul fotogramma.",
    category: "transitions", defaultDurationSeconds: .9, minimumDurationSeconds: .15, maximumDurationSeconds: 6,
    previewStyle: "zoom-in", defaultParameters: { amount: .16, curve: "smooth" }, parameterControls: [amount("Zoom", .04, .4, .01), ...curveControl], defaultPlacement: "clip-start"
  },
  {
    id: "zoom-out", label: "Pull Back", description: "Apertura progressiva dell’inquadratura, senza rimbalzi artificiali.",
    category: "transitions", defaultDurationSeconds: .9, minimumDurationSeconds: .15, maximumDurationSeconds: 6,
    previewStyle: "zoom-out", defaultParameters: { amount: .14, curve: "smooth" }, parameterControls: [amount("Apertura", .04, .35, .01), ...curveControl], defaultPlacement: "clip-start"
  },
  {
    id: "slide-up", label: "Slide Up", description: "Ingresso verticale con decelerazione editoriale e fermata pulita.",
    category: "transitions", defaultDurationSeconds: .7, minimumDurationSeconds: .15, maximumDurationSeconds: 5,
    previewStyle: "slide-up", defaultParameters: { amount: .2, curve: "smooth" }, parameterControls: [amount("Distanza", .05, .65, .01), ...curveControl], defaultPlacement: "clip-start"
  },
  {
    id: "slide-right", label: "Slide Right", description: "Ingresso laterale fluido, adatto a clip e livelli sovrapposti.",
    category: "transitions", defaultDurationSeconds: .7, minimumDurationSeconds: .15, maximumDurationSeconds: 5,
    previewStyle: "slide-right", defaultParameters: { amount: .2, curve: "smooth" }, parameterControls: [amount("Distanza", .05, .65, .01), ...curveControl], defaultPlacement: "clip-start"
  },
  {
    id: "camera-shake", label: "Camera Shake", description: "Micro-movimento camera ammortizzato, deterministico e senza scatti casuali.",
    category: "motion", defaultDurationSeconds: .6, minimumDurationSeconds: .15, maximumDurationSeconds: 8,
    previewStyle: "shake", defaultParameters: { amount: .018, frequency: 8 }, parameterControls: [amount("Ampiezza", .003, .08, .001), frequency], defaultPlacement: "clip-start"
  },
  {
    id: "film-flicker", label: "Film Flicker", description: "Oscillazione organica di luce e contrasto, con attacco e coda sfumati.",
    category: "color", defaultDurationSeconds: 1.2, minimumDurationSeconds: .2, maximumDurationSeconds: 30,
    previewStyle: "flicker", defaultParameters: { amount: .12, frequency: 7 }, parameterControls: [amount("Sfarfallio", .02, .35, .01), frequency], defaultPlacement: "clip-start"
  },
  {
    id: "noir", label: "Modern Noir", description: "Bianco e nero ad alto contrasto, dosabile senza bruciare i dettagli.",
    category: "color", defaultDurationSeconds: 2, minimumDurationSeconds: .25, maximumDurationSeconds: 120,
    previewStyle: "noir", defaultParameters: { amount: .9 }, parameterControls: [amount("Conversione", .05, 1, .01)], defaultPlacement: "clip-start"
  },
  {
    id: "rgb-split", label: "RGB Split", description: "Aberrazione cromatica laterale controllata, composta sul vero livello video.",
    category: "distortion", defaultDurationSeconds: .65, minimumDurationSeconds: .12, maximumDurationSeconds: 8,
    previewStyle: "rgb-split", defaultParameters: { amount: .014, frequency: 6 }, parameterControls: [amount("Separazione", .002, .05, .001), frequency], defaultPlacement: "clip-start"
  },
  {
    id: "digital-glitch", label: "Digital Glitch", description: "Scansione e jitter digitale sincronizzati senza fotogrammi casuali non ripetibili.",
    category: "distortion", defaultDurationSeconds: .5, minimumDurationSeconds: .12, maximumDurationSeconds: 6,
    previewStyle: "glitch", defaultParameters: { amount: .022, frequency: 11 }, parameterControls: [amount("Intensità", .003, .08, .001), frequency], defaultPlacement: "clip-start"
  },
  {
    id: "dream-bloom", label: "Dream Bloom", description: "Bagliore diffuso e luminoso che conserva il soggetto e le alte luci.",
    category: "light", defaultDurationSeconds: 1.4, minimumDurationSeconds: .2, maximumDurationSeconds: 30,
    previewStyle: "bloom", defaultParameters: { amount: .65, blur: 3 }, parameterControls: [amount("Bagliore", .05, 1, .01), { key: "blur", label: "Diffusione", kind: "range", minimum: .5, maximum: 10, step: .5, unit: " px" }], defaultPlacement: "clip-start"
  },
  {
    id: "light-leak", label: "Light Leak", description: "Flare caldo in fusione screen, confinato al livello selezionato.",
    category: "light", defaultDurationSeconds: 1.1, minimumDurationSeconds: .2, maximumDurationSeconds: 20,
    previewStyle: "light-leak", defaultParameters: { amount: .55 }, parameterControls: [amount("Luce", .05, 1, .01)], defaultPlacement: "clip-start"
  },
  {
    id: "cinematic-vignette", label: "Cinematic Vignette", description: "Caduta di luce ai bordi per aumentare profondità e fuoco visivo.",
    category: "light", defaultDurationSeconds: 2, minimumDurationSeconds: .25, maximumDurationSeconds: 120,
    previewStyle: "vignette", defaultParameters: { amount: .65 }, parameterControls: [amount("Profondità", .05, 1, .01)], defaultPlacement: "clip-start"
  }
] as const;

export function videoEditorEffectDefinition(effectId: string): VideoEditorEffectDefinition | null {
  return videoEditorEffectCatalog.find((effect) => effect.id === effectId) ?? null;
}

const timelineIcons: Readonly<Record<VideoEditorEffectPreviewStyle, string>> = {
  "fade-in": "◢", "fade-out": "◣", "zoom-in": "⊕", "zoom-out": "⊖",
  "slide-up": "↑", "slide-right": "→", shake: "≈", "rgb-split": "RGB",
  glitch: "⌁", flicker: "◐", noir: "◒", bloom: "✺", "light-leak": "◉", vignette: "◎"
};

/** Simbolo editoriale coerente con la famiglia dell’effetto nella corsia timeline. */
export function videoEditorEffectTimelineIcon(effectId: string): string {
  const definition = videoEditorEffectDefinition(effectId);
  return definition ? timelineIcons[definition.previewStyle] : "✦";
}

export function videoEditorEffectClipEnd(effect: VideoEditorEffectClip): number {
  return effect.startSeconds + effect.durationSeconds;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function curve(effect: VideoEditorEffectClip): VideoEditorFadeCurve {
  const value = effect.parameters.curve;
  return value === "linear" || value === "exponential" ? value : "smooth";
}

function numeric(effect: VideoEditorEffectClip, key: string, fallback: number, minimum: number, maximum: number): number {
  const value = effect.parameters[key];
  return clamp(typeof value === "number" && Number.isFinite(value) ? value : fallback, minimum, maximum);
}

function parameterNumber(parameters: Readonly<Record<string, number | string | boolean>>, key: string, fallback: number, minimum: number, maximum: number): number {
  const value = parameters[key];
  return clamp(typeof value === "number" && Number.isFinite(value) ? value : fallback, minimum, maximum);
}

function rounded(value: number, decimals = 4): number {
  const scale = Math.pow(10, decimals);
  return Math.round(value * scale) / scale;
}

export interface VideoEditorEffectPreviewVariables {
  amountPercent: string;
  frequency: number;
  scaleUp: number;
  scaleDown: number;
  blurPixels: string;
  flickerLow: number;
  flickerHigh: number;
  flickerContrast: number;
}

/** Valori CSS derivati dagli stessi parametri numerici salvati nella timeline. */
export function videoEditorEffectPreviewVariables(
  definition: VideoEditorEffectDefinition,
  parameters: Readonly<Record<string, number | string | boolean>>,
  mix: number
): VideoEditorEffectPreviewVariables {
  const safeMix = clamp(mix);
  const fallbackAmount = typeof definition.defaultParameters.amount === "number" ? definition.defaultParameters.amount : .2;
  const fallbackFrequency = typeof definition.defaultParameters.frequency === "number" ? definition.defaultParameters.frequency : 8;
  const fallbackBlur = typeof definition.defaultParameters.blur === "number" ? definition.defaultParameters.blur : 0;
  const amountValue = parameterNumber(parameters, "amount", fallbackAmount, 0, 1) * safeMix;
  const frequencyValue = Math.max(1, Math.round(parameterNumber(parameters, "frequency", fallbackFrequency, 1, 30)));
  const blurValue = parameterNumber(parameters, "blur", fallbackBlur, 0, 18) * safeMix;
  return {
    amountPercent: `${rounded(amountValue * 100, 3)}%`,
    frequency: frequencyValue,
    scaleUp: rounded(1 + amountValue),
    scaleDown: rounded(Math.max(.2, 1 - amountValue)),
    blurPixels: `${rounded(blurValue, 3)}px`,
    flickerLow: rounded(Math.max(.35, 1 - amountValue * .7)),
    flickerHigh: rounded(1 + amountValue),
    flickerContrast: rounded(1 + amountValue * .5)
  };
}

function effectProgress(effect: VideoEditorEffectClip, timeSeconds: number): number | null {
  const end = videoEditorEffectClipEnd(effect);
  if (!effect.enabled || timeSeconds < effect.startSeconds || timeSeconds > end) return null;
  return clamp((timeSeconds - effect.startSeconds) / Math.max(videoEditorFrameSeconds, effect.durationSeconds));
}

/** Inviluppo deterministico condiviso da timeline, player ed export. */
export function videoEditorEffectEnvelope(effect: VideoEditorEffectClip, timeSeconds: number): number {
  if (!effect.enabled || (effect.effectId !== "fade-in" && effect.effectId !== "fade-out")) return 1;
  const end = videoEditorEffectClipEnd(effect);
  let envelope: number;
  if (effect.effectId === "fade-in") {
    if (timeSeconds < effect.startSeconds) envelope = 0;
    else if (timeSeconds >= end) envelope = 1;
    else envelope = videoEditorFadeCurveValue((timeSeconds - effect.startSeconds) / effect.durationSeconds, curve(effect));
  } else {
    if (timeSeconds < effect.startSeconds) envelope = 1;
    else if (timeSeconds >= end) envelope = 0;
    else envelope = 1 - videoEditorFadeCurveValue((timeSeconds - effect.startSeconds) / effect.durationSeconds, curve(effect));
  }
  return 1 - effect.mix + envelope * effect.mix;
}

export function videoEditorEffectOpacityMultiplier(effects: readonly VideoEditorEffectClip[], clipId: string, timeSeconds: number): number {
  return effects.reduce((opacity, effect) => effect.target.kind === "clip" && effect.target.clipId === clipId ? opacity * videoEditorEffectEnvelope(effect, timeSeconds) : opacity, 1);
}

export interface VideoEditorEffectFrameState {
  opacity: number;
  translateX: number;
  translateY: number;
  scale: number;
  rotationDegrees: number;
  brightness: number;
  contrast: number;
  saturation: number;
  grayscale: number;
  sepia: number;
  hueRotateDegrees: number;
  blurPixels: number;
  chromaticOffsetPixels: number;
  vignette: number;
  lightLeak: number;
  scanlines: number;
}

export const neutralVideoEditorEffectFrameState: Readonly<VideoEditorEffectFrameState> = {
  opacity: 1, translateX: 0, translateY: 0, scale: 1, rotationDegrees: 0,
  brightness: 1, contrast: 1, saturation: 1, grayscale: 0, sepia: 0, hueRotateDegrees: 0,
  blurPixels: 0, chromaticOffsetPixels: 0, vignette: 0, lightLeak: 0, scanlines: 0
};

function windowEnvelope(progress: number): number {
  const edge = .14;
  if (progress < edge) return videoEditorFadeCurveValue(progress / edge, "smooth");
  if (progress > 1 - edge) return videoEditorFadeCurveValue((1 - progress) / edge, "smooth");
  return 1;
}

/**
 * Risolve in modo deterministico tutti gli effetti di una clip a un timestamp.
 * Nessun `Math.random`: la preview DOM, il canvas e l’export offline possono usare
 * lo stesso stato senza divergenze o perdita di fotogrammi.
 */
export function videoEditorEffectFrameState(
  effects: readonly VideoEditorEffectClip[],
  clipId: string,
  timeSeconds: number,
  width: number,
  height: number
): VideoEditorEffectFrameState {
  const state: VideoEditorEffectFrameState = { ...neutralVideoEditorEffectFrameState };
  const targetEffects = effects.filter((effect) => effect.target.kind === "clip" && effect.target.clipId === clipId);
  state.opacity = videoEditorEffectOpacityMultiplier(targetEffects, clipId, timeSeconds);

  for (const effect of targetEffects) {
    if (effect.effectId === "fade-in" || effect.effectId === "fade-out") continue;
    let progress = effectProgress(effect, timeSeconds);
    // Push In è una transizione di stato: come Fade In conserva il fotogramma
    // finale fino alla fine della clip. Senza questo ramo la scala tornerebbe a 1
    // nel frame immediatamente successivo alla coda dell’effetto.
    if (progress === null && effect.enabled && effect.effectId === "zoom-in" && timeSeconds > videoEditorEffectClipEnd(effect)) progress = 1;
    if (progress === null) continue;
    const mix = clamp(effect.mix);
    const eased = videoEditorFadeCurveValue(progress, curve(effect));
    const window = windowEnvelope(progress) * mix;
    const amountValue = numeric(effect, "amount", .2, 0, 1);
    const frequencyValue = numeric(effect, "frequency", 8, 1, 30);
    const phase = (timeSeconds - effect.startSeconds) * frequencyValue * Math.PI * 2;
    const motionPulse = progress <= 0 || progress >= 1 ? 0 : Math.sin(Math.PI * eased);

    switch (effect.effectId) {
      case "zoom-in":
        state.scale *= 1 + amountValue * eased * mix;
        break;
      case "zoom-out":
        state.scale *= Math.max(.2, 1 - amountValue * motionPulse * mix);
        break;
      case "slide-up":
        state.translateY -= height * amountValue * motionPulse * mix;
        break;
      case "slide-right":
        state.translateX += width * amountValue * motionPulse * mix;
        break;
      case "camera-shake": {
        const xWave = Math.sin(phase) * .68 + Math.sin(phase * 2.13 + .7) * .32;
        const yWave = Math.cos(phase * .83 + .4) * .72 + Math.sin(phase * 1.77) * .28;
        state.translateX += width * amountValue * xWave * window;
        state.translateY += height * amountValue * yWave * window;
        state.rotationDegrees += amountValue * 40 * Math.sin(phase * .61) * window;
        break;
      }
      case "film-flicker": {
        const luminance = Math.sin(phase) * .58 + Math.sin(phase * .47 + 1.8) * .42;
        state.brightness *= Math.max(.35, 1 + amountValue * luminance * window);
        state.contrast *= 1 + amountValue * .32 * window;
        state.sepia = Math.max(state.sepia, amountValue * .18 * window);
        break;
      }
      case "noir":
        state.grayscale = Math.max(state.grayscale, amountValue * window);
        state.contrast *= 1 + amountValue * .26 * window;
        state.saturation *= 1 - amountValue * .22 * window;
        break;
      case "rgb-split":
        state.chromaticOffsetPixels = Math.max(state.chromaticOffsetPixels, Math.max(width, height) * amountValue * (.7 + .3 * Math.sin(phase)) * window);
        state.saturation *= 1 + .22 * window;
        break;
      case "digital-glitch": {
        const stepped = Math.sin(phase) >= 0 ? 1 : -1;
        state.translateX += width * amountValue * stepped * window;
        state.chromaticOffsetPixels = Math.max(state.chromaticOffsetPixels, width * amountValue * .75 * window);
        state.hueRotateDegrees += 18 * Math.sin(phase * .5) * window;
        state.scanlines = Math.max(state.scanlines, amountValue * 10 * window);
        break;
      }
      case "dream-bloom":
        state.blurPixels += numeric(effect, "blur", 3, 0, 18) * amountValue * window;
        state.brightness *= 1 + amountValue * .22 * window;
        state.saturation *= 1 + amountValue * .16 * window;
        state.lightLeak = Math.max(state.lightLeak, amountValue * .24 * window);
        break;
      case "light-leak":
        state.lightLeak = Math.max(state.lightLeak, amountValue * window);
        state.brightness *= 1 + amountValue * .08 * window;
        break;
      case "cinematic-vignette":
        state.vignette = Math.max(state.vignette, amountValue * window);
        break;
      default:
        break;
    }
  }
  return state;
}

export function videoEditorEffectFrameStateIsNeutral(state: VideoEditorEffectFrameState): boolean {
  return state.translateX === 0 && state.translateY === 0 && state.scale === 1 && state.rotationDegrees === 0
    && state.brightness === 1 && state.contrast === 1 && state.saturation === 1 && state.grayscale === 0
    && state.sepia === 0 && state.hueRotateDegrees === 0 && state.blurPixels === 0
    && state.chromaticOffsetPixels === 0 && state.vignette === 0 && state.lightLeak === 0 && state.scanlines === 0;
}

/** Filtro serializzabile anche nel fast path DOM del player. */
export function videoEditorEffectCssFilter(state: VideoEditorEffectFrameState): string {
  return [
    `brightness(${state.brightness.toFixed(4)})`,
    `contrast(${state.contrast.toFixed(4)})`,
    `saturate(${Math.max(0, state.saturation).toFixed(4)})`,
    `grayscale(${clamp(state.grayscale).toFixed(4)})`,
    `sepia(${clamp(state.sepia).toFixed(4)})`,
    `hue-rotate(${state.hueRotateDegrees.toFixed(3)}deg)`,
    `blur(${Math.max(0, state.blurPixels).toFixed(3)}px)`
  ].join(" ");
}

export interface VideoEditorEffectPlacement { targetClipId: string; startSeconds: number; durationSeconds: number; definition: VideoEditorEffectDefinition }

export function videoEditorPlaceEffect(settings: VideoEditorSettings, effectId: string, targetClipId: string, requestedTime?: number): VideoEditorEffectPlacement | null {
  const definition = videoEditorEffectDefinition(effectId);
  const target = videoEditorClip(settings, targetClipId);
  const asset = target ? videoEditorAsset(settings, target.assetId) : null;
  if (!definition || !target || !asset || asset.kind === "audio") return null;
  const durationSeconds = Math.max(definition.minimumDurationSeconds, Math.min(definition.defaultDurationSeconds, definition.maximumDurationSeconds, target.durationSeconds));
  const defaultStart = definition.defaultPlacement === "clip-end" ? videoEditorClipEnd(target) - durationSeconds : target.startSeconds;
  const startSeconds = Math.max(target.startSeconds, Math.min(videoEditorClipEnd(target) - durationSeconds, requestedTime ?? defaultStart));
  return { targetClipId, startSeconds, durationSeconds, definition };
}

export function videoEditorClampEffect(settings: VideoEditorSettings, effect: VideoEditorEffectClip): VideoEditorEffectClip | null {
  if (effect.target.kind !== "clip") return effect;
  const target = videoEditorClip(settings, effect.target.clipId);
  const definition = videoEditorEffectDefinition(effect.effectId);
  if (!target || !definition) return null;
  const durationSeconds = Math.max(definition.minimumDurationSeconds, Math.min(definition.maximumDurationSeconds, target.durationSeconds, effect.durationSeconds));
  const startSeconds = Math.max(target.startSeconds, Math.min(videoEditorClipEnd(target) - durationSeconds, effect.startSeconds));
  return { ...effect, startSeconds, durationSeconds, mix: Math.max(0, Math.min(1, effect.mix)) };
}

export function videoEditorMoveEffect(settings: VideoEditorSettings, effectId: string, startSeconds: number): VideoEditorEffectClip | null {
  const effect = settings.effectClips.find((item) => item.id === effectId);
  return effect ? videoEditorClampEffect(settings, { ...effect, startSeconds }) : null;
}

export function videoEditorTrimEffect(settings: VideoEditorSettings, effectId: string, edge: "start" | "end", timeSeconds: number): VideoEditorEffectClip | null {
  const effect = settings.effectClips.find((item) => item.id === effectId);
  const definition = effect ? videoEditorEffectDefinition(effect.effectId) : null;
  if (!effect || !definition || effect.target.kind !== "clip") return null;
  const target = videoEditorClip(settings, effect.target.clipId);
  if (!target) return null;
  const minimum = Math.max(videoEditorFrameSeconds * 2, definition.minimumDurationSeconds);
  if (edge === "start") {
    const startSeconds = Math.max(target.startSeconds, Math.min(effect.startSeconds + effect.durationSeconds - minimum, timeSeconds));
    return videoEditorClampEffect(settings, { ...effect, startSeconds, durationSeconds: effect.startSeconds + effect.durationSeconds - startSeconds });
  }
  const endSeconds = Math.max(effect.startSeconds + minimum, Math.min(videoEditorClipEnd(target), timeSeconds));
  return videoEditorClampEffect(settings, { ...effect, durationSeconds: endSeconds - effect.startSeconds });
}
