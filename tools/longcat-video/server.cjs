#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");
const dataRoot = path.resolve(projectRoot, ".longcat-video", "browser-jobs");
const uploadRoot = path.resolve(dataRoot, "uploads");
const requestRoot = path.resolve(dataRoot, "requests");
const resultRoot = path.resolve(dataRoot, "results");
const python = process.env.MLSM_LONGCAT_PYTHON || path.resolve(projectRoot, ".venv-longcat-video", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const torchrun = process.env.MLSM_LONGCAT_TORCHRUN || path.resolve(projectRoot, ".venv-longcat-video", process.platform === "win32" ? "Scripts/torchrun.exe" : "bin/torchrun");
const worker = path.resolve(__dirname, "worker.py");
const port = Number(process.env.MLSM_LONGCAT_PORT || 8766);
const jobs = new Map(); const uploads = new Map();
const MAX_BODY = 64 * 1024; const MAX_INPUT = 4 * 1024 * 1024 * 1024;

function id(prefix) { return `${prefix}-${Date.now().toString(16)}-${crypto.randomBytes(8).toString("hex")}`; }
function isLocalOrigin(origin) { return !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin); }
function headers(req, res) {
  const origin = req.headers.origin;
  if (origin && isLocalOrigin(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin"); res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-MLSM-LongCat"); res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS"); res.setHeader("Cache-Control", "no-store");
}
function json(res, status, value) { res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(value)); }
function snapshot(job) { return { jobId: job.id, mode: job.mode, status: job.status, progress: job.progress, message: job.message, result: job.result, error: job.error }; }
function validJobId(value) { return /^lc-[a-f0-9-]{10,80}$/.test(value); }
function safeName(value) { const name = path.basename(value || ""); return name === value && /^[\w .()-]{1,180}$/.test(name) ? name : null; }
function readJson(req) { return new Promise((resolve, reject) => { let size = 0; const parts = []; req.on("data", chunk => { size += chunk.length; if (size > MAX_BODY) { reject(new Error("payload troppo grande")); req.destroy(); } else parts.push(chunk); }); req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(parts).toString("utf8"))); } catch { reject(new Error("JSON non valido")); } }); req.on("error", reject); }); }

