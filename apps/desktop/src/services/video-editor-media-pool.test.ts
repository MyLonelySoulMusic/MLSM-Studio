import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";
import { VideoEditorMediaPool, videoEditorPlaybackSyncDecision } from "./video-editor-media-pool";
import type { VideoEditorAsset, VideoEditorClip, VideoEditorSettings } from "./video-editor";

const base = {
  armed: true, inside: true, playing: true, ready: true,
  paused: false, seeking: false, currentTime: 2, targetTime: 2.02
};

describe("Video Editor · sincronizzazione decoder durante Play", () => {
  it("lascia scorrere il decoder per piccoli scarti invece di cercare ogni frame", () => {
    expect(videoEditorPlaybackSyncDecision(base)).toEqual({ seek: false, play: false, pause: false });
    expect(videoEditorPlaybackSyncDecision({ ...base, currentTime: 2, targetTime: 2.3 }).seek).toBe(false);
  });

  it("riallinea un salto vero del playhead, ma mai sopra un seek ancora aperto", () => {
    expect(videoEditorPlaybackSyncDecision({ ...base, targetTime: 3 }).seek).toBe(true);
    expect(videoEditorPlaybackSyncDecision({ ...base, targetTime: 3, seeking: true }).seek).toBe(false);
  });

  it("avvia la clip attiva e ferma quelle fuori dalla finestra", () => {
    expect(videoEditorPlaybackSyncDecision({ ...base, paused: true })).toEqual({ seek: false, play: true, pause: false });
    expect(videoEditorPlaybackSyncDecision({ ...base, armed: false })).toEqual({ seek: false, play: false, pause: true });
  });

  it("in pausa cerca il frame preciso senza cancellare quello già visibile", () => {
    expect(videoEditorPlaybackSyncDecision({ ...base, playing: false, paused: true, currentTime: 1, targetTime: 1.03 })).toEqual({ seek: true, play: false, pause: false });
  });
});

interface FakeVideo {
  video: HTMLVideoElement;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  state: { paused: boolean; currentTime: number; seeking: boolean; readyState: number };
}

function editorWithVideo(): { settings: VideoEditorSettings; clip: VideoEditorClip } {
  const baseSettings = createProject("Playback test").animation.videoEditor;
  const asset: VideoEditorAsset = {
    id: "video-asset", name: "verticale.mp4", kind: "video", url: "blob:verticale",
    durationSeconds: 8, width: 1080, height: 1920, thumbnailUrl: null, hasAudio: true,
    bpm: null, beats: [], downbeats: [], waveform: []
  };
  const clip: VideoEditorClip = {
    id: "video-clip", assetId: asset.id, trackId: "video-editor-track-main",
    startSeconds: 0, durationSeconds: 8, sourceInSeconds: 0,
    fadeInSeconds: 0, fadeOutSeconds: 0, fadeCurve: "smooth",
    audioFadeInSeconds: 0, audioFadeOutSeconds: 0,
    blendMode: "normal", blendIntensity: 1,
    adjustments: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0, sharpness: 0, denoise: 0, opacity: 1 },
    transform: { x: 0, y: 0, scale: 1, rotation: 0 }, fit: "contain", muted: false, volume: 1
  };
  return { settings: { ...baseSettings, assets: [asset], clips: [clip] }, clip };
}

function videoAsset(id: string): VideoEditorAsset {
  return {
    id, name: `${id}.mp4`, kind: "video", url: `blob:${id}`,
    durationSeconds: 12, width: 1920, height: 1080, thumbnailUrl: null, hasAudio: false,
    bpm: null, beats: [], downbeats: [], waveform: []
  };
}

function imageAsset(id: string, width = 100, height = 100): VideoEditorAsset {
  return {
    ...videoAsset(id), name: `${id}.png`, kind: "image", durationSeconds: 0,
    width, height, hasAudio: false
  };
}

function videoClip(id: string, assetId: string, trackId: string, startSeconds: number, durationSeconds: number): VideoEditorClip {
  return {
    id, assetId, trackId, startSeconds, durationSeconds, sourceInSeconds: 0,
    fadeInSeconds: 0, fadeOutSeconds: 0, fadeCurve: "smooth",
    audioFadeInSeconds: 0, audioFadeOutSeconds: 0,
    blendMode: "normal", blendIntensity: 1,
    adjustments: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0, hue: 0, sharpness: 0, denoise: 0, opacity: 1 },
    transform: { x: 0, y: 0, scale: 1, rotation: 0 }, fit: "contain", muted: false, volume: 1
  };
}

