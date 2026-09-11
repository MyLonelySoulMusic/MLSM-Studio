import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";

const APP_IDENTIFIER = "studio.dynamicsound.animation";
const MAX_REQUEST_BYTES = 52 * 1024 * 1024;
type JsonObject = Record<string, unknown>;
interface ReportsArchive { schemaVersion: 1; dashboards: unknown[] }

function dataFile(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", APP_IDENTIFIER, "reports", "dashboards.json");
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), APP_IDENTIFIER, "reports", "dashboards.json");
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), APP_IDENTIFIER, "reports", "dashboards.json");
}

function record(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function dashboardId(value: unknown): string {
  const id = record(value)?.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("ID dashboard non valido.");
  return id;
}

async function readArchive(path: string): Promise<ReportsArchive> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    const source = record(value);
    if (source?.schemaVersion !== 1 || !Array.isArray(source.dashboards)) throw new Error("L’archivio Reports locale non è valido.");
    return { schemaVersion: 1, dashboards: source.dashboards };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, dashboards: [] };
    throw error;
  }
}

async function writeArchive(path: string, archive: ReportsArchive): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(archive), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

export async function applyReportsRequest(path: string, request: unknown): Promise<unknown> {
  const source = record(request);
  if (!source) throw new Error("Richiesta Reports non valida.");
  const action = source.action;
  const archive = await readArchive(path);
  if (action === "list") return archive.dashboards;
  if (action === "save") {
    const id = dashboardId(source.dashboard);
    archive.dashboards = [source.dashboard, ...archive.dashboards.filter(item => dashboardId(item) !== id)];
    await writeArchive(path, archive);
    return null;
  }
  if (action === "delete") {
    const id = dashboardId({ id: source.dashboardId });
    archive.dashboards = archive.dashboards.filter(item => dashboardId(item) !== id);
    await writeArchive(path, archive);
    return null;
  }
  throw new Error("Operazione Reports non supportata.");
}

export function localReportsService(): Plugin {
  const path = dataFile();
  let queue: Promise<unknown> = Promise.resolve();
  return {
    name: "mlsm-reports", apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__mlsm/reports", async (request, response) => {
        const send = (status: number, value: unknown) => { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(value)); };
        if (request.method !== "POST" || !request.headers["content-type"]?.startsWith("application/json")) return send(405, { error: "JSON POST required" });
        try {
          if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) return send(403, { error: "Origin rejected" });
          let raw = "";
          for await (const chunk of request) {
            raw += Buffer.from(chunk).toString("utf8");
            if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) return send(413, { error: "La dashboard supera il limite di 50 MB." });
          }
          const parsed: unknown = JSON.parse(raw);
          const result = await (queue = queue.then(() => applyReportsRequest(path, parsed), () => applyReportsRequest(path, parsed)));
          return send(200, { result });
        } catch (error) {
          return send(400, { error: error instanceof Error ? error.message : "Richiesta Reports non valida." });
        }
      });
    },
  };
}
