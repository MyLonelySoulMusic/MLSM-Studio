import { describe, expect, it, vi } from "vitest";
import { ALL_FORMATS, BufferSource, BufferTarget, EncodedAudioPacketSource, EncodedPacket, EncodedPacketSink, EncodedVideoPacketSource, Input, Mp4OutputFormat, Output } from "mediabunny";
import { copyOriginalAudio } from "./static-watermark-exporter";

// Real H.264 + AAC MP4 generated from ffmpeg testsrc2 (16x16, 24 fps) and anullsrc.
const avMp4 = "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";
const openFixture = () => new Input({ formats: ALL_FORMATS, source: new BufferSource(Uint8Array.from(atob(avMp4), char => char.charCodeAt(0))) });

describe("watermark original audio finalization", () => {
  it.each([0, 0.1])("finalizes after 719 video frames even if copied AAC is marked delta (trim=%s)", async (start) => {
    const input = openFixture();
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    let result: Input | null = null;
    try {
      const audioTrack = (await input.getPrimaryAudioTrack())!;
      const videoTrack = (await input.getPrimaryVideoTrack())!;
      const audioPackets: EncodedPacket[] = [];
      for await (const packet of new EncodedPacketSink(audioTrack).packets()) audioPackets.push(packet);
      const firstVideo = (await new EncodedPacketSink(videoTrack).getFirstKeyPacket())!;
      const videoConfig = (await videoTrack.getDecoderConfig())!;
      const audioSource = new EncodedAudioPacketSource((await audioTrack.getCodec())!);
      const videoSource = new EncodedVideoPacketSource((await videoTrack.getCodec())!);
      output.addAudioTrack(audioSource);
      output.addVideoTrack(videoSource, { frameRate: 24 });
      await output.start();
      // Real encoded IDR samples exercise the real MP4 muxer, without a browser encoder.
      for (let index = 0; index < 719; index++) {
        await videoSource.add(firstVideo.clone({ timestamp: index / 24, duration: 1 / 24 }), { decoderConfig: videoConfig });
      }
      videoSource.close();
      // Some source containers flag only the first (trimmed-away) AAC packet as sync.
      const iterator = vi.spyOn(EncodedPacketSink.prototype, "packets").mockImplementation(async function* () {
        for (const packet of audioPackets) yield packet.clone({ type: "delta" });
      });
      let copied: number;
      try {
        copied = await copyOriginalAudio(audioTrack, audioSource, start, 1, new AbortController().signal);
      } finally { iterator.mockRestore(); }
      await output.finalize();
      result = new Input({ formats: ALL_FORMATS, source: new BufferSource(target.buffer!) });
      const video = (await result.getPrimaryVideoTrack())!;
      expect((await video.computePacketStats()).packetCount).toBe(719);
      const audio = (await result.getPrimaryAudioTrack())!;
      const restored: EncodedPacket[] = [];
      for await (const packet of new EncodedPacketSink(audio).packets()) restored.push(packet);
      const expected = audioPackets.filter(packet => packet.timestamp >= start && packet.timestamp < 1);
      expect(copied).toBe(expected.length);
      expect(restored).toHaveLength(expected.length);
      expect(restored[0]!.type).toBe("key");
      for (let index = 0; index < expected.length; index++) {
        expect(restored[index]!.data).toEqual(expected[index]!.data);
        expect(restored[index]!.timestamp).toBeCloseTo(expected[index]!.timestamp - start, 4);
      }
    } finally {
      if (output.state !== "finalized") await output.cancel().catch(() => undefined);
      result?.dispose();
      input.dispose();
    }
  });
});
