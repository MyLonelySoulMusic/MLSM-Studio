#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const python = process.env.MLSM_PYTHON ?? (existsSync(resolve(".venv/bin/python")) ? resolve(".venv/bin/python") : "python3");
const result = spawnSync(python, ["-c", "import json; from tools.rife_runtime.adapter import get_rife_capabilities; c=get_rife_capabilities(run_self_test=True); print(json.dumps(c)); raise SystemExit(0 if c.get('ready') and c.get('verified') and c.get('selfTest') else 1)"], { encoding: "utf8" });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
