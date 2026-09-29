import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { npmInvocation } = require("./npm_invocation.cjs");
const { probe, probeNpm } = require("./verify_installation.cjs");
const { repairPlan, repairInstallation } = require("./repair_installation.cjs");
const healthy = () => Object.fromEntries(["node", "npm", "npmDependencies", "python311", "ffmpeg", "ffprobe", "rubberband", "rust", "cargo", "upscalerPython", "quantizerPython", "songPlayerPython", "audioTtsPython"].map(key => [key, { ok: true, detail: "pronto" }]));

describe("npm Windows senza spawnSync npm.cmd EINVAL", () => {
  const execPath = "C:\\Users\\Test User\\node v24\\node.exe";
  const cli = "C:\\Users\\Test User\\node v24\\node_modules\\npm\\bin\\npm-cli.js";
  it("esegue npm con lo stesso Node anche con directory custom e spazi", () => {
    expect(npmInvocation(["--version"], { platform: "win32", execPath, env: {}, exists: (path: string) => path === cli }))
      .toEqual({ command: execPath, args: [cli, "--version"], options: {} });
  });
  it("riutilizza npm_execpath ereditato da npm run dev", () => {
    const configured = "D:\\Tool chain\\npm-cli.js";
    expect(npmInvocation(["ci", "--include=dev"], { platform: "win32", execPath, env: { npm_execpath: configured }, exists: (path: string) => path === configured }).args)
      .toEqual([configured, "ci", "--include=dev"]);
  });
  it("cerca anche nel PATH con casing Windows senza assumere Program Files", () => {
    const installed = "D:\\NVM\\v24\\node_modules\\npm\\bin\\npm-cli.js";
    expect(npmInvocation(["--version"], { platform: "win32", execPath, env: { Path: '"D:\\NVM\\v24";C:\\Windows' }, exists: (path: string) => path === installed }).args[0]).toBe(installed);
  });
  it("usa cmd solo come fallback e non passa mai npm.cmd direttamente a spawn", () => {
    expect(npmInvocation(["--version"], { platform: "win32", env: {}, execPath, exists: () => false }))
      .toEqual({ command: "cmd.exe", args: ["/d", "/s", "/c", "npm.cmd --version"], options: { windowsVerbatimArguments: true } });
    expect(() => npmInvocation(["run", "x&whoami"], { platform: "win32", env: {}, execPath, exists: () => false })).toThrow();
  });
  it("ignora entrypoint di altri package manager e mantiene fallback macOS", () => {
    expect(npmInvocation(["--version"], { platform: "darwin", env: { npm_execpath: "/bin/yarn.js" }, execPath: "/bin/node", exists: () => false }))
      .toEqual({ command: "npm", args: ["--version"], options: {} });
  });
  it("il probe Windows passa anche senza npm eseguibile diretto", () => {
    const execute = vi.fn(() => ({ status: 0, stdout: "11.6.0\r\n", stderr: "" }));
    expect(probeNpm("win32", { execPath, env: {}, exists: (path: string) => path === cli }, execute)).toEqual({ ok: true, detail: "11.6.0" });
    expect(execute).toHaveBeenCalledWith(execPath, [cli, "--version"], expect.objectContaining({ windowsHide: true }));
  });
  it("espone causa reale e codifica Python UTF-8", () => {
    const execute = vi.fn(() => ({ status: null, error: { code: "EINVAL", message: "spawn failed" } }));
    expect(probe("missing", [], undefined, {}, execute)).toEqual({ ok: false, detail: "missing: EINVAL · spawn failed" });
    expect(execute).toHaveBeenCalledWith("missing", [], expect.objectContaining({ env: expect.objectContaining({ PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }), timeout: 120000 }));
  });
  it("rileva davvero npm installato sulla macchina di test", () => {
    expect(probeNpm()).toMatchObject({ ok: true, detail: expect.stringMatching(/^\d+\.\d+\.\d+/) });
  });
  it.skipIf(process.platform !== "win32")("esegue il fallback cmd sul sistema Windows reale", () => {
    const invocation = npmInvocation(["--version"], { exists: () => false });
    const result = spawnSync(invocation.command, invocation.args, { ...invocation.options, encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });
});

describe("Restore mirato e ripetibile", () => {
  it("nel caso segnalato pianifica soltanto i due venv assenti", () => {
    const checks = healthy(); checks.songPlayerPython.ok = false; checks.audioTtsPython.ok = false;
    expect(repairPlan(checks).map((step: { id: string }) => step.id)).toEqual(["song-player", "audio-tts"]);
  });
  it("nessuna installazione se tutto pronto", () => {
    const execute = vi.fn();
    expect(repairInstallation({ scan: healthy, execute, log: vi.fn() }).ok).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });
  it("il dry-run non installa nulla", () => {
    const checks = healthy(); checks.audioTtsPython.ok = false;
    const execute = vi.fn();
    const result = repairInstallation({ scan: () => checks, execute, log: vi.fn(), dryRun: true });
    expect(result.plan.map((step: { id: string }) => step.id)).toEqual(["audio-tts"]);
    expect(execute).not.toHaveBeenCalled();
  });
  it("verifica il risultato e non dichiara successo se il comando termina senza riparare", () => {
    const checks = healthy(); checks.audioTtsPython.ok = false;
    expect(repairInstallation({ scan: () => checks, execute: vi.fn(), log: vi.fn() }).ok).toBe(false);
  });
  it("prosegue sui runtime indipendenti e al secondo tentativo salta quello riparato", () => {
    const checks = healthy(); checks.songPlayerPython.ok = false; checks.audioTtsPython.ok = false;
    const execute = vi.fn((step: { id: string }) => { if (step.id === "song-player") throw new Error("rete assente"); checks.audioTtsPython.ok = true; });
    const result = repairInstallation({ scan: () => checks, execute, log: vi.fn() });
    expect(result.ok).toBe(false); expect(execute).toHaveBeenCalledTimes(2);
    expect(result.errors).toEqual(["song-player: rete assente"]);
    expect(repairPlan(checks).map((step: { id: string }) => step.id)).toEqual(["song-player"]);
  });
  it("installa prerequisiti prima dei venv senza duplicare FFmpeg/FFprobe o Rust/Cargo", () => {
    const checks = healthy();
    for (const key of ["python311", "ffmpeg", "ffprobe", "rust", "cargo", "songPlayerPython"]) checks[key].ok = false;
    expect(repairPlan(checks).map((step: { id: string }) => step.id)).toEqual(["python", "ffmpeg", "rust", "song-player"]);
  });
});
