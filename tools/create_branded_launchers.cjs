#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { spawnSync } = require("node:child_process");
const { existsSync, lstatSync, mkdirSync, readFileSync, chmodSync, writeFileSync } = require("node:fs");
const { join, resolve, win32 } = require("node:path");
const { verifyBrandAssets } = require("./verify_brand_assets.cjs");
const owner = "mlsm-branded-launcher-v1";

function writeManaged(file, content) {
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error(`Refusing to overwrite a symlink: ${file}`);
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  if (!existsSync(file) || !readFileSync(file).equals(bytes)) writeFileSync(file, bytes);
}
function ensureDirectory(directory) {
  if (existsSync(directory) && (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory())) throw new Error(`Unsafe launcher directory: ${directory}`);
  mkdirSync(directory, { recursive: true });
}
function createMacLauncher(root, output = join(root, "scripts/macos")) {
  const bundle = join(output, "MLSM Studio.app"), contents = join(bundle, "Contents"), resources = join(contents, "Resources"), executable = join(contents, "MacOS", "MLSMStudioLauncher");
  const metadataFile = join(resources, "launcher.json");
  if (existsSync(bundle)) {
    if (lstatSync(bundle).isSymbolicLink()) throw new Error("Refusing to overwrite a launcher symlink.");
    let previous; try { previous = JSON.parse(readFileSync(metadataFile, "utf8")); } catch { /* Not owned by us. */ }
    if (previous?.generator !== owner) throw new Error("An unmanaged MLSM Studio.app already exists. Move it before creating the branded launcher.");
  }
  const config = JSON.parse(readFileSync(join(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"));
  const version = config.version;
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) throw new Error("Invalid launcher version.");
  if (/[\r\n]/.test(root)) throw new Error("Project path cannot contain line breaks.");
  for (const directory of [output, bundle, contents, resources, join(contents, "MacOS")]) ensureDirectory(directory);
  writeManaged(metadataFile, `${JSON.stringify({ generator: owner, version }, null, 2)}\n`);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>MLSM Studio</string>
  <key>CFBundleDisplayName</key><string>MLSM Studio</string>
  <key>CFBundleIdentifier</key><string>studio.dynamicsound.animation.launcher</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>MLSMStudioLauncher</string>
  <key>CFBundleIconFile</key><string>MLSMStudio.icns</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSUIElement</key><true/>
</dict></plist>
`;
  writeManaged(join(contents, "Info.plist"), plist);
  writeManaged(join(contents, "PkgInfo"), "APPL????");
  writeManaged(executable, readFileSync(join(root, "scripts/macos/launcher-executable.sh"))); chmodSync(executable, 0o755);
  writeManaged(join(resources, "launch.applescript"), readFileSync(join(root, "scripts/macos/launcher.applescript")));
  writeManaged(join(resources, "MLSMStudio.icns"), readFileSync(join(root, "apps/desktop/src-tauri/icons/icon.icns")));
  // Machine-specific absolute paths belong ONLY to this generated, gitignored bundle.
  writeManaged(join(resources, "project-root.txt"), `${resolve(root)}\n`);
  return bundle;
}
function windowsInvocation(root, output, environment = process.env) {
  const powershell = environment.SystemRoot ? win32.join(environment.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe") : "powershell.exe";
  return { command: powershell, args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", win32.join(root, "scripts/windows/create-launcher.ps1"), "-ProjectRoot", root, "-OutputDirectory", output] };
}
function createLaunchers(root = resolve(__dirname, ".."), options = {}) {
  verifyBrandAssets(root);
  const platform = options.platform || process.platform;
  if (platform === "darwin") return createMacLauncher(root, options.output);
  if (platform === "win32") {
    const output = options.output || join(root, "scripts/windows"), invocation = windowsInvocation(root, output, options.environment);
    const result = (options.spawn || spawnSync)(invocation.command, invocation.args, { cwd: root, shell: false, encoding: "utf8", windowsHide: true, timeout: 30_000 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || "Windows launcher creation failed.").trim());
    return join(output, "MLSM Studio.lnk");
  }
  throw new Error("Branded launchers support macOS and Windows.");
}
if (require.main === module) {
  try { const path = createLaunchers(); if (!process.argv.includes("--quiet")) console.log(`[MLSM launcher] ${path}`); }
  catch (error) { console.error(`[MLSM launcher] ${error.message}`); process.exitCode = 1; }
}
module.exports = { createLaunchers, createMacLauncher, owner, windowsInvocation };
