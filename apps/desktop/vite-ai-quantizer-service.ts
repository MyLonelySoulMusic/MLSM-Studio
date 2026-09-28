import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import type { Plugin, ViteDevServer } from "vite";
import { terminateVerifiedListener } from "./vite-process-control";

export const aiQuantizerRoutePrefix = "/music/ai-quantizer";
const healthUrl = "http://127.0.0.1:4173/api/health";
export function aiQuantizerProjectRoot(cwd = process.cwd()) {
  return existsSync(resolve(cwd, "tools/ai-quantizer")) ? cwd : resolve(cwd, "../..");
}
const projectRoot = aiQuantizerProjectRoot();

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".svg": "image/svg+xml"
};

export function aiQuantizerRuntimePaths(root = projectRoot) {
  const sourceRoot = resolve(root, "tools/ai-quantizer");
  return {
    sourceRoot,
    server: resolve(sourceRoot, "server.cjs"),
    publicRoot: resolve(sourceRoot, "public"),
    python: resolve(root, process.platform === "win32" ? ".venv-ai-quantizer/Scripts/python.exe" : ".venv-ai-quantizer/bin/python"),
    readyMarker: resolve(root, ".venv-ai-quantizer/.mlsm-aiq-ready"),
    setup: resolve(root, "tools/setup_python_runtime.cjs"),
    dataRoot: resolve(root, ".ai-quantizer-data/projects")
  };
}

async function probeBackend() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_200) });
    const health = await response.json() as Record<string, unknown> & { runtime?: string };
    return { running: response.ok, compatible: response.ok && health.runtime === "mlsm-internal-ai-quantizer", health };
  } catch { return { running: false, compatible: false, health: null }; }
}

export type AiQuantizerBootstrapPhase = "idle" | "setting-up" | "starting" | "ready" | "blocked" | "failed";

export function aiQuantizerBootstrapPayload(phase: AiQuantizerBootstrapPhase, detail?: string, progress = 0, logs: string[] = []) {
  return {
    runtime: "mlsm-ai-quantizer-bootstrap",
    status: phase,
    ready: phase === "ready",
    progress: phase === "ready" ? 100 : progress,
    logs,
    message: detail ?? (phase === "setting-up" ? "Preparazione dell’ambiente Python interno in corso." : "Avvio del motore audio interno in corso.")
  };
}

