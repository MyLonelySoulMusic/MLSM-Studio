import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
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

export function decodeSongPlayerWorkerOutput(output: string, exposeTemporaryPath = false): Record<string, unknown> {
  const messages = output.split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; } });
  const terminal = [...messages].reverse().find((item) => item.type === "result" || item.type === "error");
  if (!terminal) throw new Error("Il worker vocale non ha restituito un risultato.");
  if (terminal.type === "error") {
    const error = terminal.error && typeof terminal.error === "object" ? terminal.error as Record<string, unknown> : null;
    throw new Error(typeof error?.message === "string" ? error.message : "Separazione vocale fallita.");
  }
  const result = terminal.result && typeof terminal.result === "object" ? terminal.result as Record<string, unknown> : null;
  if (!result) throw new Error("Risultato vocale non valido.");
  return typeof result.path === "string" ? { ...result, path: exposeTemporaryPath ? result.path : "browser://vocals.wav" } : { ...result };
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
  const stems = new Map<string, { root: string; path: string; timer: ReturnType<typeof setTimeout> }>();
  const visualSessions = new Map<string, { root: string; metadata: { filename: string; language: string; anchors: unknown[] }; timer: ReturnType<typeof setTimeout> }>();
  const releaseStem = async (id: string) => { const artifact = stems.get(id); if (!artifact) return; stems.delete(id); clearTimeout(artifact.timer); await rm(artifact.root, { recursive: true, force: true }); };
  const stemIdFromUrl = (value: unknown) => typeof value === "string" ? value.match(/^\/__mlsm\/song-player-vocals\/stem\/([a-f0-9-]+)$/i)?.[1] ?? null : null;
  const retainStem = (root: string, path: string) => { const id = randomUUID(); const timer = setTimeout(() => { void releaseStem(id); }, 60 * 60 * 1000); stems.set(id, { root, path, timer }); return `${songPlayerVocalsRoutePrefix}/stem/${id}`; };
  const status = () => ({ status: phase, progress, message, error, ready: phase === "ready" });

  const verifyRuntimeFeature = (requiredFeature = "separateVocals") => new Promise<boolean>((resolveReady) => {
    if (!existsSync(paths.python) || !existsSync(paths.worker)) return resolveReady(false);
    const child = spawn(paths.python, [paths.worker], { cwd: paths.projectRoot, stdio: ["pipe", "pipe", "ignore"] });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString("utf8")}`.slice(-200_000); });
    child.once("error", () => resolveReady(false));
    child.once("exit", (code) => {
      try {
        const result = decodeSongPlayerWorkerOutput(output);
        const features = result.features && typeof result.features === "object" ? result.features as Record<string, unknown> : null;
        resolveReady(code === 0 && result.ready === true && features?.[requiredFeature] === true);
      } catch { resolveReady(false); }
    });
    child.stdin?.end('{"protocolVersion":1,"action":"capabilities"}\n');
  });

  const startSetup = (server: ViteDevServer, requiredFeature = "separateVocals") => {
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
      if (code === 0 && await verifyRuntimeFeature(requiredFeature)) { phase = "ready"; progress = 100; message = requiredFeature === "analyzeVisemes" ? "Auto-AVSR pronto" : "Demucs htdemucs e pYIN pronti"; }
      else { phase = "failed"; error = `Preparazione non riuscita (codice ${code ?? "sconosciuto"}).`; message = "Runtime vocale non disponibile"; }
    });
    server.config.logger.info("[Song Player] installazione automatica del runtime vocale avviata");
  };

  const ensureRuntime = async (server: ViteDevServer, requiredFeature = "separateVocals") => {
    if (phase === "ready" && await verifyRuntimeFeature(requiredFeature)) return;
    if (await verifyRuntimeFeature(requiredFeature)) { phase = "ready"; progress = 100; message = requiredFeature === "analyzeVisemes" ? "Auto-AVSR pronto" : "Demucs htdemucs e pYIN pronti"; error = null; return; }
    startSetup(server, requiredFeature);
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
        try {
        const url = new URL(request.url ?? "/", "http://localhost");
        const stemMatch = url.pathname.match(/^\/stem\/([a-f0-9-]+)$/i);
        if (stemMatch && request.method === "GET") { const artifact = stems.get(stemMatch[1]!); if (!artifact) return sendJson(response, 404, { error: "Stem vocale scaduto o non disponibile." }); response.statusCode = 200; response.setHeader("Content-Type", "audio/wav"); response.setHeader("Cache-Control", "no-store"); createReadStream(artifact.path).once("error", () => { if (!response.headersSent) sendJson(response, 404, { error: "Stem vocale non leggibile." }); else response.destroy(); }).pipe(response); return; }
        if (stemMatch && request.method === "DELETE") { await releaseStem(stemMatch[1]!); return sendJson(response, 200, { released: true }); }
        if (url.pathname === "/status" && request.method === "GET") return sendJson(response, 200, status());
        if (url.pathname === "/ensure" && request.method === "POST") { const requiredFeature = url.searchParams.get("feature") === "analyzeVisemes" ? "analyzeVisemes" : "separateVocals"; await ensureRuntime(server, requiredFeature); const current=status();return sendJson(response,current.status==="failed"?503:current.ready?200:202,current); }
        if (url.pathname === "/visemes/session" && request.method === "POST") {
          let serialized = ""; for await (const chunk of request) { serialized += Buffer.from(chunk).toString("utf8"); if (serialized.length > 256_000) return sendJson(response, 413, { error: "Metadati Auto-AVSR troppo grandi." }); }
          const body = JSON.parse(serialized) as Record<string, unknown>;
          const filename = typeof body.filename === "string" ? body.filename : "source.mp4";
          const language = typeof body.language === "string" ? body.language : "en";
          const anchors = Array.isArray(body.anchors) ? body.anchors : [];
          if (!anchors.length || anchors.length > 128 || language.length > 16 || !/^[A-Za-z-]+$/.test(language)) return sendJson(response, 400, { error: "Anchor o lingua Auto-AVSR non validi." });
          const root = await mkdtemp(resolve(tmpdir(), "mlsm-auto-avsr-")); const uploadId = randomUUID();
          const timer = setTimeout(() => { const session = visualSessions.get(uploadId); if (!session) return; visualSessions.delete(uploadId); void rm(session.root, { recursive: true, force: true }); }, 5 * 60 * 1000);
          visualSessions.set(uploadId, { root, metadata: { filename, language, anchors }, timer });
          return sendJson(response, 201, { uploadId });
        }
        const visualUpload = url.pathname.match(/^\/visemes\/upload\/([a-f0-9-]+)$/i);
        if (visualUpload && request.method === "POST") {
          const uploadId = visualUpload[1]!; const session = visualSessions.get(uploadId);
          if (!session) return sendJson(response, 404, { error: "Sessione Auto-AVSR scaduta o non valida." });
          visualSessions.delete(uploadId); clearTimeout(session.timer);
          if (!await verifyRuntimeFeature("analyzeVisemes")) { await rm(session.root, { recursive: true, force: true }); return sendJson(response, 503, { error: "Runtime Auto-AVSR non pronto." }); }
          if (separationProcess) { await rm(session.root, { recursive: true, force: true }); return sendJson(response, 409, { error: "Il worker vocale/visivo è già occupato." }); }
          try {
            const inputPath = resolve(session.root, safeSongPlayerAudioName(session.metadata.filename));
            await receiveFile(request, inputPath);
            const result = await new Promise<Record<string, unknown>>((resolveResult, reject) => {
              const child = spawn(paths.python, [paths.worker], { cwd: paths.projectRoot, stdio: ["pipe", "pipe", "pipe"] }); separationProcess = child; let output = ""; let stderr = "";
              child.stdout?.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString("utf8")}`.slice(-4_000_000); }); child.stderr?.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-12_000); });
              child.once("error", reject); child.once("exit", (code) => { separationProcess = null; try { if (code !== 0 && !output) throw new Error(stderr || `Worker Auto-AVSR terminato con codice ${code}.`); resolveResult(decodeSongPlayerWorkerOutput(output)); } catch (cause) { reject(cause); } });
              child.stdin?.end(`${JSON.stringify({ protocolVersion: 1, action: "analyzeVisemes", inputPath, anchors: session.metadata.anchors, language: session.metadata.language, jobRoot: session.root })}\n`);
              request.once("aborted", () => { if (child.exitCode === null) child.kill("SIGTERM"); });
            });
            return sendJson(response, 200, result);
          } catch (cause) { return sendJson(response, 500, { error: cause instanceof Error ? cause.message : String(cause) }); }
          finally { await rm(session.root, { recursive: true, force: true }); }
        }
        if (url.pathname === "/align-waveform" && request.method === "POST") {
          if (separationProcess) return sendJson(response, 409, { error: "Il worker vocale è già occupato." });
          let serialized = ""; for await (const chunk of request) { serialized += Buffer.from(chunk).toString("utf8"); if (serialized.length > 64_000) return sendJson(response, 413, { error: "Richiesta di sovrapposizione onde troppo grande." }); }
          try {
            const body = JSON.parse(serialized) as Record<string, unknown>; const sourceId = stemIdFromUrl(body.sourcePath); const targetId = stemIdFromUrl(body.targetPath); const source = sourceId ? stems.get(sourceId) : null; const target = targetId ? stems.get(targetId) : null;
            if (!source || !target) return sendJson(response, 400, { error: "Stem sorgente o stem target non validi." });
            const result = await new Promise<Record<string, unknown>>((resolveResult, reject) => {
              const child = spawn(paths.python, [paths.worker], { cwd: paths.projectRoot, stdio: ["pipe", "pipe", "pipe"] }); separationProcess = child; let output = ""; let stderr = "";
              child.stdout?.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString("utf8")}`.slice(-2_000_000); }); child.stderr?.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_000); }); child.once("error", reject); child.once("exit", (code) => { separationProcess = null; try { if (code !== 0 && !output) throw new Error(stderr || `Worker terminato con codice ${code}.`); resolveResult(decodeSongPlayerWorkerOutput(output)); } catch (cause) { reject(cause); } });
              child.stdin?.end(`${JSON.stringify({ protocolVersion: 1, action: "alignWaveform", sourcePath: source.path, targetPath: target.path, jobRoot: source.root })}\n`); request.once("aborted", () => { if (child.exitCode === null) child.kill("SIGTERM"); });
            });
            return sendJson(response, 200, result);
          } catch (cause) { return sendJson(response, 500, { error: cause instanceof Error ? cause.message : String(cause) }); }
        }
        if (url.pathname === "/refine" && request.method === "POST") {
          if (separationProcess) return sendJson(response, 409, { error: "Il worker vocale è già occupato." });
          let serialized = ""; for await (const chunk of request) { serialized += Buffer.from(chunk).toString("utf8"); if (serialized.length > 2_000_000) return sendJson(response, 413, { error: "Richiesta di micro-allineamento troppo grande." }); }
          try {
            const body = JSON.parse(serialized) as Record<string, unknown>; const sourceId = stemIdFromUrl(body.sourcePath); const targetId = stemIdFromUrl(body.targetPath); const source = sourceId ? stems.get(sourceId) : null; const target = targetId ? stems.get(targetId) : null;
            if (!source || !target || !Array.isArray(body.anchors)) return sendJson(response, 400, { error: "Stem sorgente, stem target o anchor non validi." });
            const requestedAnchors = body.anchors as unknown[];
            const result = await new Promise<Record<string, unknown>>((resolveResult, reject) => {
              const child = spawn(paths.python, [paths.worker], { cwd: paths.projectRoot, stdio: ["pipe", "pipe", "pipe"] }); separationProcess = child; let output = ""; let stderr = "";
              child.stdout?.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString("utf8")}`.slice(-2_000_000); }); child.stderr?.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_000); }); child.once("error", reject); child.once("exit", (code) => { separationProcess = null; try { if (code !== 0 && !output) throw new Error(stderr || `Worker terminato con codice ${code}.`); resolveResult(decodeSongPlayerWorkerOutput(output)); } catch (cause) { reject(cause); } });
              const anchors = requestedAnchors.map((anchor) => anchor && typeof anchor === "object" ? { ...(anchor as Record<string, unknown>), maxShiftMs: body.maxShiftMs } : anchor);
              child.stdin?.end(`${JSON.stringify({ protocolVersion: 1, action: "refineAlignment", sourcePath: source.path, targetPath: target.path, anchors, jobRoot: source.root })}\n`); request.once("aborted", () => { if (child.exitCode === null) child.kill("SIGTERM"); });
            });
            return sendJson(response, 200, result);
          } catch (cause) { return sendJson(response, 500, { error: cause instanceof Error ? cause.message : String(cause) }); }
        }
        if (url.pathname !== "/separate" || request.method !== "POST") return next();
        if (!status().ready) { await ensureRuntime(server); const current=status();if(!current.ready)return sendJson(response,503,current); }
        if (separationProcess) return sendJson(response, 409, { error: "Una separazione vocale è già in corso." });
        const jobRoot = await mkdtemp(resolve(tmpdir(), "mlsm-song-player-vocals-"));
        let retained = false;
        try {
          const startParameter = url.searchParams.get("startSeconds");
          const endParameter = url.searchParams.get("endSeconds");
          const hasWindow = startParameter !== null || endParameter !== null;
          const startSeconds = startParameter === null ? null : Number(startParameter);
          const endSeconds = endParameter === null ? null : Number(endParameter);
          if (hasWindow && (startSeconds === null || endSeconds === null || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds + .05)) return sendJson(response, 400, { error: "Intervallo startSeconds/endSeconds non valido." });
          const inputPath = resolve(jobRoot, safeSongPlayerAudioName(url.searchParams.get("filename")));
          await receiveFile(request, inputPath);
          const result = await new Promise<Record<string, unknown>>((resolveResult, reject) => {
            const child = spawn(paths.python, [paths.worker], { cwd: paths.projectRoot, stdio: ["pipe", "pipe", "pipe"] });
            separationProcess = child;
            let output = ""; let stderr = "";
            child.stdout?.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString("utf8")}`.slice(-2_000_000); });
            child.stderr?.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_000); });
            child.once("error", reject);
            child.once("exit", (code) => { separationProcess = null; try { if (code !== 0 && !output) throw new Error(stderr || `Worker vocale terminato con codice ${code}.`); resolveResult(decodeSongPlayerWorkerOutput(output, true)); } catch (cause) { reject(cause); } });
            child.stdin?.end(`${JSON.stringify({ protocolVersion: 1, action: "separateVocals", inputPath, jobRoot, ...(hasWindow ? { startSeconds, endSeconds } : {}) })}\n`);
            request.once("aborted", () => { if (child.exitCode === null) child.kill("SIGTERM"); });
          });
          if (typeof result.path !== "string") throw new Error("Lo stem vocale non contiene un percorso valido.");
          const stemUrl = retainStem(jobRoot, result.path); retained = true;
          return sendJson(response, 200, { ...result, path: stemUrl });
        } catch (cause) {
          return sendJson(response, 500, { error: cause instanceof Error ? cause.message : String(cause) });
        } finally { if (!retained) await rm(jobRoot, { recursive: true, force: true }); }
        } catch (cause) {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          if (!response.headersSent) return sendJson(response, 500, { error: `Servizio vocale locale: ${error.message}` });
          response.destroy(error);
        }
      });
      server.httpServer?.once("close", () => { setupProcess?.kill("SIGTERM"); separationProcess?.kill("SIGTERM"); for (const id of [...stems.keys()]) void releaseStem(id); for (const [id, session] of visualSessions) { visualSessions.delete(id); clearTimeout(session.timer); void rm(session.root, { recursive: true, force: true }); } });
    }
  };
}
