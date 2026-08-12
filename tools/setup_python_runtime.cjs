#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { spawnSync } = require("node:child_process");
const { existsSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");
const runtimes = {
  upscaler: { directory: ".venv", requirements: "requirements-upscaler.txt" },
  "ai-quantizer": { directory: ".venv-ai-quantizer", requirements: "tools/ai-quantizer/requirements.txt" }
};

function venvPython(directory, platform = process.platform) {
  return resolve(root, directory, platform === "win32" ? "Scripts/python.exe" : "bin/python");
}

function commandWorks(command, args = []) {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0;
}

function findPython(platform = process.platform) {
  if (process.env.MLSM_PYTHON) return { command: process.env.MLSM_PYTHON, args: [] };
  if (platform === "win32" && commandWorks("py", ["-3.11", "-c", "import sys"])) return { command: "py", args: ["-3.11"] };
  for (const command of ["python3.11", "python3", "python"]) {
    if (commandWorks(command, ["-c", "import sys; raise SystemExit(not (sys.version_info[:2] == (3, 11)))"])) return { command, args: [] };
  }
  throw new Error("Python 3.11 non trovato. Esegui prima install.sh oppure install.bat.");
}

function run(command, args, options = {}) {
  const printable = [command, ...args].join(" ");
  if (options.dryRun) { console.log(`[dry-run] ${printable}`); return; }
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Comando non riuscito (${result.status}): ${printable}`);
}

function setup(name, { dryRun = false } = {}) {
  const config = runtimes[name];
  if (!config) throw new Error(`Runtime sconosciuto: ${name}`);
  const isAiq = name === "ai-quantizer";
  const progress = (value, message) => { if (isAiq) console.log(`[AIQ_PROGRESS] ${value}|${message}`); };
  progress(5, "Verifica di Python 3.11");
  const python = findPython();
  const target = venvPython(config.directory);
  if (!existsSync(target)) {
    progress(18, `Creazione dell’ambiente isolato ${config.directory}`);
    run(python.command, [...python.args, "-m", "venv", config.directory], { dryRun });
  }
  progress(28, "Aggiornamento degli strumenti Python");
  run(target, ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"], { dryRun });
  progress(42, "Installazione delle dipendenze Python");
  run(target, ["-m", "pip", "install", "--requirement", config.requirements], { dryRun });
  if (isAiq && !dryRun) writeFileSync(resolve(root, config.directory, ".mlsm-aiq-ready"), "ready\n");
  progress(100, "Ambiente Python pronto");
  console.log(`${name}: ambiente pronto in ${resolve(root, config.directory)}`);
}

if (require.main === module) {
  try { setup(process.argv[2], { dryRun: process.argv.includes("--dry-run") }); }
  catch (error) { console.error(`[MLSM setup] ${error.message}`); process.exitCode = 1; }
}

module.exports = { findPython, runtimes, setup, venvPython };
