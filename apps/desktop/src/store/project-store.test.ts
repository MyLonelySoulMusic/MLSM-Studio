import { beforeEach, describe, expect, it } from "vitest";
import type { AudioAnalysisResult } from "@rbs/audio-analysis";
import { buildPrimaryBeatEvents, useProjectStore } from "./project-store";

describe("project event history", () => {
  beforeEach(() => useProjectStore.getState().newProject());
  it("annulla e ripete aggiunta, spostamento e cancellazione", () => {
    const store = useProjectStore.getState();
    store.attachAudio({ path: "track.wav", fileName: "track.wav", hash: "a".repeat(64), durationSeconds: 10, sampleRate: 48_000, channels: 2, codec: "pcm", fileSize: 100 }, []);
    useProjectStore.getState().addEvent(2); const id = useProjectStore.getState().project.events[0]?.id; expect(id).toBeTruthy();
    useProjectStore.getState().moveEvent(id ?? "", 3); expect(useProjectStore.getState().project.events[0]?.timeSeconds).toBe(3);
    useProjectStore.getState().undoEvents(); expect(useProjectStore.getState().project.events[0]?.timeSeconds).toBe(2);
    useProjectStore.getState().redoEvents(); expect(useProjectStore.getState().project.events[0]?.timeSeconds).toBe(3);
    useProjectStore.getState().deleteEvent(id ?? ""); expect(useProjectStore.getState().project.events).toHaveLength(0);
    useProjectStore.getState().undoEvents(); expect(useProjectStore.getState().project.events).toHaveLength(1);
  });
  it("mantiene coerenti secondi e indice campione", () => { const store = useProjectStore.getState(); store.attachAudio({ path: "track.wav", fileName: "track.wav", hash: "b".repeat(64), durationSeconds: 10, sampleRate: 44_100, channels: 1, codec: "pcm", fileSize: 100 }, []); useProjectStore.getState().addEvent(1.25); const event = useProjectStore.getState().project.events[0]; expect(event?.timeSamples).toBe(55_125); });
  it("usa un solo impatto per beat e scarta classificazioni armoniche incerte", () => { const result: AudioAnalysisResult = { analyzerVersion: "test", durationSeconds: 2, sampleRate: 1_000, globalBpm: 120, bpmConfidence: .9, localTempo: [], beats: [.5, 1, 1.5], downbeats: [.5], events: [{ timeSeconds: .5, timeSamples: 500, type: "piano", strength: .7, confidence: .7, frequencyBand: "mid" }, { timeSeconds: .72, timeSamples: 720, type: "snare", strength: .9, confidence: .9, frequencyBand: "mid" }, { timeSeconds: 1, timeSamples: 1_000, type: "strings", strength: .75, confidence: .93, frequencyBand: "mid" }, { timeSeconds: 1.5, timeSamples: 1_500, type: "kick", strength: .9, confidence: .9, frequencyBand: "low" }], energy: [], onsetEnvelope: [], spectralFlux: [], lowEnergySegments: [] }; const events = buildPrimaryBeatEvents(result); expect(events).toHaveLength(3); expect(events.map((event) => event.eventType)).toEqual(["percussion", "strings", "kick"]); expect(events.map((event) => event.timeSeconds)).toEqual(result.beats); });
  it("interpreta in half-time una beat grid molto veloce", () => { const base: AudioAnalysisResult = { analyzerVersion: "test", durationSeconds: 2, sampleRate: 1_000, globalBpm: 180, bpmConfidence: .9, localTempo: [], beats: [0, .333, .666, .999, 1.332, 1.665], downbeats: [0], events: [], energy: [], onsetEnvelope: [], spectralFlux: [], lowEnergySegments: [] }; expect(buildPrimaryBeatEvents(base).map((event) => event.timeSeconds)).toEqual([0, .666, 1.332]); });
  it("trasforma le battute deboli in cadute e alcune battute normali in scorrimenti", () => { const base: AudioAnalysisResult = { analyzerVersion: "test", durationSeconds: 4, sampleRate: 1_000, globalBpm: 120, bpmConfidence: .9, localTempo: [], beats: [0, .5, 1, 1.5, 2, 2.5, 3, 3.5], downbeats: [0, 2], events: [], energy: [], onsetEnvelope: [], spectralFlux: [], lowEnergySegments: [{ startSeconds: .4, endSeconds: 1.6, averageRms: .01 }] }; const actions = buildPrimaryBeatEvents(base).map((event) => event.action); expect(actions).toContain("freeFall"); expect(actions).toContain("nearMiss"); expect(actions[0]).toBe("accentedCollision"); });
  it("mantiene una selezione multipla e la elimina con una sola operazione annullabile", () => { const store = useProjectStore.getState(); store.attachAudio({ path: "track.wav", fileName: "track.wav", hash: "c".repeat(64), durationSeconds: 10, sampleRate: 48_000, channels: 2, codec: "pcm", fileSize: 100 }, []); store.addEvent(1); useProjectStore.getState().addEvent(2); const ids = useProjectStore.getState().project.events.map((event) => event.id); useProjectStore.getState().selectEvent(ids[0] ?? null); useProjectStore.getState().selectEvent(ids[1] ?? null, true); expect(useProjectStore.getState().selectedEventIds).toEqual(ids); useProjectStore.getState().deleteEvents(ids); expect(useProjectStore.getState().project.events).toHaveLength(0); useProjectStore.getState().undoEvents(); expect(useProjectStore.getState().project.events).toHaveLength(2); });
  it("configura la base della modalità senza consentire una selezione vuota", () => { const store = useProjectStore.getState(); store.setBaseObjectEnabled("piano", true); expect(useProjectStore.getState().project.animation.baseObjectTypes).toContain("piano"); store.setAnimationMode("instrumentalFalling", ["strings"]); useProjectStore.getState().setBaseObjectEnabled("strings", false); expect(useProjectStore.getState().project.animation).toMatchObject({ modeId: "instrumentalFalling", baseObjectTypes: ["strings"] }); });
  it("configura numero, colori e volantini di New York Streets", () => { const store = useProjectStore.getState(); store.setAnimationMode("newYorkStreets", ["pebble"]); store.setNewYorkMarbleCount(13); store.setNewYorkGroupColor("#112233"); store.setNewYorkMarbleColor(2, "#abcdef"); store.addNewYorkFlyers(["data:image/png;base64,AAAA", "data:image/png;base64,BBBB"]); store.removeNewYorkFlyer(0); const settings = useProjectStore.getState().project.animation.newYorkStreets; expect(settings.secondaryMarbleCount).toBe(13); expect(settings.secondaryColors).toHaveLength(13); expect(settings.secondaryColors[0]).toBe("#112233"); expect(settings.secondaryColors[2]).toBe("#abcdef"); expect(settings.flyerImageUrls).toEqual(["data:image/png;base64,BBBB"]); });
  it("configura palette e movimento di Teddy Walk", () => { const store = useProjectStore.getState(); store.setAnimationMode("teddyWalk", ["platform"]); store.setTeddyWalkPalette(["#112233", "#445566", "#778899"]); store.updateTeddyWalk({ pulseIntensity: 1.2, danceEnabled: true }); expect(useProjectStore.getState().project.animation.teddyWalk).toMatchObject({ furColor: "#112233", patchColor: "#445566", roadColor: "#778899", pulseIntensity: 1.2, danceEnabled: true }); });
  it("configura poster, palette e labiale di Teddy Sing", () => { const store = useProjectStore.getState(); store.setAnimationMode("teddySing", ["platform"]); store.setTeddySingPalette(["#223344", "#556677", "#8899aa", "#101820"]); store.updateTeddySing({ posterImageUrl: "data:image/png;base64,AAAA", lipSyncIntensity: 1.35, vocalSensitivity: 1.2 }); expect(useProjectStore.getState().project.animation.teddySing).toMatchObject({ posterImageUrl: "data:image/png;base64,AAAA", furColor: "#223344", patchColor: "#556677", ledColor: "#8899aa", roomColor: "#101820", lipSyncIntensity: 1.35, vocalSensitivity: 1.2 }); });
  it("propaga la palette Cover Sphere ai sottotitoli finché il collegamento automatico è attivo", () => { const store = useProjectStore.getState(); store.setCoverSpherePalette(["#ef3f91", "#6747dd"]); expect(useProjectStore.getState().project.subtitles).toMatchObject({ color: "#ef3f91", glowColor: "#6747dd" }); useProjectStore.getState().updateSubtitles({ autoPalette: false, color: "#ffffff", glowColor: "#aaaaaa" }); useProjectStore.getState().setCoverSpherePalette(["#111111", "#222222"]); expect(useProjectStore.getState().project.subtitles).toMatchObject({ color: "#ffffff", glowColor: "#aaaaaa" }); });
  it("mantiene e riapplica esplicitamente la palette automatica delle 48 bande", () => { const store = useProjectStore.getState(); store.setCoverSpherePalette(["#aa3366", "#22bbdd"]); expect(useProjectStore.getState().project.animation.coverSphere).toMatchObject({ autoPalette: true, palettePrimary: "#aa3366", paletteSecondary: "#22bbdd", spectrumColor: "#aa3366", effectColor: "#22bbdd" }); useProjectStore.getState().setCoverSphereAutoPalette(false); useProjectStore.getState().updateCoverSphere({ spectrumColor: "#ffffff" }); useProjectStore.getState().setCoverSpherePalette(["#101820", "#ffd166"]); expect(useProjectStore.getState().project.animation.coverSphere).toMatchObject({ autoPalette: false, spectrumColor: "#ffffff", palettePrimary: "#101820" }); useProjectStore.getState().setCoverSphereAutoPalette(true); expect(useProjectStore.getState().project.animation.coverSphere).toMatchObject({ spectrumColor: "#101820", effectColor: "#ffd166" }); });
  it("configura Stereo Unfold e conserva la palette manuale", () => { const store = useProjectStore.getState(); store.setAnimationMode("stereoUnfold", ["platform"]); store.setStereoUnfoldPalette(["#ef476f", "#06d6a0"]); store.updateStereoUnfold({ coverImageUrl: "data:image/png;base64,AAAA", spectrumStyle: "aurora", stereoDepth: 1.8 }); expect(useProjectStore.getState().project.animation.stereoUnfold).toMatchObject({ primaryColor: "#ef476f", secondaryColor: "#06d6a0", coverImageUrl: "data:image/png;base64,AAAA", spectrumStyle: "aurora", stereoDepth: 1.8 }); useProjectStore.getState().setStereoUnfoldAutoPalette(false); useProjectStore.getState().updateStereoUnfold({ primaryColor: "#ffffff" }); useProjectStore.getState().setStereoUnfoldPalette(["#111111", "#222222"]); expect(useProjectStore.getState().project.animation.stereoUnfold).toMatchObject({ autoPalette: false, primaryColor: "#ffffff", palettePrimary: "#111111" }); });
  it("applica la palette dell'immagine a Cube Animation e ai sottotitoli automatici", () => { const store = useProjectStore.getState(); store.setAnimationMode("walkingCube", ["platform"]); store.setWalkingCubePalette(["#10c7d9", "#5438dc", "#ff4f91"]); store.updateWalkingCube({ imageUrl: "data:image/png;base64,AAAA", rotationIntensity: 1.1 }); expect(useProjectStore.getState().project.animation.walkingCube).toMatchObject({ imageUrl: "data:image/png;base64,AAAA", palettePrimary: "#10c7d9", paletteSecondary: "#5438dc", paletteAccent: "#ff4f91", rotationIntensity: 1.1 }); expect(useProjectStore.getState().project.subtitles).toMatchObject({ color: "#10c7d9", glowColor: "#ff4f91" }); });
  it("mantiene associazioni e palette indipendenti per le istanze Background Auto", () => {
    const person = { id: "person-a", label: "person", score: .95, isPerson: true, bbox: { x: .1, y: .1, width: .3, height: .7 } };
    const car = { id: "car-b", label: "car", score: .9, isPerson: false, bbox: { x: .55, y: .5, width: .35, height: .3 } };
    useProjectStore.getState().setBackgroundAutoDetections([person, car]);
    let effects = useProjectStore.getState().project.animation.backgroundAuto.effects;
    expect(effects.every((effect) => effect.detectionId === null && !effect.enabled)).toBe(true);
    useProjectStore.getState().toggleBackgroundAutoDetectionAnimation("person-a");
    effects = useProjectStore.getState().project.animation.backgroundAuto.effects;
    expect(effects.find((effect) => effect.detectionId === "person-a" && effect.enabled)).toBeTruthy();
    useProjectStore.getState().addBackgroundAutoEffect(); effects = useProjectStore.getState().project.animation.backgroundAuto.effects;
    expect(effects.find((effect) => effect.detectionId === "car-b" && effect.enabled)).toBeFalsy();
    const manualId = effects.find((effect) => effect.detectionId === "person-a")!.id; const autoId = effects.find((effect) => effect.detectionId === null)!.id;
    useProjectStore.getState().updateBackgroundAutoEffect(manualId, { paletteMode: "manual", color: "#101010", palette: ["#101010", "#202020", "#303030"] });
    useProjectStore.getState().updateBackgroundAutoEffect(manualId, { opacity: .42 });
    useProjectStore.getState().setBackgroundAutoPalette(["#aa0000", "#00bb00", "#0000cc"]);
    effects = useProjectStore.getState().project.animation.backgroundAuto.effects;
    expect(effects.find((effect) => effect.id === manualId)).toMatchObject({ paletteMode: "manual", color: "#101010", palette: ["#101010", "#202020", "#303030"], opacity: .42 });
    expect(effects.find((effect) => effect.id === autoId)).toMatchObject({ paletteMode: "auto", color: "#00bb00", palette: ["#aa0000", "#00bb00", "#0000cc"] });
  });
  it("normalizza la geometria manuale non finita o fuori intervallo", () => {
    const effect = useProjectStore.getState().project.animation.backgroundAuto.effects[0]!;
    useProjectStore.getState().updateBackgroundAutoEffect(effect.id, { centerX: Number.NaN, centerY: Number.POSITIVE_INFINITY, diameter: Number.NEGATIVE_INFINITY });
    expect(useProjectStore.getState().project.animation.backgroundAuto.effects[0]).toMatchObject({ centerX: .5, centerY: .5, diameter: .42 });
    useProjectStore.getState().updateBackgroundAutoEffect(effect.id, { centerX: -5, centerY: 8, diameter: -2 });
    expect(useProjectStore.getState().project.animation.backgroundAuto.effects[0]).toMatchObject({ centerX: 0, centerY: 1, diameter: .05 });
  });
  it("propaga le palette automatiche per oggetto senza sovrascrivere i colori manuali", () => {
    const first = { id: "first", label: "lamp", score: .8, isPerson: false, bbox: { x: .1, y: .1, width: .2, height: .2 }, palette: ["#110000", "#001100", "#000011"] as [string, string, string], paletteMode: "manual" as const };
    const second = { id: "second", label: "car", score: .7, isPerson: false, bbox: { x: .5, y: .2, width: .2, height: .2 } };
    useProjectStore.getState().setBackgroundAutoDetections([first, second]);
    useProjectStore.getState().toggleBackgroundAutoDetectionAnimation("first");
    useProjectStore.getState().toggleBackgroundAutoDetectionAnimation("second");
    useProjectStore.getState().setBackgroundAutoPalette(["#aa0000", "#00bb00", "#0000cc"]);
    let settings = useProjectStore.getState().project.animation.backgroundAuto;
    expect(settings.detections.find((detection) => detection.id === "first")).toMatchObject({ paletteMode: "manual", palette: first.palette });
    expect(settings.detections.find((detection) => detection.id === "second")).toMatchObject({ paletteMode: "auto", palette: ["#aa0000", "#00bb00", "#0000cc"] });
    expect(settings.effects.find((effect) => effect.detectionId === "first")?.palette).toEqual(first.palette);
    expect(settings.effects.find((effect) => effect.detectionId === "second")?.palette).toEqual(["#aa0000", "#00bb00", "#0000cc"]);
    useProjectStore.getState().patchBackgroundAutoDetection("second", { palette: ["#123456", "#654321", "#abcdef"] });
    settings = useProjectStore.getState().project.animation.backgroundAuto;
    expect(settings.detections.find((detection) => detection.id === "second")).toMatchObject({ paletteMode: "manual", palette: ["#123456", "#654321", "#abcdef"] });
    expect(settings.effects.find((effect) => effect.detectionId === "second")?.palette).toEqual(["#123456", "#654321", "#abcdef"]);
  });
  it("patches aliases/person flags and toggles animation per object", () => {
    const object = { id: "object-a", label: "car", score: .9, isPerson: false, bbox: { x: .1, y: .1, width: .3, height: .3 } };
    const second = { id: "object-b", label: "lamp", score: .8, isPerson: false, bbox: { x: .5, y: .2, width: .2, height: .2 } };
    useProjectStore.getState().setBackgroundAutoDetections([object, second]);
    useProjectStore.getState().patchBackgroundAutoDetection("object-a", { alias: "Hero car", isPerson: true });
    expect(useProjectStore.getState().project.animation.backgroundAuto.detections[0]).toMatchObject({ alias: "Hero car", isPerson: true });
    useProjectStore.getState().toggleBackgroundAutoDetectionAnimation("object-b");
    let effects = useProjectStore.getState().project.animation.backgroundAuto.effects;
    expect(effects.filter((effect) => effect.detectionId === "object-b" && effect.enabled)).toHaveLength(1);
    useProjectStore.getState().toggleBackgroundAutoDetectionAnimation("object-b");
    effects = useProjectStore.getState().project.animation.backgroundAuto.effects;
    expect(effects.filter((effect) => effect.detectionId === "object-b" && effect.enabled)).toHaveLength(0);
    useProjectStore.getState().patchBackgroundAutoDetection("object-a", { alias: "" });
    expect(useProjectStore.getState().project.animation.backgroundAuto.detections[0]?.alias).toBe("car");
  });
  it("elimina in cascata gli effetti con detection rimossa without filtering by person", () => {
    const person = { id: "person-a", label: "person", score: .95, isPerson: true, bbox: { x: .1, y: .1, width: .3, height: .7 } };
    const car = { id: "car-b", label: "car", score: .9, isPerson: false, bbox: { x: .55, y: .5, width: .35, height: .3 } };
    useProjectStore.getState().setBackgroundAutoDetections([person, car]); useProjectStore.getState().toggleBackgroundAutoDetectionAnimation("person-a");
    useProjectStore.getState().setBackgroundAutoDetections([car]);
    expect(useProjectStore.getState().project.animation.backgroundAuto.effects.every((effect) => effect.detectionId !== "person-a")).toBe(true);
    useProjectStore.getState().setBackgroundAutoDetections([person, car]);
    useProjectStore.getState().updateBackgroundAuto({ personAnimationEnabled: true });
    expect(useProjectStore.getState().project.animation.backgroundAuto.effects.some((effect) => effect.detectionId === "car-b")).toBe(false);
  });
  it("propaga la nuova palette ProSubtitles alle parole automatiche senza sovrascrivere i colori manuali", () => {
    const store = useProjectStore.getState();
    store.setAnimationMode("proSubtitles", ["platform"]);
    store.attachAudio({ path: "video.mp4", fileName: "video.mp4", hash: "9".repeat(64), durationSeconds: 10, sampleRate: 48_000, channels: 2, codec: "aac", fileSize: 100 }, []);
    const id = useProjectStore.getState().addSubtitleCue(1);
    const initialPalette = useProjectStore.getState().project.animation.proSubtitles.palette;
    useProjectStore.getState().updateProSubtitleWordStyle(id, 0, { color: initialPalette[0] });
    useProjectStore.getState().updateProSubtitleWordStyle(id, 1, { color: "#123456" });
    useProjectStore.getState().setProSubtitlesPalette(["#ef476f", "#06d6a0", "#ffd166"]);
    const wordStyles = useProjectStore.getState().project.animation.proSubtitles.cueStyles.find((style) => style.cueId === id)?.wordStyles;
    expect(wordStyles?.find((style) => style.index === 0)?.color).toBe("#ef476f");
    expect(wordStyles?.find((style) => style.index === 1)?.color).toBe("#123456");
  });
  it("completa sempre la palette ProSubtitles con tre colori distinti", () => {
    useProjectStore.getState().setProSubtitlesPalette(["#101820"]);
    expect(new Set(useProjectStore.getState().project.animation.proSubtitles.palette).size).toBe(3);
  });
  it("preserva cue e personalizzazioni quando sostituisce il video guida ProSubtitles", () => {
    const store = useProjectStore.getState();
    store.setAnimationMode("proSubtitles", ["platform"]);
    store.attachAudio({ path: "first.mov", fileName: "first.mov", hash: "1".repeat(64), durationSeconds: 12, sampleRate: 48_000, channels: 2, codec: "aac", fileSize: 100 }, []);
    const cueId = useProjectStore.getState().addSubtitleCue(1.5);
    useProjectStore.getState().updateSubtitleCue(cueId, { text: "Testo già sincronizzato" });
    useProjectStore.getState().updateProSubtitleCueStyle(cueId, { animation: "letterOrbit", fontFamily: "Bebas Neue", fontSize: 144, shadowEnabled: false });
    useProjectStore.getState().updateProSubtitleWordStyle(cueId, 1, { color: "#123456", fontSizeScale: 1.4 });
    const before = useProjectStore.getState().project;
    const cues = before.subtitles.cues;
    const cueStyles = before.animation.proSubtitles.cueStyles;

    useProjectStore.getState().attachAudio(
      { path: "replacement.mov", fileName: "replacement.mov", hash: "2".repeat(64), durationSeconds: 24, sampleRate: 44_100, channels: 2, codec: "aac", fileSize: 200 },
      [.1, .2],
      { preserveSubtitleTrack: true }
    );

    const project = useProjectStore.getState().project;
    expect(project.audio).toMatchObject({ sourcePath: "replacement.mov", durationSeconds: 24, sampleRate: 44_100 });
    expect(project.analysis.waveform).toEqual([.1, .2]);
    expect(project.subtitles.cues).toEqual(cues);
    expect(project.animation.proSubtitles.cueStyles).toEqual(cueStyles);
  });
  it("marca come manuale soltanto una scelta esplicita dell'animazione ProSubtitles", () => {
    const store = useProjectStore.getState();
    store.setAnimationMode("proSubtitles", ["platform"]);
    store.attachAudio({ path: "video.mov", fileName: "video.mov", hash: "3".repeat(64), durationSeconds: 8, sampleRate: 48_000, channels: 2, codec: "aac", fileSize: 100 }, []);
    const cueId = useProjectStore.getState().addSubtitleCue(1);
    useProjectStore.getState().updateProSubtitleCueStyle(cueId, { fontSize: 136 });
    expect(useProjectStore.getState().project.animation.proSubtitles.cueStyles.find((style) => style.cueId === cueId)).toMatchObject({ animationAutomatic: true, fontSizeAutomatic: false });
    useProjectStore.getState().updateProSubtitleCueStyle(cueId, { animation: "letterOrbit" });
    expect(useProjectStore.getState().project.animation.proSubtitles.cueStyles.find((style) => style.cueId === cueId)).toMatchObject({ animation: "letterOrbit", animationAutomatic: false });
    useProjectStore.getState().updateProSubtitleCueStyle(cueId, { animation: "wordRush", animationAutomatic: true });
    expect(useProjectStore.getState().project.animation.proSubtitles.cueStyles.find((style) => style.cueId === cueId)).toMatchObject({ animation: "wordRush", animationAutomatic: true });
  });
  it("propaga font e dimensione globali ai cue automatici preservando gli override locali", () => {
    const store = useProjectStore.getState();
    store.setAnimationMode("proSubtitles", ["platform"]);
    store.attachAudio({ path: "video.mov", fileName: "video.mov", hash: "5".repeat(64), durationSeconds: 8, sampleRate: 48_000, channels: 2, codec: "aac", fileSize: 100 }, []);
    const automaticCueId = useProjectStore.getState().addSubtitleCue(1);
    const manualCueId = useProjectStore.getState().addSubtitleCue(4);

    useProjectStore.getState().updateProSubtitleCueStyle(manualCueId, { fontFamily: "Bebas Neue", fontSize: 148 });
    useProjectStore.getState().updateProSubtitles({ defaultFontFamily: "Montserrat", defaultFontSize: 126 });

    let styles = useProjectStore.getState().project.animation.proSubtitles.cueStyles;
    expect(styles.find((style) => style.cueId === automaticCueId)).toMatchObject({
      fontFamily: "Montserrat",
      fontFamilyAutomatic: true,
      fontSize: 126,
      fontSizeAutomatic: true
    });
    expect(styles.find((style) => style.cueId === manualCueId)).toMatchObject({
      fontFamily: "Bebas Neue",
      fontFamilyAutomatic: false,
      fontSize: 148,
      fontSizeAutomatic: false
    });

    useProjectStore.getState().updateProSubtitleCueStyle(manualCueId, {
      fontFamilyAutomatic: true,
      fontSizeAutomatic: true
    });
    styles = useProjectStore.getState().project.animation.proSubtitles.cueStyles;
    expect(styles.find((style) => style.cueId === manualCueId)).toMatchObject({
      fontFamily: "Montserrat",
      fontFamilyAutomatic: true,
      fontSize: 126,
      fontSizeAutomatic: true
    });
  });
  it("applica i globali anche ai cue legacy già aperti senza flag di inheritance", () => {
    const store = useProjectStore.getState();
    store.setAnimationMode("proSubtitles", ["platform"]);
    store.attachAudio({ path: "video.mov", fileName: "video.mov", hash: "7".repeat(64), durationSeconds: 8, sampleRate: 48_000, channels: 2, codec: "aac", fileSize: 100 }, []);
    const cueId = useProjectStore.getState().addSubtitleCue(1);
    const project = useProjectStore.getState().project;
    const cueStyle = project.animation.proSubtitles.cueStyles.find((style) => style.cueId === cueId);
    expect(cueStyle).toBeTruthy();
    const legacyStyle = { ...cueStyle } as Record<string, unknown>;
    delete legacyStyle.fontFamilyAutomatic;
    delete legacyStyle.fontSizeAutomatic;
    delete legacyStyle.positionAutomatic;
    delete legacyStyle.opacityAutomatic;
    useProjectStore.setState({
      project: {
        ...project,
        animation: {
          ...project.animation,
          proSubtitles: {
            ...project.animation.proSubtitles,
            cueStyles: [legacyStyle as unknown as typeof project.animation.proSubtitles.cueStyles[number]]
          }
        }
      }
    });

    useProjectStore.getState().updateProSubtitles({
      defaultFontFamily: "Oswald",
      defaultFontSize: 118,
      positionX: 64,
      positionY: 36,
      opacity: .72
    });
    expect(useProjectStore.getState().project.animation.proSubtitles.cueStyles[0]).toMatchObject({
      fontFamily: "Oswald",
      fontFamilyAutomatic: true,
      fontSize: 118,
      fontSizeAutomatic: true,
      positionX: 64,
      positionY: 36,
      positionAutomatic: true,
      opacity: .72,
      opacityAutomatic: true
    });
  });
  it("gestisce posizione e opacità globali, locali e il ripristino dell'inheritance", () => {
    const store = useProjectStore.getState();
    store.setAnimationMode("proSubtitles", ["platform"]);
    store.attachAudio({ path: "video.mov", fileName: "video.mov", hash: "6".repeat(64), durationSeconds: 8, sampleRate: 48_000, channels: 2, codec: "aac", fileSize: 100 }, []);
    const cueId = useProjectStore.getState().addSubtitleCue(1);

    useProjectStore.getState().updateProSubtitles({ positionX: 42, positionY: 68, opacity: .82 });
    let style = useProjectStore.getState().project.animation.proSubtitles.cueStyles.find((candidate) => candidate.cueId === cueId);
    expect(style).toMatchObject({
      positionX: 42,
      positionY: 68,
      positionAutomatic: true,
      opacity: .82,
      opacityAutomatic: true
    });

    useProjectStore.getState().updateProSubtitleCueStyle(cueId, { positionX: 23, positionY: 31, opacity: .45 });
    style = useProjectStore.getState().project.animation.proSubtitles.cueStyles.find((candidate) => candidate.cueId === cueId);
    expect(style).toMatchObject({ positionX: 23, positionY: 31, positionAutomatic: false, opacity: .45, opacityAutomatic: false });

    useProjectStore.getState().updateProSubtitles({ positionX: 55, positionY: 74, opacity: .9 });
    style = useProjectStore.getState().project.animation.proSubtitles.cueStyles.find((candidate) => candidate.cueId === cueId);
    expect(style).toMatchObject({ positionX: 23, positionY: 31, opacity: .45 });

    useProjectStore.getState().updateProSubtitleCueStyle(cueId, { positionAutomatic: true, opacityAutomatic: true });
    style = useProjectStore.getState().project.animation.proSubtitles.cueStyles.find((candidate) => candidate.cueId === cueId);
    expect(style).toMatchObject({
      positionX: 55,
      positionY: 74,
      positionAutomatic: true,
      opacity: .9,
      opacityAutomatic: true
    });
  });
  it("usa nel fallback parola lo stesso slot palette del renderer ProSubtitles", () => {
    const store = useProjectStore.getState();
    store.setAnimationMode("proSubtitles", ["platform"]);
    store.attachAudio({ path: "video.mov", fileName: "video.mov", hash: "4".repeat(64), durationSeconds: 8, sampleRate: 48_000, channels: 2, codec: "aac", fileSize: 100 }, []);
    const cueId = useProjectStore.getState().addSubtitleCue(1);
    useProjectStore.getState().updateSubtitleCue(cueId, { text: "uno due tre quattro" });
    useProjectStore.getState().updateProSubtitleWordStyle(cueId, 2, { fontSizeScale: 1.25 });
    const settings = useProjectStore.getState().project.animation.proSubtitles;
    expect(settings.cueStyles.find((style) => style.cueId === cueId)?.wordStyles.find((word) => word.index === 2)?.color).toBe(settings.palette[0]);
  });
  it("inserisce manualmente un blocco sottotitolo al playhead", () => { const store = useProjectStore.getState(); store.attachAudio({ path: "track.wav", fileName: "track.wav", hash: "e".repeat(64), durationSeconds: 10, sampleRate: 48_000, channels: 2, codec: "pcm", fileSize: 100 }, []); const id = useProjectStore.getState().addSubtitleCue(4.25); expect(useProjectStore.getState().project.subtitles).toMatchObject({ enabled: true, cues: [{ id, startSeconds: 4.25, endSeconds: 6.25, text: "Nuovo sottotitolo", manual: true }] }); });
  it("salva, divide ed elimina i fonemi di Teddy Sing", () => {
    const store = useProjectStore.getState();
    store.setTeddySingPhonemes([{ id: "phoneme-a", startSeconds: .2, endSeconds: .9, viseme: "A", confidence: .84, manual: false }]);
    useProjectStore.getState().splitTeddySingPhoneme("phoneme-a", .55);
    let cues = useProjectStore.getState().project.animation.teddySing.phonemeCues;
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ id: "phoneme-a", startSeconds: .2, endSeconds: .55, manual: true });
    expect(cues[1]).toMatchObject({ startSeconds: .55, endSeconds: .9, manual: true });
    useProjectStore.getState().deleteTeddySingPhoneme(cues[1]?.id ?? "");
    cues = useProjectStore.getState().project.animation.teddySing.phonemeCues;
    expect(cues).toHaveLength(1);
    expect(useProjectStore.getState().project.animation.teddySing.phonemesGenerated).toBe(true);
  });
});

