import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { modelCacheErrorResponse } from "./src/services/model-cache-errors";

export { modelCacheErrorResponse } from "./src/services/model-cache-errors";

const modelRoute = "/__local-models/";
const statusRoute = "/__local-model-cache/status";
const allowedRepositories = new Set([
  "onnx-community/whisper-tiny_timestamped",
  "onnx-community/whisper-base_timestamped",
  "onnx-community/whisper-medium_timestamped",
  "onnx-community/Qwen2.5-0.5B-Instruct",
  "Xenova/detr-resnet-50",
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
]);

const cacheRoot = fileURLToPath(new URL("../../.transformers-cache/", import.meta.url));
const pendingDownloads = new Map<string, Promise<void>>();

function contentType(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".json") return "application/json";
  if (extension === ".txt") return "text/plain; charset=utf-8";
  if (extension === ".onnx" || extension === ".data") return "application/octet-stream";
  return "application/octet-stream";
}

function safeCachePath(repository: string, filename: string): string {
  const target = resolve(cacheRoot, repository, filename);
  if (!target.startsWith(`${resolve(cacheRoot)}${sep}`)) throw new Error("Percorso modello non valido.");
  return target;
}

function modelRequest(url: URL): { repository: string; filename: string } | null {
  if (!url.pathname.startsWith(modelRoute)) return null;
  const relative = decodeURIComponent(url.pathname.slice(modelRoute.length));
  const parts = relative.split("/").filter(Boolean);
  if (parts.length < 3) return null;
  const repository = `${parts[0]}/${parts[1]}`;
  const filename = parts.slice(2).join("/");
  if (!allowedRepositories.has(repository) || filename.includes("..")) return null;
  return { repository, filename };
}

async function existingFile(path: string): Promise<boolean> {
  try { return (await stat(path)).size > 0; } catch { return false; }
}

async function downloadOnce(repository: string, filename: string, target: string): Promise<void> {
  if (await existingFile(target)) return;
  let pending = pendingDownloads.get(target);
  if (!pending) {
    pending = (async () => {
      const remote = `https://huggingface.co/${repository}/resolve/main/${filename}`;
      const response = await fetch(remote, { redirect: "follow" });
      if (!response.ok || !response.body) {
        const status = response.ok ? 502 : response.status;
        throw Object.assign(new Error(`Hugging Face ${response.status} per ${filename}`), { status });
      }
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${process.pid}.partial`;
      try {
        await pipeline(Readable.fromWeb(response.body as never), createWriteStream(temporary));
        await rename(temporary, target);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
    })().finally(() => pendingDownloads.delete(target));
    pendingDownloads.set(target, pending);
  }
  await pending;
}

async function cachedFiles(directory: string, prefix = ""): Promise<string[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return []; }
  const result: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await cachedFiles(resolve(directory, entry.name), relative));
    else if (entry.isFile() && !entry.name.endsWith(".partial")) result.push(relative);
  }
  return result;
}

async function serveFile(response: ServerResponse, path: string): Promise<void> {
  const metadata = await stat(path);
  response.statusCode = 200;
  response.setHeader("Content-Type", contentType(path));
  response.setHeader("Content-Length", metadata.size);
  response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  response.setHeader("X-Model-Cache", "disk");
  createReadStream(path).pipe(response);
}

async function handleModel(request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> {
  if (!request.url) return next();
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === statusRoute) {
    const repository = url.searchParams.get("repository") ?? "";
    if (!allowedRepositories.has(repository)) {
      response.statusCode = 400; response.end("Repository non valido."); return;
    }
    const files = await cachedFiles(safeCachePath(repository, ".")).then((items) => items.filter((item) => item !== "."));
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ repository, files }));
    return;
  }
  const parsed = modelRequest(url);
  if (!parsed) return next();
  const target = safeCachePath(parsed.repository, parsed.filename);
  try {
    await downloadOnce(parsed.repository, parsed.filename, target);
    await serveFile(response, target);
  } catch (error) {
    const failure = modelCacheErrorResponse(error);
    response.statusCode = failure.statusCode;
    response.setHeader("Content-Type", failure.contentType);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Model-Cache", failure.fallbackToRemote ? "miss" : "error");
    response.setHeader("X-Model-Cache-Diagnostic", failure.diagnostic);
    if (failure.fallbackToRemote) response.setHeader("X-Model-Cache-Fallback", "remote");
    response.end(failure.body);
  }
}

export function persistentModelCache(): Plugin {
  return {
    name: "dynamic-sound-persistent-model-cache",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => { void handleModel(request, response, next); });
      server.config.logger.info(`Cache modelli persistente: ${basename(cacheRoot)}/`);
    }
  };
}
