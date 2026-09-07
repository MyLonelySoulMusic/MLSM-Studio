import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { Plugin } from "vite";

export function studioSettingsService(): Plugin {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const children = new Set<ChildProcess>();
  return {
    name: "mlsm-settings", apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__mlsm/settings", async (request, response) => {
        const send = (status: number, value: unknown) => { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(value)); };
        if (request.method !== "POST" || !request.headers["content-type"]?.startsWith("application/json")) return send(405, { error: "JSON POST required" });
        try {
          if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) return send(403, { error: "Origin rejected" });
          let raw = "";
          for await (const chunk of request) { raw += Buffer.from(chunk).toString("utf8"); if (raw.length > 140_000) return send(413, { error: "Request too large" }); }
          JSON.parse(raw);
          const child = spawn(process.platform === "win32" ? "python" : "python3", [resolve(root, "tools/settings/worker.py"), root, resolve(root, ".mlsm-settings")], { cwd: root, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
          children.add(child);
          let output = "";
          const kill = () => { if (child.exitCode === null) child.kill(); };
          const timeout = setTimeout(kill, 60_000);
          response.once("close", kill);
          child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); if (output.length > 2_000_000) kill(); });
          child.once("error", () => { clearTimeout(timeout); children.delete(child); if (!response.writableEnded) send(503, { error: "Python unavailable for settings bridge" }); });
          child.once("exit", (code) => { clearTimeout(timeout); children.delete(child); if (response.writableEnded || response.destroyed) return; try { send(code === 0 ? 200 : 503, JSON.parse(output)); } catch { send(503, { error: "Settings bridge timed out or unavailable" }); } });
          child.stdin?.end(raw + "\n");
        } catch { if (!response.headersSent) send(400, { error: "Invalid settings request" }); }
      });
      server.httpServer?.once("close", () => { for (const child of children) child.kill(); children.clear(); });
    },
  };
}
