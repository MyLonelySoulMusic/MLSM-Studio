import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { sampleExportCamera, type ExportCameraFrameState } from "./viewport-export-camera";

describe("offline viewport camera", () => {
  it("parte dalla posa del primo frame e avanza usando il tempo del video", () => {
    const camera = new PerspectiveCamera();
    const desiredPosition = new Vector3(0, 3, 11.5);
    const desiredTarget = new Vector3(0, 2, 0);
    const smoothTarget = new Vector3();
    const state: ExportCameraFrameState = { lastSampleTimeSeconds: null };

    sampleExportCamera(camera, desiredPosition, desiredTarget, smoothTarget, state, 1 / 120);
    expect(camera.position.toArray()).toEqual([0, 3, 11.5]);
    expect(smoothTarget.toArray()).toEqual([0, 2, 0]);

    for (let frame = 1; frame <= 600; frame += 1) {
      desiredPosition.y = 3 - frame * .12;
      desiredTarget.y = 2 - frame * .12;
      sampleExportCamera(camera, desiredPosition, desiredTarget, smoothTarget, state, (frame + .5) / 60);
    }

    expect(camera.position.y).toBeLessThan(-65);
    expect(smoothTarget.y).toBeLessThan(-66);
    expect(state.lastSampleTimeSeconds).toBeCloseTo(600.5 / 60);
  });

  it("si reinizializza senza trascinare la posa di una preview precedente", () => {
    const camera = new PerspectiveCamera();
    camera.position.set(50, 50, 50);
    const desiredPosition = new Vector3(-2, -8, 11.5);
    const desiredTarget = new Vector3(-2, -9, 0);
    const smoothTarget = new Vector3(40, 40, 40);
    const state: ExportCameraFrameState = { lastSampleTimeSeconds: null };

    sampleExportCamera(camera, desiredPosition, desiredTarget, smoothTarget, state, .01);

    expect(camera.position.toArray()).toEqual(desiredPosition.toArray());
    expect(smoothTarget.toArray()).toEqual(desiredTarget.toArray());
  });
});
