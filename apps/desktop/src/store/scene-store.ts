import { create } from "zustand";

export type SceneObjectType = "drum" | "kick" | "snare" | "cymbal" | "piano" | "guitar" | "strings" | "pebble" | "peg" | "platform" | "block" | "spring";
export type RailType = "pinball" | "glassTube" | "bricks";
export type BackgroundPresetId = "gradient" | "industrialWall" | "acousticStudio" | "abstractSpectrum" | "custom";
export interface EditableSceneObject { id: string; name: string; type: SceneObjectType; railType: RailType; position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number]; color: string; roughness: number; metalness: number; }
export type MarbleInnerShape = "orb" | "icosahedron" | "torusKnot";
export interface BallAppearance { radius: number; color: string; emission: number; metalness: number; trailEnabled: boolean; innerColor: string; innerShape: MarbleInnerShape; innerImageUrl: string | null; endRevealEnabled: boolean; revealMode: "end" | "time"; revealTimeSeconds: number; revealHoldSeconds: number; }
export interface BackgroundEffects { glow: boolean; particles: boolean; vignette: boolean; }
export interface NeonAppearance { enabled: boolean; text: string; color: string; }
export interface BackgroundAppearance { colors: [string, string]; imageUrl: string | null; mediaType: "image" | "video"; presetId: BackgroundPresetId; finish: "clean" | "worn"; opacity: number; blur: number; effects: BackgroundEffects; neon: NeonAppearance; }
export type RailColors = Record<RailType, string>;
export type LightPickMode = "origin" | "target" | null;
export interface SceneLightAppearance {
  enabled: boolean;
  origin: [number, number, number];
  target: [number, number, number];
  color: string;
  intensity: number;
  distance: number;
  angleDegrees: number;
  penumbra: number;
  decay: number;
  castShadow: boolean;
  sourceVisible: boolean;
  sourceRadius: number;
  beamVisible: boolean;
  beamDensity: number;
  beamLengthMultiplier: number;
  followBall: boolean;
  activeFromSeconds: number;
  activeUntilSeconds: number | null;
  reflectionBoost: number;
}

export interface BackgroundPreset { id: Exclude<BackgroundPresetId, "custom">; label: string; imageUrl: string | null; colors: [string, string]; effects: BackgroundEffects; }
export const backgroundPresets: readonly BackgroundPreset[] = [
  { id: "gradient", label: "Gradient atmosferico", imageUrl: null, colors: ["#070b18", "#1b1030"], effects: { glow: true, particles: true, vignette: true } },
  { id: "industrialWall", label: "Muro industriale", imageUrl: "/backgrounds/industrial-wall.png", colors: ["#111a24", "#463266"], effects: { glow: true, particles: false, vignette: true } },
  { id: "acousticStudio", label: "Studio acustico", imageUrl: "/backgrounds/acoustic-studio.png", colors: ["#5e2f13", "#d18a42"], effects: { glow: true, particles: false, vignette: true } },
  { id: "abstractSpectrum", label: "Spettro astratto", imageUrl: "/backgrounds/abstract-spectrum.png", colors: ["#155db0", "#a53bce"], effects: { glow: true, particles: true, vignette: true } }
];

const initialObjects: EditableSceneObject[] = [
  { id: "kick-1", name: "Grancassa", type: "kick", railType: "pinball", position: [-3.8, 1.6, -1.4], rotation: [.03, .18, -.04], scale: [1, 1, 1], color: "#e94f70", roughness: .42, metalness: .72 },
  { id: "cymbal-1", name: "Piatto", type: "cymbal", railType: "glassTube", position: [-.7, 1.25, -.35], rotation: [.18, -.2, .06], scale: [1, 1, 1], color: "#d6a83f", roughness: .24, metalness: .86 },
  { id: "snare-1", name: "Rullante", type: "snare", railType: "bricks", position: [2.35, .88, .8], rotation: [.05, -.18, -.05], scale: [1, 1, 1], color: "#7657ff", roughness: .42, metalness: .76 },
  { id: "drum-1", name: "Tom", type: "drum", railType: "pinball", position: [5.35, .52, 1.75], rotation: [.05, .2, .04], scale: [1, 1, 1], color: "#64e8cc", roughness: .42, metalness: .72 }
];
export const defaultSceneLight: SceneLightAppearance = {
  enabled: false, origin: [4, 6, 6], target: [0, 1, 0], color: "#fff0cf",
  intensity: 32, distance: 28, angleDegrees: 34, penumbra: .42, decay: 2,
  castShadow: true, sourceVisible: true, sourceRadius: .14, beamVisible: true, beamDensity: .38, beamLengthMultiplier: 1,
  followBall: true, activeFromSeconds: 0, activeUntilSeconds: null, reflectionBoost: 1
};

