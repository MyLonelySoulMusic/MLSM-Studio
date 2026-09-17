import { z } from "zod";

const vector3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() }).strict();
const fpsSchema = z.object({ numerator: z.number().int().positive(), denominator: z.number().int().positive() }).strict();
const materialSchema = z.object({
  color: z.string(), palette: z.array(z.string()).default([]), roughness: z.number().min(0).max(1),
  metalness: z.number().min(0).max(1), emission: z.number().nonnegative(), opacity: z.number().min(0).max(1),
  textureAssetId: z.string().nullable().default(null)
}).strict();
const transformSchema = z.object({ position: vector3Schema, rotation: vector3Schema, scale: vector3Schema }).strict();
const sceneObjectSchema = z.object({
  id: z.string().min(1), name: z.string().min(1),
  type: z.enum(["drum", "snare", "tom", "kick", "cymbal", "piano", "guitar", "strings", "pebble", "triangle", "block", "peg", "platform", "inclinedPlatform", "spring", "trampoline", "bell", "rope", "tube", "ring", "blade", "crystal", "key", "electronicPad", "custom"]),
  railType: z.enum(["pinball", "glassTube", "bricks"]).default("pinball"),
  transform: transformSchema, material: materialSchema, restitution: z.number().min(0).max(1), friction: z.number().min(0).max(1),
  visible: z.boolean(), locked: z.boolean(), castShadow: z.boolean(), receiveShadow: z.boolean(), assetId: z.string().nullable().default(null)
}).strict();
const trajectorySegmentSchema = z.object({
  id: z.string().min(1), startEventId: z.string().min(1), endEventId: z.string().min(1), startTime: z.number().nonnegative(), endTime: z.number().positive(),
  startPosition: vector3Schema, endPosition: vector3Schema, initialVelocity: vector3Schema, gravity: vector3Schema, assisted: z.boolean(),
  motionKind: z.enum(["bounce", "slide", "roll", "freeFall", "sewerDrop"]).default("bounce"),
  assistanceKind: z.enum(["none", "objectPosition", "localGravity", "impulseObject", "invisibleGuide", "spatialScale"]).default("none"), status: z.enum(["valid", "invalid"]), diagnostic: z.string().default("")
}).strict();
const exportPresetSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), format: z.enum(["mp4", "mov", "webm", "pngSequence"]), codec: z.enum(["h264", "h265", "prores422", "prores4444", "vp9", "av1", "png"]),
  width: z.number().int().min(64).max(7680), height: z.number().int().min(64).max(7680), fps: fpsSchema, audioMode: z.enum(["copy", "aac", "pcm", "none"]), crf: z.number().nullable().default(null), bitrateKbps: z.number().int().positive().nullable().default(null)
}).strict();
const newYorkStreetsSchema = z.object({
  secondaryMarbleCount: z.number().int().min(1).max(13), secondaryGroupColor: z.string(), secondaryColors: z.array(z.string()).max(13), flyerImageUrls: z.array(z.string()).max(8)
}).strict();
const defaultNewYorkStreets = { secondaryMarbleCount: 6, secondaryGroupColor: "#ef6f7f", secondaryColors: ["#ef6f7f", "#f0b45d", "#71c7ec", "#a98df2", "#76d6a5", "#f28fb8"], flyerImageUrls: [] };
const coverSphereSchema = z.object({
  spectrumColor: z.string(), effectColor: z.string(), autoPalette: z.boolean().default(true),
  palettePrimary: z.string().default("#63f0d1"), paletteSecondary: z.string().default("#7657ff"),
  rotationIntensity: z.number().min(.1).max(3),
  effects: z.object({ smoke: z.boolean(), particles: z.boolean(), windLeaves: z.boolean(), rain: z.boolean(), flyers: z.boolean() }).strict(),
  flyerImageUrls: z.array(z.string()).max(8)
}).strict();
const defaultCoverSphere = { spectrumColor: "#63f0d1", effectColor: "#7657ff", autoPalette: true, palettePrimary: "#63f0d1", paletteSecondary: "#7657ff", rotationIntensity: 1, effects: { smoke: true, particles: true, windLeaves: false, rain: false, flyers: false }, flyerImageUrls: [] };
const stereoUnfoldSchema = z.object({
  coverImageUrl: z.string().nullable().default(null),
  primaryColor: z.string().default("#ff4f9a"), secondaryColor: z.string().default("#42dff5"),
  palettePrimary: z.string().default("#ff4f9a"), paletteSecondary: z.string().default("#42dff5"), autoPalette: z.boolean().default(true),
  unfoldDuration: z.number().min(.8).max(5).default(2.4), residualCrease: z.number().min(.08).max(1).default(.58),
  stereoDepth: z.number().min(.2).max(3).default(1.15), spectrumIntensity: z.number().min(.2).max(3).default(1.25),
  glowIntensity: z.number().min(0).max(3).default(1.15), spectrumStyle: z.enum(["ribbons", "prisms", "aurora"]).default("ribbons"),
  effectIntensity: z.number().min(0).max(3).default(1),
  effects: z.object({
    particles: z.boolean().default(true), lightTrails: z.boolean().default(true), pulseRings: z.boolean().default(true),
    fullScreenWaves: z.boolean().default(true), lightRays: z.boolean().default(true), chromaDust: z.boolean().default(true)
  }).strict().default({ particles: true, lightTrails: true, pulseRings: true, fullScreenWaves: true, lightRays: true, chromaDust: true })
}).strict();
const defaultStereoUnfold = { coverImageUrl: null, primaryColor: "#ff4f9a", secondaryColor: "#42dff5", palettePrimary: "#ff4f9a", paletteSecondary: "#42dff5", autoPalette: true, unfoldDuration: 2.4, residualCrease: .58, stereoDepth: 1.15, spectrumIntensity: 1.25, glowIntensity: 1.15, spectrumStyle: "ribbons" as const, effectIntensity: 1, effects: { particles: true, lightTrails: true, pulseRings: true, fullScreenWaves: true, lightRays: true, chromaDust: true } };
const walkingCubeSchema = z.object({
  imageUrl: z.string().nullable().default(null), backgroundImageUrl: z.string().nullable().default(null), autoPalette: z.boolean().default(true),
  palettePrimary: z.string().default("#63f0d1"), paletteSecondary: z.string().default("#7657ff"), paletteAccent: z.string().default("#ff4f9a"),
  rotationIntensity: z.number().min(.25).max(2.5).default(1), spectrumIntensity: z.number().min(.1).max(3).default(1.25), rippleIntensity: z.number().min(0).max(3).default(1.15), backgroundDim: z.number().min(0).max(.9).default(.32),
  effects: z.object({ halo: z.boolean().default(true), orbitRings: z.boolean().default(true), particles: z.boolean().default(true), lightSweeps: z.boolean().default(true), waterRipples: z.boolean().default(true) }).strict().default({ halo: true, orbitRings: true, particles: true, lightSweeps: true, waterRipples: true }),
  motionIntensity: z.number().min(.25).max(2.5).default(1), splitDistance: z.number().min(.2).max(2).default(.72),
  backgroundIntensity: z.number().min(.1).max(3).default(1.2), glassOpacity: z.number().min(.08).max(.65).default(.28)
}).strict();
const defaultWalkingCube = { imageUrl: null, backgroundImageUrl: null, autoPalette: true, palettePrimary: "#63f0d1", paletteSecondary: "#7657ff", paletteAccent: "#ff4f9a", rotationIntensity: 1, spectrumIntensity: 1.25, rippleIntensity: 1.15, backgroundDim: .32, effects: { halo: true, orbitRings: true, particles: true, lightSweeps: true, waterRipples: true }, motionIntensity: 1, splitDistance: .72, backgroundIntensity: 1.2, glassOpacity: .28 };
const portraitLandscapeLayerSchema = z.enum(["behindCube", "behindVideo", "behindSpectrum", "foreground"]);
const portraitLandscapeStackItemSchema = z.enum(["sideImage", "cube", "centerVideo", "spectrum", "rain", "lightning", "feathers", "particles"]);
const defaultPortraitLandscape = {
  videoUrl: null, videoName: "", videoWidth: 0, videoHeight: 0, videoHasAudio: false,
  sideImageUrl: null, sideImagePlacement: "left" as const, coverImageUrl: null,
  palette: ["#ed75a7", "#ffffff", "#181317"] as [string, string, string], sideImagePalette: ["#ed75a7", "#ffffff", "#181317"] as [string, string, string], spectrumManualPalette: ["#ed75a7", "#ffffff", "#181317"] as [string, string, string], autoPalette: true, spectrumPaletteSource: "cover" as const,
  spectrumIntensity: 1.2, spectrumOpacity: .9, cubeScale: 1, cubeSpeed: .62, cubeRotationBeats: 8, cubeRotationSpeed: 1, glassOpacity: .32,
  effects: { rain: false, lightning: false, feathers: false, particles: true },
  effectLayers: { rain: "foreground" as const, lightning: "behindSpectrum" as const, feathers: "behindVideo" as const, particles: "behindCube" as const },
  effectColors: { rain: "#dcecff", lightning: "#ed75a7", feathers: "#ffffff", particles: "#ed75a7" },
  effectOpacity: { rain: .72, lightning: .9, feathers: .88, particles: .76 },
  layerOrder: ["sideImage", "particles", "cube", "feathers", "centerVideo", "lightning", "spectrum", "rain"] as Array<"sideImage" | "cube" | "centerVideo" | "spectrum" | "rain" | "lightning" | "feathers" | "particles">,
  sideImageAdjustments: { brightness: 1, exposure: 0, contrast: 1, saturation: 1, temperature: 0, blur: 0 },
  effectIntensity: .8
};
const portraitLandscapeSchema = z.object({
  videoUrl: z.string().nullable().default(defaultPortraitLandscape.videoUrl),
  videoName: z.string().max(500).default(defaultPortraitLandscape.videoName),
  videoWidth: z.number().int().nonnegative().default(defaultPortraitLandscape.videoWidth),
  videoHeight: z.number().int().nonnegative().default(defaultPortraitLandscape.videoHeight),
  videoHasAudio: z.boolean().default(defaultPortraitLandscape.videoHasAudio),
  sideImageUrl: z.string().nullable().default(defaultPortraitLandscape.sideImageUrl),
  sideImagePlacement: z.enum(["left", "right"]).default(defaultPortraitLandscape.sideImagePlacement),
  coverImageUrl: z.string().nullable().default(defaultPortraitLandscape.coverImageUrl),
  palette: z.tuple([z.string(), z.string(), z.string()]).default(defaultPortraitLandscape.palette),
  sideImagePalette: z.tuple([z.string(), z.string(), z.string()]).default(defaultPortraitLandscape.sideImagePalette),
  spectrumManualPalette: z.tuple([z.string(), z.string(), z.string()]).default(defaultPortraitLandscape.spectrumManualPalette),
  autoPalette: z.boolean().default(defaultPortraitLandscape.autoPalette),
  spectrumPaletteSource: z.enum(["cover", "sideImage", "manual"]).default(defaultPortraitLandscape.spectrumPaletteSource),
  spectrumIntensity: z.number().min(0).max(3).default(defaultPortraitLandscape.spectrumIntensity),
  spectrumOpacity: z.number().min(0).max(1).default(defaultPortraitLandscape.spectrumOpacity),
  cubeScale: z.number().min(.45).max(1.8).default(defaultPortraitLandscape.cubeScale),
  cubeSpeed: z.number().min(.15).max(1.5).default(defaultPortraitLandscape.cubeSpeed),
  cubeRotationBeats: z.number().int().min(4).max(32).default(defaultPortraitLandscape.cubeRotationBeats),
  cubeRotationSpeed: z.number().min(.25).max(2.5).default(defaultPortraitLandscape.cubeRotationSpeed),
  glassOpacity: z.number().min(.08).max(.7).default(defaultPortraitLandscape.glassOpacity),
  effects: z.object({ rain: z.boolean(), lightning: z.boolean(), feathers: z.boolean(), particles: z.boolean() }).strict().default(defaultPortraitLandscape.effects),
  effectLayers: z.object({ rain: portraitLandscapeLayerSchema, lightning: portraitLandscapeLayerSchema, feathers: portraitLandscapeLayerSchema, particles: portraitLandscapeLayerSchema }).strict().default(defaultPortraitLandscape.effectLayers),
  effectColors: z.object({ rain: z.string(), lightning: z.string(), feathers: z.string(), particles: z.string() }).strict().default(defaultPortraitLandscape.effectColors),
  effectOpacity: z.object({ rain: z.number().min(0).max(1), lightning: z.number().min(0).max(1), feathers: z.number().min(0).max(1), particles: z.number().min(0).max(1) }).strict().default(defaultPortraitLandscape.effectOpacity),
  layerOrder: z.array(portraitLandscapeStackItemSchema).length(8).refine((items) => new Set(items).size === 8, "La pila dei livelli non può contenere duplicati").default(defaultPortraitLandscape.layerOrder),
  sideImageAdjustments: z.object({ brightness: z.number().min(.2).max(2), exposure: z.number().min(-1).max(1), contrast: z.number().min(.2).max(2), saturation: z.number().min(0).max(2.5), temperature: z.number().min(-1).max(1), blur: z.number().min(0).max(12) }).strict().default(defaultPortraitLandscape.sideImageAdjustments),
  effectIntensity: z.number().min(.1).max(2.5).default(defaultPortraitLandscape.effectIntensity)
}).strict();
const defaultCommentsInvasion = {
  videoUrl: null, videoName: "", videoWidth: 0, videoHeight: 0, videoHasAudio: false,
  maxVisible: 5, commentScale: .34, intervalSeconds: 1.25, initialDelaySeconds: .6,
  impactDurationSeconds: .34, impactIntensity: 1, rotationDegrees: 6,
  holdDurationSeconds: 5, exitDurationSeconds: .45, exitAnimation: "fade" as const,
  videoFit: "contain" as const, backgroundColor: "#050507", safeArea: .045
};
const commentsInvasionSchema = z.object({
  videoUrl: z.string().nullable().default(defaultCommentsInvasion.videoUrl),
  videoName: z.string().max(500).default(defaultCommentsInvasion.videoName),
  videoWidth: z.number().int().nonnegative().default(defaultCommentsInvasion.videoWidth),
  videoHeight: z.number().int().nonnegative().default(defaultCommentsInvasion.videoHeight),
  videoHasAudio: z.boolean().default(defaultCommentsInvasion.videoHasAudio),
  maxVisible: z.number().int().min(1).max(20).default(defaultCommentsInvasion.maxVisible),
  commentScale: z.number().min(.1).max(.8).default(defaultCommentsInvasion.commentScale),
  intervalSeconds: z.number().min(.15).max(30).default(defaultCommentsInvasion.intervalSeconds),
  initialDelaySeconds: z.number().min(0).max(60).default(defaultCommentsInvasion.initialDelaySeconds),
  impactDurationSeconds: z.number().min(.08).max(2).default(defaultCommentsInvasion.impactDurationSeconds),
  impactIntensity: z.number().min(.25).max(2).default(defaultCommentsInvasion.impactIntensity),
  rotationDegrees: z.number().min(0).max(20).default(defaultCommentsInvasion.rotationDegrees),
  holdDurationSeconds: z.number().min(.25).max(30).default(defaultCommentsInvasion.holdDurationSeconds),
  exitDurationSeconds: z.number().min(.08).max(3).default(defaultCommentsInvasion.exitDurationSeconds),
  exitAnimation: z.enum(["fade", "shrink", "slide-up", "slide-side", "spin"]).default(defaultCommentsInvasion.exitAnimation),
  videoFit: z.enum(["contain", "cover"]).default(defaultCommentsInvasion.videoFit),
  backgroundColor: z.string().default(defaultCommentsInvasion.backgroundColor),
  safeArea: z.number().min(0).max(.15).default(defaultCommentsInvasion.safeArea)
}).strict();
const teddyWalkSchema = z.object({
  coverImageUrl: z.string().nullable(), furColor: z.string(), patchColor: z.string(), accentColor: z.string(), roadColor: z.string(),
  walkIntensity: z.number().min(.1).max(3), pulseIntensity: z.number().min(0).max(2), danceEnabled: z.boolean().default(false)
}).strict();
const defaultTeddyWalk = { coverImageUrl: null, furColor: "#ef8fa8", patchColor: "#c8988e", accentColor: "#17141a", roadColor: "#a8abad", walkIntensity: .65, pulseIntensity: 1, danceEnabled: false };
const teddyPhonemeCueSchema = z.object({
  id: z.string().min(1), startSeconds: z.number().nonnegative(), endSeconds: z.number().positive(),
  viseme: z.enum(["A", "EI", "OU", "MBP", "LT", "S"]), confidence: z.number().min(0).max(1), manual: z.boolean()
}).strict();
const teddySingSchema = z.object({
  posterImageUrl: z.string().nullable(), furColor: z.string(), patchColor: z.string(), accentColor: z.string(), roomColor: z.string(), ledColor: z.string(),
  lipSyncIntensity: z.number().min(.1).max(2.5), vocalSensitivity: z.number().min(.2).max(2.5), headMotion: z.number().min(0).max(2),
  particlesEnabled: z.boolean().default(true), particleColor: z.string().default("#b9a7ff"), particleDensity: z.number().min(.1).max(2.5).default(1),
  phonemesGenerated: z.boolean().default(false), phonemeCues: z.array(teddyPhonemeCueSchema).default([])
}).strict();
const defaultTeddySing = { posterImageUrl: null, furColor: "#ef8fa8", patchColor: "#c8988e", accentColor: "#17141a", roomColor: "#20242c", ledColor: "#7b5cff", lipSyncIntensity: 1, vocalSensitivity: 1, headMotion: .55, particlesEnabled: true, particleColor: "#b9a7ff", particleDensity: 1, phonemesGenerated: false, phonemeCues: [] };
const proSubtitleAnimationSchema = z.enum([
  "wordRush", "letterOrbit", "perspectiveFlip", "kineticStack",
  "maskReveal", "elasticScale", "trackingSweep", "cinematicDrift",
  "depthZoom", "letterCascade", "waveAssembly", "splitSlide",
  "radialBurst", "verticalRoll", "fullFrameOrbit", "editorialGrid",
  "focusCarousel"
]);
const proSubtitleWordStyleSchema = z.object({
  index: z.number().int().nonnegative().max(499),
  color: z.string(),
  fontSizeScale: z.number().min(.45).max(2.2).default(1),
  animation: proSubtitleAnimationSchema.nullable().default(null)
}).strict();
const proSubtitleCueStyleSchema = z.object({
  cueId: z.string().min(1),
  animation: proSubtitleAnimationSchema,
  animationAutomatic: z.boolean().default(true),
  fontFamily: z.string().min(1).max(100),
  fontFamilyAutomatic: z.boolean().default(true),
  fontSize: z.number().int().min(24).max(260),
  fontSizeAutomatic: z.boolean().default(true),
  positionX: z.number().min(0).max(100).default(50),
  positionY: z.number().min(0).max(100).default(50),
  positionAutomatic: z.boolean().default(true),
  opacity: z.number().min(0).max(1).default(1),
  opacityAutomatic: z.boolean().default(true),
  shadowEnabled: z.boolean(),
  shadowColor: z.string(),
  wordStyles: z.array(proSubtitleWordStyleSchema).max(500).default([])
}).strict();
const defaultProSubtitles = {
  videoUrl: null, videoName: "", fit: "contain" as const, dimming: .12,
  paletteImageUrl: null, palette: ["#000000", "#ffffff", "#ed75a7"] as [string, string, string],
  paletteShadowEnabled: [true, true, true] as [boolean, boolean, boolean],
  paletteShadowColors: ["#050611", "#071b1c", "#10082a"] as [string, string, string],
  autoVaryAnimations: true, defaultAnimation: "wordRush" as const,
  defaultFontFamily: "Space Grotesk", defaultFontSize: 104,
  positionX: 50, positionY: 50, opacity: 1,
  shadowEnabled: true, shadowColor: "#050611", titleSafe: .09,
  backgroundMode: "transparent" as const, backgroundColor: "#00ff00",
  exportFormat: "webmVp9Alpha" as const, cueStyles: []
};
const proSubtitlesSchema = z.object({
  videoUrl: z.string().nullable().default(defaultProSubtitles.videoUrl),
  videoName: z.string().max(500).default(defaultProSubtitles.videoName),
  fit: z.enum(["cover", "contain"]).default(defaultProSubtitles.fit),
  dimming: z.number().min(0).max(.8).default(defaultProSubtitles.dimming),
  paletteImageUrl: z.string().nullable().default(defaultProSubtitles.paletteImageUrl),
  palette: z.tuple([z.string(), z.string(), z.string()]).default(defaultProSubtitles.palette),
  paletteShadowEnabled: z.tuple([z.boolean(), z.boolean(), z.boolean()]).default(defaultProSubtitles.paletteShadowEnabled),
  paletteShadowColors: z.tuple([z.string(), z.string(), z.string()]).default(defaultProSubtitles.paletteShadowColors),
  autoVaryAnimations: z.boolean().default(defaultProSubtitles.autoVaryAnimations),
  defaultAnimation: proSubtitleAnimationSchema.default(defaultProSubtitles.defaultAnimation),
  defaultFontFamily: z.string().min(1).max(100).default(defaultProSubtitles.defaultFontFamily),
  defaultFontSize: z.number().int().min(24).max(260).default(defaultProSubtitles.defaultFontSize),
  positionX: z.number().min(0).max(100).default(defaultProSubtitles.positionX),
  positionY: z.number().min(0).max(100).default(defaultProSubtitles.positionY),
  opacity: z.number().min(0).max(1).default(defaultProSubtitles.opacity),
  shadowEnabled: z.boolean().default(defaultProSubtitles.shadowEnabled),
  shadowColor: z.string().default(defaultProSubtitles.shadowColor),
  titleSafe: z.number().min(.05).max(.2).default(defaultProSubtitles.titleSafe),
  backgroundMode: z.enum(["transparent", "solid"]).default(defaultProSubtitles.backgroundMode),
  backgroundColor: z.string().default(defaultProSubtitles.backgroundColor),
  exportFormat: z.enum(["webmVp9Alpha", "movProRes4444"]).default(defaultProSubtitles.exportFormat),
  cueStyles: z.array(proSubtitleCueStyleSchema).default(defaultProSubtitles.cueStyles)
}).strict();
const defaultPixelsSub = {
  imageUrl: null, palette: ["#000000", "#ffffff", "#ed75a7"] as [string, string, string],
  autoPalette: true, pixelSize: 27, flowSpeed: .72, degradationDuration: 3.2,
  audioReactivity: .78, subtitleContrast: 1, trailStrength: .34, imageInset: .065,
  subtitleFontFamily: "Pixelify Sans" as const, subtitleColorIndex: 1, subtitleShadowEnabled: true, subtitleShadowColor: "#000000",
  subtitleShadowOffset: 3, subtitlePositionY: 72
};
const backgroundAutoDefaultPalette = ["#63f0d1", "#7657ff", "#ff4f9a"] as [string, string, string];
const backgroundAutoDetectionSchema = z.object({
  id: z.string().min(1), label: z.string().trim().min(1).max(120), alias: z.string().trim().max(120).default(""), score: z.number().min(0).max(1),
  bbox: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) }).strict(),
  isPerson: z.boolean().default(false),
  // Optional here for legacy JSON compatibility. The parent transform fills
  // this from the current image palette before returning a project snapshot.
  paletteMode: z.enum(["auto", "manual"]).optional(),
  // Arrays shorter than three are accepted during migration and replaced by
  // the parent image palette in the transform below.
  palette: z.array(z.string()).max(3).nullable().optional()
}).strict().transform((value) => ({ ...value, alias: value.alias || value.label })).superRefine((value, context) => {
  if (value.bbox.x + value.bbox.width > 1.000001) context.addIssue({ code: "custom", path: ["bbox", "width"], message: "Il riquadro supera il bordo destro" });
  if (value.bbox.y + value.bbox.height > 1.000001) context.addIssue({ code: "custom", path: ["bbox", "height"], message: "Il riquadro supera il bordo inferiore" });
});
const backgroundAutoEffectSchema = z.object({
  id: z.string().min(1), type: z.literal("circularSpectrum"), label: z.literal("Circular Spectrum"), enabled: z.boolean().default(true),
  placementMode: z.enum(["detected", "manual"]).default("detected"),
  detectionId: z.string().min(1).nullable().default(null),
  centerX: z.number().min(0).max(1).default(.5), centerY: z.number().min(0).max(1).default(.5), diameter: z.number().min(.05).max(1).default(.42),
  paletteMode: z.enum(["auto", "manual"]).default("auto"),
  color: z.string().default("#63f0d1"), palette: z.tuple([z.string(), z.string(), z.string()]).default(["#63f0d1", "#7657ff", "#ff4f9a"]),
  intensity: z.number().min(0).max(3).default(1), scale: z.number().min(.25).max(3).default(1),
  opacity: z.number().min(0).max(1).default(.9), collisionParticles: z.boolean().default(true),
  // These independent toggles were added after the first Background Auto
  // release. Keep them optional in persisted JSON via Zod defaults so old
  // projects continue to render the original radial spectrum.
  centerSpectrumEnabled: z.boolean().default(true),
  stereoSidesEnabled: z.boolean().default(true),
  subtitlesEnabled: z.boolean().default(false),
  radialSpectrumEnabled: z.boolean().default(true),
  // Revolutions per second. Zero is a valid, deterministic freeze value.
  rotationSpeed: z.number().min(0).max(1).default(.08)
}).strict();
const defaultBackgroundAuto = {
  imageUrl: null, sourceWidth: 0, sourceHeight: 0, palette: backgroundAutoDefaultPalette,
  detectionThreshold: .15,
  detections: [] as Array<{ id: string; label: string; alias: string; score: number; bbox: { x: number; y: number; width: number; height: number }; isPerson: boolean; paletteMode?: "auto" | "manual"; palette?: [string, string, string] | null }>,
  effects: [{ id: "circular-spectrum-1", type: "circularSpectrum" as const, label: "Circular Spectrum" as const, enabled: false, placementMode: "detected" as const, detectionId: null, centerX: .5, centerY: .5, diameter: .42, paletteMode: "auto" as const, color: "#63f0d1", palette: backgroundAutoDefaultPalette, intensity: 1, scale: 1, opacity: .9, collisionParticles: true, centerSpectrumEnabled: true, stereoSidesEnabled: true, subtitlesEnabled: false, radialSpectrumEnabled: true, rotationSpeed: .08 }],
  personAnimationEnabled: false
};
const backgroundAutoSchema = z.object({
  imageUrl: z.string().nullable().default(defaultBackgroundAuto.imageUrl),
  sourceWidth: z.number().int().nonnegative().default(defaultBackgroundAuto.sourceWidth),
  sourceHeight: z.number().int().nonnegative().default(defaultBackgroundAuto.sourceHeight),
  palette: z.tuple([z.string(), z.string(), z.string()]).default(defaultBackgroundAuto.palette),
  // DETR confidence threshold used on the next explicit detection run.
  detectionThreshold: z.number().min(.05).max(.9).default(defaultBackgroundAuto.detectionThreshold),
  detections: z.array(backgroundAutoDetectionSchema).max(256).default(defaultBackgroundAuto.detections),
  effects: z.array(backgroundAutoEffectSchema).max(16).default(defaultBackgroundAuto.effects),
  personAnimationEnabled: z.boolean().default(defaultBackgroundAuto.personAnimationEnabled)
}).strict().transform((value) => ({
  ...value,
  // Legacy detections did not carry an object-local palette. Keep their
  // image-following behaviour while making the persisted snapshot explicit.
  detections: value.detections.map((detection) => ({
    ...detection,
    paletteMode: detection.paletteMode ?? "auto",
    palette: detection.palette && detection.palette.length === 3 ? detection.palette : value.palette
  })) as typeof value.detections,
  // Null-target effects are intentional editor placeholders. Legacy projects
  // may have persisted them as enabled; disable those placeholders rather
  // than implicitly animating the first detection.
  effects: value.effects.map((effect) => ({
    ...effect,
    placementMode: effect.placementMode ?? (effect.detectionId ? "detected" : "manual"),
    centerX: effect.centerX ?? .5,
    centerY: effect.centerY ?? .5,
    diameter: effect.diameter ?? .42,
    radialSpectrumEnabled: effect.radialSpectrumEnabled ?? true,
    ...(effect.placementMode === "manual" || !effect.detectionId ? { detectionId: null } : {}),
    ...(!effect.detectionId && effect.enabled && effect.placementMode !== "manual" ? { enabled: false } : {})
  }))
}));
const pixelsSubSchema = z.object({
  imageUrl: z.string().nullable().default(defaultPixelsSub.imageUrl),
  palette: z.tuple([z.string(), z.string(), z.string()]).default(defaultPixelsSub.palette),
  autoPalette: z.boolean().default(defaultPixelsSub.autoPalette),
  pixelSize: z.number().int().min(4).max(32).default(defaultPixelsSub.pixelSize),
  flowSpeed: z.number().min(.05).max(3).default(defaultPixelsSub.flowSpeed),
  degradationDuration: z.number().min(.4).max(10).default(defaultPixelsSub.degradationDuration),
  audioReactivity: z.number().min(0).max(2).default(defaultPixelsSub.audioReactivity),
  subtitleContrast: z.number().min(.25).max(1).default(defaultPixelsSub.subtitleContrast),
  trailStrength: z.number().min(0).max(1).default(defaultPixelsSub.trailStrength),
  imageInset: z.number().min(.025).max(.16).default(defaultPixelsSub.imageInset),
  subtitleFontFamily: z.enum(["Pixelify Sans", "Press Start 2P", "Silkscreen", "VT323", "Tiny5", "Jersey 10"]).default(defaultPixelsSub.subtitleFontFamily),
  subtitleColorIndex: z.number().int().min(0).max(2).default(defaultPixelsSub.subtitleColorIndex),
  subtitleShadowEnabled: z.boolean().default(defaultPixelsSub.subtitleShadowEnabled),
  subtitleShadowColor: z.string().default(defaultPixelsSub.subtitleShadowColor),
  subtitleShadowOffset: z.number().int().min(1).max(10).default(defaultPixelsSub.subtitleShadowOffset),
  subtitlePositionY: z.number().min(15).max(88).default(defaultPixelsSub.subtitlePositionY)
}).strict();
const defaultStaticWatermark = {
  videoUrl: null, videoName: "", videoWidth: 0, videoHeight: 0,
  referenceImageUrl: null, referenceImageName: "",
  region: { x: .68, y: .04, width: .27, height: .14 },
  referenceFit: "cover" as const, referenceScale: 1, referenceOffsetX: 0, referenceOffsetY: 0,
  feather: 0, patchOpacity: 1, colorMatch: true, colorMatchStrength: .05, guideVisible: true
};
const staticWatermarkSchema = z.object({
  videoUrl: z.string().nullable().default(defaultStaticWatermark.videoUrl),
  videoName: z.string().max(500).default(defaultStaticWatermark.videoName),
  videoWidth: z.number().int().nonnegative().default(defaultStaticWatermark.videoWidth),
  videoHeight: z.number().int().nonnegative().default(defaultStaticWatermark.videoHeight),
  referenceImageUrl: z.string().nullable().default(defaultStaticWatermark.referenceImageUrl),
  referenceImageName: z.string().max(500).default(defaultStaticWatermark.referenceImageName),
  region: z.object({
    x: z.number().min(0).max(1), y: z.number().min(0).max(1),
    width: z.number().min(.005).max(1), height: z.number().min(.005).max(1)
  }).strict().default(defaultStaticWatermark.region),
  referenceFit: z.enum(["cover", "contain", "stretch"]).default(defaultStaticWatermark.referenceFit),
  referenceScale: z.number().min(.5).max(2.5).default(defaultStaticWatermark.referenceScale),
  referenceOffsetX: z.number().min(-1).max(1).default(defaultStaticWatermark.referenceOffsetX),
  referenceOffsetY: z.number().min(-1).max(1).default(defaultStaticWatermark.referenceOffsetY),
  feather: z.number().int().min(0).max(24).default(defaultStaticWatermark.feather),
  patchOpacity: z.number().min(0).max(1).default(defaultStaticWatermark.patchOpacity),
  colorMatch: z.boolean().default(defaultStaticWatermark.colorMatch),
  colorMatchStrength: z.number().min(0).max(1).default(defaultStaticWatermark.colorMatchStrength),
  guideVisible: z.boolean().default(defaultStaticWatermark.guideVisible)
}).strict();
const defaultUpscaler = {
  sourceUrl: null, sourceName: "", sourceKind: "image" as const, sourceWidth: 0, sourceHeight: 0, durationSeconds: 0,
  model: "canvas" as const, backend: "auto" as const, tileSize: 256, tta: false,
  remote: {
    enabled: false,
    endpoints: [] as Array<{ id: string; label: string; url: string; enabled: boolean }>,
    model: "",
    frameRetries: 2,
    segmentFrames: 100,
    outputFps: null as number | null
  },
  scale: 4, finalWidth: 3840, finalHeight: 2160, lockAspectRatio: true,
  comparisonMode: "split" as const, comparisonPosition: .5, originalBlend: 0,
  applyVideoAdjustments: false,
  adjustments: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, sharpness: 0, denoise: 0 }
};
const upscalerSchema = z.object({
  sourceUrl: z.string().nullable().default(defaultUpscaler.sourceUrl),
  sourceName: z.string().max(500).default(defaultUpscaler.sourceName),
  sourceKind: z.enum(["image", "video"]).default(defaultUpscaler.sourceKind),
  sourceWidth: z.number().int().nonnegative().default(defaultUpscaler.sourceWidth),
  sourceHeight: z.number().int().nonnegative().default(defaultUpscaler.sourceHeight),
  durationSeconds: z.number().nonnegative().default(defaultUpscaler.durationSeconds),
  model: z.enum(["canvas", "RealESRGAN_x4plus", "RealESRGAN_x2plus", "RealESRNet_x4plus", "RealESRGAN_x4plus_anime_6B", "realesr-general-x4v3", "realesr-animevideov3"]).default(defaultUpscaler.model),
  backend: z.enum(["auto", "cuda", "metal", "webgpu", "cpu"]).default(defaultUpscaler.backend),
  tileSize: z.number().int().min(64).max(1024).default(defaultUpscaler.tileSize),
  tta: z.boolean().default(defaultUpscaler.tta),
  remote: z.object({
    enabled: z.boolean().default(defaultUpscaler.remote.enabled),
    endpoints: z.array(z.object({
      id: z.string().min(1).max(100), label: z.string().max(100), url: z.string().url().max(2048), enabled: z.boolean()
    }).strict()).max(16).default(defaultUpscaler.remote.endpoints),
    model: z.string().max(200).default(defaultUpscaler.remote.model),
    frameRetries: z.number().int().min(0).max(6).default(defaultUpscaler.remote.frameRetries),
    segmentFrames: z.number().int().min(1).max(5000).default(defaultUpscaler.remote.segmentFrames),
    outputFps: z.number().min(1).max(480).nullable().default(defaultUpscaler.remote.outputFps)
  }).strict().default(defaultUpscaler.remote),
  scale: z.number().min(1).max(4).default(defaultUpscaler.scale),
  finalWidth: z.number().int().min(64).max(16384).default(defaultUpscaler.finalWidth),
  finalHeight: z.number().int().min(64).max(16384).default(defaultUpscaler.finalHeight),
  lockAspectRatio: z.boolean().default(defaultUpscaler.lockAspectRatio),
  comparisonMode: z.enum(["enhanced", "original", "split", "blend"]).default(defaultUpscaler.comparisonMode),
  comparisonPosition: z.number().min(0).max(1).default(defaultUpscaler.comparisonPosition),
  originalBlend: z.number().min(0).max(1).default(defaultUpscaler.originalBlend),
  applyVideoAdjustments: z.boolean().default(defaultUpscaler.applyVideoAdjustments),
  adjustments: z.object({
    exposure: z.number().min(-2).max(2), contrast: z.number().min(-100).max(100), highlights: z.number().min(-100).max(100), shadows: z.number().min(-100).max(100),
    whites: z.number().min(-100).max(100), blacks: z.number().min(-100).max(100), saturation: z.number().min(-100).max(100), vibrance: z.number().min(-100).max(100),
    temperature: z.number().min(-100).max(100), tint: z.number().min(-100).max(100), sharpness: z.number().min(0).max(100), denoise: z.number().min(0).max(100)
  }).strict().default(defaultUpscaler.adjustments)
}).strict();
const defaultFrameBooster = {
  sourceUrl: null,
  sourceName: "",
  sourceWidth: 0,
  sourceHeight: 0,
  sourceDurationSeconds: 0,
  sourceFps: null,
  sourceFrameCount: null,
  sourceHasAudio: false,
  // Frame Booster standalone uses only deterministic FFmpeg paths.
  method: "motion" as const,
  targetMode: "multiplier" as const,
  targetMultiplier: 2 as const,
  targetFps: 60,
  scale: 1 as const,
  sceneCut: true,
  quality: "balanced" as const,
  lastOutput: null
};
const frameBoosterSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const legacy = { ...(value as Record<string, unknown>) };
  delete legacy.device;
  delete legacy.rifeModel;
  delete legacy.precision;
  return { ...legacy, method: legacy.method === "rife" ? "motion" : legacy.method };
}, z.object({
  sourceUrl: z.string().nullable().default(defaultFrameBooster.sourceUrl),
  sourceName: z.string().max(500).default(defaultFrameBooster.sourceName),
  sourceWidth: z.number().int().nonnegative().default(defaultFrameBooster.sourceWidth),
  sourceHeight: z.number().int().nonnegative().default(defaultFrameBooster.sourceHeight),
  sourceDurationSeconds: z.number().nonnegative().default(defaultFrameBooster.sourceDurationSeconds),
  sourceFps: z.number().positive().nullable().default(defaultFrameBooster.sourceFps),
  sourceFrameCount: z.number().int().nonnegative().nullable().default(defaultFrameBooster.sourceFrameCount),
  sourceHasAudio: z.boolean().default(defaultFrameBooster.sourceHasAudio),
  method: z.enum(["motion", "motion-obmc", "blend"]).default(defaultFrameBooster.method),
  targetMode: z.enum(["multiplier", "fps"]).default(defaultFrameBooster.targetMode),
  targetMultiplier: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).default(defaultFrameBooster.targetMultiplier),
  targetFps: z.number().positive().max(480).default(defaultFrameBooster.targetFps),
  scale: z.union([z.literal(.5), z.literal(1), z.literal(2)]).default(defaultFrameBooster.scale),
  sceneCut: z.boolean().default(defaultFrameBooster.sceneCut),
  quality: z.enum(["balanced", "high"]).default(defaultFrameBooster.quality),
  lastOutput: z.object({
    name: z.string().max(500), fps: z.number().positive(), frameCount: z.number().int().nonnegative(),
    durationSeconds: z.number().nonnegative(), width: z.number().int().nonnegative(), height: z.number().int().nonnegative(),
    hasAudio: z.boolean(), backend: z.string().max(200)
  }).strict().nullable().default(defaultFrameBooster.lastOutput)
}).strict());
// Le modalità di fusione corrispondono uno a uno a `globalCompositeOperation`.
// L’export offline le compone esattamente; la preview DOM conserva la stessa
// semantica e privilegia la fluidità dei decoder hardware durante il montaggio.
export const videoEditorBlendModes = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"] as const;
const videoEditorBlendModeSchema = z.enum(videoEditorBlendModes);
const videoEditorFadeCurveSchema = z.enum(["linear", "smooth", "exponential"]);
const videoEditorEffectTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("clip"), clipId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("composition") }).strict()
]);
const videoEditorEffectParameterSchema = z.union([z.number().finite(), z.string().max(500), z.boolean()]);
const videoEditorEffectClipSchema = z.object({
  id: z.string().min(1), effectId: z.string().min(1).max(120), target: videoEditorEffectTargetSchema,
  startSeconds: z.number().nonnegative(), durationSeconds: z.number().positive().max(3_600),
  enabled: z.boolean().default(true), mix: z.number().min(0).max(1).default(1),
  parameters: z.record(z.string().min(1).max(80), videoEditorEffectParameterSchema).default({})
}).strict();
const defaultVideoEditorAdjustments = {
  exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  clarity: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0,
  sharpness: 0, denoise: 0, blur: 0, grayscale: 0, sepia: 0, fade: 0, vignette: 0, opacity: 1
};
const videoEditorAdjustmentsSchema = z.object({
  exposure: z.number().min(-2).max(2), brightness: z.number().min(-100).max(100).default(0), contrast: z.number().min(-100).max(100), highlights: z.number().min(-100).max(100), shadows: z.number().min(-100).max(100),
  whites: z.number().min(-100).max(100), blacks: z.number().min(-100).max(100), saturation: z.number().min(-100).max(100), vibrance: z.number().min(-100).max(100),
  temperature: z.number().min(-100).max(100), tint: z.number().min(-100).max(100), hue: z.number().min(-180).max(180), sharpness: z.number().min(0).max(100),
  denoise: z.number().min(0).max(100), clarity: z.number().min(-100).max(100).default(0), blur: z.number().min(0).max(100).default(0),
  grayscale: z.number().min(0).max(100).default(0), sepia: z.number().min(0).max(100).default(0), fade: z.number().min(0).max(100).default(0),
  vignette: z.number().min(0).max(100).default(0), opacity: z.number().min(0).max(1)
}).strict();
const videoEditorAssetSchema = z.object({
  id: z.string().min(1), name: z.string().min(1).max(500), kind: z.enum(["video", "image", "audio"]),
  url: z.string().min(1), durationSeconds: z.number().nonnegative(), width: z.number().int().nonnegative(), height: z.number().int().nonnegative(),
  // Frame identity metadata is optional on the wire for legacy projects. The
  // parser hydrates stable defaults so preview/export can use one timebase.
  sourceFrameCount: z.number().int().nonnegative().optional(),
  sourceRate: z.object({ numerator: z.number().int().min(1).max(120_000), denominator: z.number().int().min(1).max(1_001) }).strict().optional(),
  frameIdentityId: z.string().min(1).nullable().optional(),
  timingMode: z.enum(["constant", "variable", "unknown"]).optional(),
  thumbnailUrl: z.string().nullable().optional(),
  hasAudio: z.boolean().default(false), bpm: z.number().positive().nullable().default(null),
  beats: z.array(z.number().nonnegative()).max(4_000).default([]), downbeats: z.array(z.number().nonnegative()).max(1_000).default([]),
  waveform: z.array(z.number().min(-1).max(1)).max(4_096).default([])
}).strict();
const videoEditorTrackSchema = z.object({
  id: z.string().min(1), name: z.string().min(1).max(120), kind: z.enum(["video", "audio"]),
  hidden: z.boolean().default(false), muted: z.boolean().default(false), locked: z.boolean().default(false),
  volume: z.number().min(0).max(2).default(1)
}).strict();
const defaultVideoEditorImageShadow = {
  enabled: false,
  style: "drop" as const,
  color: "#000000",
  opacity: .5,
  blur: .045,
  distance: .035,
  angle: 135
};
const videoEditorImageShadowSchema = z.object({
  enabled: z.boolean().default(defaultVideoEditorImageShadow.enabled),
  style: z.enum(["drop", "glow", "long"]).default(defaultVideoEditorImageShadow.style),
  color: z.string().min(1).max(64).default(defaultVideoEditorImageShadow.color),
  opacity: z.number().min(0).max(1).default(defaultVideoEditorImageShadow.opacity),
  blur: z.number().min(0).max(.4).default(defaultVideoEditorImageShadow.blur),
  distance: z.number().min(0).max(.5).default(defaultVideoEditorImageShadow.distance),
  angle: z.number().min(-360).max(360).default(defaultVideoEditorImageShadow.angle)
}).strict().default(defaultVideoEditorImageShadow);
const videoEditorClipSchema = z.object({
  id: z.string().min(1), assetId: z.string().min(1), trackId: z.string().min(1),
  startSeconds: z.number().nonnegative(), durationSeconds: z.number().positive(), sourceInSeconds: z.number().nonnegative().default(0),
  reversed: z.boolean().default(false),
  fadeInSeconds: z.number().nonnegative().max(60).default(0), fadeOutSeconds: z.number().nonnegative().max(60).default(0),
  fadeCurve: videoEditorFadeCurveSchema.default("smooth"), audioFadeInSeconds: z.number().nonnegative().max(60).default(0), audioFadeOutSeconds: z.number().nonnegative().max(60).default(0),
  blendMode: videoEditorBlendModeSchema.default("normal"), blendIntensity: z.number().min(0).max(1).default(1),
  speed: z.object({
    mode: z.enum(["constant", "ramp"]).default("constant"),
    constant: z.number().min(.1).max(8).default(1),
    points: z.array(z.object({ id: z.string().min(1), frame: z.number().finite().nonnegative(), speed: z.number().min(.1).max(8), curve: z.enum(["hold", "linear", "exponential", "logarithmic", "custom", "easeIn", "easeOut", "easeInOut", "bezier"]).default("linear"), bezier: z.object({ x1: z.number().min(0).max(1), y1: z.number().min(0).max(1), x2: z.number().min(0).max(1), y2: z.number().min(0).max(1) }).strict().optional(), segment: z.object({ curve: z.enum(["hold", "linear", "exponential", "logarithmic", "easeIn", "easeOut", "easeInOut"]), fromProgress: z.number().min(0).max(1), toProgress: z.number().min(0).max(1) }).strict().optional(), inTangent: z.object({ x: z.number(), y: z.number() }).strict().optional(), outTangent: z.object({ x: z.number(), y: z.number() }).strict().optional() }).strict()).max(600).default([]),
    sampleOriginFrame: z.number().finite().optional(),
    leadingRate: z.number().min(.1).max(8).optional(),
    trailingRate: z.number().min(.1).max(8).optional(),
    preservePitch: z.boolean().default(false)
  }).strict().optional(),
  adjustments: videoEditorAdjustmentsSchema.default(defaultVideoEditorAdjustments),
  transform: z.object({ x: z.number().min(-2).max(2), y: z.number().min(-2).max(2), scale: z.number().min(.05).max(6), rotation: z.number().min(-360).max(360) }).strict().optional(),
  imageShadow: videoEditorImageShadowSchema,
  fit: z.enum(["cover", "contain", "fill"]).default("cover"),
  muted: z.boolean().default(false), volume: z.number().min(0).max(2).default(1)
}).strict();
const defaultVideoEditor = {
  assets: [] as [], tracks: [
    // Gli ID storici restano stabili per aprire i progetti esistenti; nomi e
    // comportamento sono neutrali: ogni livello video ha le stesse capacità.
    { id: "video-editor-track-overlay", name: "Livello video 2", kind: "video" as const, hidden: false, muted: false, locked: false, volume: 1 },
    { id: "video-editor-track-main", name: "Livello video 1", kind: "video" as const, hidden: false, muted: false, locked: false, volume: 1 },
    { id: "video-editor-track-audio", name: "Audio 1", kind: "audio" as const, hidden: false, muted: false, locked: false, volume: 1 }
  ], clips: [] as [], selectedClipIds: [] as [], effectClips: [] as [], selectedEffectClipIds: [] as [],
  timebase: { fpsNumerator: 60, fpsDenominator: 1, dropFrame: false },
  automationLanes: [] as [],
  snapEnabled: true, snapThresholdSeconds: .08, snapToBeats: true,
  backgroundColor: "#000000", outputWidth: 1920, outputHeight: 1080,
  interpolationEnabled: false, interpolationTargetFps: 60, interpolationMethod: "motion" as const
};
const videoEditorSchema = z.object({
  assets: z.array(videoEditorAssetSchema).max(200).default(defaultVideoEditor.assets),
  // L’ordine è quello mostrato in timeline (dall’alto verso il basso); il
  // compositor disegna in senso inverso, così la traccia in cima resta sopra.
  tracks: z.array(videoEditorTrackSchema).min(1).max(24).default(defaultVideoEditor.tracks),
  clips: z.array(videoEditorClipSchema).max(600).default(defaultVideoEditor.clips),
  selectedClipIds: z.array(z.string().min(1)).max(600).default(defaultVideoEditor.selectedClipIds),
  effectClips: z.array(videoEditorEffectClipSchema).max(1_200).default(defaultVideoEditor.effectClips),
  selectedEffectClipIds: z.array(z.string().min(1)).max(1_200).default(defaultVideoEditor.selectedEffectClipIds),
  timebase: z.object({ fpsNumerator: z.number().int().min(1).max(240), fpsDenominator: z.number().int().min(1).max(1_001), dropFrame: z.boolean().default(false) }).strict().default(defaultVideoEditor.timebase),
  automationLanes: z.array(z.object({
    id: z.string().min(1), target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("clip"), clipId: z.string().min(1), property: z.string().min(1).max(120) }).strict(),
      z.object({ kind: z.literal("effect"), effectId: z.string().min(1), property: z.string().min(1).max(120) }).strict()
    ]),
    keyframes: z.array(z.object({ id: z.string().min(1), frame: z.number().int().nonnegative(), value: z.number().finite(), curve: z.enum(["hold", "linear", "exponential", "logarithmic", "custom", "easeIn", "easeOut", "easeInOut", "bezier"]).default("linear"), bezier: z.object({ x1: z.number().min(0).max(1), y1: z.number().min(0).max(1), x2: z.number().min(0).max(1), y2: z.number().min(0).max(1) }).strict().optional(), inTangent: z.object({ x: z.number(), y: z.number() }).strict().optional(), outTangent: z.object({ x: z.number(), y: z.number() }).strict().optional() }).strict()).max(600),
    enabled: z.boolean().default(true)
  }).strict()).max(1_200).default(defaultVideoEditor.automationLanes),
  snapEnabled: z.boolean().default(defaultVideoEditor.snapEnabled),
  snapThresholdSeconds: z.number().min(.005).max(.5).default(defaultVideoEditor.snapThresholdSeconds),
  snapToBeats: z.boolean().default(defaultVideoEditor.snapToBeats),
  backgroundColor: z.string().default(defaultVideoEditor.backgroundColor),
  outputWidth: z.number().int().min(64).max(7680).default(defaultVideoEditor.outputWidth),
  outputHeight: z.number().int().min(64).max(7680).default(defaultVideoEditor.outputHeight),
  interpolationEnabled: z.boolean().default(defaultVideoEditor.interpolationEnabled),
  interpolationTargetFps: z.number().int().min(24).max(240).default(defaultVideoEditor.interpolationTargetFps),
  interpolationMethod: z.enum(["blend", "motion", "rife"]).default(defaultVideoEditor.interpolationMethod)
}).strict();
const defaultSceneLighting = {
  enabled: false, origin: { x: 4, y: 6, z: 6 }, target: { x: 0, y: 1, z: 0 }, color: "#fff0cf",
  intensity: 32, distance: 28, angleDegrees: 34, penumbra: .42, decay: 2, castShadow: true,
  sourceVisible: true, sourceRadius: .14, beamVisible: true, beamDensity: .38, beamLengthMultiplier: 1,
  followBall: true, activeFromSeconds: 0, activeUntilSeconds: null, reflectionBoost: 1
};
const subtitleCueSchema = z.object({
  id: z.string().min(1), startSeconds: z.number().nonnegative(), endSeconds: z.number().positive(),
  text: z.string().min(1).max(500), confidence: z.number().min(0).max(1), verified: z.boolean(), manual: z.boolean()
}).strict();
const defaultSubtitles = {
  enabled: false, animation: "ledFall" as const, fontFamily: "Orbitron", fontSize: 64,
  color: "#7fffe1", glowColor: "#35e7ff", fallSpeed: 1, maxWordsPerPhrase: 6,
  maxCueDuration: 4.2, maxCharsPerLine: 34, maxReadingSpeed: 19,
  sourceLyrics: "", language: "auto", autoPalette: true,
  whisperModel: "whisper-base_timestamped" as const,
  llmEnabled: true, llmModel: "qwen2.5-0.5b-instruct" as const, llmPasses: 5,
  cues: []
};
const subtitlesSchema = z.object({
  enabled: z.boolean().default(defaultSubtitles.enabled),
  animation: z.enum(["ledFall", "cinematicFade", "wordPop", "karaokeGlow", "slideUp"]).default(defaultSubtitles.animation),
  fontFamily: z.string().min(1).max(100).default(defaultSubtitles.fontFamily),
  fontSize: z.number().int().min(18).max(180).default(defaultSubtitles.fontSize),
  color: z.string().default(defaultSubtitles.color), glowColor: z.string().default(defaultSubtitles.glowColor),
  fallSpeed: z.number().min(.2).max(4).default(defaultSubtitles.fallSpeed),
  maxWordsPerPhrase: z.number().int().min(1).max(20).default(defaultSubtitles.maxWordsPerPhrase),
  maxCueDuration: z.number().min(1.5).max(7).default(defaultSubtitles.maxCueDuration),
  maxCharsPerLine: z.number().int().min(18).max(60).default(defaultSubtitles.maxCharsPerLine),
  maxReadingSpeed: z.number().min(10).max(28).default(defaultSubtitles.maxReadingSpeed),
  sourceLyrics: z.string().max(100_000).default(defaultSubtitles.sourceLyrics),
  language: z.string().min(2).max(12).default(defaultSubtitles.language),
  autoPalette: z.boolean().default(defaultSubtitles.autoPalette),
  whisperModel: z.enum(["whisper-tiny_timestamped", "whisper-base_timestamped", "whisper-medium_timestamped"]).default(defaultSubtitles.whisperModel),
  llmEnabled: z.boolean().default(defaultSubtitles.llmEnabled),
  llmModel: z.preprocess(
    (value) => value === "smollm2-135m-instruct" ? "qwen2.5-0.5b-instruct" : value,
    z.enum(["qwen2.5-0.5b-instruct"]).default(defaultSubtitles.llmModel)
  ),
  llmPasses: z.number().int().min(1).max(10).default(defaultSubtitles.llmPasses),
  cues: z.array(subtitleCueSchema).default(defaultSubtitles.cues)
}).strict();
const sceneLightingSchema = z.object({
  enabled: z.boolean().default(defaultSceneLighting.enabled),
  origin: vector3Schema.default(defaultSceneLighting.origin),
  target: vector3Schema.default(defaultSceneLighting.target),
  color: z.string().default(defaultSceneLighting.color),
  intensity: z.number().min(0).max(500).default(defaultSceneLighting.intensity),
  distance: z.number().min(0).max(500).default(defaultSceneLighting.distance),
  angleDegrees: z.number().min(1).max(89).default(defaultSceneLighting.angleDegrees),
  penumbra: z.number().min(0).max(1).default(defaultSceneLighting.penumbra),
  decay: z.number().min(0).max(4).default(defaultSceneLighting.decay),
  castShadow: z.boolean().default(defaultSceneLighting.castShadow),
  sourceVisible: z.boolean().default(defaultSceneLighting.sourceVisible),
  sourceRadius: z.number().min(.02).max(1).default(defaultSceneLighting.sourceRadius),
  beamVisible: z.boolean().default(defaultSceneLighting.beamVisible),
  beamDensity: z.number().min(0).max(1).default(defaultSceneLighting.beamDensity),
  beamLengthMultiplier: z.number().min(.25).max(12).default(defaultSceneLighting.beamLengthMultiplier),
  followBall: z.boolean().default(defaultSceneLighting.followBall),
  activeFromSeconds: z.number().nonnegative().default(defaultSceneLighting.activeFromSeconds),
  activeUntilSeconds: z.number().nonnegative().nullable().default(defaultSceneLighting.activeUntilSeconds),
  reflectionBoost: z.number().min(.25).max(3).default(defaultSceneLighting.reflectionBoost)
}).strict();

