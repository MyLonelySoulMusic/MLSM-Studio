import { describe, expect, it } from "vitest";
import { createProject } from "@rbs/project-schema";
import {
  videoEditorAppendPlacement,
  videoEditorAspectLabel,
  videoEditorAudibleClips,
  videoEditorBlendModeLabel,
  videoEditorClipEnd,
  videoEditorClipGain,
  videoEditorClipMaximumDuration,
  videoEditorClipOpacity,
  videoEditorCloseGaps,
  videoEditorCompositionForAsset,
  videoEditorDefaultImageSeconds,
  videoEditorMaximumImageSeconds,
  videoEditorMinimumClipSeconds,
  videoEditorMoveClip,
  videoEditorReorderTracks,
  videoEditorSnap,
  videoEditorSnapCandidates,
  videoEditorSourceTime,
  videoEditorSplitClip,
  videoEditorSyncClips,
  videoEditorTimelineDuration,
  videoEditorTrimClip,
  videoEditorVisibleLayers,
  videoEditorAlignClipsByFrame,
  videoEditorFrameAlignmentReason,
  videoEditorFormatTimecode,
  videoEditorFrameToSeconds,
  videoEditorSecondsToFrame,
  type VideoEditorAsset,
  type VideoEditorClip,
  type VideoEditorSettings
} from "./video-editor";
import { videoEditorSpeedAtFrame } from "./video-editor-speed";

const baseSettings = createProject("Montaggio").animation.videoEditor;

function asset(overrides: Partial<VideoEditorAsset> & { id: string }): VideoEditorAsset {
  return {
    name: overrides.id, kind: "video", url: `blob:${overrides.id}`, durationSeconds: 10,
    width: 1920, height: 1080, hasAudio: false, bpm: null, beats: [], downbeats: [], waveform: [],
    ...overrides
  };
}

function clip(overrides: Partial<VideoEditorClip> & { id: string; assetId: string; trackId: string }): VideoEditorClip {
  return {
    startSeconds: 0, durationSeconds: 2, sourceInSeconds: 0,
    fadeInSeconds: 0, fadeOutSeconds: 0, fadeCurve: "smooth", audioFadeInSeconds: 0, audioFadeOutSeconds: 0,
    blendMode: "normal", blendIntensity: 1,
    adjustments: { exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, clarity: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0, sharpness: 0, denoise: 0, blur: 0, grayscale: 0, sepia: 0, fade: 0, vignette: 0, opacity: 1 },
    fit: "cover", muted: false, volume: 1,
    ...overrides
  };
}

function settings(assets: VideoEditorAsset[], clips: VideoEditorClip[], overrides: Partial<VideoEditorSettings> = {}): VideoEditorSettings {
  return { ...baseSettings, assets, clips, ...overrides };
}

const mainTrack = "video-editor-track-main";
const overlayTrack = "video-editor-track-overlay";
const audioTrack = "video-editor-track-audio";

describe("Video Editor · durata e riferimenti della timeline", () => {
  it("misura la timeline sul bordo destro della clip più lontana", () => {
    const state = settings([asset({ id: "a" })], [
      clip({ id: "c1", assetId: "a", trackId: mainTrack, startSeconds: 0, durationSeconds: 3 }),
      clip({ id: "c2", assetId: "a", trackId: overlayTrack, startSeconds: 4.5, durationSeconds: 1.25 })
    ]);
    expect(videoEditorClipEnd(state.clips[1]!)).toBeCloseTo(5.75, 10);
    expect(videoEditorTimelineDuration(state)).toBeCloseTo(5.75, 10);
    expect(videoEditorTimelineDuration(baseSettings)).toBe(0);
  });

  it("limita video e audio al materiale disponibile e lascia crescere le immagini", () => {
    const video = asset({ id: "v", durationSeconds: 10 });
    const still = asset({ id: "i", kind: "image", durationSeconds: 0 });
    const videoClip = clip({ id: "cv", assetId: "v", trackId: mainTrack, sourceInSeconds: 4 });
    const imageClip = clip({ id: "ci", assetId: "i", trackId: mainTrack });
    expect(videoEditorClipMaximumDuration(videoClip, video)).toBeCloseTo(6, 10);
    expect(videoEditorClipMaximumDuration(imageClip, still)).toBe(videoEditorMaximumImageSeconds);
    const longVideo = asset({ id: "long", durationSeconds: 5_400 });
    expect(videoEditorClipMaximumDuration(clip({ id: "cl", assetId: "long", trackId: mainTrack }), longVideo)).toBe(5_400);
  });
});