export function rebaseSceneLight(light: SceneLightAppearance, previousObjects: readonly EditableSceneObject[], nextObjects: readonly EditableSceneObject[]): SceneLightAppearance {
  const previousAnchor = previousObjects[0]?.position; const nextAnchor = nextObjects[0]?.position; if (!previousAnchor || !nextAnchor) return light;
  const delta: [number, number, number] = [nextAnchor[0] - previousAnchor[0], nextAnchor[1] - previousAnchor[1], nextAnchor[2] - previousAnchor[2]];
  if (delta.every((value) => Math.abs(value) < .0001)) return light;
  const translate = (point: [number, number, number]): [number, number, number] => [point[0] + delta[0], point[1] + delta[1], point[2] + delta[2]];
  return { ...light, origin: translate(light.origin), target: translate(light.target) };
}

const objectNames: Record<SceneObjectType, string> = { drum: "Tom / Tamburo", kick: "Grancassa", snare: "Rullante", cymbal: "Piatto", piano: "Pianoforte", guitar: "Chitarra / corde", strings: "Violino / archi", pebble: "Pietruzza urbana", peg: "Paletto", platform: "Piattaforma", block: "Blocco", spring: "Molla" };
const objectColors: Record<SceneObjectType, string> = { drum: "#ef4f72", kick: "#e94f70", snare: "#7657ff", cymbal: "#d6a83f", piano: "#64e8cc", guitar: "#d89052", strings: "#d69cff", pebble: "#68645f", peg: "#64e8cc", platform: "#7657ff", block: "#64e8cc", spring: "#d69cff" };
export const sceneObjectTypeOptions = (Object.keys(objectNames) as SceneObjectType[]).map((value) => ({ value, label: objectNames[value] }));
let manualObjectSequence = 0;

function defaultMaterialForType(type: SceneObjectType): Pick<EditableSceneObject, "roughness" | "metalness"> {
  const drumType = type === "kick" || type === "snare" || type === "drum"; return { roughness: type === "pebble" ? .88 : drumType ? .42 : type === "cymbal" || type === "spring" ? .18 : .3, metalness: type === "pebble" ? .04 : drumType ? .72 : type === "cymbal" || type === "spring" ? .82 : .35 };
}

function clampChannel(value: number): number { return Math.max(0, Math.min(255, Math.round(value))); }
function tint(hex: string, amount: number): string {
  const value = hex.replace("#", ""); const normalized = value.length === 3 ? value.split("").map((character) => character + character).join("") : value;
  const parsed = Number.parseInt(normalized, 16); if (!Number.isFinite(parsed)) return "#dffeff";
  const mix = (channel: number) => clampChannel(channel + (255 - channel) * amount).toString(16).padStart(2, "0");
  return `#${mix(parsed >> 16)}${mix(parsed >> 8 & 255)}${mix(parsed & 255)}`;
}
function shade(hex: string, amount: number): string {
  const value = hex.replace("#", ""); const normalized = value.length === 3 ? value.split("").map((character) => character + character).join("") : value; const parsed = Number.parseInt(normalized, 16); if (!Number.isFinite(parsed)) return "#1d2630";
  const channel = (component: number) => clampChannel(component * (1 - amount)).toString(16).padStart(2, "0"); return `#${channel(parsed >> 16)}${channel(parsed >> 8 & 255)}${channel(parsed & 255)}`;
}

export function enforceDescendingRoute(objects: readonly EditableSceneObject[], minimumGap = .15): EditableSceneObject[] {
  let previousY = Infinity;
  return objects.map((object, index) => {
    const y = index === 0 ? object.position[1] : Math.min(object.position[1], previousY - minimumGap); previousY = y;
    return y === object.position[1] ? object : { ...object, position: [object.position[0], y, object.position[2]] };
  });
}