function installFakeVideo(playRequest: () => Promise<void>): FakeVideo {
  const nativeCreateElement = document.createElement.bind(document);
  let fake: FakeVideo | null = null;
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
    const element = nativeCreateElement(tagName, options);
    if (tagName.toLowerCase() !== "video") return element;
    const video = element as HTMLVideoElement;
    const state = { paused: true, currentTime: 0, seeking: false, readyState: 2 };
    Object.defineProperties(video, {
      paused: { configurable: true, get: () => state.paused },
      currentTime: { configurable: true, get: () => state.currentTime, set: (value: number) => { state.currentTime = value; } },
      seeking: { configurable: true, get: () => state.seeking },
      readyState: { configurable: true, get: () => state.readyState },
      videoWidth: { configurable: true, get: () => 1080 },
      videoHeight: { configurable: true, get: () => 1920 },
      requestVideoFrameCallback: { configurable: true, value: undefined }
    });
    const play = vi.fn(() => playRequest().then(() => { state.paused = false; }));
    const pause = vi.fn(() => { state.paused = true; });
    Object.defineProperties(video, {
      play: { configurable: true, value: play },
      pause: { configurable: true, value: pause },
      load: { configurable: true, value: vi.fn() }
    });
    fake = { video, play, pause, state };
    return video;
  }) as typeof document.createElement);
  // `sync` crea il video in modo sincrono, quindi il chiamante può leggerlo subito
  // dopo aver costruito il pool. Il getter evita un cast non verificato nei test.
  return new Proxy({} as FakeVideo, {
    get: (_target, property) => {
      if (!fake) throw new Error("Il decoder video non è stato ancora creato");
      return fake[property as keyof FakeVideo];
    }
  });
}

function installFakeVideos(playRequests: readonly (() => Promise<void>)[] = []): FakeVideo[] {
  const nativeCreateElement = document.createElement.bind(document);
  const videos: FakeVideo[] = [];
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
    const element = nativeCreateElement(tagName, options);
    if (tagName.toLowerCase() !== "video") return element;
    const video = element as HTMLVideoElement;
    const state = { paused: true, currentTime: 0, seeking: false, readyState: 2 };
    Object.defineProperties(video, {
      paused: { configurable: true, get: () => state.paused },
      currentTime: { configurable: true, get: () => state.currentTime, set: (value: number) => { state.currentTime = value; } },
      seeking: { configurable: true, get: () => state.seeking },
      readyState: { configurable: true, get: () => state.readyState },
      videoWidth: { configurable: true, get: () => 1920 },
      videoHeight: { configurable: true, get: () => 1080 },
      requestVideoFrameCallback: { configurable: true, value: undefined }
    });
    const request = playRequests[videos.length] ?? (() => Promise.resolve());
    const play = vi.fn(() => request().then(() => { state.paused = false; }));
    const pause = vi.fn(() => { state.paused = true; });
    Object.defineProperties(video, {
      play: { configurable: true, value: play },
      pause: { configurable: true, value: pause },
      load: { configurable: true, value: vi.fn() }
    });
    videos.push({ video, play, pause, state });
    return video;
  }) as typeof document.createElement);
  return videos;
}

afterEach(() => vi.restoreAllMocks());