describe("Video Editor · timebase e allineamento esatto", () => {
  it("converte secondi e frame sulla timebase legacy 60/1", () => {
    expect(videoEditorSecondsToFrame(1 / 60, baseSettings.timebase, "round")).toBe(1);
    expect(videoEditorFrameToSeconds(120, baseSettings.timebase)).toBe(2);
    expect(videoEditorFormatTimecode(125, baseSettings.timebase)).toBe("00:00:02:05");
  });

  it("formatta correttamente i confini drop-frame 29.97 e 59.94", () => {
    expect(videoEditorFormatTimecode(1_800, { fpsNumerator: 30_000, fpsDenominator: 1_001, dropFrame: true })).toBe("00:01:00;02");
    expect(videoEditorFormatTimecode(17_982, { fpsNumerator: 30_000, fpsDenominator: 1_001, dropFrame: true })).toBe("00:10:00;00");
    expect(videoEditorFormatTimecode(3_600, { fpsNumerator: 60_000, fpsDenominator: 1_001, dropFrame: true })).toBe("00:01:00;04");
  });

  it("allinea clip con stesso frame count usando l'ordinale sorgente", () => {
    const first = asset({ id: "first", durationSeconds: 4, sourceFrameCount: 240, sourceRate: { numerator: 60, denominator: 1 }, frameIdentityId: "same" });
    const second = asset({ id: "second", durationSeconds: 4, sourceFrameCount: 240, sourceRate: { numerator: 60, denominator: 1 }, frameIdentityId: "same" });
    const state = settings([first, second], [
      clip({ id: "reference", assetId: first.id, trackId: mainTrack, startSeconds: 2, sourceInSeconds: 1 / 60 }),
      clip({ id: "target", assetId: second.id, trackId: overlayTrack, startSeconds: 8, sourceInSeconds: 2 / 60 })
    ]);
    const result = videoEditorAlignClipsByFrame(state, "reference", ["target"]);
    expect(result?.alignedClipIds).toEqual(["target"]);
    expect(result?.clips.find((item) => item.id === "target")?.startSeconds).toBeCloseTo(2 + 1 / 60, 5);
  });

  it("rifiuta allineamento quando il numero di frame sorgente non coincide", () => {
    const first = asset({ id: "first", sourceFrameCount: 240 });
    const second = asset({ id: "second", sourceFrameCount: 239 });
    const state = settings([first, second], [clip({ id: "reference", assetId: first.id, trackId: mainTrack }), clip({ id: "target", assetId: second.id, trackId: overlayTrack })]);
    expect(videoEditorAlignClipsByFrame(state, "reference", ["target"])).toBeNull();
  });

  it("rifiuta di dichiarare esatto un riferimento con fase sub-frame", () => {
    const first = asset({ id: "first", sourceFrameCount: 240, sourceRate: { numerator: 60, denominator: 1 } });
    const second = asset({ id: "second", sourceFrameCount: 240, sourceRate: { numerator: 60, denominator: 1 } });
    const state = settings([first, second], [clip({ id: "reference", assetId: first.id, trackId: mainTrack, startSeconds: .001 }), clip({ id: "target", assetId: second.id, trackId: overlayTrack })]);
    expect(videoEditorFrameAlignmentReason(state, "reference", ["target"])).toMatch(/griglia frame/);
    expect(videoEditorAlignClipsByFrame(state, "reference", ["target"])).toBeNull();
  });
});

describe("Video Editor · composizione aderente al media", () => {
  it("riconosce un video verticale e conserva le dimensioni della sorgente", () => {
    expect(videoEditorCompositionForAsset(asset({ id: "portrait", width: 1080, height: 1920 }))).toEqual({ width: 1080, height: 1920, label: "9:16" });
    expect(videoEditorAspectLabel(1080, 1920)).toBe("9:16");
  });

  it("non forza nel 16:9 i rapporti non standard e ignora l'audio", () => {
    expect(videoEditorCompositionForAsset(asset({ id: "cinema", width: 2048, height: 858 }))).toEqual({ width: 2048, height: 858, label: "2048:858" });
    expect(videoEditorCompositionForAsset(asset({ id: "audio", kind: "audio", width: 0, height: 0 }))).toBeNull();
  });
});

