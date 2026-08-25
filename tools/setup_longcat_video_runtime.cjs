#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync } = require("node:fs");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");
const dataRoot = resolve(root, ".longcat-video");
const repository = resolve(dataRoot, "repository");
const checkpoint = resolve(dataRoot, "weights", "LongCat-Video");
const environment = resolve(root, ".venv-longcat-video");
const python = resolve(environment, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const worker = resolve(root, "tools", "longcat-video", "worker.py");
const revision = "6b3f4b8582a8bc3f20f795735f5383716c4ba794";
const repositoryUrl = "https://github.com/meituan-longcat/LongCat-Video.git";
const jsonMode = process.argv.includes("--json");
const dryRun = process.argv.includes("--dry-run");

function progress(value, message) {
  if (jsonMode) console.log(JSON.stringify({ protocolVersion: 1, type: "progress", progress: value, message }));
  else console.log(`[LongCat ${Math.round(value * 100)}%] ${message}`);
}

function commandWorks(command, args = []) { return spawnSync(command, args, { cwd: root, stdio: "ignore" }).status === 0; }
function run(command, args, options = {}) {
  if (dryRun) { console.log(`[dry-run] ${[command, ...args].join(" ")}`); return; }
  const result = spawnSync(command, args, { cwd: options.cwd ?? root, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Comando non riuscito (${result.status}): ${command} ${args.join(" ")}`);
}

function findPython310() {
  if (process.env.MLSM_LONGCAT_BOOTSTRAP_PYTHON && commandWorks(process.env.MLSM_LONGCAT_BOOTSTRAP_PYTHON, ["-c", "import sys; raise SystemExit(sys.version_info[:2] != (3, 10))"])) return process.env.MLSM_LONGCAT_BOOTSTRAP_PYTHON;
  for (const command of ["python3.10", "python3", "python"]) if (commandWorks(command, ["-c", "import sys; raise SystemExit(sys.version_info[:2] != (3, 10))"])) return command;
  throw new Error("Python 3.10 non trovato. Installa Python 3.10 o imposta MLSM_LONGCAT_BOOTSTRAP_PYTHON.");
}

function assertSupportedHost() {
  if (process.env.MLSM_LONGCAT_ALLOW_UNSUPPORTED === "1" || dryRun) return;
  if (process.platform !== "linux") throw new Error("La pipeline ufficiale LongCat-Video usa CUDA/NCCL e richiede Linux (anche WSL2) con GPU NVIDIA.");
  if (!commandWorks("nvidia-smi")) throw new Error("GPU NVIDIA/driver CUDA non rilevati (nvidia-smi non disponibile).");
}

function installRepository() {
  if (!dryRun) mkdirSync(dataRoot, { recursive: true });
  if (!existsSync(resolve(repository, ".git"))) {
    run("git", ["clone", "--no-checkout", repositoryUrl, repository]);
  }
  run("git", ["fetch", "--depth", "1", "origin", revision], { cwd: repository });
  run("git", ["checkout", "--detach", "--force", revision], { cwd: repository });
}

function installEnvironment() {
  const bootstrap = findPython310();
  if (!existsSync(python)) run(bootstrap, ["-m", "venv", environment]);
  run(python, ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"]);
  run(python, ["-m", "pip", "install", "torch==2.6.0+cu124", "torchvision==0.21.0+cu124", "torchaudio==2.6.0", "--index-url", "https://download.pytorch.org/whl/cu124"]);
  run(python, ["-m", "pip", "install", "ninja", "packaging", "psutil"]);
  run(python, ["-m", "pip", "install", "flash_attn==2.7.4.post1", "--no-build-isolation"]);
  run(python, ["-m", "pip", "install", "--requirement", resolve(repository, "requirements.txt"), "huggingface_hub[cli]"]);
}

function downloadCheckpoint() {
  if (!dryRun) mkdirSync(resolve(dataRoot, "weights"), { recursive: true });
  const script = "from huggingface_hub import snapshot_download; snapshot_download(repo_id='meituan-longcat/LongCat-Video', local_dir=r'''" + checkpoint.replaceAll("'", "") + "''')";
  run(python, ["-c", script]);
}

function verify() {
  if (!existsSync(python)) throw new Error("Runtime assente: esegui npm run longcat-video:setup.");
  const result = spawnSync(python, [worker, "--capabilities"], { cwd: root, encoding: "utf8", env: process.env });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error("Verifica runtime LongCat-Video non riuscita.");
  const last = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  const capability = JSON.parse(last)?.result;
  if (!capability?.ready) throw new Error(capability?.reason ?? "Runtime LongCat-Video incompleto.");
}

function setup() {
  assertSupportedHost();
  progress(0.03, "Verifica Linux, NVIDIA CUDA e Python 3.10");
  progress(0.08, "Installazione repository ufficiale fissato"); installRepository();
  progress(0.18, "Creazione ambiente PyTorch CUDA 12.4"); installEnvironment();
  if (!process.argv.includes("--skip-weights")) { progress(0.48, "Download checkpoint meituan-longcat/LongCat-Video"); downloadCheckpoint(); }
  if (!dryRun) { progress(0.94, "Verifica runtime e checkpoint"); verify(); }
  progress(1, process.argv.includes("--skip-weights") ? "Runtime pronto; scarica ancora il checkpoint" : "LongCat-Video pronto");
}

try {
  if (process.argv.includes("--check")) verify(); else setup();
} catch (error) {
  if (jsonMode) console.log(JSON.stringify({ protocolVersion: 1, type: "error", error: { code: "setup_failed", message: error.message } }));
  else console.error(`[LongCat setup] ${error.message}`);
  process.exitCode = 1;
}

module.exports = { checkpoint, dataRoot, environment, findPython310, repository, revision };
