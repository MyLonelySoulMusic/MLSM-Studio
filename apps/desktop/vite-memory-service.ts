import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, readdir, readFile, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, extname, isAbsolute, join, parse } from "node:path";
import { promisify } from "node:util";
import type { Plugin } from "vite";

const execFileAsync = promisify(execFile);
const routePrefix = "/__mlsm/memory";
const hardMaxEntries = 100_000;
const hardPreviewBytes = 128 * 1024 * 1024;

const mediaByExtension: Record<string, { mediaKind: string; mimeType: string }> = {
  ".jpg": { mediaKind: "image", mimeType: "image/jpeg" }, ".jpeg": { mediaKind: "image", mimeType: "image/jpeg" }, ".png": { mediaKind: "image", mimeType: "image/png" }, ".gif": { mediaKind: "image", mimeType: "image/gif" }, ".webp": { mediaKind: "image", mimeType: "image/webp" }, ".svg": { mediaKind: "image", mimeType: "image/svg+xml" },
  ".mp4": { mediaKind: "video", mimeType: "video/mp4" }, ".m4v": { mediaKind: "video", mimeType: "video/mp4" }, ".mov": { mediaKind: "video", mimeType: "video/quicktime" }, ".webm": { mediaKind: "video", mimeType: "video/webm" }, ".mkv": { mediaKind: "video", mimeType: "video/x-matroska" },
  ".mp3": { mediaKind: "audio", mimeType: "audio/mpeg" }, ".wav": { mediaKind: "audio", mimeType: "audio/wav" }, ".flac": { mediaKind: "audio", mimeType: "audio/flac" }, ".aac": { mediaKind: "audio", mimeType: "audio/aac" }, ".m4a": { mediaKind: "audio", mimeType: "audio/mp4" }, ".ogg": { mediaKind: "audio", mimeType: "audio/ogg" },
  ".txt": { mediaKind: "text", mimeType: "text/plain" }, ".md": { mediaKind: "text", mimeType: "text/markdown" }, ".csv": { mediaKind: "text", mimeType: "text/csv" }, ".json": { mediaKind: "text", mimeType: "application/json" }, ".srt": { mediaKind: "text", mimeType: "text/plain" }, ".vtt": { mediaKind: "text", mimeType: "text/plain" },
  ".pdf": { mediaKind: "document", mimeType: "application/pdf" }, ".doc": { mediaKind: "document", mimeType: "application/msword" }, ".docx": { mediaKind: "document", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  ".zip": { mediaKind: "archive", mimeType: "application/zip" }, ".rar": { mediaKind: "archive", mimeType: "application/vnd.rar" }, ".7z": { mediaKind: "archive", mimeType: "application/x-7z-compressed" }
};

function json(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let total = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array); total += value.byteLength;
    if (total > 1024 * 1024) throw new Error("Richiesta troppo grande.");
    chunks.push(value);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {};
}

async function canonicalExistingPath(value: unknown, expected: "file" | "directory" | "either" = "either") {
  if (typeof value !== "string" || !isAbsolute(value)) throw new Error("Il percorso deve essere assoluto.");
  const info = await lstat(value);
  if (info.isSymbolicLink()) throw new Error("I collegamenti simbolici non sono supportati.");
  if (expected === "file" && !info.isFile()) throw new Error("Il percorso non indica un file.");
  if (expected === "directory" && !info.isDirectory()) throw new Error("Il percorso non indica una cartella.");
  return realpath(value);
}

async function pickMac(mode: "files" | "folder") {
  const script = mode === "folder"
    ? "set chosenItem to choose folder with prompt \"Scegli la cartella da catalogare\"\nreturn POSIX path of chosenItem"
    : "set chosenItems to choose file with prompt \"Scegli i file da catalogare\" with multiple selections allowed\nset output to \"\"\nrepeat with chosenItem in chosenItems\nset output to output & POSIX path of chosenItem & linefeed\nend repeat\nreturn output";
  const { stdout } = await execFileAsync("osascript", ["-e", script], { maxBuffer: 4 * 1024 * 1024 });
  return stdout.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
}

async function pickLinux(mode: "files" | "folder") {
  const args = ["--file-selection", ...(mode === "folder" ? ["--directory"] : ["--multiple", "--separator=\n"]), "--title=MLSM Studio · Memory"];
  const { stdout } = await execFileAsync("zenity", args, { maxBuffer: 4 * 1024 * 1024 });
  return stdout.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
}

async function pickWindows(mode: "files" | "folder") {
  const script = mode === "folder"
    ? "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; if($d.ShowDialog() -eq 'OK'){[Console]::WriteLine($d.SelectedPath)}"
    : "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect=$true; if($d.ShowDialog() -eq 'OK'){$d.FileNames | ForEach-Object {[Console]::WriteLine($_)}}";
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-STA", "-Command", script], { maxBuffer: 4 * 1024 * 1024 });
  return stdout.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
}

async function pickPaths(mode: "files" | "folder") {
  try {
    return process.platform === "darwin" ? await pickMac(mode) : process.platform === "win32" ? await pickWindows(mode) : await pickLinux(mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/cancel|canceled|-128|code 1/iu.test(message)) return [];
    throw error;
  }
}