describe("Video Editor · calamita", () => {
  it("raccoglie bordi, playhead, origine e battute escludendo la clip trascinata", () => {
    const state = settings(
      [asset({ id: "a", beats: [0, .5, 1] })],
      [
        clip({ id: "dragged", assetId: "a", trackId: mainTrack, startSeconds: 6, durationSeconds: 2 }),
        clip({ id: "fixed", assetId: "a", trackId: overlayTrack, startSeconds: 2, durationSeconds: 1 })
      ]
    );
    const candidates = videoEditorSnapCandidates(state, { excludeClipIds: ["dragged"], playheadSeconds: 4.25 });
    const times = candidates.map((candidate) => candidate.timeSeconds);
    expect(times).toContain(0);
    expect(times).toContain(2);
    expect(times).toContain(3);
    expect(times).toContain(4.25);
    // I bordi della clip trascinata non devono attirarla su se stessa.
    expect(times).not.toContain(6);
    expect(times).not.toContain(8);
    // Le battute sono riportate sul tempo di timeline della clip che le porta.
    expect(candidates.filter((candidate) => candidate.reason === "beat").map((candidate) => candidate.timeSeconds)).toEqual([2, 2.5, 3]);
  });

  it("ignora le battute quando l’aggancio ritmico è disattivato", () => {
    const state = settings([asset({ id: "a", beats: [0, .5] })], [clip({ id: "c", assetId: "a", trackId: mainTrack, durationSeconds: 2 })], { snapToBeats: false });
    expect(videoEditorSnapCandidates(state).some((candidate) => candidate.reason === "beat")).toBe(false);
  });

  it("aggancia solo entro la soglia e riporta il motivo", () => {
    const candidates = [{ timeSeconds: 3, reason: "clipEdge" as const }, { timeSeconds: 5, reason: "playhead" as const }];
    expect(videoEditorSnap(2.95, candidates, .08)).toEqual({ timeSeconds: 3, snapped: true, reason: "clipEdge" });
    expect(videoEditorSnap(4.98, candidates, .08)).toEqual({ timeSeconds: 5, snapped: true, reason: "playhead" });
    expect(videoEditorSnap(4, candidates, .08)).toEqual({ timeSeconds: 4, snapped: false, reason: "none" });
  });

  it("accosta due clip senza lasciare un vuoto al centro", () => {
    const state = settings([asset({ id: "a" })], [
      clip({ id: "left", assetId: "a", trackId: mainTrack, startSeconds: 0, durationSeconds: 3 }),
      clip({ id: "right", assetId: "a", trackId: mainTrack, startSeconds: 3.06, durationSeconds: 2 })
    ]);
    const moved = videoEditorMoveClip(state, "right", 3.06);
    expect(moved?.startSeconds).toBe(3);
    expect(moved?.durationSeconds).toBe(2);
    // Il vuoto è esattamente zero, non "quasi zero".
    expect(moved!.startSeconds - videoEditorClipEnd(state.clips[0]!)).toBe(0);
  });

  it("aggancia anche la coda della clip trascinata al bordo che la precede", () => {
    const state = settings([asset({ id: "a" })], [
      clip({ id: "fixed", assetId: "a", trackId: mainTrack, startSeconds: 5, durationSeconds: 3 }),
      clip({ id: "dragged", assetId: "a", trackId: overlayTrack, startSeconds: 0, durationSeconds: 2 })
    ]);
    // La testa cade lontana da ogni candidato, ma la coda tocca l’attacco della clip fissa.
    const moved = videoEditorMoveClip(state, "dragged", 2.97);
    expect(moved?.startSeconds).toBe(3);
    expect(videoEditorClipEnd(moved!)).toBe(5);
  });

  it("non aggancia nulla quando la calamita è disattivata e non scende sotto zero", () => {
    const state = settings([asset({ id: "a" })], [
      clip({ id: "left", assetId: "a", trackId: mainTrack, startSeconds: 0, durationSeconds: 3 }),
      clip({ id: "right", assetId: "a", trackId: mainTrack, startSeconds: 3.06, durationSeconds: 2 })
    ], { snapEnabled: false });
    expect(videoEditorMoveClip(state, "right", 3.06)?.startSeconds).toBe(3.06);
    expect(videoEditorMoveClip(state, "right", .010)?.startSeconds).toBe(.010);
    expect(videoEditorMoveClip(state, "right", -4)?.startSeconds).toBe(0);
    expect(videoEditorMoveClip(state, "assente", 1)).toBeNull();
  });
});

