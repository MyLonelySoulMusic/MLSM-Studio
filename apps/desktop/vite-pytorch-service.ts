import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const healthUrl = "http://127.0.0.1:8765/health";
const workingDirectory = resolve(process.cwd());
const projectRoot = existsSync(resolve(workingDirectory, "tools/upscaler_server.py"))
  ? workingDirectory
  : resolve(workingDirectory, "../..");

interface ServiceProbe {
  running: boolean;
  compatible: boolean;
  apiVersion?: number;
}

interface UpscalerHealthContract {
  apiVersion?: number;
  ownerKind?: string;
  parentPid?: number | null;
  capabilities?: {
    videoJobs?: boolean;
    remoteVideoPartialEndpointPreflight?: boolean;
    canvasVideoStreaming?: boolean;
  };
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
      ...(health.apiVersion === undefined ? {} : { apiVersion: health.apiVersion })
    };
  } catch {
    return { running: false, compatible: false };
  }
}

export function localPyTorchService(
  probe: () => Promise<ServiceProbe> = probeService,
  startService: typeof spawn = spawn,
  fileExists: typeof existsSync = existsSync,
): Plugin {
  let child: ChildProcess | null = null;
  let stopping = false;
  let restartAttempt = 0;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  let desiredRunning = false;
  return {
    name: "dynamic-sound-local-pytorch",
    apply: "serve",
    async configureServer(server) {
      const python = resolve(projectRoot, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
      const entrypoint = resolve(projectRoot, "tools/upscaler_server.py");
      if (!fileExists(python)) {
        server.config.logger.warn("[PyTorch] .venv non trovato: esegui una volta `npm run upscaler:setup`.");
        return;
      }
      const launch = () => {
        if (stopping || !desiredRunning || child) return;
        const owned = startService(python, [entrypoint], {
          cwd: projectRoot,
          env: {
            ...process.env,
            MLSM_UPSCALER_PARENT_PID: String(process.pid),
            MLSM_UPSCALER_OWNER_KIND: "vite",
          },
          stdio: "inherit",
          detached: process.platform !== "win32",
        });
        child = owned;
        server.config.logger.info(`[PyTorch] avvio automatico con PID ${owned.pid ?? "in preparazione"} · http://127.0.0.1:8765`);
        let scheduled = false;
        const scheduleRestart = (reason: string) => {
          if (scheduled || stopping || !desiredRunning || child !== owned) return;
          scheduled = true;
          if (stabilityTimer !== null) clearTimeout(stabilityTimer);
          stabilityTimer = null;
          child = null;
          const delay = Math.min(10_000, 500 * 2 ** Math.min(restartAttempt, 5));
          restartAttempt += 1;
          server.config.logger.warn(`[PyTorch] ${reason}. Nuovo tentativo automatico tra ${delay} ms.`);
          restartTimer = setTimeout(() => { restartTimer = null; launch(); }, delay);
        };
        owned.once("spawn", () => {
          stabilityTimer = setTimeout(() => { restartAttempt = 0; stabilityTimer = null; }, 30_000);
        });
        owned.once("exit", (code, signal) => scheduleRestart(`servizio terminato${code !== null ? ` con codice ${code}` : ""}${signal ? ` · ${signal}` : ""}`));
        owned.once("error", (error) => scheduleRestart(`avvio fallito: ${error.message}`));
      };
      server.config.logger.info("[PyTorch] runtime disponibile su richiesta; verrà avviato entrando in una modalità che lo usa.");
      const stopChild = (permanent = false) => {
        if (permanent) stopping = true;
        desiredRunning = false;
        if (restartTimer !== null) clearTimeout(restartTimer);
        restartTimer = null;
        if (stabilityTimer !== null) clearTimeout(stabilityTimer);
        stabilityTimer = null;
        const owned = child;
        child = null;
        if (!owned || owned.exitCode !== null) return;
        try {
          if (process.platform === "win32" && owned.pid) spawn("taskkill", ["/PID", String(owned.pid), "/T", "/F"], { stdio: "ignore" });
          else if (owned.pid) process.kill(-owned.pid, "SIGTERM");
          else owned.kill("SIGTERM");
        } catch { owned.kill("SIGTERM"); }
        // A Python process blocked in native code can ignore/delay SIGTERM.
        // Never leave a backend owned by this Vite instance behind after close.
        const forceKillTimer = setTimeout(() => {
          if (owned.exitCode === null) owned.kill("SIGKILL");
        }, 2_000);
        forceKillTimer.unref?.();
        owned.once("exit", () => clearTimeout(forceKillTimer));
      };
      server.middlewares.use("/__mlsm/python/upscaler", async (request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (pathname === "/status" && request.method === "GET") {
          const current = await probe();
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify(current));
          return;
        }
        if (pathname === "/stop" && request.method === "POST") {
          stopChild();
          response.statusCode = 204;
          response.end();
          return;
        }
        if (pathname === "/start" && request.method === "POST") {
          desiredRunning = true;
          const current = await probe();
          if (current.running && !current.compatible) {
            server.config.logger.error(`[PyTorch] porta 8765 occupata da un backend incompatibile${current.apiVersion ? ` · API ${current.apiVersion}` : ""}.`);
          }
          if (!current.running) launch();
          response.statusCode = current.running && !current.compatible ? 409 : 202;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ started: !current.running, running: current.running }));
          return;
        }
        next();
      });
      server.httpServer?.once("close", () => stopChild(true));
    }
  };
}
