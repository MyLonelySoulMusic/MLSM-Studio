import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { versionAtLeast } = require("./verify_installation.cjs");
const { venvPython } = require("./setup_python_runtime.cjs");

describe("installer multipiattaforma", () => {
  it("rifiuta Node troppo vecchio", () => {
    expect(versionAtLeast("22.2.0", "22.12.0")).toBe(false);
    expect(versionAtLeast("22.12.0", "22.12.0")).toBe(true);
    expect(versionAtLeast("24.0.0", "22.12.0")).toBe(true);
  });
  it("usa i percorsi venv nativi", () => {
    expect(venvPython(".venv", "win32")).toMatch(/\.venv[\\/]Scripts[\\/]python\.exe$/);
    expect(venvPython(".venv", "darwin")).toMatch(/\.venv[\\/]bin[\\/]python$/);
  });
  it("include l’intera catena macOS", () => {
    const script = readFileSync(resolve(root, "install.sh"), "utf8");
    for (const command of ["xcode-select", "brew install", "npm ci", "setup_python_runtime.cjs upscaler", "cargo fetch", "verify_installation.cjs"]) expect(script).toContain(command);
  });
  it("include l’intera catena Windows senza Bash", () => {
    const script = readFileSync(resolve(root, "install.bat"), "utf8");
    for (const command of ["OpenJS.NodeJS.LTS", "Python.Python.3.11", "Rustlang.Rustup", "Gyan.FFmpeg", "MSYS2.MSYS2", "mingw-w64-ucrt-x86_64-rubberband", "Microsoft.EdgeWebView2Runtime", "Microsoft.VisualStudio.2022.BuildTools", "npm ci", "setup_python_runtime.cjs"]) expect(script).toContain(command);
    expect(script).not.toContain("setup_ai_quantizer_env.sh");
    expect(script).not.toContain("setup_upscaler_env.sh");
  });
  it("fornisce launcher separati e verificabili senza avviare server", () => {
    const mac = readFileSync(resolve(root, "launch-mlsm.sh"), "utf8");
    const windows = readFileSync(resolve(root, "launch-mlsm.bat"), "utf8");
    expect(mac).toContain('"--check"');
    expect(windows).toContain('"--check"');
    expect(mac).toContain("npm run dev --workspace @rbs/desktop -- --port 1421");
    expect(windows).toContain("npm run dev --workspace @rbs/desktop -- --port 1421");
  });
  it("fornisce packaging Tauri nativo per DMG e installer Windows", () => {
    const mac = readFileSync(resolve(root, "build-macos.sh"), "utf8");
    const windows = readFileSync(resolve(root, "build-windows.bat"), "utf8");
    expect(mac).toContain("tauri -- build --bundles dmg");
    expect(mac).toContain("CI=true");
    expect(windows).toContain("tauri -- build --bundles nsis,msi");
    expect(mac).toContain('"--check"');
    expect(windows).toContain('"--check"');
  });
  it("usa firma ad-hoc locale senza impedire la futura firma Apple", () => {
    const config = JSON.parse(readFileSync(resolve(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"));
    const script = readFileSync(resolve(root, "build-macos.sh"), "utf8");
    expect(config.bundle.macOS).toBeUndefined();
    expect(script).toContain('"signingIdentity":"-"');
    expect(script).toContain("APPLE_CERTIFICATE");
  });
});
