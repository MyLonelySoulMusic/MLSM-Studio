import { describe, expect, it } from "vitest";
import { createProject, parseProject } from "./index";
describe("project schema invariants", () => {
  it("accetta un progetto nuovo senza audio", () => { const project = parseProject(createProject()); expect(project.audio.hash).toBe(""); expect(project.animation.modeId).toBe("instrumentalFalling"); expect(project.animation.baseObjectTypes).toEqual(["kick", "snare", "drum", "cymbal"]); expect(project.animation.newYorkStreets.secondaryMarbleCount).toBe(6); expect(project.background.effects.glow).toBe(true); expect(project.background.finish).toBe("clean"); expect(project.background.neon.enabled).toBe(false); expect(project.background.railColors.glassTube).toBe("#9eeeff"); expect(project.ball.revealMode).toBe("end"); expect(project.ball.revealHoldSeconds).toBe(2); });
  it("accetta un video incorporato come sfondo", () => { const project = createProject(); const parsed = parseProject({ ...project, background: { ...project.background, type: "video", imageUrl: "data:video/mp4;base64,AAAA" } }); expect(parsed.background.type).toBe("video"); });
  it("mantiene le insegne neon e applica il default ai progetti precedenti", () => { const project = createProject(); const legacyBackground: Record<string, unknown> = { ...project.background }; delete legacyBackground.neon; expect(parseProject({ ...project, background: legacyBackground }).background.neon.enabled).toBe(false); const parsed = parseProject({ ...project, background: { ...project.background, neon: { enabled: true, text: "STAY ALIVE", color: "#ff3366" } } }); expect(parsed.background.neon).toEqual({ enabled: true, text: "STAY ALIVE", color: "#ff3366" }); });
  it("migra la luce vuota dei progetti precedenti e conserva tutti i parametri fotometrici", () => { const project = createProject(); const legacy = parseProject({ ...project, lighting: {} }); expect(legacy.lighting).toMatchObject({ enabled: false, color: "#fff0cf", angleDegrees: 34, beamVisible: true, beamDensity: .38, followBall: true, activeFromSeconds: 0, activeUntilSeconds: null, origin: { x: 4, y: 6, z: 6 } }); const parsed = parseProject({ ...project, lighting: { ...project.lighting, enabled: true, origin: { x: -2, y: 7, z: 4 }, target: { x: 1, y: .5, z: -6 }, color: "#22aaff", intensity: 74, distance: 45, angleDegrees: 52, penumbra: .68, decay: 1.8, castShadow: false, sourceVisible: false, sourceRadius: .23, beamVisible: true, beamDensity: .72, beamLengthMultiplier: 4, followBall: false, activeFromSeconds: 3, activeUntilSeconds: 18, reflectionBoost: 2.2 } }); expect(parsed.lighting).toMatchObject({ enabled: true, color: "#22aaff", intensity: 74, angleDegrees: 52, beamDensity: .72, beamLengthMultiplier: 4, followBall: false, activeFromSeconds: 3, activeUntilSeconds: 18, reflectionBoost: 2.2 }); });
  it("applica Instrumental Falling ai progetti precedenti senza modalità", () => { const legacy: Record<string, unknown> = { ...createProject() }; delete legacy.animation; const animation = parseProject(legacy).animation; expect(animation.modeId).toBe("instrumentalFalling"); expect(animation.baseObjectTypes).toEqual(["kick", "snare", "drum", "cymbal"]); expect(animation.newYorkStreets.secondaryMarbleCount).toBe(6); });
  it("applica le impostazioni New York Streets ai progetti precedenti", () => { const project = createProject(); const animation: Record<string, unknown> = { ...project.animation }; delete animation.newYorkStreets; expect(parseProject({ ...project, animation }).animation.newYorkStreets.flyerImageUrls).toEqual([]); });
  it("applica From 9:16 to 16:9 ai progetti precedenti e conserva livelli e palette", () => { const project = createProject(); const animation: Record<string, unknown> = { ...project.animation }; delete animation.portraitLandscape; const legacy = parseProject({ ...project, animation }).animation.portraitLandscape; expect(legacy).toMatchObject({ videoUrl: null, sideImagePlacement: "left", palette: ["#ed75a7", "#ffffff", "#181317"], sideImagePalette: ["#ed75a7", "#ffffff", "#181317"], spectrumManualPalette: ["#ed75a7", "#ffffff", "#181317"], spectrumPaletteSource: "cover", cubeRotationBeats: 8, cubeRotationSpeed: 1, effectOpacity: { feathers: .88 }, layerOrder: ["sideImage", "particles", "cube", "feathers", "centerVideo", "lightning", "spectrum", "rain"], sideImageAdjustments: { brightness: 1, contrast: 1, saturation: 1 } }); const parsed = parseProject({ ...project, animation: { ...project.animation, modeId: "portraitLandscape", portraitLandscape: { ...project.animation.portraitLandscape, sideImagePlacement: "right", effectIntensity: 1.4, effectOpacity: { ...project.animation.portraitLandscape.effectOpacity, feathers: .96 } } } }); expect(parsed.animation.portraitLandscape).toMatchObject({ sideImagePlacement: "right", effectIntensity: 1.4, effectOpacity: { feathers: .96 } }); });
  it("applica il visualizer di copertina anche ai progetti precedenti", () => { const project = createProject(); const animation: Record<string, unknown> = { ...project.animation }; delete animation.coverSphere; const settings = parseProject({ ...project, animation }).animation.coverSphere; expect(settings.effects.smoke).toBe(true); expect(settings.flyerImageUrls).toEqual([]); expect(settings).toMatchObject({ autoPalette: true, palettePrimary: "#63f0d1", paletteSecondary: "#7657ff" }); });
  it("applica Stereo Unfold ai progetti precedenti e ne valida i controlli", () => { const project = createProject(); const animation: Record<string, unknown> = { ...project.animation }; delete animation.stereoUnfold; expect(parseProject({ ...project, animation }).animation.stereoUnfold).toMatchObject({ coverImageUrl: null, autoPalette: true, unfoldDuration: 2.4, residualCrease: .58, spectrumStyle: "ribbons", effectIntensity: 1, effects: { particles: true, lightTrails: true, pulseRings: true, fullScreenWaves: true, lightRays: true, chromaDust: true } }); const parsed = parseProject({ ...project, animation: { ...project.animation, modeId: "stereoUnfold", stereoUnfold: { ...project.animation.stereoUnfold, spectrumStyle: "prisms", stereoDepth: 2.2, effects: { particles: false, lightTrails: true, pulseRings: false } } } }); expect(parsed.animation.stereoUnfold).toMatchObject({ spectrumStyle: "prisms", stereoDepth: 2.2, effects: { particles: false, lightTrails: true, pulseRings: false, fullScreenWaves: true, lightRays: true, chromaDust: true } }); });
  it("migra i vecchi progetti Pixel Art a Instrumental Falling e scarta le impostazioni obsolete", () => { const project = createProject(); const animation: Record<string, unknown> = { ...project.animation, modeId: "pixelArt", baseObjectTypes: ["piano"], pixelArt: { venueName: "LONELY CLUB", hoodieColor: "#ff00ff", unknownSetting: true } }; const parsed = parseProject({ ...project, animation }); expect(parsed.animation.modeId).toBe("instrumentalFalling"); expect(parsed.animation.baseObjectTypes).toEqual(["kick", "snare", "drum", "cymbal"]); expect(parsed.animation).not.toHaveProperty("pixelArt"); });
  it("migra Cube Animation con sfondo, vetro, spettrogramma ed effetti configurabili", () => { const project = createProject(); const animation: Record<string, unknown> = { ...project.animation }; delete animation.walkingCube; expect(parseProject({ ...project, animation }).animation.walkingCube).toMatchObject({ imageUrl: null, backgroundImageUrl: null, autoPalette: true, palettePrimary: "#63f0d1", rotationIntensity: 1, spectrumIntensity: 1.25, rippleIntensity: 1.15, glassOpacity: .28, effects: { halo: true, orbitRings: true, particles: true, lightSweeps: true, waterRipples: true } }); });
  it("migra gli effetti Background Auto legacy con associazione, palette, opacità e layer defaults sicuri", () => { const project = createProject(); const legacyEffect = { ...project.animation.backgroundAuto.effects[0] } as Record<string, unknown>; delete legacyEffect.detectionId; delete legacyEffect.paletteMode; delete legacyEffect.opacity; delete legacyEffect.centerSpectrumEnabled; delete legacyEffect.stereoSidesEnabled; delete legacyEffect.subtitlesEnabled; const parsed = parseProject({ ...project, animation: { ...project.animation, backgroundAuto: { ...project.animation.backgroundAuto, effects: [legacyEffect] } } }); expect(parsed.animation.backgroundAuto.effects[0]).toMatchObject({ detectionId: null, paletteMode: "auto", opacity: .9, palette: ["#63f0d1", "#7657ff", "#ff4f9a"], centerSpectrumEnabled: true, stereoSidesEnabled: true, subtitlesEnabled: false }); });
  it("migra Background Auto con soglia, velocità e palette locali per oggetto", () => {
    const project = createProject();
    const palette: [string, string, string] = ["#112233", "#445566", "#778899"];
    const parsed = parseProject({ ...project, animation: { ...project.animation, backgroundAuto: {
      ...project.animation.backgroundAuto,
      palette,
      detections: [{ id: "legacy", label: "lamp", score: .18, isPerson: false, bbox: { x: .1, y: .1, width: .2, height: .2 } }, { id: "custom", label: "car", score: .8, isPerson: false, paletteMode: "manual", palette: ["#abcdef", "#123456", "#fedcba"], bbox: { x: .4, y: .2, width: .3, height: .3 } }],
      effects: [{ ...project.animation.backgroundAuto.effects[0]!, rotationSpeed: 0 }]
    } } });
    expect(parsed.animation.backgroundAuto.detectionThreshold).toBe(.15);
    expect(parsed.animation.backgroundAuto.detections[0]).toMatchObject({ paletteMode: "auto", palette });
    expect(parsed.animation.backgroundAuto.detections[1]).toMatchObject({ paletteMode: "manual", palette: ["#abcdef", "#123456", "#fedcba"] });
    expect(parsed.animation.backgroundAuto.effects[0]?.rotationSpeed).toBe(0);
  });
  it("riempie palette oggetto assenti o vuote con la palette immagine", () => {
    const project = createProject();
    const palette: [string, string, string] = ["#102030", "#405060", "#708090"];
    const parsed = parseProject({ ...project, animation: { ...project.animation, backgroundAuto: { ...project.animation.backgroundAuto, palette, detections: [{ id: "empty", label: "cup", score: .2, isPerson: false, palette: [], bbox: { x: 0, y: 0, width: .1, height: .1 } }] } } });
    expect(parsed.animation.backgroundAuto.detections[0]?.palette).toEqual(palette);
  });
  it("valida l'opacità di ogni effetto Background Auto tra zero e uno", () => {
    const project = createProject();
    expect(parseProject({ ...project, animation: { ...project.animation, backgroundAuto: { ...project.animation.backgroundAuto, effects: [{ ...project.animation.backgroundAuto.effects[0]!, opacity: 0 }] } } }).animation.backgroundAuto.effects[0]?.opacity).toBe(0);
    expect(parseProject({ ...project, animation: { ...project.animation, backgroundAuto: { ...project.animation.backgroundAuto, effects: [{ ...project.animation.backgroundAuto.effects[0]!, opacity: 1 }] } } }).animation.backgroundAuto.effects[0]?.opacity).toBe(1);
    expect(() => parseProject({ ...project, animation: { ...project.animation, backgroundAuto: { ...project.animation.backgroundAuto, effects: [{ ...project.animation.backgroundAuto.effects[0]!, opacity: -0.01 }] } } })).toThrow();
    expect(() => parseProject({ ...project, animation: { ...project.animation, backgroundAuto: { ...project.animation.backgroundAuto, effects: [{ ...project.animation.backgroundAuto.effects[0]!, opacity: 1.01 }] } } })).toThrow();
  });
  it("preserves null-target legacy effects without implicitly animating a detection", () => { const project = createProject(); const legacyEffect = { ...project.animation.backgroundAuto.effects[0], enabled: true } as Record<string, unknown>; delete legacyEffect.detectionId; const detection = { id: "legacy-person", label: "person", score: .9, isPerson: true, bbox: { x: .1, y: .1, width: .5, height: .8 } }; const parsed = parseProject({ ...project, animation: { ...project.animation, backgroundAuto: { ...project.animation.backgroundAuto, detections: [detection], effects: [legacyEffect] } } }); expect(parsed.animation.backgroundAuto.effects[0]).toMatchObject({ detectionId: null, enabled: false }); });
  it("migrates detection aliases from legacy labels and preserves custom aliases", () => {
    const project = createProject();
    const parsed = parseProject({ ...project, animation: { ...project.animation, backgroundAuto: { ...project.animation.backgroundAuto, detections: [
      { id: "legacy-object", label: "human", score: .9, isPerson: true, bbox: { x: .1, y: .1, width: .4, height: .6 } },
      { id: "custom-object", label: "car", alias: "Hero car", score: .8, isPerson: false, bbox: { x: .5, y: .2, width: .3, height: .3 } }
    ] } } });
    expect(parsed.animation.backgroundAuto.detections).toMatchObject([{ id: "legacy-object", alias: "human" }, { id: "custom-object", alias: "Hero car" }]);
  });
  it("applica dimensioni sorgente Background Auto ai progetti legacy e rifiuta valori negativi", () => { const project = createProject(); const legacy = { ...project.animation.backgroundAuto } as Record<string, unknown>; delete legacy.sourceWidth; delete legacy.sourceHeight; expect(parseProject({ ...project, animation: { ...project.animation, backgroundAuto: legacy } }).animation.backgroundAuto).toMatchObject({ sourceWidth: 0, sourceHeight: 0 }); expect(() => parseProject({ ...project, animation: { ...project.animation, backgroundAuto: { ...project.animation.backgroundAuto, sourceWidth: -1 } } })).toThrow(); });
  it("migra le impostazioni dei modelli locali per i sottotitoli", () => { const project = createProject(); const subtitles: Record<string, unknown> = { ...project.subtitles }; delete subtitles.whisperModel; delete subtitles.llmModel; delete subtitles.llmEnabled; delete subtitles.llmPasses; delete subtitles.autoPalette; delete subtitles.maxCueDuration; delete subtitles.maxCharsPerLine; delete subtitles.maxReadingSpeed; expect(parseProject({ ...project, subtitles }).subtitles).toMatchObject({ whisperModel: "whisper-base_timestamped", llmModel: "qwen2.5-0.5b-instruct", llmEnabled: true, llmPasses: 5, autoPalette: true, maxCueDuration: 4.2, maxCharsPerLine: 34, maxReadingSpeed: 19 }); });
  it("sostituisce SmolLM2 nei progetti esistenti con Qwen", () => { const project = createProject(); expect(parseProject({ ...project, subtitles: { ...project.subtitles, llmModel: "smollm2-135m-instruct" } }).subtitles.llmModel).toBe("qwen2.5-0.5b-instruct"); });
  it("migra i vecchi progetti Add Subtitles nella modalità Pro Subtitles", () => { const project = createProject(); const parsed = parseProject({ ...project, animation: { ...project.animation, modeId: "addSubtitles", addSubtitles: { videoUrl: "blob:video", videoName: "clip.mp4", fit: "contain", dimming: .25 } }, subtitles: { ...project.subtitles, whisperModel: "whisper-medium_timestamped", llmPasses: 10, animation: "karaokeGlow" } }); expect(parsed.animation.modeId).toBe("proSubtitles"); expect(parsed.animation.proSubtitles).toMatchObject({ videoUrl: "blob:video", videoName: "clip.mp4", fit: "contain", dimming: .25 }); expect(parsed.subtitles).toMatchObject({ whisperModel: "whisper-medium_timestamped", llmPasses: 10, animation: "karaokeGlow" }); });
  it("migra e conserva ProSubtitles con palette, alpha e stili per parola", () => {
    const project = createProject(); const legacyAnimation: Record<string, unknown> = { ...project.animation }; delete legacyAnimation.proSubtitles;
    expect(parseProject({ ...project, animation: legacyAnimation }).animation.proSubtitles).toMatchObject({ videoUrl: null, palette: ["#000000", "#ffffff", "#ed75a7"], positionX: 50, positionY: 50, opacity: 1, backgroundMode: "transparent", exportFormat: "webmVp9Alpha", cueStyles: [] });
    const parsed = parseProject({ ...project, animation: { ...project.animation, modeId: "proSubtitles", proSubtitles: { ...project.animation.proSubtitles, videoUrl: "blob:guide", videoName: "guide.mov", paletteImageUrl: "data:image/png;base64,AAAA", palette: ["#ff3355", "#45e0ff", "#ffe45d"], backgroundMode: "solid", backgroundColor: "#00ff00", exportFormat: "movProRes4444", cueStyles: [{ cueId: "subtitle-a", animation: "letterOrbit", fontFamily: "Bebas Neue", fontSize: 132, shadowEnabled: true, shadowColor: "#110022", wordStyles: [{ index: 1, color: "#45e0ff", fontSizeScale: 1.25, animation: "perspectiveFlip" }] }] } } });
    expect(parsed.animation.proSubtitles).toMatchObject({ videoName: "guide.mov", palette: ["#ff3355", "#45e0ff", "#ffe45d"], positionX: 50, positionY: 50, opacity: 1, backgroundMode: "solid", exportFormat: "movProRes4444", cueStyles: [{ cueId: "subtitle-a", animation: "letterOrbit", animationAutomatic: true, fontFamilyAutomatic: false, fontSizeAutomatic: false, positionX: 50, positionY: 50, positionAutomatic: true, opacity: 1, opacityAutomatic: true, wordStyles: [{ index: 1, fontSizeScale: 1.25 }] }] });
  });
  it("usa nero, bianco e rosa come palette iniziale delle modalità a tre colori", () => {
    const project = createProject();
    expect(project.animation.pixelsSub.palette).toEqual(["#000000", "#ffffff", "#ed75a7"]);
    expect(project.animation.proSubtitles.palette).toEqual(["#000000", "#ffffff", "#ed75a7"]);
  });
  it("migra l'inheritance ProSubtitles senza perdere gli override locali", () => {
    const project = createProject();
    const legacySettings: Record<string, unknown> = {
      ...project.animation.proSubtitles,
      defaultFontFamily: "Space Grotesk",
      defaultFontSize: 104,
      cueStyles: [
        {
          cueId: "automatic",
          animation: "wordRush",
          fontFamily: "Space Grotesk",
          fontSize: 104,
          shadowEnabled: true,
          shadowColor: "#050611",
          wordStyles: []
        },
        {
          cueId: "manual",
          animation: "fullFrameOrbit",
          fontFamily: "Bebas Neue",
          fontSize: 156,
          shadowEnabled: false,
          shadowColor: "#112233",
          wordStyles: []
        }
      ]
    };
    delete legacySettings.positionX;
    delete legacySettings.positionY;
    delete legacySettings.opacity;
    const settings = parseProject({
      ...project,
      animation: { ...project.animation, proSubtitles: legacySettings }
    }).animation.proSubtitles;
    expect(settings).toMatchObject({ positionX: 50, positionY: 50, opacity: 1 });
    expect(settings.cueStyles[0]).toMatchObject({
      fontFamilyAutomatic: true,
      fontSizeAutomatic: true,
      positionX: 50,
      positionY: 50,
      positionAutomatic: true,
      opacity: 1,
      opacityAutomatic: true
    });
    expect(settings.cueStyles[1]).toMatchObject({
      animation: "fullFrameOrbit",
      fontFamily: "Bebas Neue",
      fontFamilyAutomatic: false,
      fontSize: 156,
      fontSizeAutomatic: false
    });
  });
  it("conserva le nuove regie full-frame e valida posizione e opacità", () => {
    const project = createProject();
    for (const animation of ["fullFrameOrbit", "editorialGrid", "focusCarousel"] as const) {
      const parsed = parseProject({
        ...project,
        animation: {
          ...project.animation,
          proSubtitles: { ...project.animation.proSubtitles, defaultAnimation: animation }
        }
      });
      expect(parsed.animation.proSubtitles.defaultAnimation).toBe(animation);
    }
    expect(() => parseProject({
      ...project,
      animation: {
        ...project.animation,
        proSubtitles: { ...project.animation.proSubtitles, positionX: 101 }
      }
    })).toThrow();
    expect(() => parseProject({
      ...project,
      animation: {
        ...project.animation,
        proSubtitles: { ...project.animation.proSubtitles, opacity: 1.01 }
      }
    })).toThrow();
  });
  it("supporta fino a 500 override parola ProSubtitles e rifiuta indici fuori intervallo", () => {
    const project = createProject();
    const baseStyle = {
      cueId: "long-subtitle",
      animation: "wordRush" as const,
      fontFamily: "Space Grotesk",
      fontSize: 104,
      shadowEnabled: true,
      shadowColor: "#050611"
    };
    const wordStyles = Array.from({ length: 500 }, (_, index) => ({ index, color: "#f6f7fb", fontSizeScale: 1, animation: null }));
    const parsed = parseProject({
      ...project,
      animation: {
        ...project.animation,
        proSubtitles: { ...project.animation.proSubtitles, cueStyles: [{ ...baseStyle, wordStyles }] }
      }
    });
    expect(parsed.animation.proSubtitles.cueStyles[0]?.wordStyles).toHaveLength(500);
    expect(() => parseProject({
      ...project,
      animation: {
        ...project.animation,
        proSubtitles: {
          ...project.animation.proSubtitles,
          cueStyles: [{ ...baseStyle, wordStyles: [...wordStyles.slice(0, 499), { ...wordStyles[499]!, index: 500 }] }]
        }
      }
    })).toThrow();
  });
  it("applica Teddy Walk ai progetti precedenti", () => { const project = createProject(); const animation: Record<string, unknown> = { ...project.animation }; delete animation.teddyWalk; const settings = parseProject({ ...project, animation }).animation.teddyWalk; expect(settings.walkIntensity).toBe(.65); expect(settings.coverImageUrl).toBeNull(); expect(settings.danceEnabled).toBe(false); });
  it("applica Teddy Sing ai progetti precedenti", () => { const project = createProject(); const animation: Record<string, unknown> = { ...project.animation }; delete animation.teddySing; const settings = parseProject({ ...project, animation }).animation.teddySing; expect(settings.posterImageUrl).toBeNull(); expect(settings.lipSyncIntensity).toBe(1); expect(settings.vocalSensitivity).toBe(1); expect(settings.ledColor).toBe("#7b5cff"); expect(settings.particlesEnabled).toBe(true); expect(settings.particleDensity).toBe(1); expect(settings.phonemesGenerated).toBe(false); expect(settings.phonemeCues).toEqual([]); });
  it("applica Static Watermark Remover ai progetti precedenti", () => { const project = createProject(); const animation: Record<string, unknown> = { ...project.animation }; delete animation.staticWatermark; const settings = parseProject({ ...project, animation }).animation.staticWatermark; expect(settings.videoUrl).toBeNull(); expect(settings.referenceImageUrl).toBeNull(); expect(settings.region).toEqual({ x: .68, y: .04, width: .27, height: .14 }); expect(settings.feather).toBe(0); expect(settings.colorMatch).toBe(true); expect(settings.colorMatchStrength).toBe(.05); });
  it("azzera la vecchia sfumatura percentuale interna", () => { const project = createProject(); const parsed = parseProject({ ...project, animation: { ...project.animation, staticWatermark: { ...project.animation.staticWatermark, feather: .035 } } }); expect(parsed.animation.staticWatermark.feather).toBe(0); });
  it("riduce al cinque percento la vecchia intensità automatica predefinita", () => { const project = createProject(); const parsed = parseProject({ ...project, animation: { ...project.animation, staticWatermark: { ...project.animation.staticWatermark, colorMatchStrength: .72 } } }); expect(parsed.animation.staticWatermark.colorMatchStrength).toBe(.05); });
  it("applica Upscaler ai progetti precedenti e valida output e regolazioni", () => { const project = createProject(); const animation: Record<string, unknown> = { ...project.animation }; delete animation.upscaler; const settings = parseProject({ ...project, animation }).animation.upscaler; expect(settings).toMatchObject({ sourceUrl: null, model: "canvas", backend: "auto", tileSize: 256, finalWidth: 3840, finalHeight: 2160, comparisonMode: "split", originalBlend: 0, adjustments: { sharpness: 12, denoise: 0 } }); const parsed = parseProject({ ...project, animation: { ...project.animation, modeId: "upscaler", upscaler: { ...project.animation.upscaler, model: "RealESRGAN_x4plus_anime_6B", backend: "metal", finalWidth: 7680, finalHeight: 4320, originalBlend: .3, adjustments: { ...project.animation.upscaler.adjustments, contrast: 18, saturation: 12 } } } }); expect(parsed.animation.upscaler).toMatchObject({ model: "RealESRGAN_x4plus_anime_6B", backend: "metal", finalWidth: 7680, finalHeight: 4320, originalBlend: .3, adjustments: { contrast: 18, saturation: 12 } }); });
  it("migra i progetti Teddy Wheel nella modalità Teddy Walk", () => { const project = createProject(); const animation: Record<string, unknown> = { ...project.animation, modeId: "teddyWheel", teddyWheel: { coverImageUrl: "data:image/png;base64,AAAA", furColor: "#112233", patchColor: "#445566", accentColor: "#778899", wheelColor: "#abcdef", textColor: "#ffffff", wheelText: "OLD", walkIntensity: .8, jumpIntensity: 1, wheelSpeed: 1 } }; delete animation.teddyWalk; const parsed = parseProject({ ...project, animation }); expect(parsed.animation.modeId).toBe("teddyWalk"); expect(parsed.animation.teddyWalk).toMatchObject({ coverImageUrl: "data:image/png;base64,AAAA", furColor: "#112233", roadColor: "#abcdef", walkIntensity: .8 }); });
  it("rifiuta hash audio e tempi incoerenti", () => { const project = createProject(); expect(() => parseProject({ ...project, audio: { ...project.audio, hash: "bad" } })).toThrow(); const event = { id: "e", timeSeconds: 1, timeSamples: 1, eventType: "manual", confidence: 1, strength: 1, frequencyBand: "full", assignedObjectType: null, assignedObjectId: null, enabled: true, accent: false, manualOverride: true, action: "collision", expectedBallPosition: { x: 0, y: 0, z: 0 }, expectedBallVelocity: { x: 0, y: 0, z: 0 }, expectedImpactNormal: { x: 0, y: 1, z: 0 } }; expect(() => parseProject({ ...project, events: [event] })).toThrow(); });
  it("rifiuta id oggetto duplicati", () => { const project = createProject(); const object = { id: "same", name: "Pad", type: "platform", transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, material: { color: "#fff", palette: [], roughness: .5, metalness: .1, emission: 0, opacity: 1, textureAssetId: null }, restitution: .5, friction: .5, visible: true, locked: false, castShadow: true, receiveShadow: true, assetId: null }; expect(() => parseProject({ ...project, objects: [object, object] })).toThrow(); });

  it("applica Video Editor ai progetti precedenti con tracce, calamita e composizione predefinite", () => {
    const project = createProject();
    const animation: Record<string, unknown> = { ...project.animation };
    delete animation.videoEditor;
    const settings = parseProject({ ...project, animation }).animation.videoEditor;
    expect(settings).toMatchObject({ assets: [], clips: [], selectedClipIds: [], effectClips: [], selectedEffectClipIds: [], snapEnabled: true, snapThresholdSeconds: .08, snapToBeats: true, backgroundColor: "#000000", outputWidth: 1920, outputHeight: 1080, interpolationEnabled: false, interpolationTargetFps: 60, interpolationMethod: "motion" });
    // Il montaggio nasce con due tracce video sovrapponibili e una audio, in quest'ordine.
    expect(settings.tracks.map((track) => track.kind)).toEqual(["video", "video", "audio"]);
    expect(settings.tracks.map((track) => track.id)).toEqual(["video-editor-track-overlay", "video-editor-track-main", "video-editor-track-audio"]);
    expect(settings.tracks.map((track) => track.name)).toEqual(["Livello video 2", "Livello video 1", "Audio 1"]);
  });

  it("migra soltanto i vecchi nomi principale e overlay conservando ID e nomi personalizzati", () => {
    const project = createProject();
    const tracks = project.animation.videoEditor.tracks.map((track, index) => ({
      ...track,
      name: index === 0 ? "Overlay" : index === 1 ? "Video principale" : "Audio personalizzato"
    }));
    const parsed = parseProject({ ...project, animation: { ...project.animation, videoEditor: { ...project.animation.videoEditor, tracks } } }).animation.videoEditor;
    expect(parsed.tracks.map((track) => track.id)).toEqual(tracks.map((track) => track.id));
    expect(parsed.tracks.map((track) => track.name)).toEqual(["Livello video 2", "Livello video 1", "Audio personalizzato"]);
  });

  it("conserva pool, clip, fusione e correzione colore del montaggio", () => {
    const project = createProject();
    const videoEditor = {
      ...project.animation.videoEditor,
      assets: [{ id: "media-1", name: "ripresa.mp4", kind: "video", url: "blob:media-1", durationSeconds: 12.5, width: 3840, height: 2160, hasAudio: true, bpm: 128, beats: [.5, 1, 1.5], downbeats: [.5], waveform: [-1, 0, .5, 1] }],
      clips: [{ id: "clip-1", assetId: "media-1", trackId: "video-editor-track-main", startSeconds: 2, durationSeconds: 6, sourceInSeconds: 1.25, fadeInSeconds: .8, fadeOutSeconds: 1.2, fadeCurve: "exponential", audioFadeInSeconds: .5, audioFadeOutSeconds: .5, blendMode: "soft-light", blendIntensity: .65, adjustments: { exposure: .8, contrast: 24, highlights: -12, shadows: 18, whites: 6, blacks: -4, saturation: 15, vibrance: 22, temperature: -30, tint: 8, hue: -45, sharpness: 35, denoise: 10, opacity: .9 }, fit: "contain", muted: false, volume: 1.4 }],
      selectedClipIds: ["clip-1"],
      outputWidth: 3840, outputHeight: 2160, interpolationEnabled: true, interpolationTargetFps: 120, interpolationMethod: "rife"
    };
    const parsed = parseProject({ ...project, animation: { ...project.animation, modeId: "videoEditor", videoEditor } }).animation.videoEditor;
    expect(parsed.assets[0]).toMatchObject({ id: "media-1", kind: "video", hasAudio: true, bpm: 128, beats: [.5, 1, 1.5], waveform: [-1, 0, .5, 1] });
    expect(parsed.clips[0]).toMatchObject({ blendMode: "soft-light", blendIntensity: .65, fadeCurve: "exponential", fit: "contain", volume: 1.4, sourceInSeconds: 1.25 });
    expect(parsed.clips[0]?.adjustments).toMatchObject({ exposure: .8, contrast: 24, temperature: -30, hue: -45, sharpness: 35, opacity: .9 });
    expect(parsed).toMatchObject({ outputWidth: 3840, outputHeight: 2160, interpolationEnabled: true, interpolationTargetFps: 120, interpolationMethod: "rife" });
  });

  it("applica i valori predefiniti alle clip e ai media scritti in forma minima", () => {
    const project = createProject();
    const videoEditor = {
      ...project.animation.videoEditor,
      assets: [{ id: "m", name: "foto.png", kind: "image", url: "blob:m", durationSeconds: 0, width: 1080, height: 1080 }],
      clips: [{ id: "c", assetId: "m", trackId: "video-editor-track-main", startSeconds: 0, durationSeconds: 4 }]
    };
    const parsed = parseProject({ ...project, animation: { ...project.animation, videoEditor } }).animation.videoEditor;
    expect(parsed.assets[0]).toMatchObject({ hasAudio: false, bpm: null, beats: [], downbeats: [], waveform: [] });
    expect(parsed.clips[0]).toMatchObject({ sourceInSeconds: 0, fadeInSeconds: 0, fadeOutSeconds: 0, fadeCurve: "smooth", blendMode: "normal", blendIntensity: 1, fit: "cover", muted: false, volume: 1 });
    expect(parsed.clips[0]?.adjustments).toMatchObject({ exposure: 0, contrast: 0, opacity: 1 });
  });

  it("conserva clip effetto autonome e ne valida identità, target e intervallo", () => {
    const project = createProject();
    const base = project.animation.videoEditor;
    const asset = { id: "m", name: "clip.mp4", kind: "video" as const, url: "blob:m", durationSeconds: 10, width: 1080, height: 1920, hasAudio: true, bpm: null, beats: [], downbeats: [], waveform: [] };
    const clip = { id: "c", assetId: "m", trackId: "video-editor-track-main", startSeconds: 2, durationSeconds: 4, sourceInSeconds: 0, fadeInSeconds: 0, fadeOutSeconds: 0, fadeCurve: "smooth" as const, audioFadeInSeconds: 0, audioFadeOutSeconds: 0, blendMode: "normal" as const, blendIntensity: 1, adjustments: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0, sharpness: 0, denoise: 0, opacity: 1 }, fit: "cover" as const, muted: false, volume: 1 };
    const fade = { id: "fx", effectId: "fade-in", target: { kind: "clip" as const, clipId: "c" }, startSeconds: 2, durationSeconds: .75, enabled: true, mix: 1, parameters: { curve: "smooth" } };
    const parse = (patch: Record<string, unknown>) => parseProject({ ...project, animation: { ...project.animation, videoEditor: { ...base, assets: [asset], clips: [clip], ...patch } } });
    expect(parse({ effectClips: [fade], selectedEffectClipIds: [fade.id] }).animation.videoEditor.effectClips[0]).toEqual(fade);
    expect(() => parse({ effectClips: [fade, fade] })).toThrow(/ID effetto duplicato/);
    expect(() => parse({ effectClips: [{ ...fade, target: { kind: "clip", clipId: "assente" } }] })).toThrow(/clip assente/);
    expect(() => parse({ effectClips: [{ ...fade, startSeconds: 5.8, durationSeconds: 1 }] })).toThrow(/bordi della clip/);
    expect(() => parse({ effectClips: [{ ...fade, parameters: { curve: "zig-zag" } }] })).toThrow(/Curva dissolvenza/);
    expect(() => parse({ effectClips: [fade], selectedEffectClipIds: ["assente"] })).toThrow(/Effetto selezionato inesistente/);
  });

  it("migra le vecchie dissolvenze video in blocchi effetto senza applicarle due volte", () => {
    const project = createProject();
    const legacyEditor = structuredClone(project.animation.videoEditor) as Record<string, unknown>;
    delete legacyEditor.effectClips;
    delete legacyEditor.selectedEffectClipIds;
    legacyEditor.assets = [{ id: "m", name: "legacy.mp4", kind: "video", url: "blob:m", durationSeconds: 10, width: 1920, height: 1080, hasAudio: true, bpm: null, beats: [], downbeats: [], waveform: [] }];
    legacyEditor.clips = [{ id: "c", assetId: "m", trackId: "video-editor-track-main", startSeconds: 1, durationSeconds: 5, sourceInSeconds: 0, fadeInSeconds: .5, fadeOutSeconds: .8, fadeCurve: "exponential", audioFadeInSeconds: .25, audioFadeOutSeconds: .4, blendMode: "normal", blendIntensity: 1, adjustments: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0, sharpness: 0, denoise: 0, opacity: 1 }, fit: "cover", muted: false, volume: 1 }];
    const migrated = parseProject({ ...project, animation: { ...project.animation, videoEditor: legacyEditor } }).animation.videoEditor;
    expect(migrated.clips[0]).toMatchObject({ fadeInSeconds: 0, fadeOutSeconds: 0, audioFadeInSeconds: .25, audioFadeOutSeconds: .4 });
    expect(migrated.effectClips).toEqual([
      expect.objectContaining({ id: "legacy-fade-in-c", effectId: "fade-in", startSeconds: 1, durationSeconds: .5, parameters: { curve: "exponential" } }),
      expect.objectContaining({ id: "legacy-fade-out-c", effectId: "fade-out", startSeconds: 5.2, durationSeconds: .8, parameters: { curve: "exponential" } })
    ]);
  });

  it("rifiuta un montaggio incoerente: riferimenti assenti, id duplicati e dissolvenze più lunghe della clip", () => {
    const project = createProject();
    const base = project.animation.videoEditor;
    const asset = { id: "m", name: "clip.mp4", kind: "video", url: "blob:m", durationSeconds: 10, width: 1920, height: 1080, hasAudio: true, bpm: null, beats: [], downbeats: [], waveform: [] };
    const clip = { id: "c", assetId: "m", trackId: "video-editor-track-main", startSeconds: 0, durationSeconds: 4, sourceInSeconds: 0, fadeInSeconds: 0, fadeOutSeconds: 0, fadeCurve: "smooth", audioFadeInSeconds: 0, audioFadeOutSeconds: 0, blendMode: "normal", blendIntensity: 1, adjustments: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0, sharpness: 0, denoise: 0, opacity: 1 }, fit: "cover", muted: false, volume: 1 };
    const build = (videoEditor: Record<string, unknown>) => parseProject({ ...project, animation: { ...project.animation, videoEditor: { ...base, ...videoEditor } } });
    expect(() => build({ assets: [asset], clips: [clip] })).not.toThrow();
    expect(() => build({ assets: [asset], clips: [clip, clip] })).toThrow(/ID clip duplicato/);
    expect(() => build({ assets: [asset, asset], clips: [] })).toThrow(/ID media duplicato/);
    expect(() => build({ assets: [asset], clips: [{ ...clip, assetId: "assente" }] })).toThrow(/media assente dal pool/);
    expect(() => build({ assets: [asset], clips: [{ ...clip, trackId: "assente" }] })).toThrow(/traccia inesistente/);
    expect(() => build({ assets: [asset], clips: [{ ...clip, trackId: "video-editor-track-audio" }] })).toThrow(/richiede una traccia video/);
    const audioAsset = { ...asset, id: "audio", name: "voce.wav", kind: "audio" as const, width: 0, height: 0 };
    expect(() => build({ assets: [audioAsset], clips: [{ ...clip, assetId: audioAsset.id, trackId: "video-editor-track-main" }] })).toThrow(/richiede una traccia audio/);
    expect(() => build({ assets: [asset], clips: [{ ...clip, fadeInSeconds: 3, fadeOutSeconds: 3 }] })).toThrow(/dissolvenze non possono superare/);
    expect(() => build({ assets: [asset], clips: [{ ...clip, audioFadeInSeconds: 3, audioFadeOutSeconds: 3 }] })).toThrow(/dissolvenze audio non possono superare/);
    expect(() => build({ tracks: [...base.tracks, base.tracks[0]!] })).toThrow(/ID traccia duplicato/);
    // Una clip senza durata non è montabile, e il volume non può superare il doppio.
    expect(() => build({ assets: [asset], clips: [{ ...clip, durationSeconds: 0 }] })).toThrow();
    expect(() => build({ assets: [asset], clips: [{ ...clip, volume: 3 }] })).toThrow();
    expect(() => build({ assets: [asset], clips: [{ ...clip, blendMode: "plus-lighter" }] })).toThrow();
    expect(() => build({ tracks: [] })).toThrow();
  });
});
