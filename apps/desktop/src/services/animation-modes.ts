import type { SceneObjectType } from "../store/scene-store";

export interface AnimationModeObjectType { type: SceneObjectType; label: string; description: string; }
export interface AnimationModeDefinition {
  id: string;
  label: string;
  description: string;
  generator: "instrumentalFalling" | "newYorkStreets" | "coverSphere" | "stereoUnfold" | "walkingCube" | "portraitLandscape" | "pixelArt" | "teddyWalk" | "teddySing" | "proSubtitles" | "pixelsSub" | "staticWatermark" | "upscaler" | "videoEditor" | "aiQuantizer";
  panel: "instrumentalObjects" | "newYorkStreets" | "coverSphere" | "stereoUnfold" | "walkingCube" | "portraitLandscape" | "pixelArt" | "teddyWalk" | "teddySing" | "proSubtitles" | "pixelsSub" | "staticWatermark" | "upscaler" | "videoEditor" | "aiQuantizer";
  objectTypes: readonly AnimationModeObjectType[];
  defaultBaseObjectTypes: readonly SceneObjectType[];
}

export const animationModes: readonly AnimationModeDefinition[] = [{
  id: "instrumentalFalling",
  label: "Instrumental Falling",
  description: "La biglia attraversa strumenti e superfici musicali con rimbalzi, scorrimenti e cadute sincronizzati al brano.",
  generator: "instrumentalFalling",
  panel: "instrumentalObjects",
  objectTypes: [
    { type: "kick", label: "Grancassa", description: "Colpi profondi e accenti principali" },
    { type: "snare", label: "Rullante", description: "Transienti secchi e backbeat" },
    { type: "drum", label: "Tom / Tamburo", description: "Passaggi e rimbalzi intermedi" },
    { type: "cymbal", label: "Piatti", description: "Accenti metallici e alte frequenze" },
    { type: "piano", label: "Pianoforte", description: "Note di piano riconosciute chiaramente" },
    { type: "guitar", label: "Chitarra / corde", description: "Chitarre e corde pizzicate" },
    { type: "strings", label: "Violino / archi", description: "Violini e sezioni d’archi" }
  ],
  defaultBaseObjectTypes: ["kick", "snare", "drum", "cymbal"]
}, {
  id: "newYorkStreets",
  label: "New York Streets",
  description: "Una gara di biglie autonome attraversa una strada newyorkese, colpisce pietruzze a tempo e precipita in tubazioni fatiscenti.",
  generator: "newYorkStreets",
  panel: "newYorkStreets",
  objectTypes: [{ type: "pebble", label: "Pietruzze urbane", description: "Detriti stradali e ostacoli ritmici nelle fognature" }],
  defaultBaseObjectTypes: ["pebble"]
}, {
  id: "coverSphere",
  label: "Cover Sphere Visualizer",
  description: "La copertina ruota dentro una grande sfera di vetro mentre 48 bande audio e gli effetti atmosferici reagiscono al brano.",
  generator: "coverSphere",
  panel: "coverSphere",
  objectTypes: [],
  defaultBaseObjectTypes: ["platform"]
}, {
  id: "stereoUnfold",
  label: "Stereo Unfold",
  description: "La cover precipita stropicciata, si dispiega conservando pieghe fisiche e rivela un campo spettrale stereofonico separato in profondità.",
  generator: "stereoUnfold",
  panel: "stereoUnfold",
  objectTypes: [],
  defaultBaseObjectTypes: ["platform"]
}, {
  id: "walkingCube",
  label: "Cube Animation",
  description: "Un cubo fotografico in vetro ruota in 3D sui beat mentre spettro e increspature d’acqua attraversano uno sfondo personalizzabile nella palette della cover.",
  generator: "walkingCube",
  panel: "walkingCube",
  objectTypes: [],
  defaultBaseObjectTypes: ["platform"]
}, {
  id: "portraitLandscape",
  label: "From 9:16 to 16:9",
  description: "Trasforma un video verticale in una composizione 16:9 con immagini laterali specchiate, spettrogramma stereo, cubo in vetro ed effetti multilivello sincronizzati al ritmo.",
  generator: "portraitLandscape",
  panel: "portraitLandscape",
  objectTypes: [],
  defaultBaseObjectTypes: ["platform"]
}, {
  id: "pixelArt",
  label: "Pixel Art",
  description: "Storie musicali in pixel art con volto personalizzato da una foto frontale, camminata frontale e scene narrative sincronizzate alla durata del brano.",
  generator: "pixelArt",
  panel: "pixelArt",
  objectTypes: [],
  defaultBaseObjectTypes: ["platform"]
}, {
  id: "teddyWalk",
  label: "Teddy Walk",
  description: "Un orsacchiotto vissuto cammina lentamente e sempre di mezzo profilo su una strada realistica, con la cover audio-reattiva nello squarcio sul petto.",
  generator: "teddyWalk",
  panel: "teddyWalk",
  objectTypes: [],
  defaultBaseObjectTypes: ["platform"]
}, {
  id: "teddySing",
  label: "Teddy Sing",
  description: "L’orsacchiotto canta in una stanza moderna illuminata da LED: il poster riproduce la cover e il muso 3D esegue il labiale analizzato dal brano.",
  generator: "teddySing",
  panel: "teddySing",
  objectTypes: [],
  defaultBaseObjectTypes: ["platform"]
}, {
  id: "pixelsSub",
  label: "Pixels Subtitles",
  description: "La cover resta pulita e protetta al centro; una cornice di pixel segue la musica e le frasi appaiono con tipografia pixel e ombra configurabile.",
  generator: "pixelsSub",
  panel: "pixelsSub",
  objectTypes: [],
  defaultBaseObjectTypes: ["platform"]
}, {
  id: "proSubtitles",
  label: "Pro Subtitles",
  description: "Crea un livello di kinetic typography professionale sopra un video guida, con palette automatica, stile per parola ed export trasparente per il montaggio.",
  generator: "proSubtitles",
  panel: "proSubtitles",
  objectTypes: [],
  defaultBaseObjectTypes: ["platform"]
}, {
  id: "staticWatermark",
  label: "Static Watermark Remover",
  description: "Rimuove un watermark fermo da un video usando la fotografia pulita di riferimento, una regione selezionata e una composizione offline frame per frame.",
  generator: "staticWatermark",
  panel: "staticWatermark",
  objectTypes: [],
  defaultBaseObjectTypes: ["platform"]
}, {
  id: "upscaler",
  label: "Upscaler",
  description: "Aumenta la risoluzione di fotografie e video con modelli Real-ESRGAN, accelerazione automatica, confronto e correzione colore professionale.",
  generator: "upscaler",
  panel: "upscaler",
  objectTypes: [],
  defaultBaseObjectTypes: ["platform"]
}, {
  id: "videoEditor",
  label: "Video Editor",
  description: "Montaggio professionale multitraccia: pool media, timeline con calamita, taglio, dissolvenze, modalità di fusione, correzione colore, analisi delle battute ed export con interpolazione dei frame.",
  generator: "videoEditor",
  panel: "videoEditor",
  objectTypes: [],
  defaultBaseObjectTypes: ["platform"]
}, {
  id: "aiQuantizer",
  label: "AI Quantizer",
  description: "Stabilizza il tempo di master e stem con una warp map condivisa, preserva il pitch e prosegue con DAW Align, restauro, mastering e AI Forensics.",
  generator: "aiQuantizer",
  panel: "aiQuantizer",
  objectTypes: [],
  defaultBaseObjectTypes: ["platform"]
}];

