import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Plugin } from "vite";
import { songPlayerVocalRuntimePaths } from "./vite-song-player-vocals-service";

export const streamerWhisperRoute = "/__mlsm/streamer-whisper";
export const maxLivePcmBytes = 16000 * 8 * 4;

/** One private streaming process; first-use setup reports progress. */
export class WhisperSession {
  readonly id: string;
  progress: Record<string, unknown> = { stage: "runtime", percent: null };
  readonly ready: Promise<Record<string, unknown>>;
  private child: ChildProcess;
  private pending: { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private buffer = "";
  private closed = false;
  get isClosed() { return this.closed; }
  private stderr = "";
  private idle: ReturnType<typeof setTimeout>;
  constructor(python: string, worker: string, root: string, spawnProcess: (command: string, args: string[], options: SpawnOptions) => ChildProcess = spawn, id: string = randomUUID()) {
    this.id = id;
    this.child = spawnProcess(python, ["-u", worker], { cwd: root, env: { ...process.env, MLSM_WHISPER_CACHE: resolve(root, ".transformers-cache/faster-whisper") }, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.ready = this.wait(1200000);
    this.idle = setTimeout(() => this.close(), 1200000);
    this.child.stderr?.on("data", (data: Buffer) => { this.stderr = `${this.stderr}${data.toString()}`.slice(-3000); });
    this.child.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      let boundary: number;
      while ((boundary = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, boundary); this.buffer = this.buffer.slice(boundary + 1);
        try {
          const value = JSON.parse(line) as Record<string, unknown>;
          if (value.type === "progress") { this.progress = value; continue; }
          if (value.type === "ready") { this.progress = { stage: "ready", percent: 100 }; clearTimeout(this.idle); this.idle = setTimeout(() => this.close(), 120000); }
          if (!this.pending) continue;
          const pending = this.pending; this.pending = null; clearTimeout(pending.timer);
          if (value.type === "error") { pending.reject(new Error(String(value.error))); this.close(); }
          else pending.resolve(value);
        } catch { /* Non-protocol library log. */ }
      }
    });
    this.child.once("error", error => this.fail(error));
    this.child.once("exit", code => this.fail(new Error(this.stderr || `Whisper stopped (${code})`)));
  }
  private wait(timeout: number) {
    return new Promise<Record<string, unknown>>((resolveResult, reject) => {
      const timer = setTimeout(() => this.fail(new Error("Whisper timed out")), timeout);
      this.pending = { resolve: resolveResult, reject, timer };
    });
  }
  private fail(error: Error) { const pending = this.pending; this.pending = null; if (pending) { clearTimeout(pending.timer); pending.reject(error); } this.close(); }
  async transcribe(pcm: Buffer, language: string, final = false) {
    if (this.closed) throw new Error("Whisper session expired");
    if (this.pending) throw new Error("Whisper is already processing a block");
    if ((!pcm.length && !final) || pcm.length % 4 || pcm.length > maxLivePcmBytes) throw new Error("Invalid audio block");
    clearTimeout(this.idle); this.idle = setTimeout(() => this.close(), 120000);
    const result = this.wait(60000);
    this.child.stdin?.write(`${JSON.stringify({ pcm: pcm.toString("base64"), language, final })}\n`, error => { if (error) this.fail(error); });
    return result;
  }
  close() {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.idle);
    const pending = this.pending; this.pending = null;
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error("Whisper session closed")); }
    this.child.stdin?.end();
    if (this.child.pid && this.child.exitCode === null) {
      try {
        if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(this.child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        else process.kill(-this.child.pid, "SIGKILL");
      } catch { this.child.kill("SIGKILL"); }
    } else this.child.kill("SIGKILL");
  }
}

export function localStreamerWhisperService(): Plugin {
  const paths = songPlayerVocalRuntimePaths();
  const sessions = new Map<string, WhisperSession>();
  return { name: "mlsm-streamer-whisper", configureServer(server) {
    server.middlewares.use(streamerWhisperRoute, async (request, response) => {
      const send = (code: number, value: unknown) => { if (response.destroyed) return; response.statusCode = code; response.setHeader("Content-Type", "application/json"); response.setHeader("Cache-Control", "no-store"); response.end(JSON.stringify(value)); };
      // Do not permit another website to start or send audio to the local engine.
      try {
        const origin = request.headers.origin;
        if (origin && new URL(origin).host !== request.headers.host) return send(403, { error: "Cross-origin request denied" });
        const url = new URL(request.url ?? "/", "http://localhost");
        if (request.method === "POST" && url.pathname === "/start") {
          for (const [id, session] of sessions) if (session.isClosed) sessions.delete(id);
          if (!existsSync(paths.python)) return send(503, { error: "Whisper runtime missing. Restore the existing Song Player runtime in Settings; no installation is started here." });
          if (sessions.size >= 2) return send(409, { error: "Close another live transcription session first" });
          const requestedId = url.searchParams.get("id") ?? randomUUID();
          if (!/^[a-f\d-]{36}$/i.test(requestedId) || sessions.has(requestedId)) return send(400, { error: "Invalid or duplicate session id" });
          const session = new WhisperSession(paths.python, resolve(paths.projectRoot, "tools/song-player/live_whisper.py"), paths.projectRoot, spawn, requestedId);
          sessions.set(session.id, session);
          response.once("close", () => { if (!response.writableEnded) { session.close(); sessions.delete(session.id); } });
          try { return send(200, { ...(await session.ready), id: session.id }); }
          catch (error) { sessions.delete(session.id); session.close(); throw error; }
        }
        const id = url.pathname.split("/")[1] ?? ""; const session = sessions.get(id);
        if (!session) return send(404, { error: "Whisper session expired" });
        if (request.method === "GET" && url.pathname.endsWith("/progress")) return send(200, session.progress);
        if (request.method === "DELETE") { session.close(); sessions.delete(id); return send(200, { stopped: true }); }
        if (request.method === "POST") {
          const chunks: Buffer[] = []; let bytes = 0;
          for await (const chunk of request) { const data = Buffer.from(chunk); bytes += data.length; if (bytes > maxLivePcmBytes) return send(413, { error: "Audio block too large" }); chunks.push(data); }
          response.once("close", () => { if (!response.writableEnded) { session.close(); sessions.delete(id); } });
          return send(200, await session.transcribe(Buffer.concat(chunks), url.searchParams.get("language") ?? "auto", url.searchParams.get("final") === "1"));
        }
        send(405, { error: "Method not allowed" });
      } catch (error) { send(503, { error: error instanceof Error ? error.message : String(error) }); }
    });
    server.httpServer?.once("close", () => { for (const session of sessions.values()) session.close(); sessions.clear(); });
  } };
}
