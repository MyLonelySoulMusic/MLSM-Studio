import { useEffect, useRef } from "react";
interface WaveformCanvasProps { peaks: number[]; progress: number; onSeek: (progress: number) => void; }
export function WaveformCanvas({ peaks, progress, onSeek }: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return; const ratio = window.devicePixelRatio || 1; const bounds = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(bounds.width * ratio)); canvas.height = Math.max(1, Math.round(bounds.height * ratio)); if (peaks.length === 0) return;
    const context = canvas.getContext("2d"); if (!context) return; context.scale(ratio, ratio); const width = bounds.width; const height = bounds.height; const center = height / 2;
    context.clearRect(0, 0, width, height); context.fillStyle = "#0d1018"; context.fillRect(0, 0, width, height); const pairs = Math.floor(peaks.length / 2); if (pairs === 0) return;
    const drawRange = (start: number, end: number, color: string) => { context.beginPath(); context.strokeStyle = color; const from = Math.floor(start * pairs); const to = Math.ceil(end * pairs); for (let index = from; index < to; index += 1) { const x = index / Math.max(1, pairs - 1) * width; const minimum = peaks[index * 2] ?? 0; const maximum = peaks[index * 2 + 1] ?? 0; context.moveTo(x, center + minimum * center * .86); context.lineTo(x, center + maximum * center * .86); } context.stroke(); };
    drawRange(0, 1, "#586078"); drawRange(0, Math.min(1, progress), "#65e8cc");
  }, [peaks, progress]);
  return <canvas ref={canvasRef} className="waveform-canvas" aria-label="Waveform audio" onPointerDown={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); onSeek(Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))); }} />;
}