// Song Player keeps the imported fragment in `project.audio` and stores the
// optional full track as a separate, content-addressed asset.  All fields use
// defaults so projects written before Song Player remain valid when parsed.
const defaultSongPlayer = {
  assets: [],
  fullTrackAssetId: null,
  coverImageUrl: null,
  backgroundImageUrl: null,
  backgroundFit: "cover" as const,
  title: "",
  artist: "",
  coverStyle: "flat" as const,
  autoPalette: true,
  palette: ["#63f0d1", "#7657ff", "#ff4f9a"] as [string, string, string],
  spectrumPaletteMode: "auto" as const,
  spectrumPalette: ["#63f0d1", "#7657ff", "#ff4f9a"] as [string, string, string],
  spectrogramPaletteMode: "auto" as const,
  spectrogramPalette: ["#63f0d1", "#7657ff", "#ff4f9a"] as [string, string, string],
  spectrumGain: 1,
  spectrogramOpacity: 1,
  metadataVisible: true,
  match: {
    state: "idle" as const,
    fragmentHash: "",
    fullTrackHash: "",
    selectedOffsetMs: 0,
    confidence: 0,
    candidates: [],
    resolution: "auto" as const,
    error: null,
    analyzedAt: null
  }
};
const defaultOverlaySpectral = {
  backgroundImageUrl: null,
  backgroundMediaType: "image" as const,
  backgroundFit: "cover" as const,
  backgroundDim: 0,
  title: "",
  artist: "",
  showMetadata: true,
  visualStyle: "radial" as const,
  presetId: "milkdrop-radial-spectrum" as const,
  autoPalette: true,
  palette: ["#63f0d1", "#7657ff", "#ff4f9a"] as [string, string, string],
  paletteInfluence: 1,
  intensity: 1,
  sensitivity: 1,
  overlayOpacity: 0.92,
  motionSpeed: 1,
  symmetry: 8 as const,
  trail: 0.42,
  blendMode: "screen" as const
};
const overlaySpectralSchema = z.object({
  backgroundImageUrl: z.string().refine((value) => !value.startsWith("blob:"), "Gli URL blob runtime non possono essere salvati nel progetto.").nullable().default(defaultOverlaySpectral.backgroundImageUrl),
  backgroundMediaType: z.enum(["image", "video"]).default(defaultOverlaySpectral.backgroundMediaType),
  backgroundFit: z.enum(["cover", "contain"]).default(defaultOverlaySpectral.backgroundFit),
  backgroundDim: z.number().min(0).max(1).default(defaultOverlaySpectral.backgroundDim),
  title: z.string().max(160).default(defaultOverlaySpectral.title),
  artist: z.string().max(160).default(defaultOverlaySpectral.artist),
  showMetadata: z.boolean().default(defaultOverlaySpectral.showMetadata),
  visualStyle: z.enum(["radial", "tunnel", "kaleidoscope", "plasma"]).default(defaultOverlaySpectral.visualStyle),
  presetId: z.enum(["milkdrop-radial-spectrum", "milkdrop-spectral-tunnel", "milkdrop-kaleidoscope", "milkdrop-plasma-field", "milkdrop-spectrum-bars", "milkdrop-circular-spectrum", "milkdrop-waveform-line", "milkdrop-particle-burst", "milkdrop-pulse-shapes", "milkdrop-dynamic-vignette", "milkdrop-radial-rays", "milkdrop-mirrored-waveform", "milkdrop-audio-grid", "milkdrop-orbiting-particles"]).default(defaultOverlaySpectral.presetId),
  autoPalette: z.boolean().default(defaultOverlaySpectral.autoPalette),
  palette: z.tuple([z.string(), z.string(), z.string()]).default(defaultOverlaySpectral.palette),
  paletteInfluence: z.number().min(0).max(1).default(defaultOverlaySpectral.paletteInfluence),
  intensity: z.number().min(0.1).max(3).default(defaultOverlaySpectral.intensity),
  sensitivity: z.number().min(0.25).max(3).default(defaultOverlaySpectral.sensitivity),
  overlayOpacity: z.number().min(0.1).max(1).default(defaultOverlaySpectral.overlayOpacity),
  motionSpeed: z.number().min(0).max(3).default(defaultOverlaySpectral.motionSpeed),
  symmetry: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(12)]).default(defaultOverlaySpectral.symmetry),
  trail: z.number().min(0).max(0.95).default(defaultOverlaySpectral.trail),
  blendMode: z.enum(["screen", "lighter", "source-over"]).default(defaultOverlaySpectral.blendMode)
}).strict();
export const cassetteDeskWindowEnvironments = [
  "summer-day",
  "snow-day",
  "night",
  "rain-night",
  "starry-moon",
  "pink-moon",
  "pink-meteor"
] as const;

