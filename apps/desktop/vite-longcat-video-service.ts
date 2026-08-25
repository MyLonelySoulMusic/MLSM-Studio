import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

export const longCatVideoHealthUrl = "http://127.0.0.1:8766/health";
export function longCatVideoProjectRoot(cwd = process.cwd()): string { return existsSync(resolve(cwd, "tools/longcat-video/server.cjs")) ? cwd : resolve(cwd, "../.."); }
const projectRoot = longCatVideoProjectRoot();

export function longCatVideoServerPath(root = projectRoot): string { return resolve(root, "tools/longcat-video/server.cjs"); }

async function serviceRunning(): Promise<boolean> {
  try { const response = await fetch(longCatVideoHealthUrl, { headers: { "X-MLSM-LongCat": "1" }, signal: AbortSignal.timeout(1_500) }); return response.ok; }
  catch { return false; }
}

export function localLongCatVideoService(): Plugin {
  let child: ChildProcess | null = null;
  return {
    name: "mlsm-local-longcat-video",
    apply: "serve",
    async configureServer(server) {
      if (await serviceRunning()) { server.config.logger.info(`[LongCat Video] bridge locale già disponibile · ${longCatVideoHealthUrl}`); return; }
      const entrypoint = longCatVideoServerPath();
      if (!existsSync(entrypoint)) throw new Error(`[LongCat Video] bridge locale mancante: ${entrypoint}`);
      child = spawn(process.execPath, [entrypoint], { cwd: projectRoot, env: process.env, stdio: "inherit", shell: false });
      server.config.logger.info(`[LongCat Video] avvio bridge locale con PID ${child.pid ?? "in preparazione"} · http://127.0.0.1:8766`);
      child.once("error", (error) => server.config.logger.error(`[LongCat Video] avvio bridge fallito: ${error.message}`));
      child.once("exit", (code) => { if (code && code !== 0) server.config.logger.error(`[LongCat Video] bridge terminato con codice ${code}.`); child = null; });
      server.httpServer?.once("close", () => { if (child && child.exitCode === null && !child.killed) child.kill("SIGTERM"); child = null; });
    }
  };
}