describe("Video Editor · estensione trascinando i bordi", () => {
  const state = settings(
    [asset({ id: "v", durationSeconds: 10 }), asset({ id: "i", kind: "image", durationSeconds: 0 })],
    [
      clip({ id: "video", assetId: "v", trackId: mainTrack, startSeconds: 2, durationSeconds: 3, sourceInSeconds: 1 }),
      clip({ id: "image", assetId: "i", trackId: overlayTrack, startSeconds: 20, durationSeconds: videoEditorDefaultImageSeconds })
    ],
    { snapEnabled: false }
  );

  it("sul bordo sinistro muove insieme attacco e punto di sorgente", () => {
    const trimmed = videoEditorTrimClip(state, "video", "start", 2.5);
    expect(trimmed?.startSeconds).toBe(2.5);
    expect(trimmed?.durationSeconds).toBeCloseTo(2.5, 10);
    // Lo stesso fotogramma resta sotto il cursore: +.5 s di timeline, +.5 s di sorgente.
    expect(trimmed?.sourceInSeconds).toBeCloseTo(1.5, 10);
  });

  it("non lascia consumare più materiale di quello disponibile a monte", () => {
    const trimmed = videoEditorTrimClip(state, "video", "start", 0);
    expect(trimmed?.startSeconds).toBe(1);
    expect(trimmed?.sourceInSeconds).toBe(0);
    expect(videoEditorClipEnd(trimmed!)).toBe(5);
  });

  it("sul bordo destro si ferma dove finisce il video sorgente", () => {
    const trimmed = videoEditorTrimClip(state, "video", "end", 60);
    // 10 s di sorgente meno 1 s di attacco: la clip può arrivare a 9 s.
    expect(trimmed?.durationSeconds).toBeCloseTo(9, 10);
    expect(trimmed?.sourceInSeconds).toBe(1);
  });

  it("rifila entrambi i bordi inversi preservando il fotogramma sul bordo opposto", () => {
    const reversed = clip({ id: "reverse-trim", assetId: "v", trackId: mainTrack, startSeconds: 2, durationSeconds: 3, sourceInSeconds: 1, reversed: true });
    const reverseState = settings(state.assets, [reversed], { snapEnabled: false });
    const trimmedStart = videoEditorTrimClip(reverseState, reversed.id, "start", 2.5)!;
    const trimmedEnd = videoEditorTrimClip(reverseState, reversed.id, "end", 4.5)!;

    expect(trimmedStart.sourceInSeconds).toBe(1);
    expect(videoEditorSourceTime(trimmedStart, trimmedStart.startSeconds)).toBeCloseTo(videoEditorSourceTime(reversed, 2.5), 10);
    expect(trimmedEnd.sourceInSeconds).toBeCloseTo(1.5, 10);
    expect(videoEditorSourceTime(trimmedEnd, trimmedEnd.startSeconds)).toBeCloseTo(videoEditorSourceTime(reversed, reversed.startSeconds), 10);
    expect(videoEditorSourceTime(trimmedEnd, videoEditorClipEnd(trimmedEnd))).toBeCloseTo(1.5, 10);
  });

  it("estende un fermo immagine ben oltre la durata di ingresso, in entrambe le direzioni", () => {
    expect(videoEditorTrimClip(state, "image", "end", 120)?.durationSeconds).toBeCloseTo(100, 10);
    const extended = videoEditorTrimClip(state, "image", "start", 5);
    expect(extended?.startSeconds).toBe(5);
    expect(extended?.durationSeconds).toBeCloseTo(19, 10);
    // Un fermo immagine non ha punto di attacco da spostare.
    expect(extended?.sourceInSeconds).toBe(0);
  });

  it("mantiene la clip sopra la durata minima su entrambi i bordi", () => {
    // Le posizioni sono arrotondate al microsecondo: la durata minima resta due fotogrammi.
    expect(videoEditorTrimClip(state, "video", "start", 99)?.durationSeconds).toBeCloseTo(videoEditorMinimumClipSeconds, 6);
    expect(videoEditorTrimClip(state, "video", "end", 0)?.durationSeconds).toBeCloseTo(videoEditorMinimumClipSeconds, 6);
  });

  it("applica la calamita al bordo trascinato quando è attiva", () => {
    const magnetic = settings(state.assets, state.clips, { snapEnabled: true, snapToBeats: false });
    // Il bordo destro cade a 4.97 s ma l’attacco della clip immagine non è vicino:
    // il candidato più prossimo è l’origine della clip video stessa, esclusa. Resta il valore chiesto.
    expect(videoEditorTrimClip(magnetic, "video", "end", 4.97)?.durationSeconds).toBeCloseTo(2.97, 10);
    // Con una clip vicina, il bordo si allinea esattamente.
    const neighbour = settings(state.assets, [...state.clips, clip({ id: "next", assetId: "v", trackId: overlayTrack, startSeconds: 5.02, durationSeconds: 1 })], { snapEnabled: true, snapToBeats: false });
    expect(videoEditorClipEnd(videoEditorTrimClip(neighbour, "video", "end", 4.98)!)).toBe(5.02);
  });

  it("conserva un trim sub-frame nel mapping locale della rampa", () => {
    const ramp = clip({
      id: "ramp", assetId: "v", trackId: mainTrack, startSeconds: .010, durationSeconds: 1.01,
      speed: { mode: "ramp", constant: 1, preservePitch: false, points: [
        { id: "a", frame: 0, speed: 1, curve: "linear" },
        { id: "b", frame: 60, speed: 2, curve: "linear" }
      ] }
    });
    const rampState = settings(state.assets, [ramp], { snapEnabled: false });
    const requestedStart = .020;
    const sourceAtCut = videoEditorSourceTime(ramp, requestedStart, rampState.timebase);
    const trimmed = videoEditorTrimClip(rampState, ramp.id, "start", requestedStart)!;
    expect(trimmed.startSeconds).toBe(requestedStart);
    expect(trimmed.sourceInSeconds).toBeCloseTo(sourceAtCut, 6);
    expect(trimmed.speed?.points[0]?.frame).toBe(0);
    expect(trimmed.speed?.points.find((point) => point.id === "b")?.frame).toBeCloseTo(59.4, 10);
    expect(trimmed.speed?.points.at(-1)?.frame).toBeCloseTo(60, 10);
    expect(videoEditorSpeedAtFrame(trimmed.speed, 10.2)).toBeCloseTo(videoEditorSpeedAtFrame(ramp.speed, 10.8), 10);
    expect(videoEditorSourceTime(trimmed, trimmed.startSeconds, rampState.timebase)).toBeCloseTo(sourceAtCut, 6);
  });
});

