import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const healthUrl = "http://127.0.0.1:8765/health";
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

interface ServiceProbe {
  running: boolean;
  compatible: boolean;
  apiVersion?: number;
}

async function probeService(): Promise<ServiceProbe> {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_500) });
    if (!response.ok) return { running: true, compatible: false };
    const health = await response.json() as { apiVersion?: number; capabilities?: { videoJobs?: boolean } };
    return {
      running: true,
      compatible: (health.apiVersion ?? 0) >= 2 && health.capabilities?.videoJobs === true,
      ...(health.apiVersion === undefined ? {} : { apiVersion: health.apiVersion })
    };
  } catch {
    return { running: false, compatible: false };
  }
}

export function localPyTorchService(): Plugin {
  let child: ChildProcess | null = null;
  return {
    name: "dynamic-sound-local-pytorch",
    apply: "serve",
    async configureServer(server) {
      const service = await probeService();
      if (service.compatible) {
        server.config.logger.info(`[PyTorch] servizio video frame-per-frame già attivo · API ${service.apiVersion ?? "compatibile"} · http://127.0.0.1:8765`);
        return;
      }
      if (service.running) {
        server.config.logger.error(`[PyTorch] la porta 8765 è occupata da un backend precedente${service.apiVersion ? ` (API ${service.apiVersion})` : ""}. Chiudilo e riavvia questo comando: non verrà usato per elaborare video.`);
        return;
      }
      const python = resolve(projectRoot, process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
      const entrypoint = resolve(projectRoot, "tools/upscaler_server.py");
      if (!existsSync(python)) {
        server.config.logger.warn("[PyTorch] .venv non trovato: esegui una volta `npm run upscaler:setup`.");
        return;
      }
      child = spawn(python, [entrypoint], { cwd: projectRoot, env: process.env, stdio: "inherit" });
      server.config.logger.info(`[PyTorch] avvio automatico con PID ${child.pid ?? "in preparazione"} · http://127.0.0.1:8765`);
      child.once("exit", (code, signal) => {
        if (code && code !== 0) server.config.logger.error(`[PyTorch] servizio terminato con codice ${code}${signal ? ` · ${signal}` : ""}.`);
        child = null;
      });
      child.once("error", (error) => server.config.logger.error(`[PyTorch] avvio fallito: ${error.message}`));
      const stopChild = () => {
        if (child && child.exitCode === null && !child.killed) child.kill("SIGTERM");
        child = null;
      };
      server.httpServer?.once("close", stopChild);
    }
  };
}