describe("Video Editor · montaggio nello store", () => {
  beforeEach(() => useProjectStore.getState().newProject());

  const videoAsset = { id: "media-video", name: "ripresa.mp4", kind: "video" as const, url: "blob:video", durationSeconds: 12, width: 1920, height: 1080, hasAudio: true, bpm: null, beats: [] as number[], downbeats: [] as number[], waveform: [] as number[] };
  const imageAsset = { ...videoAsset, id: "media-image", name: "foto.png", kind: "image" as const, url: "blob:image", durationSeconds: 0, hasAudio: false };
  const audioAsset = { ...videoAsset, id: "media-audio", name: "musica.wav", kind: "audio" as const, url: "blob:audio", durationSeconds: 30 };
  const editor = () => useProjectStore.getState().project.animation.videoEditor;

  it("aggiunge i media al pool una sola volta e li rimuove con le clip collegate", () => {
    const store = useProjectStore.getState();
    store.addVideoEditorAssets([videoAsset, imageAsset]);
    useProjectStore.getState().addVideoEditorAssets([videoAsset]);
    expect(editor().assets.map((asset) => asset.id)).toEqual(["media-video", "media-image"]);
    const clipId = useProjectStore.getState().addVideoEditorClip("media-video");
    expect(clipId).toBeTruthy();
    expect(editor().selectedClipIds).toEqual([clipId]);
    useProjectStore.getState().removeVideoEditorAsset("media-video");
    expect(editor().assets.map((asset) => asset.id)).toEqual(["media-image"]);
    // Nessuna clip può sopravvivere al proprio media, nemmeno nella selezione.
    expect(editor().clips).toHaveLength(0);
    expect(editor().selectedClipIds).toEqual([]);
  });

  it("mette in coda ogni nuova clip e rifiuta un media assente dal pool", () => {
    const store = useProjectStore.getState();
    store.addVideoEditorAssets([videoAsset]);
    useProjectStore.getState().addVideoEditorClip("media-video");
    useProjectStore.getState().addVideoEditorClip("media-video");
    const clips = editor().clips;
    expect(clips).toHaveLength(2);
    expect(clips[0]?.startSeconds).toBe(0);
    expect(clips[0]?.durationSeconds).toBe(12);
    // La seconda clip attacca dove finisce la prima: nessun vuoto, nessuna sovrapposizione.
    expect(clips[1]?.startSeconds).toBe(12);
    expect(useProjectStore.getState().addVideoEditorClip("assente")).toBeNull();
  });

  it("imposta il formato dal primo clip visivo, anche se il pool conteneva già media", () => {
    const portrait = { ...videoAsset, id: "portrait", width: 1080, height: 1920 };
    const landscape = { ...videoAsset, id: "landscape", width: 1920, height: 1080 };
    useProjectStore.getState().addVideoEditorAssets([landscape, portrait]);
    useProjectStore.getState().addVideoEditorClip("portrait");
    expect(editor()).toMatchObject({ outputWidth: 1080, outputHeight: 1920 });
    useProjectStore.getState().addVideoEditorClip("landscape");
    expect(editor()).toMatchObject({ outputWidth: 1080, outputHeight: 1920 });
  });

  it("manda l’audio sulla traccia audio e nega lo spostamento su una traccia del tipo sbagliato", () => {
    const store = useProjectStore.getState();
    store.addVideoEditorAssets([audioAsset]);
    const clipId = useProjectStore.getState().addVideoEditorClip("media-audio")!;
    expect(editor().clips[0]?.trackId).toBe("video-editor-track-audio");
    useProjectStore.getState().moveVideoEditorClipToTrack(clipId, "video-editor-track-main");
    expect(editor().clips[0]?.trackId).toBe("video-editor-track-audio");
  });

  it("estende un fermo immagine e limita un video al materiale disponibile", () => {
    const store = useProjectStore.getState();
    store.addVideoEditorAssets([videoAsset, imageAsset]);
    useProjectStore.getState().updateVideoEditor({ snapEnabled: false });
    const imageClip = useProjectStore.getState().addVideoEditorClip("media-image")!;
    expect(editor().clips.find((clip) => clip.id === imageClip)).toMatchObject({ durationSeconds: 4, sourceInSeconds: 0, fit: "contain" });
    useProjectStore.getState().trimVideoEditorClip(imageClip, "end", 45);
    expect(editor().clips.find((clip) => clip.id === imageClip)?.durationSeconds).toBe(45);

    const videoClip = useProjectStore.getState().addVideoEditorClip("media-video")!;
    const start = editor().clips.find((clip) => clip.id === videoClip)!.startSeconds;
    useProjectStore.getState().trimVideoEditorClip(videoClip, "end", start + 90);
    // Il video non può crescere oltre i 12 s di materiale, nemmeno trascinando lontano.
    expect(editor().clips.find((clip) => clip.id === videoClip)?.durationSeconds).toBe(12);
  });

  it("taglia una clip in due metà contigue e seleziona la seconda", () => {
    const store = useProjectStore.getState();
    store.addVideoEditorAssets([videoAsset]);
    const clipId = useProjectStore.getState().addVideoEditorClip("media-video")!;
    useProjectStore.getState().splitVideoEditorClip(clipId, 5);
    const clips = editor().clips;
    expect(clips).toHaveLength(2);
    expect(clips[0]).toMatchObject({ id: clipId, startSeconds: 0, durationSeconds: 5, sourceInSeconds: 0 });
    expect(clips[1]).toMatchObject({ startSeconds: 5, durationSeconds: 7, sourceInSeconds: 5 });
    expect(editor().selectedClipIds).toEqual([clips[1]?.id]);
    // Un taglio sul bordo non produce una clip di durata nulla.
    useProjectStore.getState().splitVideoEditorClip(clipId, 0);
    expect(editor().clips).toHaveLength(2);
  });

  it("duplica la clip subito dopo l’originale e cancella una selezione multipla", () => {
    const store = useProjectStore.getState();
    store.addVideoEditorAssets([videoAsset]);
    const clipId = useProjectStore.getState().addVideoEditorClip("media-video")!;
    useProjectStore.getState().duplicateVideoEditorClip(clipId);
    expect(editor().clips[1]?.startSeconds).toBe(12);
    const ids = editor().clips.map((clip) => clip.id);
    useProjectStore.getState().selectVideoEditorClips(ids);
    useProjectStore.getState().deleteVideoEditorClips(ids);
    expect(editor().clips).toHaveLength(0);
    expect(editor().selectedClipIds).toEqual([]);
  });

  it("gestisce la selezione additiva della timeline", () => {
    const store = useProjectStore.getState();
    store.addVideoEditorAssets([videoAsset]);
    const first = useProjectStore.getState().addVideoEditorClip("media-video")!;
    const second = useProjectStore.getState().addVideoEditorClip("media-video")!;
    useProjectStore.getState().selectVideoEditorClip(first);
    useProjectStore.getState().selectVideoEditorClip(second, true);
    expect(editor().selectedClipIds).toEqual([first, second]);
    // Un secondo clic additivo toglie la clip dalla selezione.
    useProjectStore.getState().selectVideoEditorClip(second, true);
    expect(editor().selectedClipIds).toEqual([first]);
    useProjectStore.getState().selectVideoEditorClip(null);
    expect(editor().selectedClipIds).toEqual([]);
  });

  it("gestisce Fade In/Out come elementi autonomi e li mantiene legati alla clip", () => {
    useProjectStore.getState().addVideoEditorAssets([videoAsset]);
    const clipId = useProjectStore.getState().addVideoEditorClip("media-video")!;
    const fadeInId = useProjectStore.getState().addVideoEditorEffectClip("fade-in", { targetClipId: clipId })!;
    const fadeOutId = useProjectStore.getState().addVideoEditorEffectClip("fade-out", { targetClipId: clipId })!;
    expect(editor().effectClips).toHaveLength(2);
    expect(editor().selectedClipIds).toEqual([]);
    expect(editor().selectedEffectClipIds).toEqual([fadeOutId]);
    useProjectStore.getState().moveVideoEditorEffectClip(fadeInId, 3);
    expect(editor().effectClips.find((effect) => effect.id === fadeInId)?.startSeconds).toBe(3);
    useProjectStore.getState().trimVideoEditorEffectClip(fadeInId, "end", 5);
    expect(editor().effectClips.find((effect) => effect.id === fadeInId)?.durationSeconds).toBe(2);
    useProjectStore.getState().moveVideoEditorClip(clipId, 4);
    expect(editor().effectClips.find((effect) => effect.id === fadeInId)?.startSeconds).toBe(7);
    expect(editor().effectClips.find((effect) => effect.id === fadeOutId)?.startSeconds).toBeCloseTo(15.35, 10);
    useProjectStore.getState().deleteVideoEditorClips([clipId]);
    expect(editor().effectClips).toEqual([]);
    expect(editor().selectedEffectClipIds).toEqual([]);
  });

  it("consente più istanze indipendenti dello stesso effetto sulla stessa clip", () => {
    useProjectStore.getState().addVideoEditorAssets([videoAsset]);
    const clipId = useProjectStore.getState().addVideoEditorClip("media-video")!;
    const first = useProjectStore.getState().addVideoEditorEffectClip("fade-in", { targetClipId: clipId });
    const second = useProjectStore.getState().addVideoEditorEffectClip("fade-in", { targetClipId: clipId, startSeconds: 3 });
    expect(first).not.toBeNull();
    expect(second).not.toBe(first);
    expect(editor().effectClips).toHaveLength(2);
    expect(editor().effectClips.map((effect) => effect.startSeconds)).toEqual([0, 3]);
    expect(editor().selectedEffectClipIds).toEqual([second]);
  });

  it("accosta le clip con la calamita e chiude i vuoti residui", () => {
    const store = useProjectStore.getState();
    store.addVideoEditorAssets([videoAsset]);
    const first = useProjectStore.getState().addVideoEditorClip("media-video")!;
    const second = useProjectStore.getState().addVideoEditorClip("media-video")!;
    useProjectStore.getState().moveVideoEditorClip(second, 12.05);
    // La calamita azzera il vuoto invece di lasciare cinquanta millisecondi di nero.
    expect(editor().clips.find((clip) => clip.id === second)?.startSeconds).toBe(12);
    useProjectStore.getState().updateVideoEditor({ snapEnabled: false });
    useProjectStore.getState().moveVideoEditorClip(second, 20);
    expect(editor().clips.find((clip) => clip.id === second)?.startSeconds).toBe(20);
    useProjectStore.getState().closeVideoEditorGaps("video-editor-track-main");
    expect(editor().clips.find((clip) => clip.id === second)?.startSeconds).toBe(12);
    expect(editor().clips.find((clip) => clip.id === first)?.startSeconds).toBe(0);
  });

  it("registra l’analisi ritmica e la usa per sincronizzare audio e video", () => {
    const store = useProjectStore.getState();
    store.addVideoEditorAssets([videoAsset, audioAsset]);
    useProjectStore.getState().setVideoEditorAssetAnalysis("media-audio", { bpm: 120, beats: [1, 2, 3, 4], downbeats: [1] });
    useProjectStore.getState().setVideoEditorAssetAnalysis("media-video", { bpm: 120, beats: [.5, 1.5, 2.5, 3.5], downbeats: [.5] });
    expect(editor().assets.find((asset) => asset.id === "media-audio")).toMatchObject({ bpm: 120, beats: [1, 2, 3, 4] });
    const reference = useProjectStore.getState().addVideoEditorClip("media-audio")!;
    const target = useProjectStore.getState().addVideoEditorClip("media-video")!;
    useProjectStore.getState().moveVideoEditorClip(target, 0);
    useProjectStore.getState().syncVideoEditorClips(reference, [target]);
    expect(editor().clips.find((clip) => clip.id === target)?.startSeconds).toBeCloseTo(.5, 6);
    expect(useProjectStore.getState().status).toMatch(/Sincronizzazione ritmica/);
  });

  it("limita le dissolvenze alla durata della clip", () => {
    const store = useProjectStore.getState();
    store.addVideoEditorAssets([videoAsset]);
    const clipId = useProjectStore.getState().addVideoEditorClip("media-video")!;
    useProjectStore.getState().updateVideoEditorClip(clipId, { fadeInSeconds: 20, fadeOutSeconds: 20, audioFadeInSeconds: 8, audioFadeOutSeconds: 8 });
    const clip = editor().clips[0]!;
    expect(clip.fadeInSeconds).toBe(12);
    expect(clip.fadeOutSeconds).toBe(0);
    expect(clip.audioFadeInSeconds).toBe(8);
    expect(clip.audioFadeOutSeconds).toBe(4);
    // Insieme non superano mai la clip: lo schema rifiuterebbe il progetto.
    expect(clip.fadeInSeconds + clip.fadeOutSeconds).toBeLessThanOrEqual(clip.durationSeconds);
    expect(clip.audioFadeInSeconds + clip.audioFadeOutSeconds).toBeLessThanOrEqual(clip.durationSeconds);
  });

  it("regola fusione, volume e correzione colore per clip", () => {
    const store = useProjectStore.getState();
    store.addVideoEditorAssets([videoAsset]);
    const clipId = useProjectStore.getState().addVideoEditorClip("media-video")!;
    useProjectStore.getState().updateVideoEditorClip(clipId, { blendMode: "soft-light", blendIntensity: .4, volume: 1.6, muted: false, fit: "contain" });
    useProjectStore.getState().updateVideoEditorClipAdjustments(clipId, { exposure: .6, contrast: 22, temperature: -18 });
    expect(editor().clips[0]).toMatchObject({ blendMode: "soft-light", blendIntensity: .4, volume: 1.6, fit: "contain" });
    expect(editor().clips[0]?.adjustments).toMatchObject({ exposure: .6, contrast: 22, temperature: -18, saturation: 0 });
  });

  it("aggiunge tracce nella posizione attesa e non svuota mai il montaggio", () => {
    const store = useProjectStore.getState();
    store.addVideoEditorTrack("video");
    expect(editor().tracks[0]?.name).toBe("Livello video 3");
    useProjectStore.getState().addVideoEditorTrack("audio");
    expect(editor().tracks.at(-1)?.name).toBe("Audio 2");
    useProjectStore.getState().updateVideoEditorTrack("video-editor-track-main", { muted: true, hidden: true, locked: true, volume: .4 });
    expect(editor().tracks.find((track) => track.id === "video-editor-track-main")).toMatchObject({ muted: true, hidden: true, locked: true, volume: .4 });
    for (const track of [...editor().tracks]) useProjectStore.getState().removeVideoEditorTrack(track.id);
    // L’ultima traccia resta: uno schema senza tracce non è valido.
    expect(editor().tracks).toHaveLength(1);
  });

  it("riordina liberamente i livelli video senza cambiare proprietà o clip", () => {
    useProjectStore.getState().addVideoEditorAssets([videoAsset]);
    const clipId = useProjectStore.getState().addVideoEditorClip("media-video", { trackId: "video-editor-track-main" })!;
    useProjectStore.getState().updateVideoEditorClip(clipId, { blendMode: "screen", transform: { x: .2, y: -.1, scale: .7, rotation: 12 } });
    useProjectStore.getState().updateVideoEditorClipAdjustments(clipId, { opacity: .55 });
    useProjectStore.getState().reorderVideoEditorTrack("video-editor-track-main", 0);
    expect(editor().tracks[0]?.id).toBe("video-editor-track-main");
    expect(editor().clips.find((clip) => clip.id === clipId)).toMatchObject({
      trackId: "video-editor-track-main", blendMode: "screen",
      transform: { x: .2, y: -.1, scale: .7, rotation: 12 }, adjustments: { opacity: .55 }
    });
    useProjectStore.getState().updateVideoEditorTrack("video-editor-track-main", { locked: true });
    useProjectStore.getState().reorderVideoEditorTrack("video-editor-track-main", 2);
    expect(editor().tracks[0]?.id).toBe("video-editor-track-main");
  });

  it("elimina una traccia insieme alle sue clip", () => {
    const store = useProjectStore.getState();
    store.addVideoEditorAssets([videoAsset]);
    const clipId = useProjectStore.getState().addVideoEditorClip("media-video", { trackId: "video-editor-track-main" })!;
    useProjectStore.getState().selectVideoEditorClip(clipId);
    useProjectStore.getState().removeVideoEditorTrack("video-editor-track-main");
    expect(editor().tracks.some((track) => track.id === "video-editor-track-main")).toBe(false);
    expect(editor().clips).toHaveLength(0);
    expect(editor().selectedClipIds).toEqual([]);
  });

  it("conserva la composizione e i parametri di interpolazione scelti", () => {
    useProjectStore.getState().updateVideoEditor({ outputWidth: 3840, outputHeight: 2160, snapThresholdSeconds: .12, snapToBeats: false, backgroundColor: "#101820", interpolationEnabled: true, interpolationTargetFps: 120, interpolationMethod: "rife" });
    expect(editor()).toMatchObject({ outputWidth: 3840, outputHeight: 2160, snapThresholdSeconds: .12, snapToBeats: false, backgroundColor: "#101820", interpolationEnabled: true, interpolationTargetFps: 120, interpolationMethod: "rife" });
    expect(useProjectStore.getState().dirty).toBe(true);
  });
});