const defaultCassetteDesk = {
  coverImageUrl: null,
  title: "",
  artist: "",
  stereoStyle: "classic" as const,
  windowEnvironment: "starry-moon" as const,
  autoPalette: true,
  palette: ["#d8c4a6", "#6d8068", "#d34f69"] as [string, string, string],
  waveformColorMode: "auto" as const,
  waveformColor: "#d34f69",
  displaySpectrumColorMode: "auto" as const,
  displaySpectrumColor: "#d34f69",
  stereoBodyColorMode: "auto" as const,
  stereoBodyColor: "#d8c4a6",
  pianoColorMode: "auto" as const,
  pianoColor: "#d8c4a6",
  deskColorMode: "auto" as const,
  deskColor: "#6d513f",
  introDurationSeconds: 4.8,
  vocalToleranceCents: 42,
  tempoDetectionMode: "auto" as const,
  manualBpm: 120,
  halfTime: false,
  keyDetectionMode: "auto" as const,
  manualKeyRoot: 9,
  manualKeyMode: "major" as const,
  showWaveform: true,
  showPiano: true,
  showTrackInfo: true
};
const cassetteDeskSchema = z.object({
  coverImageUrl: z.string().refine((value) => !value.startsWith("blob:"), "Gli URL blob runtime non possono essere salvati nel progetto.").nullable().default(defaultCassetteDesk.coverImageUrl),
  title: z.string().max(160).default(defaultCassetteDesk.title), artist: z.string().max(160).default(defaultCassetteDesk.artist),
  stereoStyle: z.enum(["classic", "poster"]).default(defaultCassetteDesk.stereoStyle),
  windowEnvironment: z.enum(cassetteDeskWindowEnvironments).default(defaultCassetteDesk.windowEnvironment),
  autoPalette: z.boolean().default(defaultCassetteDesk.autoPalette), palette: z.tuple([z.string(), z.string(), z.string()]).default(defaultCassetteDesk.palette),
  waveformColorMode: z.enum(["auto", "manual"]).default(defaultCassetteDesk.waveformColorMode), waveformColor: z.string().default(defaultCassetteDesk.waveformColor),
  displaySpectrumColorMode: z.enum(["auto", "manual"]).default(defaultCassetteDesk.displaySpectrumColorMode), displaySpectrumColor: z.string().default(defaultCassetteDesk.displaySpectrumColor),
  stereoBodyColorMode: z.enum(["auto", "manual"]).default(defaultCassetteDesk.stereoBodyColorMode), stereoBodyColor: z.string().default(defaultCassetteDesk.stereoBodyColor),
  pianoColorMode: z.enum(["auto", "manual"]).default(defaultCassetteDesk.pianoColorMode), pianoColor: z.string().default(defaultCassetteDesk.pianoColor),
  deskColorMode: z.enum(["auto", "manual"]).default(defaultCassetteDesk.deskColorMode), deskColor: z.string().default(defaultCassetteDesk.deskColor),
  introDurationSeconds: z.number().min(3.6).max(8).default(defaultCassetteDesk.introDurationSeconds), vocalToleranceCents: z.number().min(10).max(100).default(defaultCassetteDesk.vocalToleranceCents),
  tempoDetectionMode: z.enum(["auto", "manual"]).default(defaultCassetteDesk.tempoDetectionMode), manualBpm: z.number().min(20).max(300).default(defaultCassetteDesk.manualBpm), halfTime: z.boolean().default(defaultCassetteDesk.halfTime),
  keyDetectionMode: z.enum(["auto", "manual"]).default(defaultCassetteDesk.keyDetectionMode), manualKeyRoot: z.number().int().min(0).max(11).default(defaultCassetteDesk.manualKeyRoot), manualKeyMode: z.enum(["major", "minor"]).default(defaultCassetteDesk.manualKeyMode),
  showWaveform: z.boolean().default(defaultCassetteDesk.showWaveform), showPiano: z.boolean().default(defaultCassetteDesk.showPiano), showTrackInfo: z.boolean().default(defaultCassetteDesk.showTrackInfo)
}).strict();
const songPlayerAssetSchema = z.object({
  id: z.string().min(1), kind: z.literal("fullTrack"),
  source: z.enum(["localImport", "youtubeDownload"]), sourcePath: z.string().min(1),
  fileName: z.string().min(1).max(500), mimeType: z.string().min(1).max(160),
  hash: z.string().regex(/^[a-fA-F0-9]{64}$/), durationSeconds: z.number().positive(),
  sampleRate: z.number().int().positive(), channels: z.number().int().positive(), fileSize: z.number().int().positive(),
  provider: z.object({ sourceUrl: z.string().url().nullable().default(null), videoId: z.string().min(1).max(128).nullable().default(null), title: z.string().min(1).max(500).nullable().default(null) }).strict().default({ sourceUrl: null, videoId: null, title: null })
}).strict();
const songPlayerCandidateSchema = z.object({ offsetMs: z.number().int().min(0).max(7_200_000), score: z.number().min(0).max(1) }).strict();
const songPlayerMatchSchema = z.object({
  state: z.enum(["idle", "running", "matched", "ambiguous", "manual", "failed"]).default(defaultSongPlayer.match.state),
  fragmentHash: z.string().regex(/^(?:|[a-fA-F0-9]{64})$/).default(""), fullTrackHash: z.string().regex(/^(?:|[a-fA-F0-9]{64})$/).default(""),
  selectedOffsetMs: z.number().int().min(0).max(7_200_000).default(0), confidence: z.number().min(0).max(1).default(0),
  candidates: z.array(songPlayerCandidateSchema).max(5).default([]), resolution: z.enum(["auto", "manual"]).default("auto"),
  error: z.string().max(500).nullable().default(null), analyzedAt: z.iso.datetime().nullable().default(null)
}).strict();
const songPlayerSchema = z.object({
  assets: z.array(songPlayerAssetSchema).max(8).default(defaultSongPlayer.assets),
  fullTrackAssetId: z.string().min(1).nullable().default(defaultSongPlayer.fullTrackAssetId),
  coverImageUrl: z.string().refine((value) => !value.startsWith("blob:"), "Gli URL blob runtime non possono essere salvati nel progetto.").nullable().default(defaultSongPlayer.coverImageUrl), backgroundImageUrl: z.string().refine((value) => !value.startsWith("blob:"), "Gli URL blob runtime non possono essere salvati nel progetto.").nullable().default(defaultSongPlayer.backgroundImageUrl),
  backgroundFit: z.enum(["cover", "contain"]).default(defaultSongPlayer.backgroundFit), title: z.string().max(160).default(defaultSongPlayer.title), artist: z.string().max(160).default(defaultSongPlayer.artist),
  coverStyle: z.enum(["flat", "cube"]).default(defaultSongPlayer.coverStyle), autoPalette: z.boolean().default(defaultSongPlayer.autoPalette), palette: z.tuple([z.string(), z.string(), z.string()]).default(defaultSongPlayer.palette),
  spectrumPaletteMode: z.enum(["auto", "manual"]).default(defaultSongPlayer.spectrumPaletteMode), spectrumPalette: z.tuple([z.string(), z.string(), z.string()]).default(defaultSongPlayer.spectrumPalette),
  spectrogramPaletteMode: z.enum(["auto", "manual"]).default(defaultSongPlayer.spectrogramPaletteMode), spectrogramPalette: z.tuple([z.string(), z.string(), z.string()]).default(defaultSongPlayer.spectrogramPalette),
  spectrumGain: z.number().min(0).max(3).default(defaultSongPlayer.spectrumGain), spectrogramOpacity: z.number().min(0).max(1).default(defaultSongPlayer.spectrogramOpacity), metadataVisible: z.boolean().default(defaultSongPlayer.metadataVisible),
  match: songPlayerMatchSchema.default(defaultSongPlayer.match)
}).strict().superRefine((value, context) => {
  if (value.fullTrackAssetId && !value.assets.some((asset) => asset.id === value.fullTrackAssetId)) context.addIssue({ code: "custom", path: ["fullTrackAssetId"], message: "La traccia completa selezionata non esiste nel registro asset." });
  if (value.match.fullTrackHash && !value.fullTrackAssetId) context.addIssue({ code: "custom", path: ["match", "fullTrackHash"], message: "Il matching richiede una traccia completa." });
});

