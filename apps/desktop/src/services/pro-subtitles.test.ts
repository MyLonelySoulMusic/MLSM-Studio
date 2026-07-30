import { describe, expect, it } from "vitest";
import { createProject } from "@rbs/project-schema";
import {
  PRO_SUBTITLE_ANIMATIONS,
  assignProSubtitleCueStyles,
  deterministicProSubtitleAnimation,
  directProSubtitleAnimation,
  layoutProSubtitleCue,
  parseProSubtitleFile,
  reconcileProSubtitleWordStyles,
  renderProSubtitleCompositionFrame,
  renderProSubtitleFrame,
  resolveProSubtitleCueStyle,
  resolveProSubtitlePaletteColor,
  resolveProSubtitleWordShadow,
  resolveProSubtitleWordPose,
  retargetProSubtitleAutomaticAnimations,
  tokenizeProSubtitleWords,
  type ProSubtitleCue,
  type ProSubtitleCueStyle
} from "./pro-subtitles";

class RecordingContext {
  font = "800 100px sans-serif";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";
  fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  shadowColor = "rgba(0,0,0,0)";
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  globalAlpha = 1;
  readonly clears: number[][] = [];
  readonly fills: { text: string; x: number; y: number; color: string; shadowColor: string; shadowBlur: number; alpha: number }[] = [];
  readonly transforms: string[] = [];
  readonly clips: number[][] = [];
  private pendingRect: number[] = [];
  private readonly states: {
    globalAlpha: number;
    font: string;
    fillStyle: string | CanvasGradient | CanvasPattern;
    shadowColor: string;
    shadowBlur: number;
    shadowOffsetX: number;
    shadowOffsetY: number;
  }[] = [];
  save(): void {
    this.states.push({
      globalAlpha: this.globalAlpha,
      font: this.font,
      fillStyle: this.fillStyle,
      shadowColor: this.shadowColor,
      shadowBlur: this.shadowBlur,
      shadowOffsetX: this.shadowOffsetX,
      shadowOffsetY: this.shadowOffsetY
    });
  }
  restore(): void {
    const state = this.states.pop();
    if (!state) return;
    Object.assign(this, state);
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void { this.transforms.push(`matrix:${a}:${b}:${c}:${d}:${e}:${f}`); }
  clearRect(x: number, y: number, width: number, height: number): void { this.clears.push([x, y, width, height]); }
  measureText(text: string): TextMetrics {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 100);
    return { width: [...text].length * size * .56 } as TextMetrics;
  }
  fillText(text: string, x: number, y: number): void {
    this.fills.push({ text, x, y, color: String(this.fillStyle), shadowColor: this.shadowColor, shadowBlur: this.shadowBlur, alpha: this.globalAlpha });
  }
  translate(x: number, y: number): void { this.transforms.push(`translate:${x}:${y}`); }
  rotate(angle: number): void { this.transforms.push(`rotate:${angle}`); }
  scale(x: number, y: number): void { this.transforms.push(`scale:${x}:${y}`); }
  beginPath(): void { this.pendingRect = []; }
  rect(x: number, y: number, width: number, height: number): void { this.pendingRect = [x, y, width, height]; }
  clip(): void { this.clips.push(this.pendingRect); }
}

function context(): { recorder: RecordingContext; canvas: CanvasRenderingContext2D } {
  const recorder = new RecordingContext();
  return { recorder, canvas: recorder as unknown as CanvasRenderingContext2D };
}

function cue(id: string, text: string, startSeconds = 0, endSeconds = 2): ProSubtitleCue {
  return { id, text, startSeconds, endSeconds, confidence: 1, verified: true, manual: true };
}

function settings() {
  return createProject().animation.proSubtitles;
}

