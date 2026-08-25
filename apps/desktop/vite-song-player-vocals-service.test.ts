import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeSongPlayerWorkerOutput, safeSongPlayerAudioName, songPlayerVocalRuntimePaths } from "./vite-song-player-vocals-service";

describe("Song Player vocal service locale", () => {
  it("keeps runtime files isolated and resolves the bundled worker", () => {
    const paths = songPlayerVocalRuntimePaths(resolve("/tmp", "mlsm"));
    expect(paths.python).toContain(".venv-song-player");
    expect(paths.worker).toContain("tools/song-player/worker.py");
    expect(paths.setup).toContain("tools/setup_python_runtime.cjs");
  });
  it("accepts only known audio extensions and never trusts the uploaded filename", () => {
    expect(safeSongPlayerAudioName("../../song.FLAC")).toBe("source.flac");
    expect(safeSongPlayerAudioName("danger.exe")).toBe("source.wav");
  });
  it("decodes the terminal worker result and hides its temporary stem path", () => {
    const output = `${JSON.stringify({ protocolVersion:1,type:"progress",progress:.5,message:"Demucs" })}\n${JSON.stringify({ protocolVersion:1,type:"result",result:{kind:"separateVocals",path:"/tmp/private/vocals.wav",model:"htdemucs",pitchAlgorithm:"pyin",pitch:[[.2,64,.9]]} })}\n`;
    expect(decodeSongPlayerWorkerOutput(output)).toMatchObject({ kind:"separateVocals",path:"browser://vocals.wav",pitch:[[.2,64,.9]] });
  });
  it("surfaces the worker error instead of inventing notes from the mix", () => {
    expect(() => decodeSongPlayerWorkerOutput(JSON.stringify({type:"error",error:{message:"Demucs failed"}}))).toThrow(/Demucs failed/);
  });
});