export const musicEventSchema = z.object({
  id: z.string().min(1), timeSeconds: z.number().nonnegative(), timeSamples: z.number().int().nonnegative(),
  eventType: z.enum(["beat", "downbeat", "onset", "kick", "snare", "hihat", "piano", "guitar", "strings", "percussion", "manual", "custom"]),
  confidence: z.number().min(0).max(1), strength: z.number().min(0).max(1), frequencyBand: z.enum(["low", "mid", "high", "full"]),
  assignedObjectType: z.string().nullable(), assignedObjectId: z.string().nullable().default(null), enabled: z.boolean(), accent: z.boolean(),
  manualOverride: z.boolean(), action: z.enum(["none", "collision", "accentedCollision", "nearMiss", "freeFall", "camera", "light", "color", "particles", "background", "custom"]).default("collision"),
  expectedBallPosition: vector3Schema, expectedBallVelocity: vector3Schema, expectedImpactNormal: vector3Schema
}).strict();

export const projectSchema = z.object({
  schemaVersion: z.literal(1),
  project: z.object({ id: z.string().min(1), name: z.string().min(1), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), seed: z.number().int().min(0).max(4_294_967_295) }).strict(),
  audio: z.object({ sourcePath: z.string(), storage: z.enum(["project", "external"]), hash: z.string().regex(/^(?:|[a-fA-F0-9]{64})$/), durationSeconds: z.number().nonnegative(), sampleRate: z.number().int().positive(), channels: z.number().int().positive(), globalOffsetMs: z.number().min(-250).max(250) }).strict(),
  canvas: z.object({ aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:5", "custom"]), previewWidth: z.number().int().positive(), previewHeight: z.number().int().positive(), previewFps: fpsSchema, exportWidth: z.number().int().positive(), exportHeight: z.number().int().positive(), exportFps: fpsSchema }).strict(),
  analysis: z.object({ analyzerVersion: z.string(), cacheKey: z.string(), globalBpm: z.number().positive().nullable(), latencyCompensationMs: z.number(), waveform: z.array(z.number().min(-1).max(1)), localTempo: z.array(z.unknown()).default([]), segments: z.array(z.unknown()).default([]) }).strict(),
  events: z.array(musicEventSchema),
  animation: z.object({ modeId: z.string().min(1), baseObjectTypes: z.array(z.enum(["drum", "kick", "snare", "cymbal", "piano", "guitar", "strings", "peg", "platform", "block", "spring", "pebble"])).min(1), newYorkStreets: newYorkStreetsSchema.default(defaultNewYorkStreets), coverSphere: coverSphereSchema.default(defaultCoverSphere), stereoUnfold: stereoUnfoldSchema.default(defaultStereoUnfold), walkingCube: walkingCubeSchema.default(defaultWalkingCube), portraitLandscape: portraitLandscapeSchema.default(defaultPortraitLandscape), commentsInvasion: commentsInvasionSchema.default(defaultCommentsInvasion), teddyWalk: teddyWalkSchema.default(defaultTeddyWalk), teddySing: teddySingSchema.default(defaultTeddySing), proSubtitles: proSubtitlesSchema.default(defaultProSubtitles), pixelsSub: pixelsSubSchema.default(defaultPixelsSub), backgroundAuto: backgroundAutoSchema.default(defaultBackgroundAuto), staticWatermark: staticWatermarkSchema.default(defaultStaticWatermark), upscaler: upscalerSchema.default(defaultUpscaler), frameBooster: frameBoosterSchema.default(defaultFrameBooster), videoEditor: videoEditorSchema.default(defaultVideoEditor), songPlayer: songPlayerSchema.default(defaultSongPlayer), cassetteDesk: cassetteDeskSchema.default(defaultCassetteDesk), overlaySpectral: overlaySpectralSchema.default(defaultOverlaySpectral) }).default({ modeId: "instrumentalFalling", baseObjectTypes: ["kick", "snare", "drum", "cymbal"], newYorkStreets: defaultNewYorkStreets, coverSphere: defaultCoverSphere, stereoUnfold: defaultStereoUnfold, walkingCube: defaultWalkingCube, portraitLandscape: defaultPortraitLandscape, commentsInvasion: defaultCommentsInvasion, teddyWalk: defaultTeddyWalk, teddySing: defaultTeddySing, proSubtitles: defaultProSubtitles, pixelsSub: defaultPixelsSub, backgroundAuto: defaultBackgroundAuto, staticWatermark: defaultStaticWatermark, upscaler: defaultUpscaler, frameBooster: defaultFrameBooster, videoEditor: defaultVideoEditor, songPlayer: defaultSongPlayer, cassetteDesk: defaultCassetteDesk, overlaySpectral: defaultOverlaySpectral }),
  ball: z.object({ radius: z.number().positive(), visualMass: z.number().positive(), material: materialSchema, spinRate: z.number(), impactDeformation: z.number().min(0).max(1), trailEnabled: z.boolean(), innerColor: z.string().default("#63f0d1"), innerShape: z.enum(["orb", "icosahedron", "torusKnot"]).default("icosahedron"), innerImageUrl: z.string().nullable().default(null), endRevealEnabled: z.boolean().default(false), revealMode: z.enum(["end", "time"]).default("end"), revealTimeSeconds: z.number().nonnegative().default(0), revealHoldSeconds: z.number().min(0).max(30).default(2) }).strict(),
  objects: z.array(sceneObjectSchema), trajectorySegments: z.array(trajectorySegmentSchema),
  camera: z.object({ mode: z.enum(["fixed", "verticalTracking", "fullTracking", "smoothFollow", "cinematic", "keyframed", "autoFraming", "spline"]), position: vector3Schema, target: vector3Schema, fieldOfView: z.number().positive().max(179), damping: z.number().min(0).max(1), lookAhead: z.number().nonnegative() }).strict(),
  background: z.object({
    type: z.enum(["solid", "linearGradient", "radialGradient", "image", "video", "texture", "wall", "abstract", "transparent"]), colors: z.array(z.string()).min(1), assetId: z.string().nullable(),
    imageUrl: z.string().nullable().default(null), presetId: z.string().default("gradient"), finish: z.enum(["clean", "worn"]).default("clean"), opacity: z.number().min(0).max(1), blur: z.number().nonnegative(), brightness: z.number().nonnegative(), contrast: z.number().nonnegative(), saturation: z.number().nonnegative(),
    effects: z.object({ glow: z.boolean(), particles: z.boolean(), vignette: z.boolean() }).default({ glow: true, particles: true, vignette: true }),
    neon: z.object({ enabled: z.boolean(), text: z.string().max(1000), color: z.string() }).default({ enabled: false, text: "EMPTY STREETS\nMY LONELY SOUL", color: "#ff3cac" }),
    railColors: z.object({ pinball: z.string(), glassTube: z.string(), bricks: z.string() }).default({ pinball: "#1d2630", glassTube: "#9eeeff", bricks: "#7657ff" })
  }).strict(),
  lighting: sceneLightingSchema.default(defaultSceneLighting), subtitles: subtitlesSchema.default(defaultSubtitles), postProcessing: z.record(z.string(), z.unknown()), exportPresets: z.array(exportPresetSchema)
}).strict().superRefine((project, context) => {
  if (new Date(project.project.updatedAt) < new Date(project.project.createdAt)) context.addIssue({ code: "custom", path: ["project", "updatedAt"], message: "updatedAt precede createdAt" });
  const ids = new Set<string>();
  project.events.forEach((event, index) => { if (ids.has(event.id)) context.addIssue({ code: "custom", path: ["events", index, "id"], message: "ID evento duplicato" }); ids.add(event.id); });
  project.events.forEach((event, index) => { if (Math.abs(event.timeSeconds - event.timeSamples / project.audio.sampleRate) > 0.5 / project.audio.sampleRate) context.addIssue({ code: "custom", path: ["events", index, "timeSamples"], message: "Tempo e campione non coerenti" }); });
  const objectIds = new Set<string>(); project.objects.forEach((object, index) => { if (objectIds.has(object.id)) context.addIssue({ code: "custom", path: ["objects", index, "id"], message: "ID oggetto duplicato" }); objectIds.add(object.id); });
  project.trajectorySegments.forEach((segment, index) => { if (segment.endTime <= segment.startTime) context.addIssue({ code: "custom", path: ["trajectorySegments", index, "endTime"], message: "Il segmento deve avere durata positiva" }); });
  project.animation.teddySing.phonemeCues.forEach((cue, index) => { if (cue.endSeconds <= cue.startSeconds) context.addIssue({ code: "custom", path: ["animation", "teddySing", "phonemeCues", index, "endSeconds"], message: "Il fonema deve avere durata positiva" }); });
  project.subtitles.cues.forEach((cue, index) => { if (cue.endSeconds <= cue.startSeconds) context.addIssue({ code: "custom", path: ["subtitles", "cues", index, "endSeconds"], message: "Il sottotitolo deve avere durata positiva" }); });
  if (project.lighting.activeUntilSeconds !== null && project.lighting.activeUntilSeconds < project.lighting.activeFromSeconds) context.addIssue({ code: "custom", path: ["lighting", "activeUntilSeconds"], message: "La fine della luce deve seguire il suo inizio" });
  const trackIds = new Set<string>();
  project.animation.videoEditor.tracks.forEach((track, index) => { if (trackIds.has(track.id)) context.addIssue({ code: "custom", path: ["animation", "videoEditor", "tracks", index, "id"], message: "ID traccia duplicato" }); trackIds.add(track.id); });
  const assetIds = new Set<string>();
  project.animation.videoEditor.assets.forEach((asset, index) => { if (assetIds.has(asset.id)) context.addIssue({ code: "custom", path: ["animation", "videoEditor", "assets", index, "id"], message: "ID media duplicato" }); assetIds.add(asset.id); });
  const songAssetIds = new Set<string>();
  project.animation.songPlayer.assets.forEach((asset, index) => { if (songAssetIds.has(asset.id)) context.addIssue({ code: "custom", path: ["animation", "songPlayer", "assets", index, "id"], message: "ID asset Song Player duplicato" }); songAssetIds.add(asset.id); });
  const song = project.animation.songPlayer;
  if (song.match.fragmentHash && song.match.fragmentHash !== project.audio.hash) context.addIssue({ code: "custom", path: ["animation", "songPlayer", "match", "fragmentHash"], message: "Il matching non corrisponde al frammento audio corrente." });
  const selectedSongAsset = song.fullTrackAssetId ? song.assets.find((asset) => asset.id === song.fullTrackAssetId) : undefined;
  if (song.match.fullTrackHash && selectedSongAsset && song.match.fullTrackHash !== selectedSongAsset.hash) context.addIssue({ code: "custom", path: ["animation", "songPlayer", "match", "fullTrackHash"], message: "Il matching non corrisponde alla traccia completa selezionata." });
  if (selectedSongAsset && song.match.selectedOffsetMs > Math.max(0, Math.round((selectedSongAsset.durationSeconds - project.audio.durationSeconds) * 1000))) context.addIssue({ code: "custom", path: ["animation", "songPlayer", "match", "selectedOffsetMs"], message: "L’offset Song Player supera il segmento disponibile nella traccia completa." });
  const clipIds = new Set<string>();
  project.animation.videoEditor.clips.forEach((clip, index) => {
    const path = ["animation", "videoEditor", "clips", index] as const;
    if (clipIds.has(clip.id)) context.addIssue({ code: "custom", path: [...path, "id"], message: "ID clip duplicato" });
    clipIds.add(clip.id);
    if (!assetIds.has(clip.assetId)) context.addIssue({ code: "custom", path: [...path, "assetId"], message: "La clip riferisce un media assente dal pool" });
    if (!trackIds.has(clip.trackId)) context.addIssue({ code: "custom", path: [...path, "trackId"], message: "La clip riferisce una traccia inesistente" });
    const asset = project.animation.videoEditor.assets.find((item) => item.id === clip.assetId);
    const track = project.animation.videoEditor.tracks.find((item) => item.id === clip.trackId);
    const requiredTrackKind = asset?.kind === "audio" ? "audio" : "video";
    if (asset && track && track.kind !== requiredTrackKind) {
      context.addIssue({ code: "custom", path: [...path, "trackId"], message: `Il media ${asset.kind} richiede una traccia ${requiredTrackKind}` });
    }
    if (clip.fadeInSeconds + clip.fadeOutSeconds > clip.durationSeconds) context.addIssue({ code: "custom", path: [...path, "fadeOutSeconds"], message: "Le dissolvenze non possono superare la durata della clip" });
    if (clip.audioFadeInSeconds + clip.audioFadeOutSeconds > clip.durationSeconds) context.addIssue({ code: "custom", path: [...path, "audioFadeOutSeconds"], message: "Le dissolvenze audio non possono superare la durata della clip" });
  });
  const effectIds = new Set<string>();
  project.animation.videoEditor.effectClips.forEach((effect, index) => {
    const path = ["animation", "videoEditor", "effectClips", index] as const;
    if (effectIds.has(effect.id)) context.addIssue({ code: "custom", path: [...path, "id"], message: "ID effetto duplicato" });
    effectIds.add(effect.id);
    if (Object.keys(effect.parameters).length > 32) context.addIssue({ code: "custom", path: [...path, "parameters"], message: "Un effetto può avere al massimo 32 parametri" });
    if ((effect.effectId === "fade-in" || effect.effectId === "fade-out") && effect.parameters.curve !== undefined && !["linear", "smooth", "exponential"].includes(String(effect.parameters.curve))) {
      context.addIssue({ code: "custom", path: [...path, "parameters", "curve"], message: "Curva dissolvenza non supportata" });
    }
    if (effect.target.kind === "clip") {
      const targetClipId = effect.target.clipId;
      const clip = project.animation.videoEditor.clips.find((item) => item.id === targetClipId);
      if (!clip) context.addIssue({ code: "custom", path: [...path, "target", "clipId"], message: "L’effetto riferisce una clip assente" });
      else {
        const asset = project.animation.videoEditor.assets.find((item) => item.id === clip.assetId);
        if (asset?.kind === "audio") context.addIssue({ code: "custom", path: [...path, "target", "clipId"], message: "Un effetto video richiede una clip visiva" });
        if (effect.startSeconds < clip.startSeconds || effect.startSeconds + effect.durationSeconds > clip.startSeconds + clip.durationSeconds + 1e-6) context.addIssue({ code: "custom", path: [...path, "durationSeconds"], message: "L’effetto deve restare nei bordi della clip" });
      }
    }
  });
  project.animation.videoEditor.selectedEffectClipIds.forEach((id, index) => { if (!effectIds.has(id)) context.addIssue({ code: "custom", path: ["animation", "videoEditor", "selectedEffectClipIds", index], message: "Effetto selezionato inesistente" }); });
});

export type RhythmBallProject = z.infer<typeof projectSchema>;
export type SongPlayerSettings = RhythmBallProject["animation"]["songPlayer"];
export type SongPlayerAsset = SongPlayerSettings["assets"][number];
export type SongPlayerMatch = SongPlayerSettings["match"];
export type CassetteDeskSettings = RhythmBallProject["animation"]["cassetteDesk"];
export type CassetteDeskWindowEnvironment = CassetteDeskSettings["windowEnvironment"];
export type OverlaySpectralSettings = RhythmBallProject["animation"]["overlaySpectral"];
export type CommentsInvasionSettings = RhythmBallProject["animation"]["commentsInvasion"];

export function parseProject(input: unknown): RhythmBallProject {
  if (!input || typeof input !== "object" || Array.isArray(input)) return projectSchema.parse(input);
  const candidate = input as Record<string, unknown>; const animation = candidate.animation;
  if (!animation || typeof animation !== "object" || Array.isArray(animation)) return projectSchema.parse(input);
  const legacyAnimation = animation as Record<string, unknown>; const legacyTeddy = legacyAnimation.teddyWheel;
  const legacyProSubtitles = legacyAnimation.proSubtitles;
  const legacyAddSubtitles = legacyAnimation.addSubtitles;
  const migratedProSubtitles = legacyProSubtitles && typeof legacyProSubtitles === "object" && !Array.isArray(legacyProSubtitles)
    ? (() => {
      const settings = legacyProSubtitles as Record<string, unknown>;
      const defaultFontFamily = typeof settings.defaultFontFamily === "string" ? settings.defaultFontFamily : defaultProSubtitles.defaultFontFamily;
      const defaultFontSize = typeof settings.defaultFontSize === "number" ? settings.defaultFontSize : defaultProSubtitles.defaultFontSize;
      const positionX = typeof settings.positionX === "number" ? settings.positionX : defaultProSubtitles.positionX;
      const positionY = typeof settings.positionY === "number" ? settings.positionY : defaultProSubtitles.positionY;
      const opacity = typeof settings.opacity === "number" ? settings.opacity : defaultProSubtitles.opacity;
      const cueStyles = Array.isArray(settings.cueStyles)
        ? settings.cueStyles.map((candidate) => {
          if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
          const style = candidate as Record<string, unknown>;
          return {
            ...style,
            fontFamilyAutomatic: typeof style.fontFamilyAutomatic === "boolean"
              ? style.fontFamilyAutomatic
              : style.fontFamily === defaultFontFamily,
            fontSizeAutomatic: typeof style.fontSizeAutomatic === "boolean"
              ? style.fontSizeAutomatic
              : style.fontSize === defaultFontSize,
            positionX: typeof style.positionX === "number" ? style.positionX : positionX,
            positionY: typeof style.positionY === "number" ? style.positionY : positionY,
            positionAutomatic: typeof style.positionAutomatic === "boolean" ? style.positionAutomatic : true,
            opacity: typeof style.opacity === "number" ? style.opacity : opacity,
            opacityAutomatic: typeof style.opacityAutomatic === "boolean" ? style.opacityAutomatic : true
          };
        })
        : [];
      return { ...settings, positionX, positionY, opacity, cueStyles };
    })()
    : defaultProSubtitles;
  const migratedTeddy = legacyAnimation.teddyWalk ?? (legacyTeddy && typeof legacyTeddy === "object" && !Array.isArray(legacyTeddy) ? {
    coverImageUrl: (legacyTeddy as Record<string, unknown>).coverImageUrl ?? null,
    furColor: (legacyTeddy as Record<string, unknown>).furColor ?? defaultTeddyWalk.furColor,
    patchColor: (legacyTeddy as Record<string, unknown>).patchColor ?? defaultTeddyWalk.patchColor,
    accentColor: (legacyTeddy as Record<string, unknown>).accentColor ?? defaultTeddyWalk.accentColor,
    roadColor: (legacyTeddy as Record<string, unknown>).wheelColor ?? defaultTeddyWalk.roadColor,
    walkIntensity: (legacyTeddy as Record<string, unknown>).walkIntensity ?? defaultTeddyWalk.walkIntensity,
    pulseIntensity: defaultTeddyWalk.pulseIntensity,
    danceEnabled: defaultTeddyWalk.danceEnabled
  } : defaultTeddyWalk);
  const legacyStaticWatermark = legacyAnimation.staticWatermark;
  const migratedStaticWatermark = legacyStaticWatermark && typeof legacyStaticWatermark === "object" && !Array.isArray(legacyStaticWatermark)
    ? {
      ...legacyStaticWatermark,
      feather: typeof (legacyStaticWatermark as Record<string, unknown>).feather === "number" && ((legacyStaticWatermark as Record<string, unknown>).feather as number) >= 1 ? Math.min(24, Math.round((legacyStaticWatermark as Record<string, unknown>).feather as number)) : 0,
      colorMatchStrength: (legacyStaticWatermark as Record<string, unknown>).colorMatchStrength === .72 ? .05 : (legacyStaticWatermark as Record<string, unknown>).colorMatchStrength
    }
    : defaultStaticWatermark;
  const legacyVideoEditor = legacyAnimation.videoEditor;
  const migratedVideoEditor = legacyVideoEditor && typeof legacyVideoEditor === "object" && !Array.isArray(legacyVideoEditor)
    ? (() => {
      const source = legacyVideoEditor as Record<string, unknown>;
      const tracks = Array.isArray(source.tracks) ? source.tracks.map((candidate) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
        const track = candidate as Record<string, unknown>;
        // Migra solo le etichette predefinite: i nomi personalizzati restano intatti.
        const name = track.name === "Overlay" ? "Livello video 2"
          : track.name === "Video principale" ? "Livello video 1"
          : track.name === "Audio" ? "Audio 1"
          : track.name;
        return { ...track, name };
      }) : source.tracks;
      if (Array.isArray(source.effectClips)) return { ...source, tracks };
      const legacyClips = Array.isArray(source.clips) ? source.clips : [];
      const effectClips: Record<string, unknown>[] = [];
      const clips = legacyClips.map((candidate) => {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
        const clip = candidate as Record<string, unknown>;
        const id = typeof clip.id === "string" ? clip.id : "legacy";
        const start = typeof clip.startSeconds === "number" ? clip.startSeconds : 0;
        const duration = typeof clip.durationSeconds === "number" ? clip.durationSeconds : 0;
        const fadeIn = typeof clip.fadeInSeconds === "number" ? Math.min(duration, clip.fadeInSeconds) : 0;
        const fadeOut = typeof clip.fadeOutSeconds === "number" ? Math.min(Math.max(0, duration - fadeIn), clip.fadeOutSeconds) : 0;
        if (fadeIn > 0) effectClips.push({ id: `legacy-fade-in-${id}`, effectId: "fade-in", target: { kind: "clip", clipId: id }, startSeconds: start, durationSeconds: fadeIn, enabled: true, mix: 1, parameters: { curve: typeof clip.fadeCurve === "string" ? clip.fadeCurve : "smooth" } });
        if (fadeOut > 0) effectClips.push({ id: `legacy-fade-out-${id}`, effectId: "fade-out", target: { kind: "clip", clipId: id }, startSeconds: start + duration - fadeOut, durationSeconds: fadeOut, enabled: true, mix: 1, parameters: { curve: typeof clip.fadeCurve === "string" ? clip.fadeCurve : "smooth" } });
        return { ...clip, fadeInSeconds: 0, fadeOutSeconds: 0 };
      });
      return { ...source, tracks, clips, effectClips, selectedEffectClipIds: [] };
    })()
    : defaultVideoEditor;
  const migratedModeId = legacyAnimation.modeId === "pixelArt" ? "instrumentalFalling" : legacyAnimation.modeId === "teddyWheel" ? "teddyWalk" : legacyAnimation.modeId === "addSubtitles" ? "proSubtitles" : legacyAnimation.modeId;
  const migratedLegacySubtitleSource = legacyAnimation.modeId === "addSubtitles" && legacyAddSubtitles && typeof legacyAddSubtitles === "object" && !Array.isArray(legacyAddSubtitles)
    ? { ...migratedProSubtitles, ...legacyAddSubtitles as Record<string, unknown> }
    : migratedProSubtitles;
  const legacyOverlaySpectral = legacyAnimation.overlaySpectral;
  const migratedOverlaySpectral = legacyOverlaySpectral && typeof legacyOverlaySpectral === "object" && !Array.isArray(legacyOverlaySpectral)
    ? { ...legacyOverlaySpectral, backgroundDim: (legacyOverlaySpectral as Record<string, unknown>).backgroundDim === .38 ? 0 : (legacyOverlaySpectral as Record<string, unknown>).backgroundDim }
    : defaultOverlaySpectral;
  const currentAnimation = { ...legacyAnimation }; delete currentAnimation.addSubtitles; delete currentAnimation.pixelArt;
  const migratedBaseObjectTypes = legacyAnimation.modeId === "pixelArt" ? ["kick", "snare", "drum", "cymbal"] : currentAnimation.baseObjectTypes;
  return projectSchema.parse({ ...candidate, animation: { ...currentAnimation, modeId: migratedModeId, baseObjectTypes: migratedBaseObjectTypes, teddyWalk: migratedTeddy, proSubtitles: migratedLegacySubtitleSource, pixelsSub: legacyAnimation.pixelsSub ?? defaultPixelsSub, staticWatermark: migratedStaticWatermark, videoEditor: migratedVideoEditor, songPlayer: legacyAnimation.songPlayer ?? defaultSongPlayer, cassetteDesk: legacyAnimation.cassetteDesk ?? defaultCassetteDesk, overlaySpectral: migratedOverlaySpectral, commentsInvasion: legacyAnimation.commentsInvasion ?? defaultCommentsInvasion } });
}