function describeMedia(path: string, directory: boolean) {
  if (directory) return { mediaKind: "folder", mimeType: "inode/directory" };
  return mediaByExtension[extname(path).toLowerCase()] ?? { mediaKind: "other", mimeType: "application/octet-stream" };
}

export async function scanLocalMemoryPaths(sourcePaths: string[], maxEntries: number) {
  const entries: Array<Record<string, unknown>> = []; const errors: string[] = []; let skippedCount = 0; let truncated = false;
  const stack = (await Promise.all(sourcePaths.map((path) => canonicalExistingPath(path)))).reverse();
  while (stack.length) {
    const path = stack.pop()!;
    if (entries.length >= maxEntries) { truncated = true; break; }
    try {
      const info = await lstat(path); const name = basename(path); const hidden = name.startsWith(".");
      if (hidden) { skippedCount += 1; continue; }
      const media = describeMedia(path, info.isDirectory());
      entries.push({
        path, parentPath: dirname(path), name, extension: info.isFile() ? extname(path).slice(1).toLowerCase() || undefined : undefined,
        entryType: info.isDirectory() ? "folder" : "file", ...media, sizeBytes: info.isFile() ? info.size : 0,
        modifiedAtMs: info.mtimeMs, createdAtMs: info.birthtimeMs, isHidden: false,
        previewSupported: info.isFile() && !["archive", "other"].includes(media.mediaKind) && info.size <= hardPreviewBytes
      });
      if (info.isDirectory()) {
        const children = (await readdir(path)).sort().reverse();
        for (const child of children) stack.push(join(path, child));
      }
    } catch (error) { skippedCount += 1; errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  entries.sort((left, right) => String(left.path).localeCompare(String(right.path)));
  return { entries, skippedCount, truncated, errors };
}

async function availableDestination(directory: string, source: string) {
  const original = basename(source); const parts = parse(original);
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = join(directory, index === 1 ? original : `${parts.name} (${index})${parts.ext}`);
    try { await lstat(candidate); } catch { return candidate; }
  }
  throw new Error(`Nessun nome disponibile per ${original}.`);
}

async function countCopied(path: string): Promise<{ files: number; bytes: number }> {
  const info = await stat(path); if (info.isFile()) return { files: 1, bytes: info.size };
  let files = 0; let bytes = 0;
  for (const child of await readdir(path)) { const counted = await countCopied(join(path, child)); files += counted.files; bytes += counted.bytes; }
  return { files, bytes };
}

export function localMemoryService(): Plugin {
  return {
    name: "mlsm-local-memory-filesystem",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(routePrefix, async (request, response) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        try {
          if (pathname === "/health") return json(response, 200, { ok: true, runtime: "mlsm-local-filesystem" });
          if (request.method !== "POST") return json(response, 405, { error: "Metodo non consentito." });
          const payload = await body(request);
          if (pathname === "/select") {
            const mode = payload.mode === "folder" ? "folder" : "files"; const selected = await pickPaths(mode);
            if (!selected.length) return json(response, 200, { cancelled: true });
            return json(response, 200, await scanLocalMemoryPaths(selected, Math.max(1, Math.min(hardMaxEntries, Number(payload.maxEntries) || 20_000))));
          }
          if (pathname === "/text-preview") {
            const path = await canonicalExistingPath(payload.path, "file"); const maxBytes = Math.max(1, Math.min(2 * 1024 * 1024, Number(payload.maxBytes) || 256 * 1024));
            const value = await readFile(path); const truncated = value.byteLength > maxBytes;
            return json(response, 200, { text: value.subarray(0, maxBytes).toString("utf8"), truncated });
          }
          if (pathname === "/preview") {
            const path = await canonicalExistingPath(payload.path, "file"); const info = await stat(path);
            if (info.size > hardPreviewBytes) return json(response, 413, { error: "File troppo grande per l’anteprima." });
            response.statusCode = 200; response.setHeader("Content-Type", describeMedia(path, false).mimeType); response.setHeader("Content-Length", info.size); response.setHeader("Cache-Control", "no-store");
            createReadStream(path).pipe(response); return;
          }
          if (pathname === "/copy") {
            const sourcePaths = Array.isArray(payload.sourcePaths) ? payload.sourcePaths : [];
            const picked = await pickPaths("folder"); if (!picked[0]) return json(response, 200, { cancelled: true });
            const destination = await canonicalExistingPath(picked[0], "directory"); const items = []; const failures = []; let copiedFiles = 0; let copiedBytes = 0;
            await mkdir(destination, { recursive: true });
            for (const value of sourcePaths) {
              try {
                const source = await canonicalExistingPath(value); const target = await availableDestination(destination, source);
                await cp(source, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
                const counted = await countCopied(target); copiedFiles += counted.files; copiedBytes += counted.bytes;
                items.push({ sourcePath: source, destinationPath: target, copiedFiles: counted.files, copiedBytes: counted.bytes });
              } catch (error) { failures.push({ sourcePath: String(value), message: error instanceof Error ? error.message : String(error) }); }
            }
            return json(response, 200, { items, failures, copiedFiles, copiedBytes });
          }
          return json(response, 404, { error: "Endpoint Memory sconosciuto." });
        } catch (error) { return json(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
      });
    }
  };
}
