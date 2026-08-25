#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..", "..");
const python = resolve(
  root,
  ".venv-song-player",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python"
);
const worker = resolve(__dirname, "worker.py");

if (!existsSync(python)) {
  console.error("Runtime Song Player assente. Esegui npm run song-player:setup.");
  process.exitCode = 1;
} else {
  const child = spawn(python, [worker], { cwd: root, stdio: "inherit", shell: false });
  child.once("error", (error) => {
    console.error(`[Song Player] ${error.message}`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1);
  });
}
