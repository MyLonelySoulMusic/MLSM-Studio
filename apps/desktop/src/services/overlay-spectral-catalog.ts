export const overlaySpectralPresetIds = [
  "milkdrop-radial-spectrum", "milkdrop-spectral-tunnel", "milkdrop-kaleidoscope", "milkdrop-plasma-field",
  "milkdrop-spectrum-bars", "milkdrop-circular-spectrum", "milkdrop-waveform-line", "milkdrop-particle-burst",
  "milkdrop-pulse-shapes", "milkdrop-dynamic-vignette", "milkdrop-radial-rays", "milkdrop-mirrored-waveform",
  "milkdrop-audio-grid", "milkdrop-orbiting-particles"
] as const;

export type OverlaySpectralPresetId = typeof overlaySpectralPresetIds[number];
export type OverlaySpectralPresetCategory = "spectrum" | "waveform" | "geometry" | "particles" | "atmosphere";
export interface OverlaySpectralPreset {
  id: OverlaySpectralPresetId;
  name: string;
  category: OverlaySpectralPresetCategory;
  description: string;
  nativePalette: readonly [string, string, string];
}

export const overlaySpectralCatalog: readonly OverlaySpectralPreset[] = [
  { id: "milkdrop-radial-spectrum", name: "Radial Spectrum", category: "spectrum", description: "Corona a 48 bande che ruota e pulsa sullo spettro reale.", nativePalette: ["#14f1d9", "#7657ff", "#ff4f9a"] },
  { id: "milkdrop-spectral-tunnel", name: "Spectral Tunnel", category: "geometry", description: "Anelli prospettici deformati dalle frequenze attraversano la scena.", nativePalette: ["#35d6ff", "#4632ff", "#ff3cc8"] },
  { id: "milkdrop-kaleidoscope", name: "Kaleidoscope", category: "geometry", description: "Tracce speculari con simmetria configurabile e rotazione continua.", nativePalette: ["#00ffd5", "#ffb000", "#ff3b9d"] },
  { id: "milkdrop-plasma-field", name: "Plasma Field", category: "atmosphere", description: "Campi luminosi orbitanti reagiscono alla distribuzione spettrale.", nativePalette: ["#29a8ff", "#8f35ff", "#ff315f"] },
  { id: "milkdrop-spectrum-bars", name: "Spectrum Bars", category: "spectrum", description: "Barre lineari dense con decadimento e colori distribuiti per banda.", nativePalette: ["#18f0cf", "#735cff", "#ff4a96"] },
  { id: "milkdrop-circular-spectrum", name: "Circular Spectrum", category: "spectrum", description: "Raggi circolari stratificati con risposta stereo e impulso centrale.", nativePalette: ["#2ee8ff", "#8564ff", "#ff4f9a"] },
  { id: "milkdrop-waveform-line", name: "Waveform Line", category: "waveform", description: "Linea spettrale fluida con doppio profilo e persistenza luminosa.", nativePalette: ["#ecff4f", "#18d8ff", "#f63fff"] },
  { id: "milkdrop-particle-burst", name: "Particle Burst", category: "particles", description: "Esplosioni deterministiche sui transienti senza stato casuale tra preview ed export.", nativePalette: ["#ffe15a", "#ff6839", "#ff36ad"] },
  { id: "milkdrop-pulse-shapes", name: "Pulse Shapes", category: "geometry", description: "Poligoni concentrici si espandono e dissolvono seguendo l’energia.", nativePalette: ["#63f0d1", "#5e72ff", "#ff4f9a"] },
  { id: "milkdrop-dynamic-vignette", name: "Dynamic Vignette", category: "atmosphere", description: "Vignetta cromatica e raggi morbidi guidati da bassi e ampiezza stereo.", nativePalette: ["#112a68", "#6b35d4", "#f32986"] },
  { id: "milkdrop-radial-rays", name: "Radial Rays", category: "spectrum", description: "Novantasei raggi interpolati dalla palette con simmetria MilkDrop.", nativePalette: ["#22d3ee", "#8b5cf6", "#f43f5e"] },
  { id: "milkdrop-mirrored-waveform", name: "Mirrored Waveform", category: "waveform", description: "Due profili speculari riempiti, separati dall’ampiezza del brano.", nativePalette: ["#31f5da", "#3f7aff", "#ff49b6"] },
  { id: "milkdrop-audio-grid", name: "Audio Grid", category: "geometry", description: "Matrice prospettica di celle modulata dalle 48 bande.", nativePalette: ["#0ea5e9", "#8b5cf6", "#f97316"] },
  { id: "milkdrop-orbiting-particles", name: "Orbiting Particles", category: "particles", description: "Particelle e trail orbitano con risposte indipendenti a bassi, medi e alti.", nativePalette: ["#facc15", "#22d3ee", "#f43f5e"] }
] as const;

export function overlaySpectralPreset(id: string): OverlaySpectralPreset { return overlaySpectralCatalog.find((preset) => preset.id === id) ?? overlaySpectralCatalog[0]!; }
export function overlaySpectralBackgroundMediaType(file: { name: string; type: string }): "image" | "video" { return file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(file.name) ? "video" : "image"; }

function channels(color: string): [number, number, number] { const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1] ?? "ffffff"; return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)]; }
export function mixOverlaySpectralPalette(nativePalette: readonly [string, string, string], projectPalette: readonly [string, string, string], influence: number): [string, string, string] { const amount = Math.max(0, Math.min(1, influence)); return nativePalette.map((native, index) => { const left = channels(native); const right = channels(projectPalette[index] ?? native); return `#${left.map((value, channel) => Math.round(value + ((right[channel] ?? value) - value) * amount).toString(16).padStart(2, "0")).join("")}`; }) as [string, string, string]; }