// La modalità urbana resta leggibile nei vecchi progetti e utilizzabile dai
// relativi generatori, ma non viene più proposta per crearne di nuovi.
export const visibleAnimationModes: readonly AnimationModeDefinition[] = animationModes.filter((mode) => mode.id !== "newYorkStreets");
export type AnimationModeGroupId = "visualizers" | "stories" | "typography" | "restoration" | "editing" | "musicTools";
export type AnimationCategoryId = "soundAnimation" | "photoVideoStudio" | "videoEditor" | "music";
export interface AnimationModeGroup { id: AnimationModeGroupId; modeIds: readonly string[]; }
export interface AnimationCategory { id: AnimationCategoryId; groups: readonly AnimationModeGroup[]; }

/** Data-driven navigation: future product areas can be added without changing the editor shell. */
export const animationCategories: readonly AnimationCategory[] = [{
  id: "soundAnimation",
  groups: [
    { id: "visualizers", modeIds: ["instrumentalFalling", "coverSphere", "stereoUnfold", "walkingCube", "portraitLandscape"] },
    { id: "stories", modeIds: ["pixelArt", "teddyWalk", "teddySing"] },
    { id: "typography", modeIds: ["proSubtitles", "pixelsSub"] }
  ]
}, {
  id: "photoVideoStudio",
  groups: [{ id: "restoration", modeIds: ["staticWatermark", "upscaler"] }]
}, {
  id: "videoEditor",
  groups: [{ id: "editing", modeIds: ["videoEditor"] }]
}, {
  id: "music",
  groups: [{ id: "musicTools", modeIds: ["aiQuantizer"] }]
}];
export function getAnimationMode(modeId: string): AnimationModeDefinition { return animationModes.find((mode) => mode.id === modeId) ?? animationModes[0]!; }
export function getAnimationCategory(modeId: string): AnimationCategory { return animationCategories.find((category) => category.groups.some((group) => group.modeIds.includes(modeId))) ?? animationCategories[0]!; }
export function availableTypesForMode(modeId: string): SceneObjectType[] { return getAnimationMode(modeId).objectTypes.map((item) => item.type); }
