import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";

const healthUrl = "http://127.0.0.1:8765/health";
const interpolationHealthUrl = "http://127.0.0.1:8765/interpolation/health";
const workingDirectory = resolve(process.cwd());
const projectRoot = existsSync(resolve(workingDirectory, "tools/upscaler_server.py"))
  ? workingDirectory
  : resolve(workingDirectory, "../..");
const logPath = resolve(projectRoot, "logs/upscaler-vite.log");
const maxRecentLogs = 100;
const maxLogLineLength = 4_000;
const maxRestartAttempts = 5;

interface ServiceProbe {
  running: boolean;
  compatible: boolean;
  apiVersion?: number;
  pid?: number;
}

interface UpscalerHealthContract {
  apiVersion?: number;
  ownerKind?: string;
  parentPid?: number | null;
  pid?: number;
  capabilities?: {
    videoJobs?: boolean;
    remoteVideoPartialEndpointPreflight?: boolean;
    canvasVideoStreaming?: boolean;
  };
}

type ServicePhase = "idle" | "starting" | "ready" | "error";

interface ServiceDiagnostic {
  phase: ServicePhase;
  message: string;
  error?: string;
}

interface ServiceRuntimeOptions {
  platform?: NodeJS.Platform;
  appendLog?: (entry: string) => void;
  killProcess?: typeof spawn;
  fetchBackend?: typeof fetch;
}

export function isCompatibleUpscalerHealth(health: UpscalerHealthContract, expectedParentPid?: number): boolean {
  const contractMatches = (health.apiVersion ?? 0) >= 7
    && health.capabilities?.videoJobs === true
    && health.capabilities?.remoteVideoPartialEndpointPreflight === true
    && health.capabilities?.canvasVideoStreaming === true;
  if (!contractMatches) return false;
  // A Vite instance may reuse only a child already tied to the same parent
  // (for example after a config hot reload). Never adopt an unrelated service
  // merely because it happens to own port 8765.
  return expectedParentPid === undefined
    || (health.ownerKind === "vite" && health.parentPid === expectedParentPid);
}

async function probeService(): Promise<ServiceProbe> {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_500) });
    if (!response.ok) return { running: true, compatible: false };
    const health = await response.json() as UpscalerHealthContract;
    return {
      running: true,
      compatible: isCompatibleUpscalerHealth(health, process.pid),
      ...(health.apiVersion === undefined ? {} : { apiVersion: health.apiVersion }),
      ...(health.pid === undefined ? {} : { pid: health.pid }),
    };
  } catch {
    return { running: false, compatible: false };
  }
}

function appendServiceLog(entry: string): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, entry, "utf8");
}

export function terminateOwnedProcess(
  owned: ChildProcess,
  platform: NodeJS.Platform = process.platform,
  killProcess: typeof spawn = spawn,
): void {
  if (platform === "win32" && owned.pid) {
    try {
      const killer = killProcess("taskkill", ["/PID", String(owned.pid), "/T", "/F"], { stdio: "ignore" });
      killer.once("error", () => { if (owned.exitCode === null) owned.kill("SIGTERM"); });
      return;
    } catch {
      owned.kill("SIGTERM");
      return;
    }
  }
  try {
    if (owned.pid) process.kill(-owned.pid, "SIGTERM");
    else owned.kill("SIGTERM");
  } catch {
    owned.kill("SIGTERM");
  }
}