describe("Video Editor · taglio", () => {
  it("divide la clip conservando materiale e dissolvenze sui lati giusti", () => {
    const source = clip({ id: "c", assetId: "a", trackId: mainTrack, startSeconds: 2, durationSeconds: 6, sourceInSeconds: 1, fadeInSeconds: .5, fadeOutSeconds: .75, audioFadeInSeconds: .4, audioFadeOutSeconds: .6 });
    const halves = videoEditorSplitClip(source, 5, "nuovo");
    expect(halves).not.toBeNull();
    const [left, right] = halves!;
    expect(left.id).toBe("c");
    expect(left.durationSeconds).toBe(3);
    expect(left.fadeInSeconds).toBe(.5);
    expect(left.fadeOutSeconds).toBe(0);
    expect(left.audioFadeOutSeconds).toBe(0);
    expect(right.id).toBe("nuovo");
    expect(right.startSeconds).toBe(5);
    expect(right.durationSeconds).toBe(3);
    // Il taglio non salta materiale: la seconda metà riprende dove finisce la prima.
    expect(right.sourceInSeconds).toBe(4);
    expect(right.fadeInSeconds).toBe(0);
    expect(right.fadeOutSeconds).toBe(.75);
    expect(right.audioFadeInSeconds).toBe(0);
    expect(left.durationSeconds + right.durationSeconds).toBe(source.durationSeconds);
  });

  it("divide una clip inversa senza saltare o duplicare il materiale", () => {
    const source = clip({ id: "reverse", assetId: "a", trackId: mainTrack, startSeconds: 2, durationSeconds: 6, sourceInSeconds: 1, reversed: true });
    const [left, right] = videoEditorSplitClip(source, 5, "reverse-right")!;

    expect(videoEditorSourceTime(left, left.startSeconds)).toBeCloseTo(7, 10);
    expect(videoEditorSourceTime(left, videoEditorClipEnd(left))).toBeCloseTo(4, 10);
    expect(videoEditorSourceTime(right, right.startSeconds)).toBeCloseTo(4, 10);
    expect(videoEditorSourceTime(right, videoEditorClipEnd(right))).toBeCloseTo(1, 10);
    expect(left.sourceInSeconds).toBe(4);
    expect(right.sourceInSeconds).toBe(1);
  });

  it("accorcia una dissolvenza che non entra nella metà che la eredita", () => {
    const source = clip({ id: "c", assetId: "a", trackId: mainTrack, durationSeconds: 4, fadeInSeconds: 3, fadeOutSeconds: 3, audioFadeInSeconds: 3, audioFadeOutSeconds: 3 });
    const [left, right] = videoEditorSplitClip(source, 1, "nuovo")!;
    expect(left.fadeInSeconds).toBe(1);
    expect(left.audioFadeInSeconds).toBe(1);
    expect(right.fadeOutSeconds).toBe(3);
    expect(right.audioFadeOutSeconds).toBe(3);
  });

  it("rifiuta un taglio troppo vicino a un bordo", () => {
    const source = clip({ id: "c", assetId: "a", trackId: mainTrack, startSeconds: 1, durationSeconds: 2 });
    expect(videoEditorSplitClip(source, 1, "nuovo")).toBeNull();
    expect(videoEditorSplitClip(source, 3, "nuovo")).toBeNull();
    expect(videoEditorSplitClip(source, 1 + videoEditorMinimumClipSeconds / 2, "nuovo")).toBeNull();
    expect(videoEditorSplitClip(source, 2, "nuovo")).not.toBeNull();
  });
});

describe("Video Editor · chiusura dei vuoti", () => {
  it("impacchetta la traccia contro l’origine senza toccare le altre", () => {
    const clips = [
      clip({ id: "b", assetId: "a", trackId: mainTrack, startSeconds: 9, durationSeconds: 2 }),
      clip({ id: "a1", assetId: "a", trackId: mainTrack, startSeconds: 3, durationSeconds: 1.5 }),
      clip({ id: "altra", assetId: "a", trackId: overlayTrack, startSeconds: 7, durationSeconds: 1 })
    ];
    const closed = videoEditorCloseGaps(clips, mainTrack);
    expect(closed.find((item) => item.id === "a1")?.startSeconds).toBe(0);
    expect(closed.find((item) => item.id === "b")?.startSeconds).toBe(1.5);
    expect(closed.find((item) => item.id === "altra")?.startSeconds).toBe(7);
  });
});

