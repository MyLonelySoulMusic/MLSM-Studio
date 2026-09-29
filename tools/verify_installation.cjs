#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { python311Probe } = require("./setup_python_runtime.cjs");
const { resolveTool } = require("./platform_tools.cjs");
const { verifyNodeDependencies } = require("./verify_node_dependencies.cjs");
const { npmInvocation } = require("./npm_invocation.cjs");

const root = resolve(__dirname, "..");
function versionTuple(value) { return String(value).replace(/^v/, "").split(".").slice(0, 3).map((part) => Number.parseInt(part, 10) || 0); }
function versionAtLeast(actual, expected) {
  const a = versionTuple(actual); const b = versionTuple(expected);
  for (let i = 0; i < 3; i += 1) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return true;
}
function probe(command, args = [], validate = () => true, options = {}, execute = spawnSync) {
  const result = execute(command, args, { cwd: root, encoding: "utf8", timeout: 120000, windowsHide: true, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }, ...options });
  const ok = result.status === 0 && validate(`${result.stdout || ""}${result.stderr || ""}`);
  return { ok, detail: result.error ? `${command}: ${result.error.code || "errore"} · ${result.error.message}` : (ok ? (result.stdout || result.stderr || "").trim().split(/\r?\n/)[0] || "pronto" : (result.stderr || result.stdout || `Uscita ${result.status ?? result.signal ?? "sconosciuta"}`).trim().slice(-2000)) };
}
function probeNpm(platform = process.platform, options = {}, execute = spawnSync) {
  const invocation = npmInvocation(["--version"], { ...options, platform });
  return probe(invocation.command, invocation.args, value => /^\d+\.\d+\.\d+/m.test(value), invocation.options, execute);
}
function systemPython311(platform = process.platform) {
  const candidates = process.env.MLSM_PYTHON
    ? [[process.env.MLSM_PYTHON, []]]
    : platform === "win32"
      ? [["py", ["-3.11"]], ["python3.11", []], ["python", []]]
      : [["python3.11", []], ["python3", []], ["python", []]];
  for (const [command, prefix] of candidates) {
    const result = probe(command, [...prefix, "-c", `${python311Probe}; print('Python 3.11')`]);
    if (result.ok) return result;
  }
  return { ok: false, detail: "Python 3.11 non disponibile" };
}
function pythonRuntime(path, imports, absent) {
  return existsSync(path)
    ? probe(path, ["-P", "-c", `import sys; assert sys.version_info[:2] == (3, 11); ${imports}; print('Python 3.11 · dipendenze pronte')`])
    : { ok: false, detail: absent };
}
function collect(platform = process.platform) {
  const venv = (name) => resolve(root, name, platform === "win32" ? "Scripts/python.exe" : "bin/python");
  return {
    node: probe(process.execPath, ["--version"], (v) => versionAtLeast(v, "22.12.0")),
    npm: probeNpm(platform),
    npmDependencies: verifyNodeDependencies(),
    python311: systemPython311(platform),
    ffmpeg: probe(resolveTool("ffmpeg", platform), ["-version"]),
    ffprobe: probe(resolveTool("ffprobe", platform), ["-version"]),
    rubberband: probe(resolveTool("rubberband", platform), ["--version"]),
    rust: probe(resolveTool("rustc", platform), ["--version"]),
    cargo: probe(resolveTool("cargo", platform), ["--version"]),
    upscalerPython: pythonRuntime(venv(".venv"), "import types,torch,fastapi,cv2; from torchvision.transforms.functional import rgb_to_grayscale; m=types.ModuleType('torchvision.transforms.functional_tensor'); m.rgb_to_grayscale=rgb_to_grayscale; sys.modules['torchvision.transforms.functional_tensor']=m; import realesrgan", "ambiente .venv assente"),
    quantizerPython: pythonRuntime(venv(".venv-ai-quantizer"), "import beat_this, soundfile, scipy, onnxruntime", "ambiente .venv-ai-quantizer assente"),
    songPlayerPython: pythonRuntime(venv(".venv-song-player"), "import torch,torchaudio,demucs,cv2,mediapipe,faster_whisper", "ambiente .venv-song-player assente"),
    audioTtsPython: pythonRuntime(venv(".venv-audio-tts"), "from chatterbox.mtl_tts import ChatterboxMultilingualTTS", "ambiente .venv-audio-tts assente")
  };
}
if (require.main === module) {
  const checks = collect();
  const ok = Object.values(checks).every((item) => item.ok);
  if (process.argv.includes("--json")) console.log(JSON.stringify({ ok, platform: process.platform, arch: process.arch, checks }, null, 2));
  else {
    console.log(`MLSM Studio · verifica ${process.platform}/${process.arch}`);
    for (const [name, result] of Object.entries(checks)) console.log(`${result.ok ? "✓" : "✗"} ${name}: ${result.detail}`);
    console.log(ok ? "Installazione completa." : "Installazione incompleta: esegui node tools/repair_installation.cjs per riparare solo i componenti non pronti.");
  }
  process.exitCode = ok ? 0 : 1;
}
module.exports = { collect, probe, probeNpm, systemPython311, versionAtLeast, versionTuple };
