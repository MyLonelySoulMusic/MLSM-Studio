import type { Camera, Vector3 } from "three";

export interface ExportCameraFrameState {
  lastSampleTimeSeconds: number | null;
}

/**
 * Advances camera damping using video time instead of wall-clock time.
 * The first offline frame snaps to its requested pose, while subsequent frames
 * reproduce the same exponential smoothing used by the interactive preview.
 */
export function sampleExportCamera(
  camera: Camera,
  desiredPosition: Vector3,
  desiredTarget: Vector3,
  smoothTarget: Vector3,
  state: ExportCameraFrameState,
  sampleTimeSeconds: number,
  snapEveryFrame = false
): void {
  const sampleTime = Number.isFinite(sampleTimeSeconds)
    ? Math.max(0, sampleTimeSeconds)
    : (state.lastSampleTimeSeconds ?? 0) + 1 / 60;
  const firstFrame = state.lastSampleTimeSeconds === null || sampleTime <= state.lastSampleTimeSeconds;

  if (firstFrame || snapEveryFrame) {
    camera.position.copy(desiredPosition);
    smoothTarget.copy(desiredTarget);
  } else {
    const delta = Math.min(.1, sampleTime - state.lastSampleTimeSeconds!);
    camera.position.lerp(desiredPosition, 1 - Math.exp(-5.8 * delta));
    smoothTarget.lerp(desiredTarget, 1 - Math.exp(-7.2 * delta));
  }

  camera.lookAt(smoothTarget);
  camera.updateMatrixWorld(true);
  state.lastSampleTimeSeconds = sampleTime;
}
