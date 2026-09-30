import { describe, expect, it } from "vitest";
import { defaultLayout } from "./streamer-layout";

describe("Streamer default workspace", () => {
  it("opens with only the six essential monitoring widgets in the requested order", () => {
    const layout = defaultLayout();
    expect(layout.filter(panel => panel.visible).map(panel => panel.id)).toEqual(["vinyl", "peaks", "spectrum", "loudness", "stereo", "phase"]);
    expect(layout.filter(panel => !panel.visible).map(panel => panel.id)).toEqual(["spectrogram", "waveform", "dynamics", "tonal", "track"]);
  });
});
