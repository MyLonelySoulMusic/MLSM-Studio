import { describe, expect, it } from "vitest";
import { createProject, parseProject } from "./index";
describe("project schema invariants", () => {
  it("accetta un progetto nuovo senza audio", () => { const project = parseProject(createProject()); expect(project.audio.hash).toBe(""); expect(project.animation.modeId).toBe("instrumentalFalling"); expect(project.animation.baseObjectTypes).toEqual(["kick", "snare", "drum", "cymbal"]); expect(project.animation.newYorkStreets.secondaryMarbleCount).toBe(6); expect(project.background.effects.glow).toBe(true); expect(project.background.finish).toBe("clean"); expect(project.background.neon.enabled).toBe(false); expect(project.background.railColors.glassTube).toBe("#9eeeff"); expect(project.ball.revealMode).toBe("end"); expect(project.ball.revealHoldSeconds).toBe(2); });
  it("accetta un video incorporato come sfondo", () => { const project = createProject(); const parsed = parseProject({ ...project, background: { ...project.background, type: "video", imageUrl: "data:video/mp4;base64,AAAA" } }); expect(parsed.background.type).toBe("video"); });
  it("mantiene le insegne neon e applica il default ai progetti precedenti", () => { const project = createProject(); const legacyBackground: Record<string, unknown> = { ...project.background }; delete legacyBackground.neon; expect(parseProject({ ...project, background: legacyBackground }).background.neon.enabled).toBe(false); const parsed = parseProject({ ...project, background: { ...project.background, neon: { enabled: true, text: "STAY ALIVE", color: "#ff3366" } } }); expect(parsed.background.neon).toEqual({ enabled: true, text: "STAY ALIVE", color: "#ff3366" }); });
  it("migra la luce vuota dei progetti precedenti e conserva tutti i parametri fotometrici", () => { const project = createProject(); const legacy = parseProject({ ...project, lighting: {} }); expect(legacy.lighting).toMatchObject({ enabled: false, color: "#fff0cf", angleDegrees: 34, beamVisible: true, beamDensity: .38, followBall: true, activeFromSeconds: 0, activeUntilSeconds: null, origin: { x: 4, y: 6, z: 6 } }); const parsed = parseProject({ ...project, lighting: { ...project.lighting, enabled: true, origin: { x: -2, y: 7, z: 4 }, target: { x: 1, y: .5, z: -6 }, color: "#22aaff", intensity: 74, distance: 45, angleDegrees: 52, penumbra: .68, decay: 1.8, castShadow: false, sourceVisible: false, sourceRadius: .23, beamVisible: true, beamDensity: .72, beamLengthMultiplier: 4, followBall: false, activeFromSeconds: 3, activeUntilSeconds: 18, reflectionBoost: 2.2 } }); expect(parsed.lighting).toMatchObject({ enabled: true, color: "#22aaff", intensity: 74, angleDegrees: 52, beamDensity: .72, beamLengthMultiplier: 4, followBall: false, activeFromSeconds: 3, activeUntilSeconds: 18, reflectionBoost: 2.2 }); });
  it("applica Instrumental Falling ai progetti precedenti senza modalità", () => { const legacy: Record<string, unknown> = { ...createProject() }; delete legacy.animation; const animation = parseProject(legacy).animation; expect(animation.modeId).toBe("instrumentalFalling"); expect(animation.baseObjectTypes).toEqual(["kick", "snare", "drum", "cymbal"]); expect(animation.newYorkStreets.secondaryMarbleCount).toBe(6); });
  it("applica le impostazioni New York Streets ai progetti precedenti", () => { const project = createProject(); const animation: Record<string, unknown> = { ...project.animation }; delete animation.newYorkStreets; expect(parseProject({ ...project, animation }).animation.newYorkStreets.flyerImageUrls).toEqual([]); });
  it("applica il visualizer di copertina anche ai progetti precedenti", () => { const project = createProject(); const animation: Record<string, unknown> = { ...project.animation }; delete animation.coverSphere; const settings = parseProject({ ...project, animation }).animation.coverSphere; expect(settings.effects.smoke).toBe(true); expect(settings.flyerImageUrls).toEqual([]); expect(settings).toMatchObject({ autoPalette: true, palettePrimary: "#63f0d1", paletteSecondary: "#7657ff" }); });
  it("applica Stereo Unfold ai progetti precedenti e ne valida i controlli", () => { const project = createProject(); const animation: Record<string, unknown> = { ...project.animation }; delete animation.stereoUnfold; expect(parseProject({ ...project, animation }).animation.stereoUnfold).toMatchObject({ coverImageUrl: null, autoPalette: true, unfoldDuration: 2.4, residualCrease: .58, spectrumStyle: "ribbons", effectIntensity: 1, effects: { particles: true, lightTrails: true, pulseRings: true, fullScreenWaves: true, lightRays: true, chromaDust: true } }); const parsed = parseProject({ ...project, animation: { ...project.animation, modeId: "stereoUnfold", stereoUnfold: { ...project.animation.stereoUnfold, spectrumStyle: "prisms", stereoDepth: 2.2, effects: { particles: false, lightTrails: true, pulseRings: false } } } }); expect(parsed.animation.stereoUnfold).toMatchObject({ spectrumStyle: "prisms", stereoDepth: 2.2, effects: { particles: false, lightTrails: true, pulseRings: false, fullScreenWaves: true, lightRays: true, chromaDust: true } }); });
  it("applica Pixel Art ai progetti precedenti, forza la felpa nera e conserva la sotto-modalità", () => { const project = createProject(); const animation: Record<string, unknown> = { ...project.animation }; delete animation.pixelArt; expect(parseProject({ ...project, animation }).animation.pixelArt).toMatchObject({ subMode: "walkingThroughNewYork", venueName: "BAR", coverImageUrl: null, hoodieColor: "#08090e", pantsColor: "#4252c8" }); const parsed = parseProject({ ...project, animation: { ...project.animation, modeId: "pixelArt", pixelArt: { ...project.animation.pixelArt, venueName: "LONELY CLUB", hoodieColor: "#ff00ff" } } }); expect(parsed.animation.pixelArt).toMatchObject({ venueName: "LONELY CLUB", hoodieColor: "#08090e" }); });
  it("migra Cube Animation con sfondo, vetro, spettrogramma ed effetti configurabili", () => { const project = createProject(); const animation: Record<string, unknown> = { ...project.animation }; delete animation.walkingCube; expect(parseProject({ ...project, animation }).animation.walkingCube).toMatchObject({ imageUrl: null, backgroundImageUrl: null, autoPalette: true, palettePrimary: "#63f0d1", rotationIntensity: 1, spectrumIntensity: 1.25, rippleIntensity: 1.15, glassOpacity: .28, effects: { halo: true, orbitRings: true, particles: true, lightSweeps: true, waterRipples: true } }); });
  it("migra le impostazioni dei modelli locali per i sottotitoli", () => { const project = createProject(); const subtitles: Record<string, unknown> = { ...project.subtitles }; delete subtitles.whisperModel; delete subtitles.llmModel; delete subtitles.llmEnabled; delete subtitles.llmPasses; delete subtitles.autoPalette; delete subtitles.maxCueDuration; delete subtitles.maxCharsPerLine; delete subtitles.maxReadingSpeed; expect(parseProject({ ...project, subtitles }).subtitles).toMatchObject({ whisperModel: "whisper-base_timestamped", llmModel: "qwen2.5-0.5b-instruct", llmEnabled: true, llmPasses: 5, autoPalette: true, maxCueDuration: 4.2, maxCharsPerLine: 34, maxReadingSpeed: 19 }); });
  it("sostituisce SmolLM2 nei progetti esistenti con Qwen", () => { const project = createProject(); expect(parseProject({ ...project, subtitles: { ...project.subtitles, llmModel: "smollm2-135m-instruct" } }).subtitles.llmModel).toBe("qwen2.5-0.5b-instruct"); });
  it("conserva Whisper Medium, dieci revisioni e le impostazioni Add Subtitles", () => { const project = createProject(); const parsed = parseProject({ ...project, animation: { ...project.animation, modeId: "addSubtitles", addSubtitles: { videoUrl: "blob:video", videoName: "clip.mp4", fit: "contain", dimming: .25 } }, subtitles: { ...project.subtitles, whisperModel: "whisper-medium_timestamped", llmPasses: 10, animation: "karaokeGlow" } }); expect(parsed.animation.addSubtitles).toEqual({ videoUrl: "blob:video", videoName: "clip.mp4", fit: "contain", dimming: .25 }); expect(parsed.subtitles).toMatchObject({ whisperModel: "whisper-medium_timestamped", llmPasses: 10, animation: "karaokeGlow" }); });
  it("migra e conserva ProSubtitles con palette, alpha e stili per parola", () => {
    const project = createProject(); const legacyAnimation: Record<string, unknown> = { ...project.animation }; delete legacyAnimation.proSubtitles;
    expect(parseProject({ ...project, animation: legacyAnimation }).animation.proSubtitles).toMatchObject({ videoUrl: null, palette: ["#f6f7fb", "#63f0d1", "#7657ff"], positionX: 50, positionY: 50, opacity: 1, backgroundMode: "transparent", exportFormat: "webmVp9Alpha", cueStyles: [] });
    const parsed = parseProject({ ...project, animation: { ...project.animation, modeId: "proSubtitles", proSubtitles: { ...project.animation.proSubtitles, videoUrl: "blob:guide", videoName: "guide.mov", paletteImageUrl: "data:image/png;base64,AAAA", palette: ["#ff3355", "#45e0ff", "#ffe45d"], backgroundMode: "solid", backgroundColor: "#00ff00", exportFormat: "movProRes4444", cueStyles: [{ cueId: "subtitle-a", animation: "letterOrbit", fontFamily: "Bebas Neue", fontSize: 132, shadowEnabled: true, shadowColor: "#110022", wordStyles: [{ index: 1, color: "#45e0ff", fontSizeScale: 1.25, animation: "perspectiveFlip" }] }] } } });
    expect(parsed.animation.proSubtitles).toMatchObject({ videoName: "guide.mov", palette: ["#ff3355", "#45e0ff", "#ffe45d"], positionX: 50, positionY: 50, opacity: 1, backgroundMode: "solid", exportFormat: "movProRes4444", cueStyles: [{ cueId: "subtitle-a", animation: "letterOrbit", animationAutomatic: true, fontFamilyAutomatic: false, fontSizeAutomatic: false, positionX: 50, positionY: 50, positionAutomatic: true, opacity: 1, opacityAutomatic: true, wordStyles: [{ index: 1, fontSizeScale: 1.25 }] }] });
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
  it("migra i progetti Teddy Wheel nella modalità Teddy Walk", () => { const project = createProject(); const animation: Record<string, unknown> = { ...project.animation, modeId: "teddyWheel", teddyWheel: { coverImageUrl: "data:image/png;base64,AAAA", furColor: "#112233", patchColor: "#445566", accentColor: "#778899", wheelColor: "#abcdef", textColor: "#ffffff", wheelText: "OLD", walkIntensity: .8, jumpIntensity: 1, wheelSpeed: 1 } }; delete animation.teddyWalk; const parsed = parseProject({ ...project, animation }); expect(parsed.animation.modeId).toBe("teddyWalk"); expect(parsed.animation.teddyWalk).toMatchObject({ coverImageUrl: "data:image/png;base64,AAAA", furColor: "#112233", roadColor: "#abcdef", walkIntensity: .8 }); });
  it("rifiuta hash audio e tempi incoerenti", () => { const project = createProject(); expect(() => parseProject({ ...project, audio: { ...project.audio, hash: "bad" } })).toThrow(); const event = { id: "e", timeSeconds: 1, timeSamples: 1, eventType: "manual", confidence: 1, strength: 1, frequencyBand: "full", assignedObjectType: null, assignedObjectId: null, enabled: true, accent: false, manualOverride: true, action: "collision", expectedBallPosition: { x: 0, y: 0, z: 0 }, expectedBallVelocity: { x: 0, y: 0, z: 0 }, expectedImpactNormal: { x: 0, y: 1, z: 0 } }; expect(() => parseProject({ ...project, events: [event] })).toThrow(); });
  it("rifiuta id oggetto duplicati", () => { const project = createProject(); const object = { id: "same", name: "Pad", type: "platform", transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, material: { color: "#fff", palette: [], roughness: .5, metalness: .1, emission: 0, opacity: 1, textureAssetId: null }, restitution: .5, friction: .5, visible: true, locked: false, castShadow: true, receiveShadow: true, assetId: null }; expect(() => parseProject({ ...project, objects: [object, object] })).toThrow(); });
});