describe("ProSubtitles parser", () => {
  it("legge SRT con BOM, CRLF, testo multilinea, separatori misti, sort e clamp", () => {
    const source = "\uFEFF2\r\n00:00:03.500 --> 00:00:08,000\r\nSeconda riga\r\nmultilinea\r\n\r\n1\r\n00:00:00,750 --> 00:00:02.250\r\nPrima frase\r\n";
    const parsed = parseProSubtitleFile(source, 5);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((item) => item.text)).toEqual(["Prima frase", "Seconda riga\nmultilinea"]);
    expect(parsed[1]).toMatchObject({ startSeconds: 3.5, endSeconds: 5, confidence: 1, verified: true, manual: true });
    expect(new Set(parsed.map((item) => item.id)).size).toBe(2);
  });

  it("legge WebVTT con identificatori, cue settings, markup e blocchi NOTE/STYLE", () => {
    const source = `WEBVTT

NOTE questa nota non è un sottotitolo
e continua qui

STYLE
::cue { color: white; }

intro
00:00.500 --> 00:02.250 align:start position:10%
<v Singer><b>Hello</b> &amp; goodbye

00:02.300 --> 00:04.000
second line<br>still visible
`;
    const parsed = parseProSubtitleFile(source, 10);
    expect(parsed.map((item) => item.text)).toEqual(["Hello & goodbye", "second line\nstill visible"]);
    expect(parsed[0]).toMatchObject({ startSeconds: .5, endSeconds: 2.25 });
  });

  it("ignora cue interamente fuori durata e segnala file non validi", () => {
    const source = `1
00:01:00,000 --> 00:01:02,000
Fuori

2
00:00:01,000 --> 00:00:02,000
Dentro`;
    expect(parseProSubtitleFile(source, 5)).toHaveLength(1);
    expect(() => parseProSubtitleFile("questo non è un SRT", 5)).toThrow(/timestamp validi/);
    expect(parseProSubtitleFile(" \n ", 5)).toEqual([]);
  });
});

