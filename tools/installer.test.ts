import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { versionAtLeast } = require("./verify_installation.cjs");
const { resolveTool, windowsToolCandidates } = require("./platform_tools.cjs");
const { verifyNodeDependencies } = require("./verify_node_dependencies.cjs");
const { python311Probe, runtimes, venvPython } = require("./setup_python_runtime.cjs");
const platformScript = (platform: "macos" | "windows", file: string) => resolve(root, "scripts", platform, file);

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
  it("risolve Rubber Band anche se il terminale Windows non ha ancora ricaricato il PATH", () => {
    const installed = "C:\\msys64\\ucrt64\\bin\\rubberband.exe";
    expect(windowsToolCandidates("rubberband", {})).toContain(installed);
    expect(resolveTool("rubberband", "win32", {}, (candidate: string) => candidate === installed)).toBe(installed);
  });
  it("verifica che npm ci abbia installato davvero le dipendenze essenziali", () => {
    expect(verifyNodeDependencies()).toMatchObject({ ok: true });
  });
  it("blocca Python alla versione 3.11 e prepara tutti gli ambienti isolati", () => {
    expect(python311Probe).toContain("(3, 11)");
    expect(Object.fromEntries(Object.entries(runtimes).map(([name, value]) => [name, value.directory]))).toEqual({
      upscaler: ".venv",
      "ai-quantizer": ".venv-ai-quantizer",
      "song-player": ".venv-song-player",
      "audio-tts": ".venv-audio-tts",
    });
    const verify = readFileSync(resolve(root, "tools/verify_installation.cjs"), "utf8");
    for (const runtime of [".venv", ".venv-ai-quantizer", ".venv-song-player", ".venv-audio-tts"]) expect(verify).toContain(runtime);
    expect(verify).toContain("sys.version_info[:2] == (3, 11)");
  });
  it("installa e verifica l'intero runtime visuale Auto-AVSR", () => {
    const requirements = readFileSync(resolve(root, "tools/song-player/requirements.txt"), "utf8");
    const setup = readFileSync(resolve(root, "tools/setup_python_runtime.cjs"), "utf8");
    expect(requirements).toContain("torchaudio>=2.7,<3");
    expect(requirements).toContain("mediapipe==0.10.21");
    expect(requirements).toContain("opencv-contrib-python>=4.10,<5");
    expect(requirements).toContain("faster-whisper>=1.2,<2");
    expect(requirements).toContain("numba==0.61.2");
    expect(requirements).not.toContain("opencv-python-headless");
    expect(setup).toContain('features?.analyzeVisemes !== true');
    expect(setup).toContain('features?.transcribeWords !== true');
    expect(setup).toContain('"opencv-python-headless"');
    const tauri = JSON.parse(readFileSync(resolve(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"));
    expect(tauri.bundle.resources["../../../tools/song-player/auto_avsr_runtime.py"]).toBe("song-player/auto_avsr_runtime.py");
  });
  it("mantiene riproducibile il runtime Chatterbox su Python 3.11", () => {
    const requirements = readFileSync(resolve(root, "tools/audio/requirements.txt"), "utf8");
    expect(requirements).toContain("chatterbox-tts==0.1.7");
    expect(requirements).toContain("numba==0.61.2");
  });
  it("include l’intera catena macOS", () => {
    const script = readFileSync(platformScript("macos", "install.sh"), "utf8");
    for (const command of ["xcode-select", "brew install", "python@3.11", "npm ci --include=dev", "verify_node_dependencies.cjs", "setup_python_runtime.cjs upscaler", "setup_python_runtime.cjs ai-quantizer", "setup_python_runtime.cjs song-player", "setup_python_runtime.cjs audio-tts", "cargo fetch", "verify_installation.cjs"]) expect(script).toContain(command);
  });
  it("include l’intera catena Windows senza Bash", () => {
    const script = readFileSync(platformScript("windows", "install.bat"), "utf8");
    for (const command of ["OpenJS.NodeJS.LTS", "Python.Python.3.11", "py -3.11", "Rustlang.Rustup", "Gyan.FFmpeg", "MSYS2.MSYS2", "mingw-w64-ucrt-x86_64-rubberband", "Microsoft.EdgeWebView2Runtime", "Microsoft.VisualStudio.2022.BuildTools", "npm ci --include=dev", "verify_node_dependencies.cjs", "ensure-user-path.ps1", "rubberband.exe\" --version", "setup_python_runtime.cjs upscaler", "setup_python_runtime.cjs ai-quantizer", "setup_python_runtime.cjs song-player", "setup_python_runtime.cjs audio-tts", "verify_installation.cjs || exit /b"]) expect(script).toContain(command);
    expect(script).not.toContain("setup_ai_quantizer_env.sh");
    expect(script).not.toContain("setup_upscaler_env.sh");
  });
  it("aggiorna il PATH utente Windows senza usare setx", () => {
    const script = readFileSync(platformScript("windows", "ensure-user-path.ps1"), "utf8");
    expect(script).toContain("SetEnvironmentVariable('Path', $updated, 'User')");
    expect(script.toLowerCase()).not.toContain("setx");
  });
  it("fornisce launcher separati e verificabili senza avviare server", () => {
    const mac = readFileSync(platformScript("macos", "launch.sh"), "utf8");
    const windows = readFileSync(platformScript("windows", "launch.bat"), "utf8");
    expect(mac).toContain('"--check"');
    expect(windows).toContain('"--check"');
    expect(mac).toContain("npm run dev --workspace @rbs/desktop -- --port 1421");
    expect(windows).toContain("npm run dev --workspace @rbs/desktop -- --port 1421");
    expect(mac).toContain('"$SCRIPT_DIR/../.."');
    expect(windows).toContain('"%~dp0\\..\\.."');
  });
  it("fornisce packaging Tauri nativo per DMG e installer Windows", () => {
    const mac = readFileSync(platformScript("macos", "build.sh"), "utf8");
    const windows = readFileSync(platformScript("windows", "build.bat"), "utf8");
    expect(mac).toContain("tauri -- build --bundles dmg");
    expect(mac).toContain("CI=true");
    expect(windows).toContain("tauri -- build --bundles nsis,msi");
    expect(mac).toContain('"--check"');
    expect(windows).toContain('"--check"');
  });
  it("usa firma ad-hoc locale senza impedire la futura firma Apple", () => {
    const config = JSON.parse(readFileSync(resolve(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"));
    const script = readFileSync(platformScript("macos", "build.sh"), "utf8");
    expect(config.bundle.macOS).toBeUndefined();
    expect(script).toContain('"signingIdentity":"-"');
    expect(script).toContain("APPLE_CERTIFICATE");
  });
  it("mantiene la root libera da script di piattaforma e requisiti runtime", () => {
    for (const file of ["install.sh", "install.bat", "launch-mlsm.sh", "launch-mlsm.bat", "build-macos.sh", "build-windows.bat", "requirements-upscaler.txt"]) {
      expect(existsSync(resolve(root, file)), file).toBe(false);
    }
    expect(runtimes.upscaler.requirements).toBe("tools/upscaler/requirements.txt");
    expect(existsSync(resolve(root, runtimes.upscaler.requirements))).toBe(true);
  });
});
