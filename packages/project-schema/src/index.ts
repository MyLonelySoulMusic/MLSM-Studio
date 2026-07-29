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
const pixelArtSchema = z.object({
  subMode: z.enum(["walkingThroughNewYork"]).default("walkingThroughNewYork"),
  coverImageUrl: z.string().nullable().default(null), venueName: z.string().trim().min(1).max(24).default("BAR"),
  palettePrimary: z.string().default("#e94290"), paletteSecondary: z.string().default("#32d7ff"),
  hoodieColor: z.string().default("#08090e"), pantsColor: z.string().default("#4252c8"),
  neonPrimary: z.string().default("#e94290"), neonSecondary: z.string().default("#32d7ff")
}).strict();
const defaultPixelArt = { subMode: "walkingThroughNewYork" as const, coverImageUrl: null, venueName: "BAR", palettePrimary: "#e94290", paletteSecondary: "#32d7ff", hoodieColor: "#08090e", pantsColor: "#4252c8", neonPrimary: "#e94290", neonSecondary: "#32d7ff" };
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
const defaultAddSubtitles = { videoUrl: null, videoName: "", fit: "cover" as const, dimming: 0 };
const addSubtitlesSchema = z.object({
  videoUrl: z.string().nullable().default(defaultAddSubtitles.videoUrl),
  videoName: z.string().max(500).default(defaultAddSubtitles.videoName),
  fit: z.enum(["cover", "contain"]).default(defaultAddSubtitles.fit),
  dimming: z.number().min(0).max(.8).default(defaultAddSubtitles.dimming)
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
  llmEnabled: true, llmModel: "smollm2-135m-instruct" as const, llmPasses: 2,
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
  llmModel: z.enum(["smollm2-135m-instruct"]).default(defaultSubtitles.llmModel),
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
  animation: z.object({ modeId: z.string().min(1), baseObjectTypes: z.array(z.enum(["drum", "kick", "snare", "cymbal", "piano", "guitar", "strings", "peg", "platform", "block", "spring", "pebble"])).min(1), newYorkStreets: newYorkStreetsSchema.default(defaultNewYorkStreets), coverSphere: coverSphereSchema.default(defaultCoverSphere), stereoUnfold: stereoUnfoldSchema.default(defaultStereoUnfold), walkingCube: walkingCubeSchema.default(defaultWalkingCube), pixelArt: pixelArtSchema.default(defaultPixelArt), teddyWalk: teddyWalkSchema.default(defaultTeddyWalk), teddySing: teddySingSchema.default(defaultTeddySing), addSubtitles: addSubtitlesSchema.default(defaultAddSubtitles) }).default({ modeId: "instrumentalFalling", baseObjectTypes: ["kick", "snare", "drum", "cymbal"], newYorkStreets: defaultNewYorkStreets, coverSphere: defaultCoverSphere, stereoUnfold: defaultStereoUnfold, walkingCube: defaultWalkingCube, pixelArt: defaultPixelArt, teddyWalk: defaultTeddyWalk, teddySing: defaultTeddySing, addSubtitles: defaultAddSubtitles }),
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
});

export type RhythmBallProject = z.infer<typeof projectSchema>;

export function parseProject(input: unknown): RhythmBallProject {
  if (!input || typeof input !== "object" || Array.isArray(input)) return projectSchema.parse(input);
  const candidate = input as Record<string, unknown>; const animation = candidate.animation;
  if (!animation || typeof animation !== "object" || Array.isArray(animation)) return projectSchema.parse(input);
  const legacyAnimation = animation as Record<string, unknown>; const legacyTeddy = legacyAnimation.teddyWheel;
  const legacyPixelArt = legacyAnimation.pixelArt;
  const migratedPixelArt = legacyPixelArt && typeof legacyPixelArt === "object" && !Array.isArray(legacyPixelArt) ? { ...legacyPixelArt as Record<string, unknown>, hoodieColor: "#08090e" } : defaultPixelArt;
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
  return projectSchema.parse({ ...candidate, animation: { ...legacyAnimation, modeId: legacyAnimation.modeId === "teddyWheel" ? "teddyWalk" : legacyAnimation.modeId, pixelArt: migratedPixelArt, teddyWalk: migratedTeddy } });
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
    animation: { modeId: "instrumentalFalling", baseObjectTypes: ["kick", "snare", "drum", "cymbal"], newYorkStreets: defaultNewYorkStreets, coverSphere: defaultCoverSphere, stereoUnfold: defaultStereoUnfold, walkingCube: defaultWalkingCube, pixelArt: defaultPixelArt, teddyWalk: defaultTeddyWalk, teddySing: defaultTeddySing, addSubtitles: defaultAddSubtitles },
    ball: { radius: 0.45, visualMass: 1, material: { color: "#dffeff", palette: ["#63f0d1", "#7857ff"], roughness: 0.05, metalness: 0, emission: 0.2, opacity: .32, textureAssetId: null }, spinRate: 1, impactDeformation: 0.2, trailEnabled: true, innerColor: "#63f0d1", innerShape: "icosahedron", innerImageUrl: null, endRevealEnabled: false, revealMode: "end", revealTimeSeconds: 0, revealHoldSeconds: 2 },
    objects: [], trajectorySegments: [],
    camera: { mode: "smoothFollow", position: { x: 0, y: 2, z: 10 }, target: { x: 0, y: 2, z: 0 }, fieldOfView: 45, damping: 0.12, lookAhead: 1.5 },
    background: { type: "linearGradient", colors: ["#080b18", "#19112f"], assetId: null, imageUrl: null, presetId: "gradient", finish: "clean", opacity: 1, blur: 0, brightness: 1, contrast: 1, saturation: 1, effects: { glow: true, particles: true, vignette: true }, neon: { enabled: false, text: "EMPTY STREETS\nMY LONELY SOUL", color: "#ff3cac" }, railColors: { pinball: "#1d2630", glassTube: "#9eeeff", bricks: "#7657ff" } },
    lighting: defaultSceneLighting, subtitles: defaultSubtitles, postProcessing: {}, exportPresets: []
  });
}