describe("ProSubtitles style assignment", () => {
  it("varia deterministicamente fra tutte le animazioni", () => {
    const animations = Array.from({ length: PRO_SUBTITLE_ANIMATIONS.length }, (_, index) => deterministicProSubtitleAnimation(index));
    expect(new Set(animations)).toEqual(new Set(PRO_SUBTITLE_ANIMATIONS));
    expect(Array.from({ length: PRO_SUBTITLE_ANIMATIONS.length }, (_, index) => deterministicProSubtitleAnimation(index))).toEqual(animations);
  });

  it("assegna uno stile completo e conserva gli override già presenti", () => {
    const projectSettings = settings();
    const cues = [cue("a", "One two three"), cue("b", "Four five")];
    const existing: ProSubtitleCueStyle = {
      cueId: "a",
      animation: "maskReveal",
      animationAutomatic: false,
      fontFamily: "Bebas Neue",
      fontFamilyAutomatic: false,
      fontSize: 142,
      fontSizeAutomatic: false,
      positionX: 50,
      positionY: 50,
      positionAutomatic: true,
      opacity: 1,
      opacityAutomatic: true,
      shadowEnabled: false,
      shadowColor: "#112233",
      wordStyles: [{ index: 1, color: "#abcdef", fontSizeScale: 1.4, animation: "letterOrbit" }]
    };
    const assigned = assignProSubtitleCueStyles(cues, projectSettings, [existing]);
    expect(assigned[0]).toMatchObject({ cueId: "a", animation: "maskReveal", fontFamily: "Bebas Neue", fontSize: 142, shadowEnabled: false });
    expect(assigned[0]?.wordStyles).toHaveLength(3);
    expect(assigned[0]?.wordStyles[1]).toMatchObject({ index: 1, color: "#abcdef", fontSizeScale: 1.4, animation: "letterOrbit" });
    expect(assigned[1]?.animation).not.toBeUndefined();
  });

  it("dirige automaticamente ritmo, varietà e parola chiave senza casualità", () => {
    const projectSettings = settings();
    const cues = [
      cue("impact", "GO!", 0, .72),
      cue("normal", "This phrase keeps the visual rhythm moving", .72, 2.4),
      cue("calm", "A much longer sentence receives enough time to remain elegant and completely readable", 2.4, 6.8)
    ];
    const first = assignProSubtitleCueStyles(cues, projectSettings, []);
    expect(assignProSubtitleCueStyles(cues, projectSettings, [])).toEqual(first);
    expect(first[0]?.animation).toBe(directProSubtitleAnimation(cues[0]!, 0));
    expect(first[1]?.animation).not.toBe(first[0]?.animation);
    expect(first[2]?.animation).not.toBe(first[1]?.animation);
    expect(first[0]?.wordStyles[0]).toMatchObject({
      color: projectSettings.palette[2],
      fontSizeScale: 1.28
    });
    expect(Math.max(...first[1]!.wordStyles.map((word) => word.fontSizeScale))).toBeGreaterThan(1);
  });

  it("riserva i preset full-frame alle cue brevi e leggibili", () => {
    const fullFrame = ["fullFrameOrbit", "editorialGrid", "focusCarousel"];
    const shortEmphatic = cue("short-full", "OWN THE NIGHT!", 0, 2.1);
    const overloaded = cue(
      "overloaded",
      "THIS PHRASE HAS TOO MANY WORDS AND TOO LITTLE TIME TO FILL THE WHOLE FRAME SAFELY!",
      0,
      1.25
    );
    expect(fullFrame).toContain(directProSubtitleAnimation(shortEmphatic, 0));
    expect(fullFrame).not.toContain(directProSubtitleAnimation(overloaded, 1));
  });

  it("riconcilia per indice, elimina stili orfani e crea quelli mancanti", () => {
    const palette = ["#111111", "#222222", "#333333"] as const;
    const result = reconcileProSubtitleWordStyles("alpha beta gamma", [
      { index: 1, color: "#ff00ff", fontSizeScale: 3, animation: "wordRush" },
      { index: 8, color: "#000000", fontSizeScale: 1, animation: null }
    ], palette);
    expect(result).toHaveLength(3);
    expect(result[1]).toEqual({ index: 1, color: "#ff00ff", fontSizeScale: 2.2, animation: "wordRush" });
    expect(result.some((item) => item.index === 8)).toBe(false);
    expect(result.every((item, index) => item.index === index && Boolean(item.color))).toBe(true);
  });

  it("usa i default della modalità quando una cue non ha uno stile salvato", () => {
    const projectSettings = {
      ...settings(),
      autoVaryAnimations: false,
      defaultAnimation: "cinematicDrift" as const,
      defaultFontFamily: "Oswald",
      defaultFontSize: 126,
      positionX: 28,
      positionY: 72,
      opacity: .68
    };
    const resolved = resolveProSubtitleCueStyle(cue("new", "A fresh subtitle"), projectSettings, 4);
    expect(resolved).toMatchObject({
      cueId: "new",
      animation: "cinematicDrift",
      fontFamily: "Oswald",
      fontSize: 126,
      positionX: 28,
      positionY: 72,
      opacity: .68
    });
    expect(resolved.wordStyles).toHaveLength(3);
  });

  it("eredita font, dimensione, posizione e opacità globali finché l'override locale non è esplicito", () => {
    const currentCue = cue("inheritance", "GLOBAL CONTROLS");
    const stale = {
      ...resolveProSubtitleCueStyle(currentCue, settings(), 0),
      fontFamily: "Bebas Neue",
      fontSize: 76,
      positionX: 4,
      positionY: 96,
      opacity: .18
    };
    const globalSettings = {
      ...settings(),
      defaultFontFamily: "Montserrat",
      defaultFontSize: 154,
      positionX: 72,
      positionY: 31,
      opacity: .84,
      cueStyles: [stale]
    };
    expect(resolveProSubtitleCueStyle(currentCue, globalSettings, 0)).toMatchObject({
      fontFamily: "Montserrat",
      fontSize: 154,
      positionX: 72,
      positionY: 31,
      opacity: .84
    });

    const manual = {
      ...stale,
      fontFamilyAutomatic: false,
      fontSizeAutomatic: false,
      positionAutomatic: false,
      opacityAutomatic: false
    };
    expect(resolveProSubtitleCueStyle(currentCue, { ...globalSettings, cueStyles: [manual] }, 0)).toMatchObject({
      fontFamily: "Bebas Neue",
      fontSize: 76,
      positionX: 4,
      positionY: 96,
      opacity: .18
    });
  });

  it("cambia soltanto le animazioni automatiche conservando tutti gli override", () => {
    const projectSettings = settings();
    const cues = [cue("auto", "Automatic words"), cue("manual", "Manual words")];
    const automatic = {
      ...resolveProSubtitleCueStyle(cues[0]!, projectSettings, 0),
      fontFamily: "Bebas Neue",
      fontFamilyAutomatic: false,
      fontSize: 148,
      fontSizeAutomatic: false,
      shadowEnabled: false,
      shadowColor: "#112233",
      wordStyles: [{ index: 0, color: "#abcdef", fontSizeScale: 1.6, animation: "letterOrbit" as const }]
    };
    const manual = {
      ...resolveProSubtitleCueStyle(cues[1]!, projectSettings, 1),
      animation: "maskReveal" as const,
      animationAutomatic: false
    };
    const disabled = retargetProSubtitleAutomaticAnimations(cues, {
      ...projectSettings,
      autoVaryAnimations: true,
      cueStyles: [automatic, manual]
    }, false);

    expect(disabled[0]).toMatchObject({
      animation: projectSettings.defaultAnimation,
      animationAutomatic: true,
      fontFamily: "Bebas Neue",
      fontSize: 148,
      shadowEnabled: false,
      shadowColor: "#112233"
    });
    expect(disabled[0]?.wordStyles[0]).toEqual(automatic.wordStyles[0]);
    expect(disabled[1]).toMatchObject({ animation: "maskReveal", animationAutomatic: false });

    const reenabled = retargetProSubtitleAutomaticAnimations(cues, {
      ...projectSettings,
      autoVaryAnimations: false,
      cueStyles: disabled
    }, true);
    expect(reenabled[0]?.animation).toBe(directProSubtitleAnimation(cues[0]!, 0));
    expect(reenabled[0]?.wordStyles[0]).toEqual(automatic.wordStyles[0]);
    expect(reenabled[1]?.animation).toBe("maskReveal");
  });

  it("usa un unico pattern palette per renderer, pannello e store", () => {
    const palette = ["#111111", "#222222", "#333333"] as const;
    expect(Array.from({ length: 4 }, (_, index) => resolveProSubtitlePaletteColor(palette, 0, index))).toEqual([
      "#111111", "#222222", "#111111", "#333333"
    ]);
    expect(resolveProSubtitlePaletteColor(palette, 1, 0)).toBe("#222222");
  });

  it("usa l'ombra dello slot palette esatto e il fallback della cue per colori manuali", () => {
    const projectSettings = {
      ...settings(),
      palette: ["#FF0000", "#00ff00", "#0000ff"] as [string, string, string],
      paletteShadowEnabled: [false, true, true] as [boolean, boolean, boolean],
      paletteShadowColors: ["#110000", "#001100", "#000011"] as [string, string, string]
    };
    expect(resolveProSubtitleWordShadow("#ff0000", { shadowEnabled: true, shadowColor: "#999999" }, projectSettings)).toEqual({
      enabled: false,
      color: "#110000",
      paletteIndex: 0
    });
    expect(resolveProSubtitleWordShadow("#123456", { shadowEnabled: true, shadowColor: "#999999" }, projectSettings)).toEqual({
      enabled: true,
      color: "#999999",
      paletteIndex: null
    });
  });
});

