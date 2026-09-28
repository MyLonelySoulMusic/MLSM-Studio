import { describe, expect, it, vi } from "vitest";
import { ALL_FORMATS, BufferSource, EncodedPacket, EncodedPacketSink, Input } from "mediabunny";
import { frameTimestamps, referenceFrameTimestamps } from "./static-watermark-exporter";

// Real 16x16 H.264 MP4: 8 frames at 24 fps, two closed GOPs with 2 B-frames each.
// Generated using ffmpeg testsrc2 and libx264 bframes=2:b-adapt=0:keyint=4:scenecut=0.
const bFrameMp4 = "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";
function inputFixture() {
  return new Input({ formats: ALL_FORMATS, source: new BufferSource(Uint8Array.from(atob(bFrameMp4), char => char.charCodeAt(0))) });
}

describe("watermark source presentation timeline", () => {
  it("reads real B-frame metadata in presentation order, preserving every timestamp and frame", async () => {
    const input = inputFixture();
    try {
      const track = (await input.getPrimaryVideoTrack())!;
      const decodeOrder: number[] = [];
      for await (const packet of new EncodedPacketSink(track).packets()) decodeOrder.push(packet.timestamp);
      expect(decodeOrder).toHaveLength(8);
      expect(decodeOrder.some((time, index) => index > 0 && time < decodeOrder[index - 1]!)).toBe(true);
      const timeline = await frameTimestamps(track, 0, 1, new AbortController().signal);
      expect(timeline).toEqual([...decodeOrder].sort((a, b) => a - b));
      expect(timeline).toHaveLength(8);
      for (let index = 1; index < timeline.length; index++) expect(timeline[index]!).toBeGreaterThan(timeline[index - 1]!);
    } finally { input.dispose(); }
  });

  it("fixes the reported 12.042 -> 11.958666666666666 boundary before sampling either video", async () => {
    const input = inputFixture();
    const reportedOrder = [11.875333333333334, 12.042, 11.958666666666666, 12.000333333333334, 12.083666666666666];
    const packets = vi.spyOn(EncodedPacketSink.prototype, "packets").mockImplementation(async function* () {
      for (const [index, timestamp] of reportedOrder.entries()) yield new EncodedPacket(new Uint8Array([0]), index === 0 || index === 1 ? "key" : "delta", timestamp, 1 / 24);
    });
    try {
      const track = (await input.getPrimaryVideoTrack())!;
      const timeline = await frameTimestamps(track, 11.9, 12.08, new AbortController().signal);
      expect(timeline).toEqual([11.958666666666666, 12.000333333333334, 12.042]);
      const references = referenceFrameTimestamps(timeline, 11.9, 0, 0);
      for (let index = 1; index < references.length; index++) expect(references[index]!).toBeGreaterThan(references[index - 1]!);
    } finally { packets.mockRestore(); input.dispose(); }
  });
});
