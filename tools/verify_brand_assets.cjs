#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

function pngSize(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("Invalid PNG icon.");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), alpha: [4, 6].includes(bytes[25]) };
}
function icoSizes(bytes) {
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) throw new Error("Invalid Windows ICO icon.");
  const count = bytes.readUInt16LE(4), sizes = [];
  if (!count || bytes.length < 6 + count * 16) throw new Error("Truncated Windows ICO directory.");
  for (let i = 0; i < count; i++) {
    const position = 6 + i * 16, size = bytes.readUInt32LE(position + 8), offset = bytes.readUInt32LE(position + 12);
    if (!size || offset < 6 + count * 16 || offset + size > bytes.length) throw new Error("Truncated Windows ICO image.");
    const width = bytes[position] || 256, height = bytes[position + 1] || 256;
    if (width !== height) throw new Error("Windows icons must be square.");
    sizes.push(width);
  }
  return sizes;
}
function icnsTypes(bytes) {
  if (bytes.length < 8 || bytes.toString("ascii", 0, 4) !== "icns" || bytes.readUInt32BE(4) !== bytes.length) throw new Error("Invalid macOS ICNS icon.");
  const types = []; let position = 8;
  while (position < bytes.length) {
    if (position + 8 > bytes.length) throw new Error("Truncated macOS ICNS directory.");
    const size = bytes.readUInt32BE(position + 4);
    if (size <= 8 || position + size > bytes.length) throw new Error("Truncated macOS ICNS image.");
    types.push(bytes.toString("ascii", position, position + 4)); position += size;
  }
  return types;
}
function verifyBrandAssets(root = resolve(__dirname, "..")) {
  const base = resolve(root, "apps/desktop/src-tauri"), config = JSON.parse(readFileSync(resolve(base, "tauri.conf.json"), "utf8"));
  const sizes = { "icons/32x32.png": 32, "icons/128x128.png": 128, "icons/128x128@2x.png": 256, "icons/icon.png": 512 };
  const required = [...Object.keys(sizes), "icons/icon.icns", "icons/icon.ico"];
  for (const name of required) if (!config.bundle?.icon?.includes(name)) throw new Error(`Missing bundle.icon entry: ${name}`);
  for (const [name, expected] of Object.entries(sizes)) {
    const image = pngSize(readFileSync(resolve(base, name)));
    if (image.width !== expected || image.height !== expected || !image.alpha) throw new Error(`${name}: expected a square ${expected}px RGBA icon.`);
  }
  const windowsSizes = icoSizes(readFileSync(resolve(base, "icons/icon.ico")));
  if (![16, 32, 256].every(size => windowsSizes.includes(size)) || windowsSizes[0] !== 32) throw new Error("Windows icon needs 16/32/256px layers, with 32px first for Tauri.");
  const macTypes = icnsTypes(readFileSync(resolve(base, "icons/icon.icns")));
  if (!macTypes.some(type => ["ic09", "ic14"].includes(type)) || !macTypes.includes("ic10")) throw new Error("macOS icon needs 512px and 1024px Retina layers.");
  for (const name of ["installerIcon", "uninstallerIcon"]) if (config.bundle.windows?.nsis?.[name] !== "icons/icon.ico") throw new Error(`Missing Windows NSIS ${name}.`);
  return { config, windowsSizes, macTypes };
}
if (require.main === module) {
  try { verifyBrandAssets(); console.log("[MLSM icons] App macOS/Windows e installer: icone originali multirisoluzione verificate."); }
  catch (error) { console.error(`[MLSM icons] ${error.message}`); process.exitCode = 1; }
}
module.exports = { icnsTypes, icoSizes, pngSize, verifyBrandAssets };