export function mergeGeneratedScene(generated: readonly EditableSceneObject[], current: readonly EditableSceneObject[]): EditableSceneObject[] {
  const byType = new Map<SceneObjectType, EditableSceneObject[]>(); const typeOffsets = new Map<SceneObjectType, number>();
  for (const object of current) byType.set(object.type, [...(byType.get(object.type) ?? []), object]);
  return enforceDescendingRoute(generated.map((object, index) => {
    const routeObject = current[index]; const offset = typeOffsets.get(object.type) ?? 0; const appearance = byType.get(object.type)?.[offset] ?? routeObject; typeOffsets.set(object.type, offset + 1);
    return { ...object, id: routeObject?.id ?? object.id, railType: routeObject?.railType ?? object.railType, scale: routeObject ? [...routeObject.scale] : object.scale, color: appearance?.color ?? object.color, roughness: appearance?.roughness ?? object.roughness, metalness: appearance?.metalness ?? object.metalness };
  }));
}

interface SceneState {
  objects: EditableSceneObject[]; selectedId: string | null; ball: BallAppearance; background: BackgroundAppearance; railColors: RailColors; light: SceneLightAppearance; lightPickMode: LightPickMode;
  select: (id: string | null) => void; reset: () => void; add: (type: SceneObjectType) => void; remove: (id: string) => void; update: (id: string, patch: Partial<EditableSceneObject>) => void; changeType: (id: string, type: SceneObjectType) => void; updateTypeColor: (type: SceneObjectType, color: string) => void; replace: (objects: EditableSceneObject[]) => void; regenerate: (objects: EditableSceneObject[]) => void;
  updateBall: (patch: Partial<BallAppearance>) => void; updateBackground: (patch: Partial<BackgroundAppearance>) => void; updateRailColor: (type: RailType, color: string) => void; setAllRails: (type: RailType) => void;
  updateLight: (patch: Partial<SceneLightAppearance>) => void; setLightPickMode: (mode: LightPickMode) => void;
  applyPreset: (preset: "neon" | "minimal" | "dark") => void; applyBackgroundPreset: (presetId: Exclude<BackgroundPresetId, "custom">) => void; applyExtractedPalette: (colors: string[]) => void;
}

function paletteUpdate(state: SceneState, colors: readonly string[]): Pick<SceneState, "background" | "ball" | "objects" | "railColors"> {
  const primary = colors[0] ?? "#63f0d1"; const secondary = colors[1] ?? primary; const tertiary = colors[2] ?? secondary;
  return {
    background: { ...state.background, colors: [primary, secondary] },
    ball: { ...state.ball, color: tint(primary, .7), innerColor: primary },
    objects: state.objects.map((object, index) => ({ ...object, color: object.type === "cymbal" ? objectColors.cymbal : colors[index % Math.max(1, colors.length)] ?? object.color })),
    railColors: { pinball: shade(secondary, .68), glassTube: tint(primary, .55), bricks: tertiary }
  };
}