describe("Video Editor · handshake reale con HTMLMediaElement.play", () => {
  it("non risolve start finché il browser non conferma l'avvio del decoder", async () => {
    let resolvePlay!: () => void;
    const pendingPlay = new Promise<void>((resolve) => { resolvePlay = resolve; });
    const fake = installFakeVideo(() => pendingPlay);
    const { settings } = editorWithVideo();
    const pool = new VideoEditorMediaPool(vi.fn());
    pool.sync(settings);

    const completed = vi.fn();
    const start = pool.start(settings, 0);
    void start.then(completed);
    await Promise.resolve();
    expect(fake.play).toHaveBeenCalledOnce();
    expect(completed).not.toHaveBeenCalled();

    resolvePlay();
    await expect(start).resolves.toEqual({ startedMedia: 1, startedVideos: 1, startedAudio: 0 });
    expect(fake.state.paused).toBe(false);
    expect(completed).toHaveBeenCalledOnce();
    pool.dispose();
  });

  it("rifiuta l'handshake, ferma i media e rende leggibile l'errore di play", async () => {
    const fake = installFakeVideo(() => Promise.reject(new DOMException("autoplay bloccato", "NotAllowedError")));
    const { settings } = editorWithVideo();
    const notify = vi.fn();
    const pool = new VideoEditorMediaPool(notify);
    pool.sync(settings);

    await expect(pool.start(settings, 0)).rejects.toThrow("Impossibile avviare la preview");
    expect(fake.pause).toHaveBeenCalled();
    expect(pool.status(settings, 0).errors.join(" ")).toContain("NotAllowedError");
    expect(notify).toHaveBeenCalled();
    pool.dispose();
  });

  it("mantiene il video nativo dentro lo stack hardware WebKit", () => {
    const fake = installFakeVideo(() => Promise.resolve());
    const { settings } = editorWithVideo();
    const pool = new VideoEditorMediaPool(vi.fn());
    const monitor = document.createElement("div");
    pool.attach(monitor);
    pool.sync(settings);

    expect(fake.video.parentElement).toBe(monitor);
    expect([...pool.present(settings, 0)]).toEqual(["video-clip"]);
    expect(fake.video).toHaveClass("video-editor-presented-video");
    expect(fake.video.style.clipPath).toBe("none");
    expect(fake.video.style.filter).toBe("none");
    expect(fake.video.style.transform).toBe("none");
    // Il presentatore ripara anche un nodo spostato/rimosso da un commit React.
    fake.video.remove();
    expect([...pool.present(settings, 0)]).toEqual(["video-clip"]);
    expect(fake.video.parentElement).toBe(monitor);
    fake.video.onloadedmetadata?.call(fake.video, new Event("loadedmetadata"));
    expect(pool.status(settings, 0)).toMatchObject({ expectedVisuals: 1, readyVisuals: 1, pendingNames: [] });
    pool.dispose();
  });

  it("usa direttamente il frame video fermo se WebKit non consente la copia canvas", () => {
    const fake = installFakeVideo(() => Promise.resolve());
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { settings, clip } = editorWithVideo();
    const pool = new VideoEditorMediaPool(vi.fn());
    pool.sync(settings);

    fake.video.onloadeddata?.call(fake.video, new Event("loadeddata"));
    expect(pool.frame(clip)).toEqual({ width: 1080, height: 1920, source: fake.video });
    pool.dispose();
  });

  it("prepara il layer nativo anche sul fotogramma zero di un Fade In", () => {
    const fake = installFakeVideo(() => Promise.resolve());
    const { settings } = editorWithVideo();
    settings.effectClips = [{
      id: "fade-zero", effectId: "fade-in", target: { kind: "clip", clipId: "video-clip" },
      startSeconds: 0, durationSeconds: 1, enabled: true, mix: 1, parameters: { curve: "smooth" }
    }];
    const pool = new VideoEditorMediaPool(vi.fn());
    const monitor = document.createElement("div");
    pool.attach(monitor);
    pool.sync(settings);

    expect([...pool.present(settings, 0)]).toEqual(["video-clip"]);
    expect(fake.video).toHaveClass("video-editor-presented-video");
    expect(fake.video.style.opacity).toBe("0");
    expect([...pool.present(settings, .5)]).toEqual(["video-clip"]);
    expect(Number(fake.video.style.opacity)).toBeGreaterThan(0);
    pool.dispose();
  });

  it("cattura un frame di fallback su loadeddata, canplay e seeked", () => {
    const fake = installFakeVideo(() => Promise.resolve());
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const { settings, clip } = editorWithVideo();
    const pool = new VideoEditorMediaPool(vi.fn());
    pool.sync(settings);

    fake.video.onloadeddata?.call(fake.video, new Event("loadeddata"));
    expect(pool.frame(clip)?.source).toBeInstanceOf(HTMLCanvasElement);
    fake.video.oncanplay?.call(fake.video, new Event("canplay"));
    fake.video.onseeked?.call(fake.video, new Event("seeked"));
    expect(drawImage).toHaveBeenCalledTimes(3);
    pool.dispose();
  });
});

