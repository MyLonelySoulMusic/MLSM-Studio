import { useEffect, useRef } from "react";
import type { UiTheme } from "../services/ui-preferences";
import type { StreamerAudioRuntime } from "./streamer-audio";
import type { AnalysisFrame } from "./analysis-engine";

export type AnalyzerKind = "spectrum" | "peaks" | "loudness" | "stereo" | "phase" | "spectrogram" | "waveform" | "dynamics" | "tonal";
const pink = "#e4408e";
// Exported for deterministic palette tests; the component remains the only UI export used at runtime.
// eslint-disable-next-line react-refresh/only-export-components
export const analyzerPalette = (theme: UiTheme) => theme === "night" ? {
  background: "#15151b", secondary: "#f7f3f6", muted: "#bbb3bd", grid: "#39353d", gridStrong: "#5b535e",
  soft: "#2b282f", softAccent: "#513242", guide: "#928792", stereoCenter: "#29232a", stereoMid: "#1b181d", stereoEdge: "#111013"
} : {
  background: "#f9f7f9", secondary: "#151215", muted: "#716970", grid: "#ded9dd", gridStrong: "#bdb4bb",
  soft: "#e6e0e4", softAccent: "#d899b4", guide: "#9a8c96", stereoCenter: "#f8f3f6", stereoMid: "#eee8ed", stereoEdge: "#e3dce2"
};
const format = (n: number, digits = 1) => Number.isNaN(n) ? "—" : Number.isFinite(n) ? n.toFixed(digits) : "−∞";
export function AnalyzerCanvas({ kind, runtime, freeze = false, language, speed = 2, theme, water = false }: { kind: AnalyzerKind; runtime: StreamerAudioRuntime; freeze?: boolean; language: "it" | "en"; speed?: number; theme: UiTheme; water?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null), freezeRef = useRef(freeze); freezeRef.current = freeze;
  const waterRef = useRef(water); waterRef.current = water;
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return; const ctx = canvas.getContext("2d"); if (!ctx) return;
    const palette = analyzerPalette(theme);
    let visible = true, animation = 0, lastDraw = 0, frozen: AnalysisFrame | null = null, lastSequence = -1, lastElapsed = 0;
    const meter = [-90, -90]; const history: { m: number; s: number; i: number }[] = []; const hover = { x: -1 };
    const strip = document.createElement("canvas"); const sc = strip.getContext("2d")!;
    const resize = new ResizeObserver(() => { const rect = canvas.getBoundingClientRect(), dpr = Math.min(3, window.devicePixelRatio || 1); canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr)); strip.width = Math.max(1, Math.round(rect.width)); strip.height = Math.max(1, Math.round(rect.height)); lastSequence = -1; }); resize.observe(canvas);
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true; }); observer.observe(canvas);
    const pointer = (event: PointerEvent) => { hover.x = event.clientX - canvas.getBoundingClientRect().left; }; const leave = () => { hover.x = -1; };
    canvas.addEventListener("pointermove", pointer); canvas.addEventListener("pointerleave", leave);
    function draw(time: number) {
      animation = requestAnimationFrame(draw); if (!visible || document.hidden || !ctx || !canvas) return;
      const dt = Math.min(.1, (time - lastDraw) / 1000 || .016); lastDraw = time;
      const { width: w, height: h } = canvas.getBoundingClientRect(); if (!w || !h) return;
      const withWater = waterRef.current;
      ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
      if (!freezeRef.current) frozen = runtime.frame;
      const f = frozen; const fresh = !!f && (freezeRef.current || time - runtime.receivedAt < 250);
      const x0 = 40, y0 = 20, pw = Math.max(1, w - 55), ph = Math.max(1, h - 50);
      const text = (value: string, x: number, y: number, size = 11, color = palette.muted, align: CanvasTextAlign = "left") => { ctx.font = `${size >= 20 ? "600 " : ""}${size}px ui-monospace, SFMono-Regular, monospace`; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(value, x, y); };
      const line = (x1: number, y1: number, x2: number, y2: number, color = palette.grid) => { ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
      if (withWater) ctx.clearRect(0, 0, w, h);
      if (kind === "stereo") {
        const background = ctx.createRadialGradient(w / 2, h * .48, 0, w / 2, h * .48, Math.max(w, h) * .68);
        background.addColorStop(0, palette.stereoCenter); background.addColorStop(.58, palette.stereoMid); background.addColorStop(1, palette.stereoEdge);
        ctx.save(); ctx.globalAlpha = withWater ? .24 : 1; ctx.fillStyle = background; ctx.fillRect(0, 0, w, h); ctx.restore();
      } else if (!withWater) { ctx.fillStyle = palette.background; ctx.fillRect(0, 0, w, h); }
      const frequencyX = (hz: number) => x0 + Math.log(hz / 20) / Math.log(Math.min(20000, (f?.sampleRate ?? 48000) / 2) / 20) * pw;
      if (kind === "spectrum" || kind === "waveform" || kind === "spectrogram") {
        for (let d = 0; d <= 4; d++) { const y = y0 + d * ph / 4; line(x0, y, x0 + pw, y); text(kind === "waveform" ? (1 - d / 2).toFixed(1) : String(-d * 24), 5, y + 4); }
        if (kind !== "waveform") for (const hz of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) { if (hz > (f?.sampleRate ?? 48000) / 2) continue; const x = frequencyX(hz); if (kind === "spectrum") line(x, y0, x, y0 + ph); text(hz >= 1000 ? `${hz / 1000}k` : String(hz), x, h - 9, 9, palette.muted, "center"); }
      }
      if (!f) { text(language === "it" ? "In attesa del segnale audio" : "Waiting for audio signal", w / 2, h / 2, 12, palette.muted, "center"); return; }
      if (f.elapsed < lastElapsed) { history.length = 0; sc.clearRect(0, 0, strip.width, strip.height); } lastElapsed = f.elapsed;
      const newFrame = f.sequence !== lastSequence;
      if (kind === "spectrum") {
        for (const [values, color] of [[f.spectrumRight, palette.secondary], [f.spectrumLeft, pink]] as const) { ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.6; for (let px = 0; px <= pw; px++) { const hz = 20 * (Math.min(20000, f.sampleRate / 2) / 20) ** (px / pw), bin = Math.min(values.length - 1, Math.max(1, Math.round(hz * values.length * 2 / f.sampleRate))); const db = values[bin]! - (fresh ? 0 : Math.min(120, (time - runtime.receivedAt) / 25)); const y = y0 + Math.max(0, Math.min(1, -db / 96)) * ph; if (!px) ctx.moveTo(x0 + px, y); else ctx.lineTo(x0 + px, y); } ctx.stroke(); }
        if (hover.x >= x0 && hover.x <= x0 + pw) { const hz = 20 * (Math.min(20000, f.sampleRate / 2) / 20) ** ((hover.x - x0) / pw), bin = Math.min(f.spectrumLeft.length - 1, Math.round(hz * f.spectrumLeft.length * 2 / f.sampleRate)); line(hover.x, y0, hover.x, y0 + ph, palette.guide); text(`${hz < 1000 ? hz.toFixed(0) + " Hz" : (hz / 1000).toFixed(2) + " kHz"} · L ${format(f.spectrumLeft[bin]!)} / R ${format(f.spectrumRight[bin]!)} dBFS`, x0 + 5, 13, 10); }
      } else if (kind === "waveform") {
        line(x0, y0 + ph / 2, x0 + pw, y0 + ph / 2, palette.gridStrong);
        for (const [wave, color] of [[f.waveRight, palette.secondary], [f.waveLeft, pink]] as const) { ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.3; for (let i = 0; i < wave.length; i++) { const x = x0 + i / (wave.length - 1) * pw, y = y0 + ph / 2 - (fresh ? wave[i]! : 0) * ph * .45; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke(); } text(`${(1024 / f.sampleRate * 1000).toFixed(1)} ms`, w - 15, h - 8, 10, palette.muted, "right");
      } else if (kind === "spectrogram") {
        if (newFrame && fresh) { const step = Math.max(1, speed); sc.drawImage(strip, 0, -step); for (let x = 0; x < pw; x++) { const hz = 20 * (Math.min(20000, f.sampleRate / 2) / 20) ** (x / pw), bin = Math.min(f.spectrumLeft.length - 1, Math.max(1, Math.round(hz * f.spectrumLeft.length * 2 / f.sampleRate))); const db = Math.max(f.spectrumLeft[bin]!, f.spectrumRight[bin]!); const energy = Math.max(0, Math.min(1, (db + 90) / 90)); sc.fillStyle = `rgb(${Math.round(25 + 205 * energy)} ${Math.round(22 + 50 * energy)} ${Math.round(29 + 106 * energy)})`; sc.fillRect(x0 + x, y0 + ph - step, 1, step); } }
        ctx.drawImage(strip, 0, 0, w, h); text(language === "it" ? "tempo ↓ · frequenza →" : "time ↓ · frequency →", x0, 14, 10);
      } else if (kind === "stereo") {
        const radius = Math.min(w * .43, h * .39), cx = w / 2, cy = h * .48;
        const grid = theme === "night" ? "rgba(235,225,232,.16)" : "rgba(64,50,59,.15)", gridStrong = theme === "night" ? "rgba(235,225,232,.3)" : "rgba(64,50,59,.3)";
        ctx.save();
        for (const scale of [.25, .5, .75, 1]) { ctx.beginPath(); ctx.strokeStyle = scale === 1 ? gridStrong : grid; ctx.lineWidth = scale === 1 ? 1.2 : .7; ctx.arc(cx, cy, radius * scale, 0, Math.PI * 2); ctx.stroke(); }
        line(cx - radius, cy, cx + radius, cy, gridStrong); line(cx, cy - radius, cx, cy + radius, gridStrong);
        line(cx - radius * .707, cy - radius * .707, cx + radius * .707, cy + radius * .707, grid);
        line(cx - radius * .707, cy + radius * .707, cx + radius * .707, cy - radius * .707, grid);
        ctx.beginPath(); ctx.strokeStyle = "rgba(228,64,142,.22)"; ctx.setLineDash([3, 5]); ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius); ctx.stroke(); ctx.setLineDash([]);
        if (fresh) {
          const plot = () => { ctx.beginPath(); for (let i = 0; i < f.waveLeft.length; i += 2) { const l = f.waveLeft[i]!, r = f.waveRight[i]!, x = cx + (r - l) * radius * .66, y = cy - (l + r) * radius * .66; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke(); };
          ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = "rgba(228,64,142,.18)"; ctx.lineWidth = 6; ctx.shadowColor = "#e4408e"; ctx.shadowBlur = 12; plot();
          ctx.strokeStyle = "rgba(255,151,203,.92)"; ctx.lineWidth = 1.15; ctx.shadowBlur = 4; plot();
        }
        ctx.restore();
        const state = !fresh || Math.max(...f.peak) < -90 ? (language === "it" ? "ATTESA SEGNALE" : "WAITING FOR SIGNAL") : f.correlation < 0 ? (language === "it" ? "FUORI FASE" : "OUT OF PHASE") : f.width < .00001 && f.correlation > .99999 ? "MONO · L=R" : f.width < 24 ? (language === "it" ? "STRETTO" : "NARROW") : f.width < 65 ? "STEREO" : (language === "it" ? "AMPIO" : "WIDE");
        text("GONIOMETER", 14, 18, 9, palette.muted); text(state, w - 14, 18, 9, f.correlation < 0 ? "#ff7897" : "#e4408e", "right");
        text("M", cx, cy - radius - 7, 9, palette.muted, "center"); text("S−", cx - radius - 7, cy + 4, 9, "#d64c8d", "right"); text("S+", cx + radius + 7, cy + 4, 9, "#d64c8d");
        text("L", cx - radius * .77, cy - radius * .72, 11, "#e4408e", "center"); text("R", cx + radius * .77, cy - radius * .72, 11, palette.secondary, "center");
        text(`${language === "it" ? "AMPIEZZA" : "WIDTH"}  ${format(f.width, 0)}%`, 14, h - 12, 10, palette.muted);
        text(`CORR  ${f.correlation >= 0 ? "+" : ""}${format(f.correlation, 2)}   LOW  ${f.lowCorrelation >= 0 ? "+" : ""}${format(f.lowCorrelation, 2)}`, w - 14, h - 12, 10, palette.muted, "right");
      } else if (kind === "phase") {
        const left = 25, range = w - 50, y = h * .5; ctx.fillStyle = palette.soft; ctx.fillRect(left, y, range, 8); ctx.fillStyle = palette.softAccent; ctx.fillRect(left, y, range / 2, 8); const x = left + (f.correlation + 1) / 2 * range; ctx.fillStyle = palette.secondary; ctx.fillRect(x - 2, y - 8, 4, 24); for (const n of [-1, 0, 1]) text(`${n > 0 ? "+" : ""}${n}`, left + (n + 1) / 2 * range, y + 35, 11, palette.muted, "center"); text(format(f.correlation, 2), w / 2, y - 22, 26, palette.secondary, "center"); text(`Bass <120 Hz: ${format(f.lowCorrelation, 2)}`, w / 2, h - 12, 10, palette.muted, "center");
      } else if (kind === "peaks") {
        const top = 34, bottom = h - 47, height = bottom - top;
        for (let c = 0; c < 2; c++) { const target = fresh ? Math.max(-90, f.peak[c]!) : -90; meter[c] = target >= meter[c]! ? target : Math.max(target, meter[c]! - dt * 24); const x = w * (.25 + c * .34), bw = Math.min(35, w * .15); ctx.fillStyle = palette.soft; ctx.fillRect(x, top, bw, height); const fraction = Math.min(1, Math.max(0, (meter[c]! + 60) / 60)); ctx.fillStyle = c ? palette.secondary : pink; ctx.fillRect(x, bottom - fraction * height, bw, fraction * height); const holdY = top + Math.max(0, Math.min(1, -f.hold[c]! / 60)) * height; line(x - 3, holdY, x + bw + 3, holdY, "#ad2d64"); text(c ? "R" : "L", x + bw / 2, 20, 12, c ? palette.secondary : pink, "center"); text(format(f.peak[c]!), x + bw / 2, h - 26, 11, palette.secondary, "center"); text(`${format(f.truePeak[c]!)} TP`, x + bw / 2, h - 10, 9, palette.muted, "center"); if (f.clip[c]) { ctx.fillStyle = "#b8294c"; ctx.fillRect(x, top - 9, bw, 5); } }
        for (const db of [0, -6, -12, -24, -36, -48, -60]) text(String(db), 5, top + -db / 60 * height + 3, 9); text("dBFS / dBTP", w - 8, 14, 9, palette.muted, "right");
      } else if (kind === "loudness") {
        text(format(f.momentary), 22, 53, Math.min(43, w / 8), palette.secondary); text("LUFS · M", 24, 72, 11, pink);
        const metrics = [["S", f.shortTerm], ["I", f.integrated], ["LRA · LU", f.lra], ["Max M", f.maxMomentary], ["Max S", f.maxShortTerm], ["Max TP", f.maxTruePeak]] as const;
        metrics.forEach(([label, value], i) => { const x = w * .43 + (i % 3) * w * .18, y = 28 + Math.floor(i / 3) * 40; text(label, x, y, 9); text(format(value), x, y + 18, 16, palette.secondary); });
        if (newFrame) { history.push({ m: f.momentary, s: f.shortTerm, i: f.integrated }); if (history.length > 900) history.shift(); }
        const hy = 112, hh = Math.max(20, h - hy - 24); for (const level of [-12, -24, -36]) { const y = hy + -level / 60 * hh; line(22, y, w - 18, y); text(String(level), 2, y + 3, 8); }
        for (const [key, color] of [["m", pink], ["s", palette.secondary], ["i", palette.muted]] as const) { ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.beginPath(); history.forEach((v, i) => { const x = 22 + i / 899 * (w - 40), y = hy + Math.max(0, Math.min(1, -v[key] / 60)) * hh; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); } text("M / S / I · 30 s", 22, h - 8, 9);
      } else if (kind === "dynamics") {
        text("L", w * .55, 24, 11, pink); text("R", w * .8, 24, 11, palette.secondary);
        for (const [label, values, row] of [["RMS · dBFS", f.rms, 0], ["Peak · dBFS", f.peak, 1], ["Crest · dB", [f.peak[0] - f.rms[0], f.peak[1] - f.rms[1]], 2], ["True peak · dBTP", f.truePeak, 3]] as const) { const y = 53 + row * Math.max(27, (h - 70) / 4); text(label, 12, y, 10); text(format(values[0]!), w * .55, y, 16, palette.secondary); text(format(values[1]!), w * .8, y, 16, palette.secondary); }
      } else if (kind === "tonal") {
        const names = ["Sub", "Bass", "Low mid", "Mid", "High mid", "High"];
        for (let i = 0; i < 6; i++) { const y = 24 + i * (h - 36) / 6; text(names[i]!, 12, y, 10); ctx.fillStyle = palette.soft; ctx.fillRect(80, y - 8, Math.max(10, w - 135), 7); ctx.fillStyle = pink; ctx.fillRect(80, y - 8, Math.max(10, w - 135) * f.bands[i]!, 7); text(`${format(f.bands[i]! * 100, 0)}%`, w - 9, y, 10, palette.secondary, "right"); }
      }
      lastSequence = f.sequence;
    }
    animation = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(animation); resize.disconnect(); observer.disconnect(); canvas.removeEventListener("pointermove", pointer); canvas.removeEventListener("pointerleave", leave); };
  }, [kind, runtime, language, speed, theme]);
  return <canvas ref={ref} className="sav-canvas" data-ripple-source={kind === "stereo" || kind === "peaks" ? kind : undefined} role="img" aria-label={`${kind} · ${language === "it" ? "analisi audio stereo in tempo reale" : "live stereo audio analysis"}`} />;
}