describe("ProSubtitles title-safe layout", () => {
  it("rispetta il title-safe, manda a capo e riduce il font per il 9:16", () => {
    const { canvas } = context();
    const currentCue = cue("portrait", "A very long modern subtitle that must remain completely visible inside a narrow portrait video");
    const style = resolveProSubtitleCueStyle(currentCue, { ...settings(), defaultFontSize: 220 }, 0);
    const layout = layoutProSubtitleCue(canvas, { cue: currentCue, style, width: 540, height: 960, titleSafe: .09 });
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.baseFontSize).toBeLessThanOrEqual(220);
    expect(layout.bounds.x).toBeGreaterThanOrEqual(layout.safeRect.x - .01);
    expect(layout.bounds.x + layout.bounds.width).toBeLessThanOrEqual(layout.safeRect.x + layout.safeRect.width + .01);
    expect(layout.bounds.y).toBeGreaterThanOrEqual(layout.safeRect.y - .01);
    expect(layout.bounds.y + layout.bounds.height).toBeLessThanOrEqual(layout.safeRect.y + layout.safeRect.height + .01);
  });

  it("mantiene le interruzioni di riga esplicite e gli indici delle parole", () => {
    const tokens = tokenizeProSubtitleWords("FIRST LINE\nSECOND LINE");
    expect(tokens.map((token) => [token.index, token.text, token.breakBefore])).toEqual([
      [0, "FIRST", false], [1, "LINE", false], [2, "SECOND", true], [3, "LINE", false]
    ]);
    const { canvas } = context();
    const currentCue = cue("lines", "FIRST LINE\nSECOND LINE");
    const style = resolveProSubtitleCueStyle(currentCue, settings(), 0);
    const layout = layoutProSubtitleCue(canvas, { cue: currentCue, style, width: 1920, height: 1080, titleSafe: .09 });
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[1]?.wordIndices).toEqual([2, 3]);
  });

  it("mantiene la stessa scala tipografica fra preview, Full HD e 4K", () => {
    const { canvas } = context();
    const currentCue = cue("resolution", "SAME COMPOSITION");
    const style = resolveProSubtitleCueStyle(currentCue, { ...settings(), defaultFontSize: 108 }, 0);
    const preview = layoutProSubtitleCue(canvas, { cue: currentCue, style, width: 540, height: 960, titleSafe: .09 });
    const fullHd = layoutProSubtitleCue(canvas, { cue: currentCue, style, width: 1080, height: 1920, titleSafe: .09 });
    const fourK = layoutProSubtitleCue(canvas, { cue: currentCue, style, width: 2160, height: 3840, titleSafe: .09 });
    expect(fullHd.baseFontSize / preview.baseFontSize).toBeCloseTo(2, 5);
    expect(fourK.baseFontSize / fullHd.baseFontSize).toBeCloseTo(2, 5);
    expect(preview.bounds.width / preview.width).toBeCloseTo(fullHd.bounds.width / fullHd.width, 5);
    expect(fullHd.bounds.width / fullHd.width).toBeCloseTo(fourK.bounds.width / fourK.width, 5);
  });

  it("riduce anche un singolo token estremo finché resta interamente nel title-safe", () => {
    const { canvas } = context();
    const currentCue = cue("long-token", "W".repeat(500));
    const style = resolveProSubtitleCueStyle(currentCue, { ...settings(), defaultFontSize: 260 }, 0);
    const layout = layoutProSubtitleCue(canvas, { cue: currentCue, style, width: 540, height: 960, titleSafe: .09 });
    expect(layout.baseFontSize).toBeLessThan(6);
    expect(layout.bounds.x).toBeGreaterThanOrEqual(layout.safeRect.x - .01);
    expect(layout.bounds.x + layout.bounds.width).toBeLessThanOrEqual(layout.safeRect.x + layout.safeRect.width + .01);
  });

  it("sposta la composizione globalmente o localmente senza superare il title-safe", () => {
    const { canvas } = context();
    const currentCue = cue("position", "MOVE THE TYPE");
    const base = resolveProSubtitleCueStyle(currentCue, settings(), 0);
    const left = layoutProSubtitleCue(canvas, {
      cue: currentCue,
      style: { ...base, positionX: 0, positionY: 0, positionAutomatic: false },
      width: 1920,
      height: 1080,
      titleSafe: .09
    });
    const right = layoutProSubtitleCue(canvas, {
      cue: currentCue,
      style: { ...base, positionX: 100, positionY: 100, positionAutomatic: false },
      width: 1920,
      height: 1080,
      titleSafe: .09
    });
    expect(left.bounds.x + left.bounds.width / 2).toBeLessThan(right.bounds.x + right.bounds.width / 2);
    expect(left.bounds.y + left.bounds.height / 2).toBeLessThan(right.bounds.y + right.bounds.height / 2);
    for (const layout of [left, right]) {
      expect(layout.bounds.x).toBeGreaterThanOrEqual(layout.safeRect.x);
      expect(layout.bounds.y).toBeGreaterThanOrEqual(layout.safeRect.y);
      expect(layout.bounds.x + layout.bounds.width).toBeLessThanOrEqual(layout.safeRect.x + layout.safeRect.width);
      expect(layout.bounds.y + layout.bounds.height).toBeLessThanOrEqual(layout.safeRect.y + layout.safeRect.height);
    }
  });
});

