#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { venvPython } = require("./setup_python_runtime.cjs");

const root = resolve(__dirname, "..");
const target = process.argv[2];
const definitions = {
  upscaler: { venv: ".venv", program: venvPython(".venv"), args: [resolve(root, "tools/upscaler_server.py")] },
  "ai-quantizer": { venv: ".venv-ai-quantizer", program: process.execPath, args: [resolve(root, "tools/ai-quantizer/server.cjs")] }
};
const definition = definitions[target];
if (!definition) { console.error(`Servizio sconosciuto: ${target}`); process.exit(2); }
const python = venvPython(definition.venv);
if (!existsSync(python)) { console.error(`Runtime mancante. Esegui: npm run ${target}:setup`); process.exit(1); }
const env = target === "ai-quantizer"
  ? { ...process.env, AIQ_PYTHON: python, AIQ_DATA_ROOT: resolve(root, ".ai-quantizer-data/projects") }
  : {
      ...process.env,
      MLSM_UPSCALER_PARENT_PID: String(process.pid),
      MLSM_UPSCALER_OWNER_KIND: "cli",
    };
const child = spawn(definition.program, definition.args, { cwd: root, stdio: "inherit", env });
let stopping = false;

function stop(signal) {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  const force = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 3000);
  force.unref();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => stop(signal));
}
child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal && !stopping) console.error(`Servizio terminato dal segnale ${signal}`);
  process.exit(code ?? (stopping ? 0 : 1));
});