export function localAiQuantizerService(): Plugin {
  const paths = aiQuantizerRuntimePaths();
  let child: ChildProcess | null = null;
  let closing = false;
  let phase: AiQuantizerBootstrapPhase = "idle";
  let phaseDetail = "";
  let progress = 0;
  let requested = false;
  const logs: string[] = [];

  const recordLog = (line: string) => {
    const clean = line.replace(/^\[AIQ_PROGRESS\]\s*\d+\|/, "").trim();
    if (!clean || logs.at(-1) === clean) return;
    logs.push(clean);
    if (logs.length > 80) logs.splice(0, logs.length - 80);
  };

  const captureSetupOutput = (setup: ChildProcess) => {
    const capture = (stream: Readable | null, terminal: NodeJS.WriteStream) => {
      if (!stream) return;
      let pending = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        terminal.write(chunk);
        pending += chunk;
        const lines = pending.split(/\r?\n/); pending = lines.pop() ?? "";
        for (const line of lines) {
          const marker = line.match(/^\[AIQ_PROGRESS\]\s*(\d+)\|(.*)$/);
          if (marker) {
            progress = Math.max(progress, Math.min(99, Number(marker[1])));
            phaseDetail = marker[2]?.trim() || phaseDetail;
          }
          recordLog(line);
        }
      });
      stream.on("end", () => { if (pending) recordLog(pending); });
    };
    capture(setup.stdout, process.stdout);
    capture(setup.stderr, process.stderr);
  };

  const startBackend = (server: ViteDevServer) => {
    if (closing || !requested || child || !existsSync(paths.python) || !existsSync(paths.readyMarker)) return;
    phase = "starting";
    progress = Math.max(progress, 94);
    phaseDetail = "Avvio del backend audio interno.";
    recordLog(phaseDetail);
    const owned = spawn(process.execPath, [paths.server], {
      cwd: paths.sourceRoot,
      env: { ...process.env, PORT: "4173", AIQ_PYTHON: paths.python, AIQ_DATA_ROOT: paths.dataRoot },
      stdio: "inherit",
      detached: process.platform !== "win32",
    });
    child = owned;
    server.config.logger.info(`[AI Quantizer] motore MLSM interno · ${paths.server} · http://127.0.0.1:4173`);
    owned.once("error", (error) => {
      phase = "failed"; phaseDetail = error.message;
      server.config.logger.error(`[AI Quantizer] avvio fallito: ${error.message}`);
    });
    owned.once("exit", (code) => {
      if (!closing && code && code !== 0) server.config.logger.error(`[AI Quantizer] motore terminato con codice ${code}.`);
      if (child === owned) child = null;
      if (!closing && requested) { phase = "failed"; phaseDetail = `Il motore si è arrestato con codice ${code ?? "sconosciuto"}.`; }
    });
  };

  const startSetup = (server: ViteDevServer) => {
    if (closing || !requested || child) return;
    phase = "setting-up";
    progress = Math.max(progress, 2);
    phaseDetail = "Installazione delle dipendenze nel runtime isolato. Questa operazione avviene una sola volta.";
    recordLog(phaseDetail);
    server.config.logger.info("[AI Quantizer] primo utilizzo: preparo l’ambiente Python isolato. L’operazione avviene una sola volta…");
    const owned = spawn(process.execPath, [paths.setup, "ai-quantizer"], { cwd: projectRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    child = owned;
    captureSetupOutput(owned);
    owned.once("error", (error) => {
      phase = "failed"; phaseDetail = error.message;
      server.config.logger.error(`[AI Quantizer] preparazione fallita: ${error.message}`);
    });
    owned.once("exit", (code) => {
      if (child === owned) child = null;
      if (closing || !requested) return;
      if (code === 0) startBackend(server);
      else {
        phase = "failed"; phaseDetail = `Preparazione non riuscita (codice ${code ?? "sconosciuto"}).`;
        server.config.logger.error(`[AI Quantizer] ambiente non preparato (codice ${code ?? "sconosciuto"}).`);
      }
    });
  };

  const ensureEngine = async (server: ViteDevServer) => {
    requested = true;
    const backend = await probeBackend();
    if (backend.compatible) { phase = "ready"; progress = 100; phaseDetail = "Motore audio interno pronto."; recordLog(phaseDetail); return backend; }
    if (backend.running) {
      phase = "blocked";
      phaseDetail = "La porta 4173 è occupata da un backend non appartenente a MLSM Studio.";
      return backend;
    }
    if (!child && phase !== "failed" && phase !== "blocked") {
      if (existsSync(paths.python) && existsSync(paths.readyMarker)) startBackend(server);
      else startSetup(server);
    }
    return backend;
  };

  const terminateProcessTree = (owned: ChildProcess | null) => {
    if (!owned?.pid || owned.exitCode !== null) return;
    try {
      if (process.platform === "win32") spawn("taskkill", ["/PID", String(owned.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-owned.pid, "SIGTERM");
    } catch { owned.kill("SIGTERM"); }
  };

  const stopEngine = (includeVerifiedOrphans = false) => {
    requested = false;
    const owned = child;
    child = null;
    terminateProcessTree(owned);
    if (!owned && includeVerifiedOrphans) terminateVerifiedListener(4173, paths.server);
    phase = "idle";
    phaseDetail = "";
    progress = 0;
    logs.splice(0);
  };

  const sendJson = (response: ServerResponse, status: number, value: unknown) => {
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(JSON.stringify(value));
  };

  return {
    name: "mlsm-internal-ai-quantizer",
    apply: "serve",
    async configureServer(server) {
      if (!existsSync(paths.server)) throw new Error(`[AI Quantizer] runtime interno mancante: ${paths.server}`);

      server.config.logger.info("[AI Quantizer] runtime lazy pronto; verrà avviato al primo ingresso nell’area.");

      server.middlewares.use(aiQuantizerRoutePrefix, async (request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (pathname === "/api/lifecycle/status" && request.method === "GET") {
          const current = await probeBackend();
          if (current.compatible) {
            phase = "ready";
            phaseDetail = "Motore audio interno pronto.";
            progress = 100;
          } else if (!current.running && phase === "ready") {
            phase = "idle";
            phaseDetail = "";
            progress = 0;
          }
          return sendJson(response, 200, { ...current, phase, detail: phaseDetail, progress });
        }
        if (pathname === "/api/lifecycle/start" && request.method === "POST") {
          const current = await ensureEngine(server);
          return sendJson(response, current.compatible ? 200 : 202, current.compatible ? current.health : aiQuantizerBootstrapPayload(phase, phaseDetail, progress, logs));
        }
        if (pathname === "/api/lifecycle/stop" && request.method === "POST") {
          stopEngine(true);
          response.statusCode = 204;
          response.end();
          return;
        }
        if (pathname === "/api/health") {
          const current = await ensureEngine(server);
          if (current.compatible) return sendJson(response, 200, current.health);
          return sendJson(response, phase === "blocked" || phase === "failed" ? 503 : 202, aiQuantizerBootstrapPayload(phase, phaseDetail, progress, logs));
        }
        if (pathname === "/api/bootstrap/retry" && request.method === "POST") {
          phase = "idle"; phaseDetail = "Nuovo tentativo richiesto dall’utente."; progress = 0;
          recordLog(phaseDetail);
          await ensureEngine(server);
          return sendJson(response, 202, aiQuantizerBootstrapPayload(phase, phaseDetail, progress, logs));
        }
        if (pathname.startsWith("/api/")) {
          const current = await ensureEngine(server);
          if (current.compatible) return next();
          return sendJson(response, 503, aiQuantizerBootstrapPayload(phase, phaseDetail, progress, logs));
        }
        const relative = pathname === "/" || pathname === "" ? "index.html" : decodeURIComponent(pathname.slice(1));
        const target = resolve(paths.publicRoot, relative);
        if ((target !== paths.publicRoot && !target.startsWith(`${paths.publicRoot}${sep}`)) || !existsSync(target)) return next();
        try {
          const body = await readFile(target);
          response.statusCode = 200;
          response.setHeader("Content-Type", mimeTypes[extname(target)] ?? "application/octet-stream");
          response.setHeader("Cache-Control", "no-store");
          response.end(body);
        } catch (error) { next(error as Error); }
      });

      server.httpServer?.once("close", () => {
        closing = true;
        stopEngine();
      });
    }
  };
}
