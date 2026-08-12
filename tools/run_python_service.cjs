#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { spawnSync } = require("node:child_process");
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
  : process.env;
const result = spawnSync(definition.program, definition.args, { cwd: root, stdio: "inherit", env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