describe("Video Editor · sincronizzazione audio/video come CapCut", () => {
  it("allinea le griglie ritmiche scegliendo lo scarto che fa combaciare più battute", () => {
    const state = settings(
      [
        asset({ id: "musica", kind: "audio", hasAudio: true, durationSeconds: 12, beats: [1, 2, 3, 4] }),
        asset({ id: "ripresa", durationSeconds: 12, hasAudio: true, beats: [.5, 1.5, 2.5, 3.5] })
      ],
      [
        clip({ id: "riferimento", assetId: "musica", trackId: audioTrack, startSeconds: 0, durationSeconds: 6 }),
        clip({ id: "video", assetId: "ripresa", trackId: mainTrack, startSeconds: 0, durationSeconds: 6 })
      ]
    );
    const result = videoEditorSyncClips(state, "riferimento", ["video"]);
    expect(result?.strategy).toBe("beatGrid");
    expect(result?.offsetSeconds).toBeCloseTo(.5, 10);
    expect(result?.matchedBeats).toBeGreaterThanOrEqual(3);
    expect(result?.clips.find((item) => item.id === "video")?.startSeconds).toBeCloseTo(.5, 10);
    // La clip di riferimento non si muove mai.
    expect(result?.clips.find((item) => item.id === "riferimento")?.startSeconds).toBe(0);
  });

  it("allinea gli attacchi quando manca una griglia ritmica analizzata", () => {
    const state = settings([asset({ id: "a" })], [
      clip({ id: "riferimento", assetId: "a", trackId: mainTrack, startSeconds: 2, durationSeconds: 3 }),
      clip({ id: "target", assetId: "a", trackId: overlayTrack, startSeconds: 5, durationSeconds: 3 })
    ]);
    const result = videoEditorSyncClips(state, "riferimento", ["target"]);
    expect(result?.strategy).toBe("clipStart");
    expect(result?.clips.find((item) => item.id === "target")?.startSeconds).toBe(2);
    expect(result?.offsetSeconds).toBe(-3);
  });

  it("non produce posizioni negative e ignora selezioni prive di bersagli", () => {
    const state = settings([asset({ id: "a" })], [
      clip({ id: "riferimento", assetId: "a", trackId: mainTrack, startSeconds: 0, durationSeconds: 2 }),
      clip({ id: "target", assetId: "a", trackId: overlayTrack, startSeconds: 4, durationSeconds: 2 })
    ]);
    expect(videoEditorSyncClips(state, "riferimento", ["target"])?.clips.find((item) => item.id === "target")?.startSeconds).toBe(0);
    expect(videoEditorSyncClips(state, "riferimento", ["riferimento"])).toBeNull();
    expect(videoEditorSyncClips(state, "assente", ["target"])).toBeNull();
  });
});

describe("Video Editor · dissolvenze professionali", () => {
  const faded = clip({ id: "c", assetId: "a", trackId: mainTrack, startSeconds: 1, durationSeconds: 4, fadeInSeconds: 1, fadeOutSeconds: 1 });

  it("parte da zero, arriva a uno e torna a zero", () => {
    expect(videoEditorClipOpacity(faded, 1)).toBe(0);
    expect(videoEditorClipOpacity(faded, 2)).toBe(1);
    expect(videoEditorClipOpacity(faded, 3)).toBe(1);
    expect(videoEditorClipOpacity(faded, 5)).toBe(0);
  });

  it("usa una smoothstep e non una rampa lineare", () => {
    // A metà dissolvenza smoothstep e rampa lineare coincidono: la differenza sta ai quarti.
    expect(videoEditorClipOpacity(faded, 1.5)).toBeCloseTo(.5, 10);
    expect(videoEditorClipOpacity(faded, 1.25)).toBeCloseTo(.15625, 10);
    const linear = videoEditorClipOpacity({ ...faded, fadeCurve: "linear" }, 1.25);
    expect(linear).toBeCloseTo(.25, 10);
    expect(videoEditorClipOpacity(faded, 1.25)).toBeLessThan(linear);
    expect(videoEditorClipOpacity({ ...faded, fadeCurve: "exponential" }, 1.5)).toBeCloseTo(Math.pow(.5, 2.2), 10);
  });

  it("moltiplica la dissolvenza per l’opacità manuale e azzera fuori dalla clip", () => {
    const half = { ...faded, adjustments: { ...faded.adjustments, opacity: .5 } };
    expect(videoEditorClipOpacity(half, 3)).toBe(.5);
    expect(videoEditorClipOpacity(half, 1.5)).toBeCloseTo(.25, 10);
    expect(videoEditorClipOpacity(faded, .5)).toBe(0);
    expect(videoEditorClipOpacity(faded, 5.5)).toBe(0);
  });
});