export function createProject(name = "Progetto senza titolo", now = new Date()): RhythmBallProject {
  const timestamp = now.toISOString();
  return parseProject({
    schemaVersion: 1,
    project: { id: crypto.randomUUID(), name, createdAt: timestamp, updatedAt: timestamp, seed: 12_345 },
    audio: { sourcePath: "", storage: "external", hash: "", durationSeconds: 0, sampleRate: 48_000, channels: 2, globalOffsetMs: 0 },
    canvas: { aspectRatio: "9:16", previewWidth: 540, previewHeight: 960, previewFps: { numerator: 30, denominator: 1 }, exportWidth: 1080, exportHeight: 1920, exportFps: { numerator: 60, denominator: 1 } },
    analysis: { analyzerVersion: "", cacheKey: "", globalBpm: null, latencyCompensationMs: 0, waveform: [], localTempo: [], segments: [] },
    events: [],
    animation: { modeId: "instrumentalFalling", baseObjectTypes: ["kick", "snare", "drum", "cymbal"], newYorkStreets: defaultNewYorkStreets, coverSphere: defaultCoverSphere, stereoUnfold: defaultStereoUnfold, walkingCube: defaultWalkingCube, portraitLandscape: defaultPortraitLandscape, commentsInvasion: defaultCommentsInvasion, teddyWalk: defaultTeddyWalk, teddySing: defaultTeddySing, proSubtitles: defaultProSubtitles, pixelsSub: defaultPixelsSub, backgroundAuto: defaultBackgroundAuto, staticWatermark: defaultStaticWatermark, upscaler: defaultUpscaler, frameBooster: defaultFrameBooster, videoEditor: defaultVideoEditor, songPlayer: defaultSongPlayer, cassetteDesk: defaultCassetteDesk, overlaySpectral: defaultOverlaySpectral },
    ball: { radius: 0.45, visualMass: 1, material: { color: "#dffeff", palette: ["#63f0d1", "#7857ff"], roughness: 0.05, metalness: 0, emission: 0.2, opacity: .32, textureAssetId: null }, spinRate: 1, impactDeformation: 0.2, trailEnabled: true, innerColor: "#63f0d1", innerShape: "icosahedron", innerImageUrl: null, endRevealEnabled: false, revealMode: "end", revealTimeSeconds: 0, revealHoldSeconds: 2 },
    objects: [], trajectorySegments: [],
    camera: { mode: "smoothFollow", position: { x: 0, y: 2, z: 10 }, target: { x: 0, y: 2, z: 0 }, fieldOfView: 45, damping: 0.12, lookAhead: 1.5 },
    background: { type: "linearGradient", colors: ["#080b18", "#19112f"], assetId: null, imageUrl: null, presetId: "gradient", finish: "clean", opacity: 1, blur: 0, brightness: 1, contrast: 1, saturation: 1, effects: { glow: true, particles: true, vignette: true }, neon: { enabled: false, text: "EMPTY STREETS\nMY LONELY SOUL", color: "#ff3cac" }, railColors: { pinball: "#1d2630", glassTube: "#9eeeff", bricks: "#7657ff" } },
    lighting: defaultSceneLighting, subtitles: defaultSubtitles, postProcessing: {}, exportPresets: []
  });
}
