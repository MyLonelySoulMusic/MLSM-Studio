import { useEffect, useRef } from "react";

/** Risoluzione fissa della tela: l’elemento viene poi stirato via CSS sulla larghezza della clip. */
const drawWidth = 320;
const drawHeight = 48;

/**
 * Forma d’onda della porzione di sorgente effettivamente usata dalla clip: trimmando
 * un bordo l’onda scorre di conseguenza, così il montaggio resta leggibile a occhio.
 */
export function VideoEditorClipWaveform({ waveform, sourceInSeconds, durationSeconds, assetDurationSeconds, color }: { waveform: readonly number[]; sourceInSeconds: number; durationSeconds: number; assetDurationSeconds: number; color: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const context = target.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, drawWidth, drawHeight);
    // La forma d’onda è una sequenza di coppie minimo/massimo: due valori per colonna.
    const columns = Math.floor(waveform.length / 2);
    if (columns <= 0 || assetDurationSeconds <= 0) return;
    const from = Math.max(0, Math.min(columns - 1, Math.floor(sourceInSeconds / assetDurationSeconds * columns)));
    const to = Math.max(from + 1, Math.min(columns, Math.ceil((sourceInSeconds + durationSeconds) / assetDurationSeconds * columns)));
    const span = to - from;
    const middle = drawHeight / 2;
    context.fillStyle = color;
    for (let x = 0; x < drawWidth; x += 1) {
      const index = from + Math.floor(x / drawWidth * span);
      const minimum = waveform[index * 2] ?? 0;
      const maximum = waveform[index * 2 + 1] ?? 0;
      const top = middle - Math.max(0, maximum) * middle;
      const bottom = middle - Math.min(0, minimum) * middle;
      context.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
  }, [assetDurationSeconds, color, durationSeconds, sourceInSeconds, waveform]);

  return <canvas ref={canvas} className="video-editor-clip-waveform" width={drawWidth} height={drawHeight} aria-hidden="true" />;
}