describe("Video Editor · volume e disattivazione audio", () => {
  const track = { id: audioTrack, name: "Audio", kind: "audio" as const, hidden: false, muted: false, locked: false, volume: 1 };
  const sounding = clip({ id: "c", assetId: "a", trackId: audioTrack, startSeconds: 0, durationSeconds: 4, volume: 1, audioFadeInSeconds: 1, audioFadeOutSeconds: 1 });

  it("silenzia la clip mutata e la traccia mutata", () => {
    expect(videoEditorClipGain({ ...sounding, muted: true }, track, 2)).toBe(0);
    expect(videoEditorClipGain(sounding, { ...track, muted: true }, 2)).toBe(0);
  });

  it("moltiplica volume di clip e di traccia fino al doppio", () => {
    expect(videoEditorClipGain({ ...sounding, volume: .5 }, track, 2)).toBe(.5);
    expect(videoEditorClipGain({ ...sounding, volume: 2 }, track, 2)).toBe(2);
    expect(videoEditorClipGain({ ...sounding, volume: 1.5 }, { ...track, volume: 1.5 }, 2)).toBe(2);
  });

  it("applica dissolvenze audio indipendenti da quelle video", () => {
    expect(videoEditorClipGain(sounding, track, 0)).toBe(0);
    expect(videoEditorClipGain(sounding, track, .5)).toBeCloseTo(.5, 10);
    expect(videoEditorClipGain(sounding, track, 4)).toBe(0);
    // La stessa clip senza dissolvenza video resta pienamente visibile mentre l’audio sale.
    expect(videoEditorClipOpacity(sounding, .5)).toBe(1);
  });
});

describe("Video Editor · composizione dei livelli", () => {
  it("riordina qualsiasi livello senza ruoli principale o overlay", () => {
    const reordered = videoEditorReorderTracks(baseSettings.tracks, mainTrack, 0);
    expect(reordered.map((track) => track.id)).toEqual([mainTrack, overlayTrack, audioTrack]);
    expect(videoEditorReorderTracks(reordered, audioTrack, 1).map((track) => track.id)).toEqual([mainTrack, audioTrack, overlayTrack]);
    expect(videoEditorReorderTracks(reordered, "assente", 0)).toEqual(reordered);
  });

  it("disegna dal fondo verso l’alto e salta tracce nascoste e livelli trasparenti", () => {
    const state = settings([asset({ id: "a" })], [
      clip({ id: "sopra", assetId: "a", trackId: overlayTrack, startSeconds: 0, durationSeconds: 4 }),
      clip({ id: "sotto", assetId: "a", trackId: mainTrack, startSeconds: 0, durationSeconds: 4 }),
      clip({ id: "invisibile", assetId: "a", trackId: mainTrack, startSeconds: 0, durationSeconds: 4, adjustments: { ...clip({ id: "x", assetId: "a", trackId: mainTrack }).adjustments, opacity: 0 } })
    ]);
    // Il primo livello in elenco viene disegnato per ultimo, qualunque sia il suo ID.
    expect(videoEditorVisibleLayers(state, 1).map((layer) => layer.clip.id)).toEqual(["sotto", "sopra"]);
    const hidden = settings(state.assets, state.clips, { tracks: state.tracks.map((item) => item.id === overlayTrack ? { ...item, hidden: true } : item) });
    expect(videoEditorVisibleLayers(hidden, 1).map((layer) => layer.clip.id)).toEqual(["sotto"]);
    expect(videoEditorVisibleLayers(state, 9)).toEqual([]);
  });

  it("al taglio esatto mostra solo la clip entrante e conserva l'ultimo frame a fine timeline", () => {
    const state = settings([asset({ id: "a" }), asset({ id: "b" })], [
      clip({ id: "uscente", assetId: "a", trackId: mainTrack, startSeconds: 0, durationSeconds: 2 }),
      clip({ id: "entrante", assetId: "b", trackId: mainTrack, startSeconds: 2, durationSeconds: 3 })
    ]);
    expect(videoEditorVisibleLayers(state, 2).map((layer) => layer.clip.id)).toEqual(["entrante"]);
    expect(videoEditorClipOpacity(state.clips[0]!, 2)).toBe(0);
    expect(videoEditorVisibleLayers(state, 5).map((layer) => layer.clip.id)).toEqual(["entrante"]);
    expect(videoEditorVisibleLayers(state, 5)[0]?.sourceTimeSeconds).toBeCloseTo(3, 5);
    expect(videoEditorVisibleLayers(state, 5.01)).toEqual([]);
  });

  it("riporta il tempo di timeline nel tempo della sorgente", () => {
    const trimmed = clip({ id: "c", assetId: "a", trackId: mainTrack, startSeconds: 3, durationSeconds: 2, sourceInSeconds: 7 });
    expect(videoEditorSourceTime(trimmed, 3)).toBe(7);
    expect(videoEditorSourceTime(trimmed, 4)).toBe(8);
    // Fuori dalla clip il tempo resta dentro i bordi del materiale usato.
    expect(videoEditorSourceTime(trimmed, 0)).toBe(7);
    expect(videoEditorSourceTime(trimmed, 99)).toBe(9);
  });

  it("riporta il tempo sorgente in ordine decrescente per una clip inversa", () => {
    const reversed = clip({ id: "reverse", assetId: "a", trackId: mainTrack, startSeconds: 3, durationSeconds: 2, sourceInSeconds: 7, reversed: true });
    expect(videoEditorSourceTime(reversed, 3)).toBe(9);
    expect(videoEditorSourceTime(reversed, 4)).toBe(8);
    expect(videoEditorSourceTime(reversed, 5)).toBe(7);
    expect(videoEditorVisibleLayers(settings([asset({ id: "a" })], [reversed]), 3.5)[0]?.sourceTimeSeconds).toBeCloseTo(8.5, 10);
  });

  it("applica alla preview gli stessi blocchi Fade In/Out dell’export", () => {
    const visual = clip({ id: "c", assetId: "a", trackId: mainTrack, startSeconds: 0, durationSeconds: 4 });
    const state = settings([asset({ id: "a" })], [visual], {
      effectClips: [{ id: "fx", effectId: "fade-in", target: { kind: "clip", clipId: visual.id }, startSeconds: 0, durationSeconds: 2, enabled: true, mix: 1, parameters: { curve: "linear" } }]
    });
    expect(videoEditorVisibleLayers(state, 0)).toEqual([]);
    expect(videoEditorVisibleLayers(state, 1)[0]?.opacity).toBeCloseTo(.5, 10);
    expect(videoEditorVisibleLayers(state, 2)[0]?.opacity).toBe(1);
  });

  it("considera audibili le tracce audio e i video con audio attivo", () => {
    const state = settings(
      [asset({ id: "musica", kind: "audio", hasAudio: true }), asset({ id: "parlato", hasAudio: true }), asset({ id: "muto", hasAudio: false })],
      [
        clip({ id: "a1", assetId: "musica", trackId: audioTrack, durationSeconds: 4 }),
        clip({ id: "v1", assetId: "parlato", trackId: mainTrack, durationSeconds: 4 }),
        clip({ id: "v2", assetId: "muto", trackId: overlayTrack, durationSeconds: 4 }),
        clip({ id: "v3", assetId: "parlato", trackId: overlayTrack, durationSeconds: 4, muted: true })
      ]
    );
    expect(videoEditorAudibleClips(state, 1).map((item) => item.clip.id)).toEqual(["a1", "v1"]);
  });
});