describe("Video Editor · stack DOM aderente alla timeline", () => {
  it("sostituisce subito il video presentato attraversando clip, gap e seek", () => {
    const fakes = installFakeVideos();
    const first = videoAsset("first");
    const second = videoAsset("second");
    const firstClip = videoClip("clip-first", first.id, "video-editor-track-main", 0, 2);
    const secondClip = videoClip("clip-second", second.id, "video-editor-track-main", 3, 2);
    const settings: VideoEditorSettings = {
      ...createProject("Sequenza").animation.videoEditor,
      assets: [first, second], clips: [firstClip, secondClip]
    };
    const pool = new VideoEditorMediaPool(vi.fn());
    const monitor = document.createElement("div");
    pool.attach(monitor);
    pool.sync(settings);

    expect(fakes).toHaveLength(2);
    expect([...pool.present(settings, .5)]).toEqual(["clip-first"]);
    expect(fakes[0]!.video).toHaveClass("video-editor-presented-video");
    expect(fakes[1]!.video).toHaveClass("video-editor-decoder-media");
    expect(fakes[1]!.video.style.opacity).toBe("0");

    expect([...pool.present(settings, 2.5)]).toEqual([]);
    expect(fakes.every(({ video }) => video.classList.contains("video-editor-decoder-media") && video.style.opacity === "0")).toBe(true);

    expect([...pool.present(settings, 3.25)]).toEqual(["clip-second"]);
    expect(fakes[0]!.video).toHaveClass("video-editor-decoder-media");
    expect(fakes[1]!.video).toHaveClass("video-editor-presented-video");
    expect(fakes[1]!.video.dataset.clipId).toBe("clip-second");
    pool.dispose();
  });

  it("usa intervalli [start, end) al taglio e conserva soltanto l'ultimo frame finale", () => {
    installFakeVideos();
    const first = videoAsset("cut-first");
    const second = videoAsset("cut-second");
    const settings: VideoEditorSettings = {
      ...createProject("Taglio esatto").animation.videoEditor,
      assets: [first, second],
      clips: [
        videoClip("cut-first-clip", first.id, "video-editor-track-main", 0, 2),
        videoClip("cut-second-clip", second.id, "video-editor-track-main", 2, 3)
      ]
    };
    const pool = new VideoEditorMediaPool(vi.fn());
    pool.sync(settings);

    expect([...pool.present(settings, 2)]).toEqual(["cut-second-clip"]);
    expect(pool.status(settings, 2).expectedVisuals).toBe(1);
    expect([...pool.present(settings, 5)]).toEqual(["cut-second-clip"]);
    expect([...pool.present(settings, 5.01)]).toEqual([]);
    pool.dispose();
  });

  it("presenta insieme due tracce sovrapposte nell'ordine fondo-superficie", () => {
    const fakes = installFakeVideos();
    const main = videoAsset("main");
    const overlay = videoAsset("overlay");
    const mainClip = videoClip("clip-main", main.id, "video-editor-track-main", 0, 4);
    const overlayClip = videoClip("clip-overlay", overlay.id, "video-editor-track-overlay", 0, 4);
    const settings: VideoEditorSettings = {
      ...createProject("Livelli").animation.videoEditor,
      assets: [main, overlay], clips: [mainClip, overlayClip]
    };
    const pool = new VideoEditorMediaPool(vi.fn());
    const monitor = document.createElement("div");
    pool.attach(monitor);
    pool.sync(settings);

    expect([...pool.present(settings, 1)]).toEqual(["clip-main", "clip-overlay"]);
    const byId = new Map(fakes.map(({ video }) => [video.dataset.clipId, video]));
    expect(byId.get("clip-main")?.style.zIndex).toBe("1");
    expect(byId.get("clip-overlay")?.style.zIndex).toBe("4");
    expect(byId.get("clip-main")?.style.visibility).toBe("visible");
    expect(byId.get("clip-overlay")?.style.visibility).toBe("visible");
    pool.dispose();
  });

  it("rimuove dal rack il decoder della clip cancellata e non puo ripresentarlo", () => {
    const fakes = installFakeVideos();
    const removed = videoAsset("removed");
    const kept = videoAsset("kept");
    const removedClip = videoClip("clip-removed", removed.id, "video-editor-track-overlay", 0, 4);
    const keptClip = videoClip("clip-kept", kept.id, "video-editor-track-main", 0, 4);
    const settings: VideoEditorSettings = {
      ...createProject("Cancellazione").animation.videoEditor,
      assets: [removed, kept], clips: [removedClip, keptClip]
    };
    const pool = new VideoEditorMediaPool(vi.fn());
    const monitor = document.createElement("div");
    pool.attach(monitor);
    pool.sync(settings);
    expect(pool.present(settings, 1).size).toBe(2);

    const next = { ...settings, assets: [kept], clips: [keptClip] };
    pool.sync(next);
    expect([...pool.present(next, 1)]).toEqual(["clip-kept"]);
    expect(monitor.querySelectorAll("video")).toHaveLength(1);
    expect(fakes[0]!.video.parentElement).toBeNull();
    expect(fakes[1]!.video.dataset.clipId).toBe("clip-kept");
    pool.dispose();
  });

  it("avvia e mette in pausa tutti i layer video attivi, non soltanto il primo", async () => {
    const fakes = installFakeVideos();
    const main = videoAsset("play-main");
    const overlay = videoAsset("play-overlay");
    const settings: VideoEditorSettings = {
      ...createProject("Playback multilivello").animation.videoEditor,
      assets: [main, overlay],
      clips: [
        videoClip("play-main-clip", main.id, "video-editor-track-main", 0, 4),
        videoClip("play-overlay-clip", overlay.id, "video-editor-track-overlay", 0, 4)
      ]
    };
    const pool = new VideoEditorMediaPool(vi.fn());
    pool.sync(settings);

    await expect(pool.start(settings, 1)).resolves.toEqual({ startedMedia: 2, startedVideos: 2, startedAudio: 0 });
    expect(fakes.every(({ play, state }) => play.mock.calls.length === 1 && !state.paused)).toBe(true);
    pool.update(settings, 1.1, false);
    expect(fakes.every(({ pause, state }) => pause.mock.calls.length > 0 && state.paused)).toBe(true);
    pool.dispose();
  });

  it("mantiene un'immagine sopra il video quando la sua traccia e superiore", () => {
    const fakes = installFakeVideos();
    const video = videoAsset("background-video");
    const image: VideoEditorAsset = {
      ...videoAsset("top-image"), kind: "image", hasAudio: false, durationSeconds: 0
    };
    const settings: VideoEditorSettings = {
      ...createProject("Video e immagine").animation.videoEditor,
      assets: [video, image],
      clips: [
        videoClip("background-clip", video.id, "video-editor-track-main", 0, 4),
        videoClip("image-clip", image.id, "video-editor-track-overlay", 0, 4)
      ]
    };
    const pool = new VideoEditorMediaPool(vi.fn());
    const monitor = document.createElement("div");
    pool.attach(monitor);
    pool.sync(settings);

    expect([...pool.present(settings, 1)]).toEqual(["background-clip", "image-clip"]);
    expect(fakes[0]!.video.style.zIndex).toBe("1");
    const presentedImage = monitor.querySelector<HTMLImageElement>('img[data-clip-id="image-clip"]');
    expect(presentedImage).not.toBeNull();
    expect(presentedImage).toHaveClass("video-editor-presented-image");
    expect(presentedImage?.style.zIndex).toBe("4");
    pool.dispose();
  });

  it("assegna slot z deterministici: livello inferiore completo, ombra superiore, media e overlay superiori", () => {
    installFakeVideos();
    const lower = imageAsset("lower-layer");
    const upper = imageAsset("upper-layer");
    const lowerClip = videoClip("lower-clip", lower.id, "video-editor-track-main", 0, 4);
    const upperClip = videoClip("upper-clip", upper.id, "video-editor-track-overlay", 0, 4);
    upperClip.imageShadow = { enabled: true, style: "drop", color: "#112233", opacity: .6, blur: .02, distance: .1, angle: 0 };
    const settings: VideoEditorSettings = {
      ...createProject("Ordine ombre").animation.videoEditor,
      assets: [lower, upper], clips: [lowerClip, upperClip],
      effectClips: [
        { id: "lower-leak", effectId: "light-leak", target: { kind: "clip", clipId: lowerClip.id }, startSeconds: 0, durationSeconds: 3, enabled: true, mix: 1, parameters: { amount: .7 } },
        { id: "upper-leak", effectId: "light-leak", target: { kind: "clip", clipId: upperClip.id }, startSeconds: 0, durationSeconds: 3, enabled: true, mix: 1, parameters: { amount: .7 } }
      ]
    };
    const pool = new VideoEditorMediaPool(vi.fn());
    const monitor = document.createElement("div");
    pool.attach(monitor);
    pool.sync(settings);
    expect([...pool.present(settings, 1)]).toEqual([lowerClip.id, upperClip.id]);

    const z = (selector: string) => Number(monitor.querySelector<HTMLElement>(selector)?.style.zIndex);
    expect(z(`.video-editor-image-shadow-caster[data-clip-id="${lowerClip.id}"]`)).toBe(0);
    expect(z(`.video-editor-presented-image[data-clip-id="${lowerClip.id}"]`)).toBe(1);
    expect(z(`.video-editor-layer-effect-overlay[data-clip-id="${lowerClip.id}"]`)).toBe(2);
    expect(z(`.video-editor-image-shadow-caster[data-clip-id="${upperClip.id}"]`)).toBe(3);
    expect(z(`.video-editor-presented-image[data-clip-id="${upperClip.id}"]`)).toBe(4);
    expect(z(`.video-editor-layer-effect-overlay[data-clip-id="${upperClip.id}"]`)).toBe(5);
    expect(z(`.video-editor-layer-effect-overlay[data-clip-id="${lowerClip.id}"]`))
      .toBeLessThan(z(`.video-editor-image-shadow-caster[data-clip-id="${upperClip.id}"]`));
    pool.dispose();
  });

  it("riusa l'albero SVG, aggiorna i vettori live e non ricrea gli otto stop dell'ombra lunga", () => {
    installFakeVideos();
    const image = imageAsset("stable-shadow", 100, 200);
    const clip = videoClip("stable-shadow-clip", image.id, "video-editor-track-overlay", 0, 4);
    clip.imageShadow = { enabled: true, style: "long", color: "#123456", opacity: .65, blur: .02, distance: .08, angle: 0 };
    const settings: VideoEditorSettings = {
      ...createProject("Ombra SVG stabile").animation.videoEditor,
      outputWidth: 200, outputHeight: 100, assets: [image], clips: [clip]
    };
    const pool = new VideoEditorMediaPool(vi.fn());
    const monitor = document.createElement("div");
    let bounds = { width: 200, height: 100 };
    monitor.getBoundingClientRect = () => ({ ...bounds } as DOMRect);
    pool.attach(monitor);
    pool.sync(settings);
    pool.present(settings, 1);

    const filter = monitor.querySelector<SVGFilterElement>("filter")!;
    const firstOffsets = [...filter.querySelectorAll<SVGElement>("feOffset")];
    expect(firstOffsets).toHaveLength(8);
    expect(firstOffsets.map((node) => Number(node.getAttribute("dx")))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(firstOffsets.every((node) => Number(node.getAttribute("dy")) === 0)).toBe(true);
    const firstChildren = [...filter.children];

    pool.present(settings, 1.1);
    expect([...filter.children].every((node, index) => node === firstChildren[index])).toBe(true);
    expect([...filter.querySelectorAll("feOffset")].every((node, index) => node === firstOffsets[index])).toBe(true);

    bounds = { width: 400, height: 200 };
    pool.present(settings, 1.2);
    expect([...filter.querySelectorAll("feOffset")].every((node, index) => node === firstOffsets[index])).toBe(true);
    expect(firstOffsets.map((node) => Number(node.getAttribute("dx")))).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(pool.status(settings, 1.2)).toMatchObject({ expectedVisuals: 1, errors: [] });
    pool.dispose();
  });

  it("usa nel filtro SVG il vettore drop condiviso e mantiene il glow centrato senza churn", () => {
    installFakeVideos();
    const image = imageAsset("vector-shadow");
    const clip = videoClip("vector-shadow-clip", image.id, "video-editor-track-main", 0, 4);
    clip.imageShadow = { enabled: true, style: "drop", color: "#445566", opacity: .5, blur: .02, distance: .1, angle: 30 };
    const settings: VideoEditorSettings = {
      ...createProject("Vettore ombra").animation.videoEditor,
      outputWidth: 200, outputHeight: 100, assets: [image], clips: [clip]
    };
    const pool = new VideoEditorMediaPool(vi.fn());
    const monitor = document.createElement("div");
    pool.attach(monitor);
    pool.sync(settings);
    pool.present(settings, 1);

    const filter = monitor.querySelector<SVGFilterElement>("filter")!;
    const offsets = [...filter.querySelectorAll<SVGElement>("feOffset")];
    expect(Number(offsets[0]?.getAttribute("dx"))).toBeCloseTo(Math.cos(Math.PI / 6) * 10, 12);
    expect(Number(offsets[0]?.getAttribute("dy"))).toBeCloseTo(5, 12);
    expect(offsets.slice(1).every((node) => node.getAttribute("dx") === "0" && node.getAttribute("dy") === "0")).toBe(true);

    const glowClip = { ...clip, imageShadow: { ...clip.imageShadow, style: "glow" as const } };
    pool.present({ ...settings, clips: [glowClip] }, 1.1);
    expect([...filter.querySelectorAll("feOffset")].every((node, index) => node === offsets[index])).toBe(true);
    expect(offsets.every((node) => node.getAttribute("dx") === "0" && node.getAttribute("dy") === "0")).toBe(true);
    pool.dispose();
  });

  it.each([
    ["contain", "contain"],
    ["cover", "cover"],
    ["fill", "100% 100%"]
  ] as const)("maschera gli effetti DOM con l'alpha dell'immagine in fit %s", (fit, maskSize) => {
    installFakeVideos();
    const image: VideoEditorAsset = {
      ...videoAsset(`alpha-${fit}`), kind: "image", url: `blob:alpha-${fit}`,
      width: 1080, height: 1920, hasAudio: false, durationSeconds: 0
    };
    const clip = videoClip(`alpha-${fit}-clip`, image.id, "video-editor-track-overlay", 0, 4);
    clip.fit = fit;
    clip.transform = { x: .2, y: -.1, scale: .8, rotation: 12 };
    const settings: VideoEditorSettings = {
      ...createProject(`Alpha ${fit}`).animation.videoEditor,
      outputWidth: 1920, outputHeight: 1080,
      assets: [image], clips: [clip],
      effectClips: [
        {
          id: `leak-${fit}`, effectId: "light-leak", target: { kind: "clip", clipId: clip.id },
          startSeconds: 0, durationSeconds: 3, enabled: true, mix: 1, parameters: { amount: .8 }
        },
        {
          id: `rgb-${fit}`, effectId: "rgb-split", target: { kind: "clip", clipId: clip.id },
          startSeconds: 0, durationSeconds: 3, enabled: true, mix: 1, parameters: { amount: .02, frequency: 6 }
        }
      ]
    };
    const pool = new VideoEditorMediaPool(vi.fn());
    const monitor = document.createElement("div");
    pool.attach(monitor);
    pool.sync(settings);
    pool.present(settings, 1);

    const presentedImage = monitor.querySelector<HTMLImageElement>(`img[data-clip-id="${clip.id}"]`)!;
    const overlay = monitor.querySelector<HTMLDivElement>(`.video-editor-layer-effect-overlay[data-clip-id="${clip.id}"]`)!;
    expect(presentedImage.style.filter).toContain("drop-shadow(");
    expect(presentedImage.style.maskImage).toContain(`blob:alpha-${fit}`);
    expect(presentedImage.style.webkitMaskImage).toContain(`blob:alpha-${fit}`);
    expect(presentedImage.style.maskSize).toBe(maskSize);
    expect(presentedImage.style.maskPosition).toBe("center");
    expect(presentedImage.style.maskRepeat).toBe("no-repeat");
    expect(overlay.style.maskImage).toContain(`blob:alpha-${fit}`);
    expect(overlay.style.webkitMaskImage).toContain(`blob:alpha-${fit}`);
    expect(overlay.style.maskSize).toBe(maskSize);
    expect(overlay.style.webkitMaskSize).toBe(maskSize);
    expect(overlay.style.maskPosition).toBe("center");
    expect(overlay.style.maskRepeat).toBe("no-repeat");
    expect(presentedImage.style.transform).toContain("translate(192.000px, -54.000px)");
    expect(presentedImage.style.transform).toContain("rotate(12.000deg) scale(0.80000)");
    expect(overlay.style.transform).toBe(presentedImage.style.transform);
    expect(overlay.style.left).toBe("0px");
    expect(overlay.style.top).toBe("0px");
    expect(overlay.style.width).toBe(`${settings.outputWidth}px`);
    expect(overlay.style.height).toBe(`${settings.outputHeight}px`);
    pool.dispose();
  });

  it("lascia gli overlay dei video privi di maschera immagine", () => {
    installFakeVideos();
    const asset = videoAsset("unmasked-video");
    const clip = videoClip("unmasked-video-clip", asset.id, "video-editor-track-main", 0, 4);
    const settings: VideoEditorSettings = {
      ...createProject("Video senza mask").animation.videoEditor,
      assets: [asset], clips: [clip],
      effectClips: [{ id: "video-leak", effectId: "light-leak", target: { kind: "clip", clipId: clip.id }, startSeconds: 0, durationSeconds: 3, enabled: true, mix: 1, parameters: { amount: .8 } }]
    };
    const pool = new VideoEditorMediaPool(vi.fn());
    const monitor = document.createElement("div");
    pool.attach(monitor);
    pool.sync(settings);
    pool.present(settings, 1);
    const video = monitor.querySelector<HTMLVideoElement>('video[data-clip-id="unmasked-video-clip"]')!;
    const overlay = monitor.querySelector<HTMLDivElement>('.video-editor-layer-effect-overlay[data-clip-id="unmasked-video-clip"]')!;
    expect(video.style.maskImage).toBe("none");
    expect(video.style.webkitMaskImage).toBe("none");
    expect(overlay.style.maskImage).toBe("none");
    expect(overlay.style.webkitMaskImage).toBe("none");
    pool.dispose();
  });

  it("applica lo stesso stato temporale degli effetti al layer DOM", () => {
    const fakes = installFakeVideos();
    const asset = videoAsset("effect-video");
    const clip = videoClip("effect-clip", asset.id, "video-editor-track-main", 0, 4);
    const settings: VideoEditorSettings = {
      ...createProject("Effetti DOM").animation.videoEditor,
      assets: [asset], clips: [clip],
      effectClips: [
        { id: "zoom", effectId: "zoom-in", target: { kind: "clip", clipId: clip.id }, startSeconds: 0, durationSeconds: 2, enabled: true, mix: 1, parameters: { amount: .2, curve: "smooth" } },
        { id: "noir", effectId: "noir", target: { kind: "clip", clipId: clip.id }, startSeconds: 0, durationSeconds: 2, enabled: true, mix: 1, parameters: { amount: 1 } },
        { id: "vignette", effectId: "cinematic-vignette", target: { kind: "clip", clipId: clip.id }, startSeconds: 0, durationSeconds: 2, enabled: true, mix: 1, parameters: { amount: .8 } }
      ]
    };
    const pool = new VideoEditorMediaPool(vi.fn());
    const monitor = document.createElement("div");
    pool.attach(monitor);
    pool.sync(settings);
    pool.present(settings, 1);

    expect(fakes[0]!.video.style.transform).toContain("scale(");
    expect(fakes[0]!.video.style.filter).toContain("grayscale(");
    const overlay = monitor.querySelector<HTMLDivElement>('.video-editor-layer-effect-overlay[data-clip-id="effect-clip"]');
    expect(overlay?.style.background).toContain("radial-gradient");
    expect(overlay?.style.visibility).toBe("visible");
    pool.dispose();
  });

  it("sfuma anche gli overlay ottici e li confina al contenuto in contain", () => {
    const fakes = installFakeVideos();
    const asset = { ...videoAsset("portrait-effect"), width: 1080, height: 1920 };
    const clip = videoClip("portrait-effect-clip", asset.id, "video-editor-track-main", 0, 4);
    clip.fit = "contain";
    const settings: VideoEditorSettings = {
      ...createProject("Overlay confinato").animation.videoEditor,
      outputWidth: 1920, outputHeight: 1080,
      assets: [asset], clips: [clip],
      effectClips: [
        { id: "fade", effectId: "fade-in", target: { kind: "clip", clipId: clip.id }, startSeconds: 0, durationSeconds: 2, enabled: true, mix: 1, parameters: { curve: "linear" } },
        { id: "vignette", effectId: "cinematic-vignette", target: { kind: "clip", clipId: clip.id }, startSeconds: 0, durationSeconds: 3, enabled: true, mix: 1, parameters: { amount: .8 } }
      ]
    };
    const pool = new VideoEditorMediaPool(vi.fn());
    const monitor = document.createElement("div");
    pool.attach(monitor);
    pool.sync(settings);
    pool.present(settings, 1);

    expect(fakes[0]!.video.style.opacity).toBe("0.5");
    const overlay = monitor.querySelector<HTMLDivElement>('.video-editor-layer-effect-overlay[data-clip-id="portrait-effect-clip"]')!;
    expect(overlay.style.opacity).toBe("0.5");
    expect(Number.parseFloat(overlay.style.width)).toBeLessThan(settings.outputWidth);
    expect(Number.parseFloat(overlay.style.left)).toBeGreaterThan(0);
    expect(overlay.style.height).toBe(`${settings.outputHeight}px`);
    pool.dispose();
  });

  it("rispetta gli estremi di blendIntensity e reagisce a temperatura, tinta e nitidezza", () => {
    const fakes = installFakeVideos();
    const asset = videoAsset("styled");
    const clip = videoClip("styled-clip", asset.id, "video-editor-track-main", 0, 4);
    clip.blendMode = "multiply";
    clip.blendIntensity = 0;
    clip.adjustments = { ...clip.adjustments, temperature: 40, tint: -20, sharpness: 60 };
    const settings: VideoEditorSettings = {
      ...createProject("Stile DOM").animation.videoEditor,
      assets: [asset], clips: [clip]
    };
    const pool = new VideoEditorMediaPool(vi.fn());
    pool.sync(settings);

    pool.present(settings, 1);
    expect(fakes[0]!.video.style.mixBlendMode).toBe("normal");
    expect(fakes[0]!.video.style.filter).toContain("sepia(");
    expect(fakes[0]!.video.style.filter).toContain("hue-rotate(");
    const fullBlend = { ...settings, clips: [{ ...clip, blendIntensity: 1 }] };
    pool.present(fullBlend, 1);
    expect(fakes[0]!.video.style.mixBlendMode).toBe("multiply");
    pool.dispose();
  });

  it("prime nello stesso gesto la clip successiva senza includerla nell'handshake attivo", async () => {
    const fakes = installFakeVideos();
    const first = videoAsset("prime-first");
    const second = videoAsset("prime-second");
    const settings: VideoEditorSettings = {
      ...createProject("Priming taglio").animation.videoEditor,
      assets: [first, second],
      clips: [
        videoClip("prime-first-clip", first.id, "video-editor-track-main", 0, 2),
        videoClip("prime-second-clip", second.id, "video-editor-track-main", 2, 3)
      ]
    };
    const pool = new VideoEditorMediaPool(vi.fn());
    pool.sync(settings);

    const started = pool.start(settings, 0);
    expect(fakes[0]!.play).toHaveBeenCalledOnce();
    expect(fakes[1]!.play).toHaveBeenCalledOnce();
    await expect(started).resolves.toEqual({ startedMedia: 1, startedVideos: 1, startedAudio: 0 });
    expect(fakes[1]!.state.paused).toBe(true);

    pool.update(settings, 2, true);
    await Promise.resolve();
    expect(fakes[1]!.play).toHaveBeenCalledTimes(2);
    expect(fakes[0]!.state.paused).toBe(true);
    pool.dispose();
  });

  it("prime la prossima clip anche quando Play parte da un gap", async () => {
    const fakes = installFakeVideos();
    const future = videoAsset("gap-future");
    const settings: VideoEditorSettings = {
      ...createProject("Priming gap").animation.videoEditor,
      assets: [future],
      clips: [videoClip("gap-future-clip", future.id, "video-editor-track-main", 3, 2)]
    };
    const pool = new VideoEditorMediaPool(vi.fn());
    pool.sync(settings);

    const started = pool.start(settings, 1);
    expect(fakes[0]!.play).toHaveBeenCalledOnce();
    await expect(started).resolves.toEqual({ startedMedia: 0, startedVideos: 0, startedAudio: 0 });
    await Promise.resolve();
    expect(fakes[0]!.state.paused).toBe(true);
    pool.dispose();
  });

  it("non abortisce un priming futuro lento durante i primi tick della timeline", async () => {
    let releaseFuture!: () => void;
    const futurePlay = new Promise<void>((resolve) => { releaseFuture = resolve; });
    const fakes = installFakeVideos([() => Promise.resolve(), () => futurePlay]);
    const first = videoAsset("slow-prime-first");
    const second = videoAsset("slow-prime-second");
    const settings: VideoEditorSettings = {
      ...createProject("Priming lento").animation.videoEditor,
      assets: [first, second],
      clips: [
        videoClip("slow-prime-first-clip", first.id, "video-editor-track-main", 0, 2),
        videoClip("slow-prime-second-clip", second.id, "video-editor-track-main", 3, 2)
      ]
    };
    const pool = new VideoEditorMediaPool(vi.fn());
    pool.sync(settings);

    await pool.start(settings, 0);
    pool.update(settings, .2, true);
    expect(fakes[1]!.pause).not.toHaveBeenCalled();
    releaseFuture();
    await futurePlay;
    await Promise.resolve();
    expect(fakes[1]!.pause).toHaveBeenCalledOnce();
    pool.dispose();
  });

  it("non avvia un decoder collocato su una traccia video nascosta", async () => {
    const fakes = installFakeVideos();
    const visible = videoAsset("visible");
    const hidden = videoAsset("hidden");
    const project = createProject("Traccia nascosta").animation.videoEditor;
    const settings: VideoEditorSettings = {
      ...project,
      tracks: project.tracks.map((track) => track.id === "video-editor-track-overlay" ? { ...track, hidden: true } : track),
      assets: [visible, hidden],
      clips: [
        videoClip("visible-clip", visible.id, "video-editor-track-main", 0, 4),
        videoClip("hidden-clip", hidden.id, "video-editor-track-overlay", 0, 4)
      ]
    };
    const pool = new VideoEditorMediaPool(vi.fn());
    pool.sync(settings);

    await expect(pool.start(settings, 1)).resolves.toEqual({ startedMedia: 1, startedVideos: 1, startedAudio: 0 });
    expect(fakes[0]!.play).toHaveBeenCalledOnce();
    expect(fakes[1]!.play).not.toHaveBeenCalled();
    pool.update(settings, 1.2, true);
    expect(fakes[1]!.play).not.toHaveBeenCalled();
    pool.dispose();
  });
});