export const useSceneStore = create<SceneState>((set) => ({
  objects: initialObjects, selectedId: null,
  ball: { radius: .42, color: "#dffeff", emission: .35, metalness: 0, trailEnabled: true, innerColor: "#63f0d1", innerShape: "icosahedron", innerImageUrl: null, endRevealEnabled: false, revealMode: "end", revealTimeSeconds: 0, revealHoldSeconds: 2 },
  background: { colors: ["#070b18", "#1b1030"], imageUrl: null, mediaType: "image", presetId: "gradient", finish: "clean", opacity: 1, blur: 0, effects: { glow: true, particles: true, vignette: true }, neon: { enabled: false, text: "EMPTY STREETS\nMY LONELY SOUL", color: "#ff3cac" } },
  railColors: { pinball: "#1d2630", glassTube: "#9eeeff", bricks: "#7657ff" },
  light: { ...defaultSceneLight, origin: [...defaultSceneLight.origin], target: [...defaultSceneLight.target] },
  lightPickMode: null,
  select: (selectedId) => set({ selectedId }),
  reset: () => set({ objects: initialObjects.map((object) => ({ ...object, position: [...object.position], rotation: [...object.rotation], scale: [...object.scale] })), selectedId: null, ball: { radius: .42, color: "#dffeff", emission: .35, metalness: 0, trailEnabled: true, innerColor: "#63f0d1", innerShape: "icosahedron", innerImageUrl: null, endRevealEnabled: false, revealMode: "end", revealTimeSeconds: 0, revealHoldSeconds: 2 }, background: { colors: ["#070b18", "#1b1030"], imageUrl: null, mediaType: "image", presetId: "gradient", finish: "clean", opacity: 1, blur: 0, effects: { glow: true, particles: true, vignette: true }, neon: { enabled: false, text: "EMPTY STREETS\nMY LONELY SOUL", color: "#ff3cac" } }, railColors: { pinball: "#1d2630", glassTube: "#9eeeff", bricks: "#7657ff" }, light: { ...defaultSceneLight, origin: [...defaultSceneLight.origin], target: [...defaultSceneLight.target] }, lightPickMode: null }),
  add: (type) => set((state) => {
    const last = state.objects.at(-1); const id = `${type}-manual-${++manualObjectSequence}`; const index = state.objects.length;
    const object: EditableSceneObject = { id, name: objectNames[type], type, railType: (["pinball", "glassTube", "bricks"] as RailType[])[index % 3] ?? "pinball", position: [last && last.position[0] > 0 ? -1.65 : 1.65, (last?.position[1] ?? 3.85) - .38, 0], rotation: [.05, last && last.position[0] > 0 ? -.28 : .28, last && last.position[0] > 0 ? -.07 : .07], scale: [1, 1, 1], color: objectColors[type], ...defaultMaterialForType(type) };
    return { objects: [...state.objects, object], selectedId: id };
  }),
  remove: (id) => set((state) => ({ objects: state.objects.filter((object) => object.id !== id), selectedId: state.selectedId === id ? null : state.selectedId })),
  update: (id, patch) => set((state) => {
    const objectIndex = state.objects.findIndex((object) => object.id === id); if (objectIndex < 0) return state; let adjusted = patch;
    if (patch.position) { const previousY = state.objects[objectIndex - 1]?.position[1] ?? Infinity; const nextY = state.objects[objectIndex + 1]?.position[1] ?? -Infinity; const position: [number, number, number] = [...patch.position]; position[1] = Math.min(previousY - .15, Math.max(nextY + .15, position[1])); adjusted = { ...patch, position }; }
    return { objects: state.objects.map((object) => object.id === id ? { ...object, ...adjusted } : object) };
  }),
  changeType: (id, type) => set((state) => ({ objects: state.objects.map((object) => object.id === id ? { ...object, type, name: objectNames[type] } : object), selectedId: id })),
  updateTypeColor: (type, color) => set((state) => ({ objects: state.objects.map((object) => object.type === type ? { ...object, color } : object) })),
  replace: (objects) => set({ objects: enforceDescendingRoute(objects), selectedId: null }),
  regenerate: (objects) => set((state) => ({ objects: mergeGeneratedScene(objects, state.objects), selectedId: state.selectedId })),
  updateBall: (patch) => set((state) => ({ ball: { ...state.ball, ...patch } })),
  updateBackground: (patch) => set((state) => ({ background: { ...state.background, ...patch } })),
  updateLight: (patch) => set((state) => ({ light: { ...state.light, ...patch } })),
  setLightPickMode: (lightPickMode) => set({ lightPickMode }),
  updateRailColor: (type, color) => set((state) => ({ railColors: { ...state.railColors, [type]: color } })),
  setAllRails: (railType) => set((state) => ({ objects: state.objects.map((object) => ({ ...object, railType })) })),
  applyPreset: (preset) => set((state) => {
    const values = preset === "minimal" ? { colors: ["#f4f4f1", "#d8dae0"] as [string, string], ball: "#15161a", palette: ["#16171b", "#676b74"] } : preset === "dark" ? { colors: ["#08080d", "#24101a"] as [string, string], ball: "#ff526f", palette: ["#ad2949", "#333743"] } : { colors: ["#0d1020", "#211238"] as [string, string], ball: "#63f0d1", palette: ["#ef4f72", "#7657ff", "#f2c65c"] };
    return { background: { ...state.background, imageUrl: null, mediaType: "image", presetId: "gradient", colors: values.colors }, ball: { ...state.ball, innerColor: values.ball, emission: preset === "minimal" ? .1 : .5 }, objects: state.objects.map((object, index) => ({ ...object, color: object.type === "cymbal" ? objectColors.cymbal : values.palette[index % values.palette.length] ?? object.color })) };
  }),
  applyBackgroundPreset: (presetId) => set((state) => {
    const preset = backgroundPresets.find((item) => item.id === presetId) ?? backgroundPresets[0]!; const palette = paletteUpdate(state, preset.colors);
    return { ...palette, background: { ...palette.background, imageUrl: preset.imageUrl, mediaType: "image", presetId: preset.id, effects: preset.effects, opacity: 1, blur: 0 } };
  }),
  applyExtractedPalette: (colors) => set((state) => paletteUpdate(state, colors))
}));