describe("Video Editor · inserimento dal pool", () => {
  it("mette il media in coda alla traccia adatta, senza vuoti né sovrapposizioni", () => {
    const state = settings([asset({ id: "v" })], [clip({ id: "c", assetId: "v", trackId: mainTrack, startSeconds: 0, durationSeconds: 3 })]);
    const placement = videoEditorAppendPlacement(state, asset({ id: "nuovo", durationSeconds: 5 }), mainTrack);
    expect(placement).toEqual({ trackId: mainTrack, startSeconds: 3, durationSeconds: 5 });
  });

  it("manda l’audio su una traccia audio e le immagini alla durata editoriale standard", () => {
    const state = settings([], []);
    expect(videoEditorAppendPlacement(state, asset({ id: "suono", kind: "audio", hasAudio: true, durationSeconds: 8 }))?.trackId).toBe(audioTrack);
    const image = videoEditorAppendPlacement(state, asset({ id: "foto", kind: "image", durationSeconds: 0 }));
    expect(image?.durationSeconds).toBe(videoEditorDefaultImageSeconds);
    expect(image?.trackId).toBe(mainTrack);
  });

  it("evita le tracce bloccate e rinuncia se non ne resta nessuna", () => {
    const locked = settings([], [], { tracks: baseSettings.tracks.map((item) => item.kind === "video" ? { ...item, locked: true } : item) });
    expect(videoEditorAppendPlacement(locked, asset({ id: "v" }), mainTrack)).toBeNull();
    expect(videoEditorAppendPlacement(locked, asset({ id: "suono", kind: "audio" }))?.trackId).toBe(audioTrack);
  });
});

describe("Video Editor · etichette delle modalità di fusione", () => {
  it("nomina in italiano ogni modalità accettata dallo schema", () => {
    expect(videoEditorBlendModeLabel("normal")).toBe("Normale");
    expect(videoEditorBlendModeLabel("soft-light")).toBe("Luce soffusa");
    expect(videoEditorBlendModeLabel("luminosity")).toBe("Luminosità");
  });
});
