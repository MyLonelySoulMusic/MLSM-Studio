export interface FrameInterpolationMediaAudit {
  frameCount: number;
  fps: number;
  durationSeconds: number;
  width: number;
  height: number;
  sampleAspectRatio?: string;
  displayAspectRatio?: number;
  hasAudio: boolean;
}

export function expectedInterpolationFrameCount(sourceFrames: number, sourceFps: number, targetFps: number): number {
  if (!Number.isFinite(sourceFrames) || sourceFrames < 3 || !Number.isFinite(sourceFps) || sourceFps <= 0 || !Number.isFinite(targetFps) || targetFps <= sourceFps) {
    throw new Error("Parametri di interpolazione non validi.");
  }
  return Math.floor((sourceFrames - 2) * targetFps / sourceFps) + 1;
}

export function assertInterpolationIntegrity(input: { source: FrameInterpolationMediaAudit; output: FrameInterpolationMediaAudit; targetFps: number }): void {
  const { source, output, targetFps } = input;
  if (!output.frameCount || output.durationSeconds <= 0) throw new Error("Il risultato interpolato è vuoto.");
  const fpsTolerance = Math.max(.05, targetFps * .01);
  if (Math.abs(output.fps - targetFps) > fpsTolerance) throw new Error(`FPS interpolati non validi: ${output.fps} invece di ${targetFps}.`);
  const minimum = expectedInterpolationFrameCount(source.frameCount, source.fps, targetFps);
  if (output.frameCount < minimum) throw new Error(`Conteggio frame interpolato incompleto: ${output.frameCount} < ${minimum}.`);
  if (Math.abs(output.width - source.width) > 1 || Math.abs(output.height - source.height) > 1) throw new Error("La risoluzione interpolata non coincide con la sorgente.");
  if (source.sampleAspectRatio && output.sampleAspectRatio && source.sampleAspectRatio !== output.sampleAspectRatio) throw new Error("Il sample aspect ratio è cambiato.");
  if (source.displayAspectRatio && output.displayAspectRatio && Math.abs(source.displayAspectRatio - output.displayAspectRatio) > .01) throw new Error("Il display aspect ratio è cambiato.");
  if (source.hasAudio && !output.hasAudio) throw new Error("L'audio della sorgente è stato perso.");
  const expectedDuration = source.durationSeconds;
  if (Math.abs(output.durationSeconds - expectedDuration) > Math.max(.08, expectedDuration * .04)) throw new Error("La durata interpolata non coincide con quella sorgente.");
}
