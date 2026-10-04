// @vitest-environment node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bundled offline AAC runtime", () => {
  it("encodes real stereo audio without native AudioEncoder or an external backend", () => {
    // A fresh process avoids Vitest module mocks; no --input-type=module is inherited by the codec worker.
    const result = spawnSync(process.execPath, ["-e", `
      (async () => {
        const m = await import("mediabunny");
        if (await m.canEncodeAudio("aac")) throw new Error("Expected no native encoder in Node");
        const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
        registerAacEncoder();
        const target = new m.BufferTarget();
        const output = new m.Output({ format: new m.Mp4OutputFormat(), target });
        const source = new m.AudioSampleSource({ codec: "aac", bitrate: 320000 });
        output.addAudioTrack(source); await output.start();
        const data = new Float32Array(48000 * 2);
        for (let n = 0; n < 48000; n++) {
          data[2*n] = .2 * Math.sin(2*Math.PI*440*n/48000);
          data[2*n+1] = .2 * Math.sin(2*Math.PI*880*n/48000);
        }
        const sample = new m.AudioSample({ data, format: "f32", numberOfChannels: 2, sampleRate: 48000, timestamp: 0 });
        try { await source.add(sample); } finally { sample.close(); }
        source.close(); await output.finalize();
        const input = new m.Input({ formats: m.ALL_FORMATS, source: new m.BufferSource(target.buffer) });
        try {
          const track = await input.getPrimaryAudioTrack();
          console.log(JSON.stringify({ codec: await track.getCodec(), channels: await track.getNumberOfChannels(), sampleRate: await track.getSampleRate(), packets: (await track.computePacketStats()).packetCount, bytes: target.buffer.byteLength }));
        } finally { input.dispose(); }
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `], { cwd: process.cwd(), encoding: "utf8", timeout: 20_000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const stats = JSON.parse(result.stdout.trim());
    expect(stats).toMatchObject({ codec: "aac", channels: 2, sampleRate: 48_000 });
    expect(stats.packets).toBeGreaterThan(40);
    expect(stats.bytes).toBeGreaterThan(1000);
  }, 25_000);

  it("permits the bundled WASM and blob worker without allowing arbitrary JS eval in desktop builds", () => {
    const config = JSON.parse(readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"));
    const csp = config.app.security.csp as string;
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).not.toContain("'unsafe-eval'");
  });
});
