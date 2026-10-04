import { EventEmitter } from "node:events";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { SpawnOptions, ChildProcess } from "node:child_process";
const mocks = { spawn: vi.fn<(command: string, args: string[], options: SpawnOptions) => ChildProcess>() };
import { WhisperSession, maxLivePcmBytes } from "./vite-streamer-whisper";
class Child extends EventEmitter {
  stdout = new EventEmitter(); stderr = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() }; kill = vi.fn();
}
describe("persistent Whisper host", () => {
  let child: Child;
  beforeEach(() => { vi.useFakeTimers(); child = new Child(); mocks.spawn.mockReturnValue(child as unknown as ChildProcess); });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
  it("loads once, handles split JSON lines and transcribes multiple blocks", async () => {
    const session = new WhisperSession("python", "worker.py", "/tmp", mocks.spawn);
    child.stdout.emit("data", Buffer.from('{"type":"progress","stage":"download","percent":25}\n'));
    expect(session.progress).toMatchObject({ stage: "download", percent: 25 });
    child.stdout.emit("data", Buffer.from('{"type":"rea')); child.stdout.emit("data", Buffer.from('dy","model":"medium"}\n'));
    expect(await session.ready).toMatchObject({ model: "medium" });
    for (let i = 0; i < 2; i++) {
      const result = session.transcribe(Buffer.alloc(16000 * 4), "auto");
      child.stdout.emit("data", Buffer.from('{"type":"result","phrases":[]}\n'));
      await expect(result).resolves.toMatchObject({ phrases: [] });
    }
    expect(mocks.spawn).toHaveBeenCalledOnce(); expect(child.stdin.write).toHaveBeenCalledTimes(2);
    session.close(); expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });
  it("flushes the final hypothesis with an empty audio block", async () => {
    const session = new WhisperSession("python", "worker.py", "/tmp", mocks.spawn);
    child.stdout.emit("data", Buffer.from('{"type":"ready"}\n')); await session.ready;
    const result = session.transcribe(Buffer.alloc(0), "en", true);
    expect(JSON.parse(child.stdin.write.mock.calls[0]![0] as string)).toMatchObject({ final: true, pcm: "" });
    child.stdout.emit("data", Buffer.from('{"type":"result","phrases":[]}\n')); await result; session.close();
  });
  it("rejects oversize PCM and stops idle sessions", async () => {
    const session = new WhisperSession("python", "worker.py", "/tmp", mocks.spawn);
    child.stdout.emit("data", Buffer.from('{"type":"ready"}\n')); await session.ready;
    await expect(session.transcribe(Buffer.alloc(maxLivePcmBytes + 4), "auto")).rejects.toThrow("Invalid audio");
    vi.advanceTimersByTime(120000); expect(child.kill).toHaveBeenCalledOnce();
  });
  it("fails visibly if Whisper exits during startup", async () => {
    const session = new WhisperSession("python", "worker.py", "/tmp", mocks.spawn); const failed = expect(session.ready).rejects.toThrow("missing weights");
    child.stderr.emit("data", Buffer.from("missing weights")); child.emit("exit", 1); await failed;
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
