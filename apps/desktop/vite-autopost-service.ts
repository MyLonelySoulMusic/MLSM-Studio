import { spawn, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { terminateVerifiedListener } from "./vite-process-control";

const portOpen = () => new Promise<boolean>((done) => {
  const socket = connect({ host: "127.0.0.1", port: 1430 });
  const finish = (value: boolean) => { socket.destroy(); done(value); };
  socket.setTimeout(180);
  socket.once("connect", () => finish(true));
  socket.once("timeout", () => finish(false));
  socket.once("error", () => finish(false));
});

/** Keeps the same local scheduler/data service available when Studio runs in
 * a normal browser. It never adopts or terminates an existing AutoPost server. */
export function localAutoPostService(): Plugin {
  let child: ChildProcess | undefined;
  const start = async () => {
    if (child && child.exitCode === null) return { running: true, started: false, pid: child.pid ?? null };
    if (await portOpen()) return { running: true, started: false, pid: null };
    const root = resolve(import.meta.dirname, "../..");
    child = spawn(process.execPath, [resolve(root, "tools/autopost/server.mjs")], { cwd: root, stdio: "ignore", env: { ...process.env, MLSM_AUTOPOST_PORT: "1430" } });
    child.once("exit", () => { child = undefined; });
    return { running: false, started: true, pid: child.pid ?? null };
  };
  const entrypoint = resolve(import.meta.dirname, "../../tools/autopost/server.mjs");
  const stop = (includeVerifiedOrphans = false) => {
    const owned = child;
    child = undefined;
    if (owned && owned.exitCode === null) {
      if (process.platform === "win32" && owned.pid) spawn("taskkill", ["/PID", String(owned.pid), "/T", "/F"], { stdio: "ignore" });
      else owned.kill("SIGTERM");
    } else if (includeVerifiedOrphans) terminateVerifiedListener(1430, entrypoint);
  };
  return {
    name: "mlsm-autopost-service",
    apply: "serve",
    async configureServer(server) {
      await start();
      server.middlewares.use("/__mlsm/autopost", async (request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (pathname === "/status" && request.method === "GET") {
          const running = await portOpen();
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify({ running, compatible: running, pid: child?.pid ?? null }));
          return;
        }
        if (pathname === "/start" && request.method === "POST") {
          const result = await start();
          response.statusCode = result.running ? 200 : 202;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify(result));
          return;
        }
        if (pathname === "/stop" && request.method === "POST") {
          stop(true);
          response.statusCode = 204;
          response.end();
          return;
        }
        next();
      });
      server.httpServer?.once("close", stop);
    },
  };
}
