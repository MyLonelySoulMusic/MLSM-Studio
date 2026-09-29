#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { collect } = require("./verify_installation.cjs");

const root = resolve(__dirname, "..");
const groups = [
  { id: "node", keys: ["node", "npm"], winget: "OpenJS.NodeJS.LTS", brew: "node@22" },
  { id: "python", keys: ["python311"], winget: "Python.Python.3.11", brew: "python@3.11" },
  { id: "ffmpeg", keys: ["ffmpeg", "ffprobe"], winget: "Gyan.FFmpeg", brew: "ffmpeg" },
  { id: "rubberband", keys: ["rubberband"], brew: "rubberband" },
  { id: "rust", keys: ["rust", "cargo"], winget: "Rustlang.Rustup", brew: "rust" },
  { id: "npmDependencies", keys: ["npmDependencies"], script: "prepare_node_workspace.cjs" },
  ...Object.entries({ upscalerPython: "upscaler", quantizerPython: "ai-quantizer", songPlayerPython: "song-player", audioTtsPython: "audio-tts" })
    .map(([key, runtime]) => ({ id: runtime, keys: [key], script: "setup_python_runtime.cjs", runtime })),
];

function repairPlan(checks) { return groups.filter(group => group.keys.some(key => checks[key]?.ok === false)); }

function run(command, args) {
  console.log(`[restore] ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", windowsHide: true, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command}: codice ${result.status ?? result.signal}`);
}

function refreshPath(platform = process.platform) {
  if (platform !== "win32") return;
  // Read the newly installed user/machine PATH without setx or editing user settings.
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  if (result.status === 0 && result.stdout.trim()) process.env.PATH = `${process.env.PATH || ""};${result.stdout.trim()}`;
}

function repairComponent(step, platform = process.platform) {
  if (step.script) return run(process.execPath, [resolve(__dirname, step.script), ...(step.runtime ? [step.runtime] : [])]);
  if (platform === "win32") {
    const install = id => run("winget.exe", ["install", "--id", id, "--exact", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"]);
    if (step.id === "rubberband") {
      if (!existsSync("C:\\msys64\\usr\\bin\\bash.exe")) install("MSYS2.MSYS2");
      run("C:\\msys64\\usr\\bin\\bash.exe", ["-lc", "pacman -S --needed --noconfirm mingw-w64-ucrt-x86_64-rubberband"]);
      run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", resolve(root, "scripts/windows/ensure-user-path.ps1"), "-Directory", "C:\\msys64\\ucrt64\\bin"]);
    } else install(step.winget);
    refreshPath(platform);
    return;
  }
  if (platform === "darwin") {
    const brew = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"].find(existsSync) || "brew";
    const installed = spawnSync(brew, ["list", "--versions", step.brew], { encoding: "utf8" });
    if (installed.error?.code === "ENOENT") throw new Error("Homebrew non disponibile: esegui scripts/macos/install.sh per il bootstrap iniziale.");
    run(brew, [installed.status === 0 ? "reinstall" : "install", step.brew]);
    return;
  }
  throw new Error(`Riparazione di ${step.id} non supportata su ${platform}`);
}

function repairInstallation({ scan = collect, execute = repairComponent, log = console.log, dryRun = false, platform = process.platform } = {}) {
  log("[restore] Verifica iniziale: i componenti pronti saranno saltati.");
  const initial = scan();
  const plan = repairPlan(initial);
  for (const group of groups.filter(group => !plan.includes(group))) log(`[restore] SKIP ${group.id}: pronto`);
  if (dryRun) {
    for (const step of plan) log(`[dry-run] Ripara ${step.id}${step.runtime ? `: node tools/setup_python_runtime.cjs ${step.runtime}` : ""}`);
    return { checks: initial, plan, errors: [], ok: true };
  }
  const errors = [];
  for (const [index, step] of plan.entries()) {
    log(`[RESTORE_PROGRESS] ${Math.round(5 + index / plan.length * 85)}|Riparazione ${step.id} (${index + 1}/${plan.length})`);
    try { execute(step, platform); }
    catch (error) { const detail = `${step.id}: ${error.message}`; errors.push(detail); log(`[restore] ERRORE ${detail}`); }
  }
  log("[RESTORE_PROGRESS] 95|Verifica finale dell'installazione");
  const checks = scan();
  const failed = Object.entries(checks).filter(([, check]) => !check.ok);
  for (const [key, check] of failed) log(`[restore] NON PRONTO ${key}: ${check.detail}`);
  const ok = failed.length === 0 && errors.length === 0;
  log(ok ? "[RESTORE_PROGRESS] 100|Ripristino completato: tutti i controlli superati." : `[restore] Ripristino incompleto: ${failed.map(([key]) => key).join(", ") || errors.join("; ")}. Consulta gli errori sopra; riprovando verranno saltati i componenti pronti.`);
  return { checks, plan, errors, ok };
}

if (require.main === module) {
  try {
    refreshPath();
    process.exitCode = repairInstallation({ dryRun: process.argv.includes("--dry-run") }).ok ? 0 : 1;
  } catch (error) { console.error(`[restore] ${error.message}`); process.exitCode = 1; }
}
module.exports = { repairPlan, repairInstallation };