function capabilityCheck() {
  return new Promise(resolve => {
    if (!fs.existsSync(python) || !fs.existsSync(worker)) { resolve({ ready: false, platformSupported: process.platform === "linux", runtimeReady: false, repositoryReady: false, checkpointReady: false, cudaReady: false, gpuName: null, revision: "6b3f4b8582a8bc3f20f795735f5383716c4ba794", reason: "Esegui npm run longcat-video:setup", setupCommand: "npm run longcat-video:setup" }); return; }
    const child = spawn(python, [worker, "--capabilities"], { cwd: projectRoot, env: process.env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.stdout.on("data", chunk => { if (stdout.length < 1024 * 1024) stdout += chunk; }); child.stderr.on("data", chunk => { if (stderr.length < 64 * 1024) stderr += chunk; });
    child.on("error", error => { clearTimeout(timer); resolve({ ready: false, platformSupported: process.platform === "linux", runtimeReady: false, repositoryReady: false, checkpointReady: false, cudaReady: false, gpuName: null, revision: "6b3f4b8582a8bc3f20f795735f5383716c4ba794", reason: error.message, setupCommand: "npm run longcat-video:setup" }); });
    child.on("exit", () => { clearTimeout(timer); const line = stdout.trim().split(/\r?\n/).map(item => { try { return JSON.parse(item); } catch { return null; } }).find(item => item?.type === "result"); resolve(line?.result || { ready: false, platformSupported: process.platform === "linux", runtimeReady: true, repositoryReady: false, checkpointReady: false, cudaReady: false, gpuName: null, revision: "6b3f4b8582a8bc3f20f795735f5383716c4ba794", reason: stderr.trim() || "Capability check non riuscito", setupCommand: "npm run longcat-video:setup" }); });
  });
}

async function receiveUpload(req, url) {
  const kind = url.searchParams.get("kind"); const name = safeName(url.searchParams.get("name") || "");
  const extensions = kind === "image" ? new Set([".png", ".jpg", ".jpeg", ".webp"]) : kind === "video" ? new Set([".mp4", ".mov", ".webm", ".mkv"]) : null;
  if (!name || !extensions?.has(path.extname(name).toLowerCase())) throw new Error("nome o formato sorgente non valido");
  const declared = Number(req.headers["content-length"] || 0); if (declared > MAX_INPUT) throw new Error("sorgente oltre 4 GiB");
  await fsp.mkdir(uploadRoot, { recursive: true }); const uploadId = id("upload"); const target = path.resolve(uploadRoot, `${uploadId}${path.extname(name).toLowerCase()}`);
  if (path.dirname(target) !== uploadRoot) throw new Error("destinazione upload non confinata");
  let received = 0;
  await new Promise((resolve, reject) => { const output = fs.createWriteStream(target, { flags: "wx" }); const fail = error => { output.destroy(); fsp.rm(target, { force: true }).finally(() => reject(error)); }; req.on("data", chunk => { received += chunk.length; if (received > MAX_INPUT) fail(new Error("sorgente oltre 4 GiB")); }); req.on("error", fail); output.on("error", fail); output.on("finish", resolve); req.pipe(output); });
  if (!received) { await fsp.rm(target, { force: true }); throw new Error("sorgente vuota"); }
  uploads.set(uploadId, { path: target, name, kind, createdAt: Date.now() }); return { inputRef: `mlsm-upload:${uploadId}:${encodeURIComponent(name)}`, name };
}

function validateJobRequest(raw) {
  if (!raw || typeof raw !== "object" || !["textToVideo", "imageToVideo", "videoContinuation"].includes(raw.mode)) throw new Error("mode non valida");
  if (typeof raw.prompt !== "string" || !raw.prompt.trim() || raw.prompt.length > 4000 || typeof raw.negativePrompt !== "string" || raw.negativePrompt.length > 4000) throw new Error("prompt non valido");
  if (!Number.isInteger(raw.numFrames) || raw.numFrames < 5 || raw.numFrames > 257 || (raw.numFrames - 1) % 4) throw new Error("numFrames non valido");
  if (!Number.isInteger(raw.numInferenceSteps) || raw.numInferenceSteps < 1 || raw.numInferenceSteps > 100 || typeof raw.guidanceScale !== "number" || raw.guidanceScale < 0 || raw.guidanceScale > 20 || !Number.isInteger(raw.seed) || raw.seed < 0 || raw.seed > 2147483647) throw new Error("parametri di generazione non validi");
  const allowed = raw.mode === "textToVideo" ? new Set(["mode", "prompt", "negativePrompt", "outputDirectory", "width", "height", "numFrames", "numInferenceSteps", "guidanceScale", "seed", "useDistill", "enableCompile"]) : raw.mode === "imageToVideo" ? new Set(["mode", "prompt", "negativePrompt", "outputDirectory", "inputPath", "resolution", "numFrames", "numInferenceSteps", "guidanceScale", "seed", "useDistill", "enableCompile"]) : new Set(["mode", "prompt", "negativePrompt", "outputDirectory", "inputPath", "resolution", "numFrames", "numCondFrames", "numInferenceSteps", "guidanceScale", "seed", "useDistill", "enableCompile"]);
  const unknown = Object.keys(raw).filter(key => !allowed.has(key)); if (unknown.length) throw new Error(`campi non supportati: ${unknown.join(", ")}`);
  const payload = { ...raw, protocolVersion: 1 }; delete payload.outputDirectory; let upload = null;
  if (raw.mode === "textToVideo") { if (!Number.isInteger(raw.width) || !Number.isInteger(raw.height) || raw.width < 256 || raw.height < 256 || raw.width > 1280 || raw.height > 1280 || raw.width % 16 || raw.height % 16) throw new Error("dimensioni non valide"); }
  else { const match = typeof raw.inputPath === "string" && raw.inputPath.match(/^mlsm-upload:(upload-[a-f0-9-]+):/); upload = match ? uploads.get(match[1]) : null; if (!upload || upload.kind !== (raw.mode === "imageToVideo" ? "image" : "video")) throw new Error("upload sorgente non valido o scaduto"); if (!["480p", "720p"].includes(raw.resolution)) throw new Error("risoluzione non valida"); payload.inputPath = upload.path; if (raw.mode === "videoContinuation" && (!Number.isInteger(raw.numCondFrames) || raw.numCondFrames < 1 || raw.numCondFrames > Math.min(65, raw.numFrames))) throw new Error("numCondFrames non valido"); }
  if (raw.useDistill === true && (raw.numInferenceSteps !== 16 || raw.guidanceScale !== 1)) throw new Error("profilo distilled non valido");
  return { payload, upload };
}

function killTree(child) { if (!child || child.exitCode !== null) return; if (process.platform !== "win32") { try { process.kill(-child.pid, "SIGKILL"); return; } catch { /* portable child fallback below */ } } child.kill("SIGKILL"); }
function startJob(raw) {
  if ([...jobs.values()].some(job => job.status === "queued" || job.status === "running")) throw new Error("Un job LongCat-Video è già attivo");
  if (!fs.existsSync(torchrun) || !fs.existsSync(worker)) throw new Error("Runtime assente: esegui npm run longcat-video:setup");
  const { payload, upload } = validateJobRequest(raw); const jobId = id("lc"); const jobDir = path.resolve(requestRoot, jobId); const output = path.resolve(resultRoot, `${jobId}.mp4`);
  fs.mkdirSync(jobDir, { recursive: true }); fs.mkdirSync(resultRoot, { recursive: true }); payload.outputPath = output; const requestPath = path.resolve(jobDir, "request.json"); fs.writeFileSync(requestPath, JSON.stringify(payload), { flag: "wx" });
  const job = { id: jobId, mode: raw.mode, status: "queued", progress: 0, message: "Job in coda", result: null, error: null, child: null, output, upload }; jobs.set(jobId, job);
  const child = spawn(torchrun, ["--standalone", "--nproc_per_node=1", worker, "--request", requestPath], { cwd: projectRoot, env: process.env, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] }); job.child = child; job.status = "running"; job.message = "Avvio LongCat-Video";
  let pending = ""; let stderr = ""; let workerResult = null; let workerError = null;
  child.stdout.setEncoding("utf8"); child.stdout.on("data", chunk => { pending += chunk; const lines = pending.split(/\r?\n/); pending = lines.pop() || ""; for (const line of lines) { let event; try { event = JSON.parse(line); } catch { workerError = "protocollo JSONL non valido"; killTree(child); continue; } if (event.protocolVersion !== 1) { workerError = "protocolVersion non valida"; killTree(child); } else if (event.type === "progress" && Number.isFinite(event.progress)) { job.progress = Math.max(job.progress, Math.min(.99, event.progress)); job.message = typeof event.message === "string" ? event.message.slice(0, 500) : job.message; } else if (event.type === "result") workerResult = event.result; else if (event.type === "error") workerError = `${event.error?.code || "worker_error"}: ${event.error?.message || "errore non specificato"}`; } });
  child.stderr.setEncoding("utf8"); child.stderr.on("data", chunk => { if (stderr.length < 128 * 1024) stderr += chunk; });
  child.on("error", error => { if (job.status !== "cancelled") { job.status = "failed"; job.error = error.message; } });
  child.on("exit", async code => { job.child = null; if (job.status !== "cancelled") { const valid = code === 0 && workerResult?.path === output && fs.existsSync(output) && fs.statSync(output).size > 0; if (valid) { job.status = "completed"; job.progress = 1; job.message = "Video completato"; job.result = { ...workerResult, path: `http://127.0.0.1:${port}/jobs/${jobId}/result` }; } else { job.status = "failed"; job.message = "Generazione non riuscita"; job.error = (workerError || stderr.trim() || "worker terminato senza MP4 valido").slice(0, 4000); await fsp.rm(output, { force: true }); } } await fsp.rm(jobDir, { recursive: true, force: true }); if (upload) { uploads.delete(path.basename(upload.path).split(".")[0]); await fsp.rm(upload.path, { force: true }); } });
  return snapshot(job);
}

async function route(req, res) {
  headers(req, res); if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  const publicResult = req.method === "GET" && /^\/jobs\/lc-[a-f0-9-]+\/result$/.test(url.pathname);
  if (!isLocalOrigin(req.headers.origin) || (!publicResult && req.headers["x-mlsm-longcat"] !== "1")) { json(res, 403, { error: "origine MLSM non autorizzata" }); return; }
  try {
    if (req.method === "GET" && url.pathname === "/health") { json(res, 200, await capabilityCheck()); return; }
    if (req.method === "POST" && url.pathname === "/uploads") { json(res, 201, await receiveUpload(req, url)); return; }
    if (req.method === "POST" && url.pathname === "/jobs") { json(res, 202, startJob(await readJson(req))); return; }
    const match = url.pathname.match(/^\/jobs\/(lc-[a-f0-9-]+)(\/result)?$/); if (match && validJobId(match[1])) { const job = jobs.get(match[1]); if (!job) { json(res, 404, { error: "Job non trovato" }); return; } if (match[2]) { if (req.method !== "GET" || job.status !== "completed" || !fs.existsSync(job.output)) { json(res, 409, { error: "Risultato non disponibile" }); return; } res.statusCode = 200; res.setHeader("Content-Type", "video/mp4"); res.setHeader("Content-Length", fs.statSync(job.output).size); res.setHeader("Content-Disposition", `inline; filename="longcat-${job.id}.mp4"`); fs.createReadStream(job.output).pipe(res); return; } if (req.method === "GET") { json(res, 200, snapshot(job)); return; } if (req.method === "DELETE") { if (job.status === "queued" || job.status === "running") { job.status = "cancelled"; job.message = "Job annullato"; killTree(job.child); await fsp.rm(job.output, { force: true }); } json(res, 200, snapshot(job)); return; } }
    json(res, 404, { error: "Endpoint non trovato" });
  } catch (error) { json(res, /non valido|non valida|troppo|supportat|vuota|scaduto/.test(error.message) ? 400 : /già attivo/.test(error.message) ? 409 : 500, { error: error.message }); }
}

async function startServer() { await Promise.all([uploadRoot, requestRoot, resultRoot].map(directory => fsp.mkdir(directory, { recursive: true }))); const server = http.createServer((req, res) => void route(req, res)); await new Promise((resolve, reject) => { const failed = error => reject(error); server.once("error", failed); server.listen(port, "127.0.0.1", () => { server.off("error", failed); resolve(); }); }); console.log(`LongCat-Video locale disponibile su http://127.0.0.1:${port}`); const stop = () => { for (const job of jobs.values()) killTree(job.child); server.close(() => process.exit(0)); }; process.once("SIGINT", stop); process.once("SIGTERM", stop); return server; }

if (require.main === module) startServer().catch(error => { console.error(`[LongCat server] ${error.message}`); process.exitCode = 1; });
module.exports = { capabilityCheck, dataRoot, isLocalOrigin, safeName, startServer, validateJobRequest };
