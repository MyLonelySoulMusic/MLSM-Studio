import { afterEach, describe, expect, it, vi } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createLaunchers, createMacLauncher, windowsInvocation } = require("./create_branded_launchers.cjs");
const { icoSizes, icnsTypes, pngSize, verifyBrandAssets } = require("./verify_brand_assets.cjs");
const root = resolve(import.meta.dirname, "..");
const temporary: string[] = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "mlsm-branded-launcher-")); temporary.push(directory);
  const project = join(directory, "MLSM Studio & l'artista $2026");
  mkdirSync(join(project, "scripts/macos"), { recursive: true }); mkdirSync(join(project, "apps/desktop/src-tauri/icons"), { recursive: true });
  for (const file of ["scripts/macos/launcher-executable.sh", "scripts/macos/launcher.applescript", "scripts/macos/launch.sh", "apps/desktop/src-tauri/tauri.conf.json", "apps/desktop/src-tauri/icons/icon.icns"]) copyFileSync(join(root, file), join(project, file));
  return project;
}
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("branded native app assets", () => {
  it("explicitly bundles the original multi-resolution icons for macOS, Windows and NSIS", () => {
    const result = verifyBrandAssets(root);
    expect(result.windowsSizes).toEqual(expect.arrayContaining([16, 32, 256]));
    expect(result.macTypes).toContain("ic10");
    expect(result.config.bundle.windows.nsis).toEqual({ installerIcon: "icons/icon.ico", uninstallerIcon: "icons/icon.ico" });
  });
  it("rejects corrupt icon formats", () => {
    for (const read of [pngSize, icoSizes, icnsTypes]) expect(() => read(Buffer.alloc(80))).toThrow();
    const ico = readFileSync(join(root, "apps/desktop/src-tauri/icons/icon.ico")); expect(() => icoSizes(ico.subarray(0, 40))).toThrow();
    const icns = readFileSync(join(root, "apps/desktop/src-tauri/icons/icon.icns")); expect(() => icnsTypes(icns.subarray(0, 60))).toThrow();
  });
  it("checks branding before packaging on either platform", () => {
    for (const name of ["scripts/macos/build.sh", "scripts/windows/build.bat"]) expect(readFileSync(join(root, name), "utf8")).toContain("verify_brand_assets.cjs");
  });
});
describe("macOS launcher", () => {
  it("creates a Finder app with a Retina icon and safely passes unusual project names as data", () => {
    const project = fixture(), bundle = createMacLauncher(project);
    const plist = readFileSync(join(bundle, "Contents/Info.plist"), "utf8");
    expect(plist).toContain("<key>CFBundleIconFile</key><string>MLSMStudio.icns</string>");
    expect(plist).toContain("<key>CFBundleExecutable</key><string>MLSMStudioLauncher</string>");
    expect(readFileSync(join(bundle, "Contents/Resources/MLSMStudio.icns")).equals(readFileSync(join(root, "apps/desktop/src-tauri/icons/icon.icns")))).toBe(true);
    expect(readFileSync(join(bundle, "Contents/Resources/project-root.txt"), "utf8")).toBe(`${project}\n`);
    const shell = readFileSync(join(bundle, "Contents/MacOS/MLSMStudioLauncher"), "utf8");
    expect(shell).not.toContain(project); expect(shell).toContain('"$MLSM_PROJECT_ROOT"'); expect(shell).toContain('"--check"');
    expect(readFileSync(join(bundle, "Contents/Resources/launch.applescript"), "utf8")).toContain("quoted form of");
    expect(statSync(join(bundle, "Contents/MacOS/MLSMStudioLauncher")).mode & 0o111).toBe(0o111);
  });
  it("is idempotent and repairs only its own managed files", () => {
    const project = fixture(), bundle = createMacLauncher(project), icon = join(bundle, "Contents/Resources/MLSMStudio.icns");
    const before = statSync(icon).mtimeMs; createMacLauncher(project); expect(statSync(icon).mtimeMs).toBe(before);
    writeFileSync(join(bundle, "Contents/Info.plist"), "outdated"); createMacLauncher(project);
    expect(readFileSync(join(bundle, "Contents/Info.plist"), "utf8")).toContain("CFBundleIconFile");
  });
  it("refuses to overwrite an unrelated app or a symlink", () => {
    const project = fixture(), path = join(project, "scripts/macos/MLSM Studio.app"); mkdirSync(path);
    expect(() => createMacLauncher(project)).toThrow("unmanaged"); expect(existsSync(join(path, "Contents"))).toBe(false);
    const second = fixture(); symlinkSync(path, join(second, "scripts/macos/MLSM Studio.app"), process.platform === "win32" ? "junction" : "dir");
    expect(() => createMacLauncher(second)).toThrow("symlink");
  });
});
describe("Windows launcher", () => {
  it("calls PowerShell.exe with argument boundaries, never npm.cmd/bat via spawnSync", () => {
    const project = "C:\\Users\\L'Artista\\Documents\\MLSM Studio & friends";
    const output = `${project}\\scripts\\windows`, invocation = windowsInvocation(project, output, { SystemRoot: "C:\\Windows" });
    expect(invocation.command).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(invocation.args).toContain(`${project}\\scripts\\windows\\create-launcher.ps1`);
    expect(invocation.args.slice(-4)).toEqual(["-ProjectRoot", project, "-OutputDirectory", output]);
  });
  it("sets the shortcut icon, separately quotes the BAT and preserves diagnostics", () => {
    const script = readFileSync(join(root, "scripts/windows/create-launcher.ps1"), "utf8");
    expect(script).toContain("$shortcut.TargetPath = $cmd"); expect(script).toContain("$shortcut.IconLocation = $icon + ',0'");
    expect(script).toContain("'/d /s /k \"\"{0}\"\"'"); expect(script).toContain("$shortcut.WorkingDirectory = $project");
    expect(script).toContain("$saved.Arguments -ne $arguments"); expect(script).toContain("unmanaged MLSM Studio.lnk"); expect(script).not.toContain("Invoke-Expression");
  });
  it("surfaces Windows shortcut failures rather than silently reporting success", () => {
    const spawn = vi.fn(() => ({ status: 1, stderr: "WSH unavailable" }));
    expect(() => createLaunchers(root, { platform: "win32", spawn, environment: {} })).toThrow("WSH unavailable");
    expect(spawn).toHaveBeenCalledWith("powershell.exe", expect.any(Array), expect.objectContaining({ shell: false, timeout: 30000 }));
  });
});
describe("installation and local state", () => {
  it("creates branded launchers during install and launch without turning icon failures into runtime failures", () => {
    for (const name of ["scripts/macos/install.sh", "scripts/macos/launch.sh", "scripts/windows/install.bat", "scripts/windows/launch.bat"]) {
      const script = readFileSync(join(root, name), "utf8"); expect(script).toContain("create_branded_launchers.cjs");
      expect(script).toMatch(/create_branded_launchers\.cjs[^\n]*\|\| echo/);
    }
  });
  it("keeps the absolute-path launcher artifacts out of Git", () => {
    const ignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(ignore).toContain("/scripts/macos/MLSM Studio.app/"); expect(ignore).toContain("/scripts/windows/MLSM Studio.lnk");
  });
});
