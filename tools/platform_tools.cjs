#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { existsSync } = require("node:fs");
const { resolve, win32 } = require("node:path");

const root = resolve(__dirname, "..");

function windowsToolCandidates(name, env = process.env) {
  const local = env.LOCALAPPDATA || "";
  const profile = env.USERPROFILE || "";
  const programFiles = env.ProgramFiles || "C:\\Program Files";
  const overrides = {
    rubberband: env.MLSM_RUBBERBAND,
    ffmpeg: env.MLSM_FFMPEG,
    ffprobe: env.MLSM_FFPROBE
  };
  const candidates = {
    rubberband: [
      overrides.rubberband,
      win32.join(root, "tools", "rubberband", "rubberband.exe"),
      "C:\\Tools\\rubberband\\rubberband.exe",
      "C:\\msys64\\ucrt64\\bin\\rubberband.exe"
    ],
    ffmpeg: [overrides.ffmpeg, local && win32.join(local, "Microsoft", "WinGet", "Links", "ffmpeg.exe")],
    ffprobe: [overrides.ffprobe, local && win32.join(local, "Microsoft", "WinGet", "Links", "ffprobe.exe")],
    node: [win32.join(programFiles, "nodejs", "node.exe")],
    npm: [win32.join(programFiles, "nodejs", "npm.cmd")],
    rustc: [profile && win32.join(profile, ".cargo", "bin", "rustc.exe")],
    cargo: [profile && win32.join(profile, ".cargo", "bin", "cargo.exe")]
  };
  return (candidates[name] || []).filter(Boolean);
}

function resolveTool(name, platform = process.platform, env = process.env, exists = existsSync) {
  if (platform === "win32") {
    const installed = windowsToolCandidates(name, env).find((candidate) => exists(candidate));
    if (installed) return installed;
  }
  return name;
}

module.exports = { resolveTool, windowsToolCandidates };
