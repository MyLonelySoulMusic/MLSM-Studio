#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");
const required = {
  lockfile: "package-lock.json",
  installedLockfile: "node_modules/.package-lock.json",
  vite: "node_modules/vite/bin/vite.js",
  typescript: "node_modules/typescript/bin/tsc",
  react: "node_modules/react/package.json",
  tauriCli: "node_modules/@tauri-apps/cli/tauri.js"
};

function collectNodeDependencies() {
  return Object.fromEntries(Object.entries(required).map(([name, relative]) => [name, {
    ok: existsSync(resolve(root, relative)),
    detail: relative
  }]));
}

function verifyNodeDependencies() {
  const checks = collectNodeDependencies();
  return {
    ok: Object.values(checks).every((item) => item.ok),
    detail: Object.entries(checks).filter(([, item]) => !item.ok).map(([name]) => name).join(", ") || "lockfile e pacchetti npm essenziali presenti",
    checks
  };
}

if (require.main === module) {
  const result = verifyNodeDependencies();
  for (const [name, item] of Object.entries(result.checks))
    console.log(`${item.ok ? "✓" : "✗"} npm/${name}: ${item.detail}`);
  if (!result.ok) console.error("Dipendenze npm incomplete: esegui `npm ci --include=dev` dalla root del progetto.");
  process.exitCode = result.ok ? 0 : 1;
}

module.exports = { collectNodeDependencies, required, verifyNodeDependencies };
