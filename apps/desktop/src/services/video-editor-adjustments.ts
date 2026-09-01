import type { VideoEditorAdjustments } from "./video-editor";

export interface VideoEditorAdjustmentControl {
  key: Exclude<keyof VideoEditorAdjustments, "opacity">;
  label: string;
  minimum: number;
  maximum: number;
  step: number;
  unit?: string;
}

/** Shared catalog: the dock and the inspector must never expose different corrections. */
export const videoEditorAdjustmentControls: readonly VideoEditorAdjustmentControl[] = [
  { key: "exposure", label: "Esposizione", minimum: -2, maximum: 2, step: .01, unit: " EV" },
  { key: "brightness", label: "Luminosità", minimum: -100, maximum: 100, step: 1 },
  { key: "contrast", label: "Contrasto", minimum: -100, maximum: 100, step: 1 },
  { key: "highlights", label: "Luci", minimum: -100, maximum: 100, step: 1 },
  { key: "shadows", label: "Ombre", minimum: -100, maximum: 100, step: 1 },
  { key: "whites", label: "Bianchi", minimum: -100, maximum: 100, step: 1 },
  { key: "blacks", label: "Neri", minimum: -100, maximum: 100, step: 1 },
  { key: "clarity", label: "Chiarezza", minimum: -100, maximum: 100, step: 1 },
  { key: "saturation", label: "Saturazione", minimum: -100, maximum: 100, step: 1 },
  { key: "vibrance", label: "Vividezza", minimum: -100, maximum: 100, step: 1 },
  { key: "temperature", label: "Temperatura", minimum: -100, maximum: 100, step: 1 },
  { key: "tint", label: "Tinta", minimum: -100, maximum: 100, step: 1 },
  { key: "hue", label: "Tonalità", minimum: -180, maximum: 180, step: 1, unit: "°" },
  { key: "sharpness", label: "Nitidezza", minimum: 0, maximum: 100, step: 1 },
  { key: "denoise", label: "Riduzione rumore", minimum: 0, maximum: 100, step: 1 },
  { key: "blur", label: "Sfocatura", minimum: 0, maximum: 100, step: 1 },
  { key: "grayscale", label: "Scala di grigi", minimum: 0, maximum: 100, step: 1, unit: "%" },
  { key: "sepia", label: "Seppia", minimum: 0, maximum: 100, step: 1, unit: "%" },
  { key: "fade", label: "Neri sbiaditi", minimum: 0, maximum: 100, step: 1 },
  { key: "vignette", label: "Vignettatura", minimum: 0, maximum: 100, step: 1, unit: "%" }
];

export const neutralVideoEditorAdjustments: VideoEditorAdjustments = {
  exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, clarity: 0,
  saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0, sharpness: 0, denoise: 0,
  blur: 0, grayscale: 0, sepia: 0, fade: 0, vignette: 0, opacity: 1
};