describe("ProSubtitles Canvas renderer", () => {
  it("pulisce in trasparenza senza riempire lo sfondo e usa colori per parola", () => {
    const { recorder, canvas } = context();
    const currentCue = cue("render", "COLOR WORDS");
    const base = resolveProSubtitleCueStyle(currentCue, settings(), 0);
    const style: ProSubtitleCueStyle = {
      ...base,
      animation: "wordRush",
      wordStyles: [
        { index: 0, color: "#ff0000", fontSizeScale: 1, animation: null },
        { index: 1, color: "#00ff00", fontSizeScale: 1.2, animation: "elasticScale" }
      ]
    };
    const projectSettings = {
      ...settings(),
      palette: ["#ff0000", "#00ff00", "#0000ff"] as [string, string, string],
      paletteShadowEnabled: [false, true, true] as [boolean, boolean, boolean],
      paletteShadowColors: ["#110000", "#001100", "#000011"] as [string, string, string]
    };
    const rendered = renderProSubtitleFrame(canvas, currentCue, style, projectSettings, { width: 1080, height: 1920, timeSeconds: 1 });
    expect(rendered.active).toBe(true);
    expect(recorder.clears).toEqual([[0, 0, 1080, 1920]]);
    expect(new Set(recorder.fills.map((fill) => fill.color))).toEqual(new Set(["#ff0000", "#00ff00"]));
    expect(recorder.fills.find((fill) => fill.color === "#ff0000")).toMatchObject({ shadowColor: "rgba(0,0,0,0)", shadowBlur: 0 });
    expect(recorder.fills.find((fill) => fill.color === "#00ff00")).toMatchObject({ shadowColor: "#001100" });
  });

  it("renderizza tutte le diciassette animazioni, incluse pose per carattere, split e full-frame", () => {
    for (const animation of PRO_SUBTITLE_ANIMATIONS) {
      const { recorder, canvas } = context();
      const currentCue = cue(animation, "MOTION DESIGN");
      const base = resolveProSubtitleCueStyle(currentCue, settings(), 0);
      const style = {
        ...base,
        animation,
        wordStyles: base.wordStyles.map((wordStyle) => ({ ...wordStyle, animation }))
      };
      const result = renderProSubtitleFrame(canvas, currentCue, style, settings(), { width: 1920, height: 1080, timeSeconds: 1 });
      expect(result.active).toBe(true);
      expect(recorder.fills.length).toBeGreaterThan(0);
      if (animation === "maskReveal" || animation === "splitSlide") expect(recorder.clips.length).toBeGreaterThan(0);
      if (["letterOrbit", "trackingSweep", "letterCascade", "waveAssembly", "radialBurst"].includes(animation)) {
        expect(recorder.fills.length).toBeGreaterThan("MOTION DESIGN".split(" ").length);
      }
    }
  });

  it("compone cue sovrapposte in regioni distinte e usa confini senza frame vuoti", () => {
    const { recorder, canvas } = context();
    const projectSettings = settings();
    const rendered = renderProSubtitleCompositionFrame(canvas, [
      cue("first", "FIRST VOICE", 0, 2),
      cue("second", "SECOND VOICE", 1, 3)
    ], projectSettings, { width: 1080, height: 1920, timeSeconds: 1.5 });
    expect(rendered.activeCueIds).toEqual(["first", "second"]);
    expect(rendered.layouts).toHaveLength(2);
    expect(rendered.layouts[0]!.safeRect.y + rendered.layouts[0]!.safeRect.height)
      .toBeLessThanOrEqual(rendered.layouts[1]!.safeRect.y);
    expect(recorder.clears).toEqual([[0, 0, 1080, 1920]]);

    const boundary = renderProSubtitleCompositionFrame(canvas, [
      cue("old", "OLD", 0, 1),
      cue("new", "NEW", 1, 2)
    ], projectSettings, { width: 1080, height: 1920, timeSeconds: 1 });
    expect(boundary.activeCueIds).toEqual(["new"]);
  });

  it("non disegna fuori dall'intervallo e produce pose finite e stabili", () => {
    const { recorder, canvas } = context();
    const currentCue = cue("inactive", "HIDDEN", 2, 4);
    const style = resolveProSubtitleCueStyle(currentCue, settings(), 0);
    expect(renderProSubtitleFrame(canvas, currentCue, style, settings(), { width: 540, height: 960, timeSeconds: 1 })).toMatchObject({ active: false, layout: null });
    expect(renderProSubtitleFrame(canvas, currentCue, style, settings(), { width: 540, height: 960, timeSeconds: 4 })).toMatchObject({ active: false, layout: null });
    expect(recorder.fills).toHaveLength(0);
    for (const animation of PRO_SUBTITLE_ANIMATIONS) {
      const pose = resolveProSubtitleWordPose(animation, .5, 1, 4, 1080, 1920, 100);
      expect(Object.values(pose).every(Number.isFinite)).toBe(true);
      expect(pose.opacity).toBeGreaterThan(.9);
    }
  });

  it("applica l'opacità risolta alla frase senza alterare i colori", () => {
    const { recorder, canvas } = context();
    const currentCue = cue("opacity", "VISIBLE");
    const style = {
      ...resolveProSubtitleCueStyle(currentCue, settings(), 0),
      animation: "maskReveal" as const,
      opacity: .37,
      opacityAutomatic: false
    };
    const rendered = renderProSubtitleFrame(canvas, currentCue, style, settings(), {
      width: 1080,
      height: 1920,
      progress: .5
    });
    expect(rendered.active).toBe(true);
    expect(recorder.fills).toHaveLength(1);
    expect(recorder.fills[0]?.alpha).toBeCloseTo(.37, 5);
  });

  it("mantiene ogni glifo o parola full-frame nel title-safe con ombra in 9:16 e 16:9", () => {
    const animations = ["fullFrameOrbit", "editorialGrid", "focusCarousel"] as const;
    const sizes = [[1080, 1920], [1920, 1080]] as const;
    const positions = [[0, 0], [50, 50], [100, 100]] as const;
    const progressValues = [.12, .25, .5, .78, .9];
    for (const animation of animations) {
      for (const [width, height] of sizes) {
        for (const [positionX, positionY] of positions) {
          const currentCue = cue(`${animation}-${width}-${positionX}`, "MAKE EVERY FRAME ICONIC", 0, 3);
          const base = resolveProSubtitleCueStyle(currentCue, settings(), 0);
          const style = {
            ...base,
            animation,
            animationAutomatic: false,
            positionX,
            positionY,
            positionAutomatic: false,
            wordStyles: base.wordStyles.map((wordStyle) => ({ ...wordStyle, animation: null }))
          };
          for (const progress of progressValues) {
            const { canvas } = context();
            const first = renderProSubtitleFrame(canvas, currentCue, style, settings(), { width, height, progress });
            const second = renderProSubtitleFrame(context().canvas, currentCue, style, settings(), { width, height, progress });
            expect(first.renderedAnimation).toBe(animation);
            expect(first.paintBounds.length).toBeGreaterThan(0);
            expect(first.paintBounds).toEqual(second.paintBounds);
            const safe = first.layout!.safeRect;
            for (const bounds of first.paintBounds) {
              expect(bounds.x).toBeGreaterThanOrEqual(safe.x - .001);
              expect(bounds.y).toBeGreaterThanOrEqual(safe.y - .001);
              expect(bounds.x + bounds.width).toBeLessThanOrEqual(safe.x + safe.width + .001);
              expect(bounds.y + bounds.height).toBeLessThanOrEqual(safe.y + safe.height + .001);
            }
          }
        }
      }
    }
  });

  it("usa l'intera pagina per i preset full-frame e degrada le frasi troppo lunghe a un preset leggibile", () => {
    for (const animation of ["fullFrameOrbit", "editorialGrid", "focusCarousel"] as const) {
      const currentCue = cue(animation, "MAKE EVERY FRAME ICONIC", 0, 3);
      const style = {
        ...resolveProSubtitleCueStyle(currentCue, settings(), 0),
        animation,
        animationAutomatic: false
      };
      const rendered = renderProSubtitleFrame(context().canvas, currentCue, style, settings(), {
        width: 1080,
        height: 1920,
        progress: .22
      });
      const left = Math.min(...rendered.paintBounds.map((bounds) => bounds.x));
      const right = Math.max(...rendered.paintBounds.map((bounds) => bounds.x + bounds.width));
      const top = Math.min(...rendered.paintBounds.map((bounds) => bounds.y));
      const bottom = Math.max(...rendered.paintBounds.map((bounds) => bounds.y + bounds.height));
      expect(right - left).toBeGreaterThan(rendered.layout!.safeRect.width * .5);
      expect(bottom - top).toBeGreaterThan(rendered.layout!.safeRect.height * .5);
    }

    const longCue = cue(
      "long-full-frame",
      "THIS VERY LONG SUBTITLE CONTAINS FAR TOO MANY WORDS TO BECOME A SAFE FULL FRAME COMPOSITION",
      0,
      2
    );
    const longStyle = {
      ...resolveProSubtitleCueStyle(longCue, settings(), 0),
      animation: "fullFrameOrbit" as const,
      animationAutomatic: false
    };
    const rendered = renderProSubtitleFrame(context().canvas, longCue, longStyle, settings(), {
      width: 1080,
      height: 1920,
      progress: .5
    });
    expect(["trackingSweep", "cinematicDrift"]).toContain(rendered.renderedAnimation);
    expect(rendered.paintBounds).toEqual([]);
  });
});
