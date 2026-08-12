#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");
function versionTuple(value) { return String(value).replace(/^v/, "").split(".").slice(0, 3).map((part) => Number.parseInt(part, 10) || 0); }
function versionAtLeast(actual, expected) {
  const a = versionTuple(actual); const b = versionTuple(expected);
  for (let i = 0; i < 3; i += 1) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return true;
}
function probe(command, args = [], validate = () => true) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  const ok = result.status === 0 && validate(`${result.stdout || ""}${result.stderr || ""}`);
  return { ok, detail: (result.stdout || result.stderr || "").trim().split(/\r?\n/)[0] || (ok ? "pronto" : "non disponibile") };
}
function collect(platform = process.platform) {
  const venv = (name) => resolve(root, name, platform === "win32" ? "Scripts/python.exe" : "bin/python");
  return {
    node: probe(process.execPath, ["--version"], (v) => versionAtLeast(v, "22.12.0")),
    npm: probe(platform === "win32" ? "npm.cmd" : "npm", ["--version"]),
    ffmpeg: probe("ffmpeg", ["-version"]), ffprobe: probe("ffprobe", ["-version"]),
    rubberband: probe("rubberband", ["--version"]), rust: probe("rustc", ["--version"]), cargo: probe("cargo", ["--version"]),
    upscalerPython: existsSync(venv(".venv")) ? probe(venv(".venv"), ["-c", "import sys,types,torch,fastapi,cv2; from torchvision.transforms.functional import rgb_to_grayscale; m=types.ModuleType('torchvision.transforms.functional_tensor'); m.rgb_to_grayscale=rgb_to_grayscale; sys.modules['torchvision.transforms.functional_tensor']=m; import realesrgan"]) : { ok: false, detail: "ambiente .venv assente" },
    quantizerPython: existsSync(venv(".venv-ai-quantizer")) ? probe(venv(".venv-ai-quantizer"), ["-c", "import beat_this, soundfile, scipy, onnxruntime"]) : { ok: false, detail: "ambiente .venv-ai-quantizer assente" }
  };
}
if (require.main === module) {
  const checks = collect();
  const ok = Object.values(checks).every((item) => item.ok);
  if (process.argv.includes("--json")) console.log(JSON.stringify({ ok, platform: process.platform, arch: process.arch, checks }, null, 2));
  else {
    console.log(`MLSM Studio · verifica ${process.platform}/${process.arch}`);
    for (const [name, result] of Object.entries(checks)) console.log(`${result.ok ? "✓" : "✗"} ${name}: ${result.detail}`);
    console.log(ok ? "Installazione completa." : "Installazione incompleta: riesegui l’installer della piattaforma.");
  }
  process.exitCode = ok ? 0 : 1;
}
module.exports = { collect, versionAtLeast, versionTuple };
