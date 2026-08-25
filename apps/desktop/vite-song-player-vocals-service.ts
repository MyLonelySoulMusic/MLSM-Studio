import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Plugin, ViteDevServer } from "vite";

export const songPlayerVocalsRoutePrefix = "/__mlsm/song-player-vocals";
const maxUploadBytes = 512 * 1024 * 1024;
type RuntimePhase = "idle" | "installing" | "ready" | "failed";

export function songPlayerVocalRuntimePaths(root = process.cwd()) {
  const projectRoot = existsSync(resolve(root, "tools/song-player/worker.py")) ? root : resolve(root, "../..");
  return {
    projectRoot,
    python: resolve(projectRoot, process.platform === "win32" ? ".venv-song-player/Scripts/python.exe" : ".venv-song-player/bin/python"),
    worker: resolve(projectRoot, "tools/song-player/worker.py"),
    setup: resolve(projectRoot, "tools/setup_python_runtime.cjs")
  };
}

export function safeSongPlayerAudioName(value: string | null) {
  const extension = extname(basename(value || "track.wav")).toLowerCase();
  return `source${[".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".mp4", ".webm"].includes(extension) ? extension : ".wav"}`;
}

export function decodeSongPlayerWorkerOutput(output: string): Record<string, unknown> {
  const messages = output.split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; } });
  const terminal = [...messages].reverse().find((item) => item.type === "result" || item.type === "error");
  if (!terminal) throw new Error("Il worker vocale non ha restituito un risultato.");
  if (terminal.type === "error") {
    const error = terminal.error && typeof terminal.error === "object" ? terminal.error as Record<string, unknown> : null;
    throw new Error(typeof error?.message === "string" ? error.message : "Separazione vocale fallita.");
  }
  const result = terminal.result && typeof terminal.result === "object" ? terminal.result as Record<string, unknown> : null;
  if (!result) throw new Error("Risultato vocale non valido.");
  return { ...result, path: "browser://vocals.wav" };
}

const sendJson = (response: ServerResponse, status: number, value: unknown) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(value));
};

export function localSongPlayerVocalsService(): Plugin {
  const paths = songPlayerVocalRuntimePaths();
  let phase: RuntimePhase = "idle";
  let progress = 0;
  let message = "Runtime vocale da preparare";
  let error: string | null = null;
  let setupProcess: ChildProcess | null = null;
  let separationProcess: ChildProcess | null = null;
  const status = () => ({ status: phase, progress, message, error, ready: phase === "ready" });

  const verifyRuntime = () => new Promise<boolean>((resolveReady) => {
    if (!existsSync(paths.python) || !existsSync(paths.worker)) return resolveReady(false);
    const child = spawn(paths.python, [paths.worker], { cwd: paths.projectRoot, stdio: ["pipe", "pipe", "ignore"] });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString("utf8")}`.slice(-200_000); });
    child.once("error", () => resolveReady(false));
    child.once("exit", (code) => {
      try {
        const result = decodeSongPlayerWorkerOutput(output);
        const features = result.features && typeof result.features === "object" ? result.features as Record<string, unknown> : null;
        resolveReady(code === 0 && result.ready === true && features?.separateVocals === true);
      } catch { resolveReady(false); }
    });
    child.stdin?.end('{"protocolVersion":1,"action":"capabilities"}\n');
  });

  const startSetup = (server: ViteDevServer) => {
    if (setupProcess || phase === "installing") return;
    phase = "installing"; progress = 2; message = "Preparazione automatica di Demucs e pYIN"; error = null;
    setupProcess = spawn(process.execPath, [paths.setup, "song-player"], { cwd: paths.projectRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const capture = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        const marker = line.match(/^\[SONG_PLAYER_PROGRESS\]\s*(\d+)\|(.*)$/);
        if (marker) { progress = Math.min(99, Number(marker[1])); message = marker[2]?.trim() || message; }
      }
    };
    setupProcess.stdout?.on("data", capture); setupProcess.stderr?.on("data", capture);
    setupProcess.once("error", (cause) => { phase = "failed"; error = cause.message; message = "Installazione automatica non riuscita"; setupProcess = null; });
    setupProcess.once("exit", async (code) => {
      setupProcess = null;
      if (code === 0 && await verifyRuntime()) { phase = "ready"; progress = 100; message = "Demucs htdemucs e pYIN pronti"; }
      else { phase = "failed"; error = `Preparazione non riuscita (codice ${code ?? "sconosciuto"}).`; message = "Runtime vocale non disponibile"; }
    });
    server.config.logger.info("[Song Player] installazione automatica del runtime vocale avviata");
  };

  const ensureRuntime = async (server: ViteDevServer) => {
    if (phase === "ready") return;
    if (await verifyRuntime()) { phase = "ready"; progress = 100; message = "Demucs htdemucs e pYIN pronti"; error = null; return; }
    startSetup(server);
  };

  const receiveFile = async (request: IncomingMessage, target: string) => {
    let size = 0;
    const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) { size += chunk.length; callback(size > maxUploadBytes ? new Error("Il brano supera il limite di 512 MB.") : null, chunk); } });
    await pipeline(request, limiter, createWriteStream(target, { flags: "wx" }));
    if (!size) throw new Error("Il file audio è vuoto.");
  };

  return {
    name: "mlsm-song-player-vocals",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(songPlayerVocalsRoutePrefix, async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname === "/status" && request.method === "GET") return sendJson(response, 200, status());
        if (url.pathname === "/ensure" && request.method === "POST") { await ensureRuntime(server); const current=status();return sendJson(response,current.status==="failed"?503:current.ready?200:202,current); }
        if (url.pathname !== "/separate" || request.method !== "POST") return next();
        if (!status().ready) { await ensureRuntime(server); const current=status();if(!current.ready)return sendJson(response,503,current); }
        if (separationProcess) return sendJson(response, 409, { error: "Una separazione vocale è già in corso." });
        const jobRoot = await mkdtemp(resolve(tmpdir(), "mlsm-song-player-vocals-"));
        try {
          const inputPath = resolve(jobRoot, safeSongPlayerAudioName(url.searchParams.get("filename")));
          await receiveFile(request, inputPath);
          const result = await new Promise<Record<string, unknown>>((resolveResult, reject) => {
            const child = spawn(paths.python, [paths.worker], { cwd: paths.projectRoot, stdio: ["pipe", "pipe", "pipe"] });
            separationProcess = child;
            let output = ""; let stderr = "";
            child.stdout?.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString("utf8")}`.slice(-2_000_000); });
            child.stderr?.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_000); });
            child.once("error", reject);
            child.once("exit", (code) => { separationProcess = null; try { if (code !== 0 && !output) throw new Error(stderr || `Worker vocale terminato con codice ${code}.`); resolveResult(decodeSongPlayerWorkerOutput(output)); } catch (cause) { reject(cause); } });
            child.stdin?.end(`${JSON.stringify({ protocolVersion: 1, action: "separateVocals", inputPath, jobRoot })}\n`);
            request.once("aborted", () => { if (child.exitCode === null) child.kill("SIGTERM"); });
          });
          return sendJson(response, 200, result);
        } catch (cause) {
          return sendJson(response, 500, { error: cause instanceof Error ? cause.message : String(cause) });
        } finally { await rm(jobRoot, { recursive: true, force: true }); }
      });
      server.httpServer?.once("close", () => { setupProcess?.kill("SIGTERM"); separationProcess?.kill("SIGTERM"); });
    }
  };
}
