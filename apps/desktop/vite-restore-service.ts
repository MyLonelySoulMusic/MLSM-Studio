import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import type { ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";

export interface RestoreJobSnapshot {
  state: "idle" | "running" | "success" | "error";
  progress: number;
  detail: string;
  logs: string[];
  restartRequired: boolean;
}

const projectRoot = resolve(import.meta.dirname, "../..");
const verifyScript = resolve(projectRoot, "tools/verify_installation.cjs");

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(value));
}

function runCaptured(command: string, args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", code => done({ code: code ?? 1, stdout, stderr }));
  });
}

export function restoreInstallerInvocation() {
  // No shell, nested quotes or batch wrappers: paths with spaces stay one argument.
  return { command: process.execPath, args: [resolve(projectRoot, "tools/repair_installation.cjs")] };
}

function restartInvocation(platform = process.platform) {
  const launcher = resolve(projectRoot, platform === "win32" ? "scripts/windows/launch.bat" : "scripts/macos/launch.sh");
  return platform === "win32"
    ? { command: "powershell.exe", args: ["-NoProfile", "-Command", "Start-Sleep -Seconds 2; Start-Process -FilePath $args[0] -WorkingDirectory $args[1]", launcher, projectRoot] }
    : { command: "bash", args: ["-c", "sleep 2; exec \"$1\"", "mlsm-restore", launcher] };
}

function attachRepairOutput(child: ChildProcessWithoutNullStreams, update: (line: string) => void) {
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    let pending = "";
    stream.on("data", (chunk: string) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) update(line);
    });
    stream.on("end", () => { if (pending) update(pending); });
  }
}

export function studioRestoreService(): Plugin {
  let serverRef: ViteDevServer | null = null;
  let repairProcess: ChildProcessWithoutNullStreams | null = null;
  let job: RestoreJobSnapshot = { state: "idle", progress: 0, detail: "", logs: [], restartRequired: false };
  const record = (line: string) => {
    const clean = line.trim();
    if (!clean) return;
    job.logs = [...job.logs.slice(-199), clean];
    job.detail = clean;
    const progress = clean.match(/^\[RESTORE_PROGRESS\] (\d+)\|(.*)$/);
    if (progress) { job.progress = Math.min(99, Number(progress[1])); job.detail = progress[2] ?? clean; }
  };
  return {
    name: "mlsm-studio-restore",
    apply: "serve",
    configureServer(server) {
      serverRef = server;
      server.middlewares.use("/__mlsm/restore", async (request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (pathname === "/scan" && request.method === "GET") {
          try {
            const result = await runCaptured(process.execPath, [verifyScript, "--json"]);
            const report = JSON.parse(result.stdout);
            return sendJson(response, 200, report);
          } catch (error) {
            return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
          }
        }
        if (pathname === "/repair" && request.method === "POST") {
          if (repairProcess && repairProcess.exitCode === null) return sendJson(response, 409, job);
          const invocation = restoreInstallerInvocation();
          job = { state: "running", progress: 2, detail: "Avvio del ripristino della piattaforma…", logs: [], restartRequired: false };
          try {
            const child = spawn(invocation.command, invocation.args, { cwd: projectRoot, env: process.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
            repairProcess = child;
            child.stdin.end();
            attachRepairOutput(child, record);
            child.once("error", error => { job = { ...job, state: "error", detail: error.message }; repairProcess = null; });
            child.once("close", code => {
              if (repairProcess !== child || job.state === "error") return;
              job = code === 0
                ? { ...job, state: "success", progress: 100, detail: "Ripristino completato. Riavvia MLSM Studio per applicare il nuovo ambiente.", restartRequired: true }
                : { ...job, state: "error", detail: `Ripristino terminato con codice ${code ?? "sconosciuto"}. ${job.logs.at(-1) ?? "Controlla i log."}` };
              repairProcess = null;
            });
            return sendJson(response, 202, job);
          } catch (error) {
            job = { ...job, state: "error", detail: error instanceof Error ? error.message : String(error) };
            repairProcess = null;
            return sendJson(response, 500, job);
          }
        }
        if (pathname === "/job" && request.method === "GET") return sendJson(response, 200, job);
        if (pathname === "/restart" && request.method === "POST") {
          const invocation = restartInvocation();
          const child = spawn(invocation.command, invocation.args, { cwd: projectRoot, env: process.env, stdio: "ignore", detached: true, windowsHide: true });
          child.unref();
          sendJson(response, 202, { restarting: true });
          setTimeout(() => { void serverRef?.close().finally(() => process.exit(0)); }, 250);
          return;
        }
        next();
      });
    },
  };
}