export function localPyTorchService(
  probe: () => Promise<ServiceProbe> = probeService,
  startService: typeof spawn = spawn,
  fileExists: typeof existsSync = existsSync,
  runtime: ServiceRuntimeOptions = {},
): Plugin {
  let child: ChildProcess | null = null;
  let stopping = false;
  let restartAttempt = 0;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  let stopPromise: Promise<boolean> | null = null;
  let desiredRunning = false;
  let diagnostic: ServiceDiagnostic = { phase: "idle", message: "Backend non ancora richiesto." };
  const recentLogs: string[] = [];
  const platform = runtime.platform ?? process.platform;
  const persistLog = runtime.appendLog ?? appendServiceLog;
  const killProcess = runtime.killProcess ?? spawn;
  const fetchBackend = runtime.fetchBackend ?? fetch;

  return {
    name: "dynamic-sound-local-pytorch",
    apply: "serve",
    async configureServer(server) {
      const python = resolve(projectRoot, platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
      const entrypoint = resolve(projectRoot, "tools/upscaler_server.py");
      const runtimeError = !fileExists(python)
        ? `Runtime Python non trovato in ${python}. Esegui \`npm run upscaler:setup\` dalla cartella del progetto e riavvia MLSM Studio.`
        : !fileExists(entrypoint)
          ? `Server Upscaler non trovato in ${entrypoint}. Ripristina i file dell'applicazione e riavvia MLSM Studio.`
          : null;
      let logWriteWarningShown = false;

      const recordLog = (source: "vite" | "stdout" | "stderr", value: string) => {
        const clean = value.replace(/\r$/, "");
        if (!clean) return;
        const bounded = clean.length > maxLogLineLength
          ? `${clean.slice(0, maxLogLineLength)} … [riga troncata]`
          : clean;
        const recent = `[${source}] ${bounded}`;
        recentLogs.push(recent);
        if (recentLogs.length > maxRecentLogs) recentLogs.splice(0, recentLogs.length - maxRecentLogs);
        try {
          persistLog(`[${new Date().toISOString()}] ${recent}\n`);
        } catch (error) {
          if (!logWriteWarningShown) {
            logWriteWarningShown = true;
            server.config.logger.warn(`[PyTorch] impossibile scrivere ${logPath}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      };

      const setDiagnostic = (phase: ServicePhase, message: string, error?: string) => {
        diagnostic = { phase, message, ...(error ? { error } : {}) };
      };

      const attachOutput = (owned: ChildProcess, stream: "stdout" | "stderr") => {
        const readable = owned[stream];
        if (!readable) return;
        let pending = "";
        const flushCompleteLines = () => {
          const lines = pending.split("\n");
          pending = lines.pop() ?? "";
          for (const line of lines) recordLog(stream, line);
          while (pending.length > maxLogLineLength) {
            recordLog(stream, pending.slice(0, maxLogLineLength));
            pending = pending.slice(maxLogLineLength);
          }
        };
        readable.on("data", (chunk: unknown) => {
          pending += String(chunk);
          flushCompleteLines();
        });
        readable.once("end", () => {
          flushCompleteLines();
          if (pending) recordLog(stream, pending);
          pending = "";
        });
      };

      const payload = (current: ServiceProbe, started?: boolean) => ({
        ...current,
        ...(started === undefined ? {} : { started }),
        phase: diagnostic.phase,
        message: diagnostic.message,
        ...(diagnostic.error ? { error: diagnostic.error } : {}),
        pid: current.pid ?? child?.pid ?? null,
        logPath,
        recentLogs: [...recentLogs],
      });

      const clearRestartTimers = () => {
        if (restartTimer !== null) clearTimeout(restartTimer);
        restartTimer = null;
        if (stabilityTimer !== null) clearTimeout(stabilityTimer);
        stabilityTimer = null;
      };

      const launch = (): boolean => {
        if (stopping || !desiredRunning || child || runtimeError) return false;
        setDiagnostic("starting", restartAttempt > 0
          ? `Nuovo tentativo di avvio (${restartAttempt + 1}/${maxRestartAttempts + 1}); attendo /health.`
          : "Processo Python in avvio; attendo /health.");
        let owned: ChildProcess;
        try {
          owned = startService(python, [entrypoint], {
            cwd: projectRoot,
            env: {
              ...process.env,
              MLSM_UPSCALER_PARENT_PID: String(process.pid),
              MLSM_UPSCALER_OWNER_KIND: "vite",
              PYTHONUNBUFFERED: "1",
              PYTHONIOENCODING: "utf-8",
            },
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
            detached: platform !== "win32",
          });
        } catch (error) {
          const reason = `Avvio del processo Python fallito: ${error instanceof Error ? error.message : String(error)}`;
          setDiagnostic("error", reason, reason);
          recordLog("vite", reason);
          return false;
        }
        child = owned;
        attachOutput(owned, "stdout");
        attachOutput(owned, "stderr");
        const startedMessage = `Processo Python creato${owned.pid ? ` con PID ${owned.pid}` : ""}; attendo /health.`;
        setDiagnostic("starting", startedMessage);
        recordLog("vite", startedMessage);
        server.config.logger.info(`[PyTorch] ${startedMessage} · http://127.0.0.1:8765`);
        let finished = false;
        const finish = (reason: string, isError: boolean) => {
          if (finished) return;
          finished = true;
          if (stabilityTimer !== null) clearTimeout(stabilityTimer);
          stabilityTimer = null;
          if (child === owned) child = null;
          recordLog(isError ? "stderr" : "vite", reason);
          if (stopping || !desiredRunning) return;
          if (restartAttempt >= maxRestartAttempts) {
            desiredRunning = false;
            const exhausted = `${reason}. Riavvio automatico interrotto dopo ${maxRestartAttempts} tentativi; controlla ${logPath}.`;
            setDiagnostic("error", exhausted, exhausted);
            server.config.logger.error(`[PyTorch] ${exhausted}`);
            return;
          }
          const delay = Math.min(10_000, 500 * 2 ** Math.min(restartAttempt, 5));
          restartAttempt += 1;
          const retryMessage = `${reason}. Nuovo tentativo automatico tra ${delay} ms (${restartAttempt}/${maxRestartAttempts}).`;
          setDiagnostic("starting", retryMessage, isError ? reason : undefined);
          server.config.logger.warn(`[PyTorch] ${retryMessage}`);
          restartTimer = setTimeout(() => { restartTimer = null; launch(); }, delay);
        };
        owned.once("spawn", () => {
          stabilityTimer = setTimeout(() => { restartAttempt = 0; stabilityTimer = null; }, 30_000);
        });
        owned.once("exit", (code, signal) => finish(`Servizio terminato${code !== null ? ` con codice ${code}` : ""}${signal ? ` · ${signal}` : ""}`, code !== 0));
        owned.once("error", (error) => finish(`Avvio fallito: ${error.message}`, true));
        return true;
      };

      const stopChild = (permanent = false): Promise<boolean> => {
        if (permanent) stopping = true;
        desiredRunning = false;
        clearRestartTimers();
        if (stopPromise) return stopPromise;
        const owned = child;
        if (!owned || owned.exitCode !== null) {
          if (child === owned) child = null;
          if (!permanent) setDiagnostic("idle", "Backend arrestato.");
          return Promise.resolve(true);
        }
        recordLog("vite", `Arresto del processo PID ${owned.pid ?? "sconosciuto"}.`);
        terminateOwnedProcess(owned, platform, killProcess);
        stopPromise = new Promise<boolean>((resolveStop) => {
          let settled = false;
          const settle = (success: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(forceKillTimer);
            clearTimeout(exitTimeout);
            if (success && child === owned) child = null;
            if (!permanent) {
              if (success) setDiagnostic("idle", "Backend arrestato.");
              else {
                const reason = `Il processo PID ${owned.pid ?? "sconosciuto"} non si è arrestato entro 3 secondi. Chiudilo manualmente e riprova.`;
                setDiagnostic("error", reason, reason);
              }
            }
            stopPromise = null;
            resolveStop(success);
          };
          owned.once("exit", () => settle(true));
          const forceKillTimer = setTimeout(() => {
            if (owned.exitCode === null) owned.kill("SIGKILL");
          }, 2_000);
          forceKillTimer.unref?.();
          const exitTimeout = setTimeout(() => settle(owned.exitCode !== null), 3_000);
          exitTimeout.unref?.();
        });
        return stopPromise;
      };

      if (runtimeError) {
        setDiagnostic("error", runtimeError, runtimeError);
        recordLog("vite", runtimeError);
        server.config.logger.warn(`[PyTorch] ${runtimeError}`);
      } else {
        server.config.logger.info("[PyTorch] runtime disponibile su richiesta; verrà avviato entrando in una modalità che lo usa.");
      }

      // The generic Vite proxy logs ECONNREFUSED for every health poll while
      // Python is legitimately importing Torch/OpenCV and has not bound 8765
      // yet. Handle this one readiness endpoint here so "not ready" remains a
      // normal 503 response, while real startup failures stay in /status and
      // in the persistent backend log.
      server.middlewares.use("/__mlsm/upscaler-api/interpolation/health", async (request, response, next) => {
        if (request.method !== "GET") {
          next();
          return;
        }
        response.setHeader("Cache-Control", "no-store");
        try {
          const backend = await fetchBackend(interpolationHealthUrl, {
            signal: AbortSignal.timeout(1_500),
            cache: "no-store",
          });
          const body = await backend.text();
          response.statusCode = backend.status;
          response.setHeader("Content-Type", backend.headers.get("content-type") ?? "application/json; charset=utf-8");
          response.end(body);
        } catch {
          response.statusCode = 503;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({
            ok: false,
            ready: false,
            phase: diagnostic.phase,
            starting: desiredRunning,
            message: diagnostic.message,
          }));
        }
      });

      server.middlewares.use("/__mlsm/python/upscaler", async (request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (pathname === "/status" && request.method === "GET") {
          const current = runtimeError ? { running: false, compatible: false } : await probe();
          if (!runtimeError && current.compatible) {
            setDiagnostic("ready", `Backend pronto${current.pid ? ` · PID ${current.pid}` : ""}.`);
          } else if (!runtimeError && current.running && !current.compatible) {
            const reason = `Porta 8765 occupata da un backend incompatibile${current.apiVersion ? ` · API ${current.apiVersion}` : ""}.`;
            setDiagnostic("error", reason, reason);
          }
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify(payload(current)));
          return;
        }
        if (pathname === "/stop" && request.method === "POST") {
          const stopped = await stopChild();
          response.statusCode = stopped ? 204 : 409;
          if (!stopped) {
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify(payload({ running: true, compatible: false })));
          } else response.end();
          return;
        }
        if (pathname === "/start" && request.method === "POST") {
          if (stopPromise && !await stopPromise) {
            response.statusCode = 409;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify(payload({ running: true, compatible: false }, false)));
            return;
          }
          if (runtimeError) {
            response.statusCode = 503;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify(payload({ running: false, compatible: false }, false)));
            return;
          }
          desiredRunning = true;
          const current = await probe();
          if (current.running && !current.compatible) {
            const reason = `Porta 8765 occupata da un backend incompatibile${current.apiVersion ? ` · API ${current.apiVersion}` : ""}.`;
            setDiagnostic("error", reason, reason);
            server.config.logger.error(`[PyTorch] ${reason}`);
          } else if (current.compatible) {
            setDiagnostic("ready", `Backend già pronto${current.pid ? ` · PID ${current.pid}` : ""}.`);
          }
          restartAttempt = 0;
          const started = !current.running && launch();
          response.statusCode = current.running && !current.compatible ? 409 : diagnostic.phase === "error" ? 500 : 202;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify(payload(current, started)));
          return;
        }
        next();
      });
      server.httpServer?.once("close", () => { void stopChild(true); });
    }
  };
}
