#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } = require("node:fs");
const { dirname, join, relative, resolve } = require("node:path");

const projectRoot = resolve(__dirname, "..");
const STATE_VERSION = 1;
const STATE_RELATIVE_PATH = "node_modules/.cache/mlsm-studio/node-workspace-state.json";
const IGNORED_DIRECTORIES = new Set([".git", ".graphify", ".venv", ".venv-ai-quantizer", ".venv-audio-tts", ".venv-song-player", "dist", "node_modules", "target", "temp"]);
const BUILD_ROOTS = ["apps/desktop", "packages"];
const ROOT_BUILD_FILES = ["package.json", "package-lock.json", "tsconfig.json", "eslint.config.js", "vite.config.ts", "vite.config.js"];

function normalizedPath(root, file) { return relative(root, file).split("\\").join("/"); }
function walkFiles(root, directory, predicate = () => true) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === ".DS_Store" || entry.name.endsWith(".tsbuildinfo")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) files.push(...walkFiles(root, path, predicate));
    } else if (entry.isFile() && predicate(path)) files.push(path);
  }
  return files;
}
function hashFiles(root, files) {
  const hash = createHash("sha256");
  for (const file of [...new Set(files)].sort((a, b) => normalizedPath(root, a).localeCompare(normalizedPath(root, b)))) {
    hash.update(normalizedPath(root, file)); hash.update("\0"); hash.update(readFileSync(file)); hash.update("\0");
  }
  return hash.digest("hex");
}
function dependencyFiles(root) {
  const manifests = walkFiles(root, root, file => file.endsWith("package.json"));
  return [resolve(root, "package-lock.json"), ...manifests].filter(existsSync);
}
function buildFiles(root) {
  const files = ROOT_BUILD_FILES.map(file => resolve(root, file)).filter(existsSync);
  for (const directory of BUILD_ROOTS) files.push(...walkFiles(root, resolve(root, directory)));
  return files;
}
function statePath(root) { return resolve(root, STATE_RELATIVE_PATH); }
function readState(root) {
  try {
    const value = JSON.parse(readFileSync(statePath(root), "utf8"));
    return value?.version === STATE_VERSION ? value : null;
  } catch { return null; }
}
function writeState(root, state) {
  const destination = statePath(root); const temporary = `${destination}.tmp`;
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify({ version: STATE_VERSION, ...state }, null, 2)}\n`, "utf8");
  renameSync(temporary, destination);
}
function dependenciesPresent(root) {
  return ["node_modules/.package-lock.json", "node_modules/vite/bin/vite.js", "node_modules/typescript/bin/tsc", "node_modules/react/package.json", "node_modules/@tauri-apps/cli/tauri.js"]
    .every(path => existsSync(resolve(root, path)));
}
function workspaceStatus(root = projectRoot) {
  if (!existsSync(resolve(root, "package-lock.json"))) throw new Error("package-lock.json non trovato.");
  const state = readState(root);
  const dependencyFingerprint = hashFiles(root, dependencyFiles(root));
  const currentBuildFingerprint = hashFiles(root, buildFiles(root));
  const installRequired = !dependenciesPresent(root) || state?.dependencyFingerprint !== dependencyFingerprint;
  const buildRequired = installRequired || !existsSync(resolve(root, "apps/desktop/dist/index.html")) || state?.buildFingerprint !== currentBuildFingerprint;
  return { state, dependencyFingerprint, buildFingerprint: currentBuildFingerprint, installRequired, buildRequired };
}
function spawnInvocation(command, args, platform = process.platform, environment = process.env) {
  if (platform !== "win32") return { command, args };
  const commandProcessor = environment.ComSpec || environment.COMSPEC || "cmd.exe";
  return { command: commandProcessor, args: ["/d", "/s", "/c", [command, ...args].join(" ")] };
}
function run(root, command, args) {
  const shown = [command, ...args].join(" ");
  console.log(`\n[MLSM launcher] ${shown}`);
  const invocation = spawnInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, { cwd: root, env: process.env, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Comando terminato con codice ${result.status}: ${shown}`);
}
function prepareWorkspace(root = projectRoot, options = {}) {
  let status = workspaceStatus(root);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  if (status.installRequired) {
    console.log("[MLSM launcher] Dipendenze cambiate o incomplete: eseguo npm ci.");
    (options.runCommand || run)(root, npm, ["ci", "--include=dev"]);
    if (!dependenciesPresent(root)) throw new Error("npm ci è terminato, ma le dipendenze essenziali risultano incomplete.");
    writeState(root, { dependencyFingerprint: status.dependencyFingerprint, buildFingerprint: status.state?.buildFingerprint || null, dependenciesPreparedAt: new Date().toISOString(), buildPreparedAt: status.state?.buildPreparedAt || null });
    status = workspaceStatus(root);
  } else console.log("[MLSM launcher] Dipendenze npm aggiornate.");
  if (status.buildRequired) {
    console.log("[MLSM launcher] Sorgenti cambiati o build assente: eseguo npm run build.");
    (options.runCommand || run)(root, npm, ["run", "build"]);
    if (!existsSync(resolve(root, "apps/desktop/dist/index.html"))) throw new Error("La build è terminata senza produrre apps/desktop/dist/index.html.");
    const refreshed = workspaceStatus(root);
    writeState(root, { dependencyFingerprint: refreshed.dependencyFingerprint, buildFingerprint: refreshed.buildFingerprint, dependenciesPreparedAt: readState(root)?.dependenciesPreparedAt || new Date().toISOString(), buildPreparedAt: new Date().toISOString() });
  } else console.log("[MLSM launcher] Build web aggiornata.");
  return workspaceStatus(root);
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const status = workspaceStatus(projectRoot);
  if (checkOnly) {
    console.log(`[MLSM launcher] npm ci: ${status.installRequired ? "necessario" : "non necessario"}`);
    console.log(`[MLSM launcher] npm run build: ${status.buildRequired ? "necessario" : "non necessario"}`);
    process.exitCode = status.installRequired || status.buildRequired ? 2 : 0;
    return;
  }
  prepareWorkspace(projectRoot);
  console.log("[MLSM launcher] Workspace Node pronto.");
}
if (require.main === module) {
  try { main(); }
  catch (error) { console.error(`[MLSM launcher] Preparazione non riuscita: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
module.exports = { BUILD_ROOTS, STATE_RELATIVE_PATH, buildFiles, dependenciesPresent, dependencyFiles, hashFiles, prepareWorkspace, readState, spawnInvocation, statePath, workspaceStatus, writeState };
