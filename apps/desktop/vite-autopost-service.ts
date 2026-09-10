import { spawn, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import { resolve } from "node:path";
import type { Plugin } from "vite";

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
  return {
    name: "mlsm-autopost-service",
    apply: "serve",
    async configureServer(server) {
      if (!await portOpen()) {
        const root = resolve(import.meta.dirname, "../..");
        child = spawn(process.execPath, [resolve(root, "tools/autopost/server.mjs")], { cwd: root, stdio: "ignore", env: { ...process.env, MLSM_AUTOPOST_PORT: "1430" } });
        child.once("exit", () => { child = undefined; });
      }
      const close = () => { if (child && child.exitCode === null) child.kill("SIGTERM"); child = undefined; };
      server.httpServer?.once("close", close);
    },
  };
}
