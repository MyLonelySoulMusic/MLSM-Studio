#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { spawnSync } = require("node:child_process");
const { existsSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");
const runtimes = {
  upscaler: { directory: ".venv", requirements: "requirements-upscaler.txt" },
  "ai-quantizer": { directory: ".venv-ai-quantizer", requirements: "tools/ai-quantizer/requirements.txt" },
  "song-player": { directory: ".venv-song-player", requirements: "tools/song-player/requirements.txt" }
  ,"audio-tts": { directory: ".venv-audio-tts", requirements: "tools/audio/requirements.txt" }
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
  const progressPrefix = isAiq ? "AIQ_PROGRESS" : name === "song-player" ? "SONG_PLAYER_PROGRESS" : name === "audio-tts" ? "AUDIO_TTS_PROGRESS" : null;
  const progress = (value, message) => { if (progressPrefix) console.log(`[${progressPrefix}] ${value}|${message}`); };
  progress(5, "Verifica di Python 3.11");
  const python = findPython();
  const target = venvPython(config.directory);
  if (!existsSync(target)) {
    progress(18, `Creazione dell’ambiente isolato ${config.directory}`);
    run(python.command, [...python.args, "-m", "venv", config.directory], { dryRun });
  }
  progress(28, "Aggiornamento degli strumenti Python");
  run(target, ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"], { dryRun });
  if (name === "song-player") {
    // MediaPipe requires the contrib build. Keeping another OpenCV wheel in
    // the same environment makes both distributions overwrite the same cv2
    // package and can produce non-deterministic native-library crashes.
    progress(36, "Rimozione di distribuzioni OpenCV incompatibili");
    run(target, ["-m", "pip", "uninstall", "--yes", "opencv-python", "opencv-python-headless"], { dryRun });
  }
  progress(42, "Installazione delle dipendenze Python");
  run(target, ["-m", "pip", "install", "--requirement", config.requirements], { dryRun });
  if (name === "upscaler" && !dryRun) {
    const check = spawnSync(target, ["-c", "import json; from tools.rife_runtime.adapter import get_rife_capabilities; c=get_rife_capabilities(run_self_test=True); print(json.dumps(c)); raise SystemExit(0 if c.get('ready') and c.get('verified') and c.get('selfTest') else 1)"], { cwd: root, encoding: "utf8" });
    if (check.stdout) console.log(`RIFE capability: ${check.stdout.trim()}`);
    if (check.status !== 0) console.warn("RIFE capability non verificabile; Motion/Blend restano disponibili.");
  }
  if (isAiq && !dryRun) writeFileSync(resolve(root, config.directory, ".mlsm-aiq-ready"), "ready\n");
  if (name === "song-player" && !dryRun) {
    progress(82, "Verifica del worker Song Player");
    const check = spawnSync(target, ["tools/song-player/worker.py"], {
      cwd: root,
      encoding: "utf8",
      input: '{"protocolVersion":1,"action":"capabilities"}\n'
    });
    if (check.stdout) console.log(`Song Player capability: ${check.stdout.trim()}`);
    let capability;
    try {
      const lastLine = check.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
      capability = JSON.parse(lastLine);
    } catch { capability = null; }
    if (check.status !== 0 || capability?.type !== "result" || capability?.result?.ready !== true || capability?.result?.features?.separateVocals !== true || capability?.result?.features?.analyzeVisemes !== true || capability?.result?.features?.transcribeWords !== true) {
      throw new Error("Il worker Song Player non ha superato la verifica Demucs/Auto-AVSR/Whisper.");
    }
    progress(91, "Download e verifica del modello Demucs htdemucs");
    const model = spawnSync(target, ["-c", "from demucs.pretrained import get_model; get_model('htdemucs'); print('Demucs htdemucs pronto')"], { cwd: root, encoding: "utf8", stdio: "inherit" });
    if (model.status !== 0) throw new Error("Il modello Demucs htdemucs non è stato scaricato o verificato.");
  }
  if (name === "audio-tts" && !dryRun) {
    progress(90, "Verifica del motore Chatterbox");
    const check = spawnSync(target, ["tools/audio/worker.py"], { cwd: root, encoding: "utf8", input: '{"protocolVersion":1,"action":"capabilities"}\n' });
    const lastLine = check.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
    let capability = null; try { capability = JSON.parse(lastLine); } catch { /* verified below */ }
    if (check.status !== 0 || capability?.type !== "result" || capability?.result?.ready !== true) throw new Error("Chatterbox non ha superato la verifica del runtime Audio.");
  }
  progress(100, "Ambiente Python pronto");
  console.log(`${name}: ambiente pronto in ${resolve(root, config.directory)}`);
}

if (require.main === module) {
  try { setup(process.argv[2], { dryRun: process.argv.includes("--dry-run") }); }
  catch (error) { console.error(`[MLSM setup] ${error.message}`); process.exitCode = 1; }
}

module.exports = { findPython, runtimes, setup, venvPython };
