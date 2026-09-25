import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { prepareWorkspace, workspaceStatus, writeState } = require("./prepare_node_workspace.cjs");
const roots: string[] = [];
function file(root: string, path: string, content = "ok") { const target = join(root, path); mkdirSync(join(target, ".."), { recursive: true }); writeFileSync(target, content); }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mlsm-workspace-")); roots.push(root);
  file(root, "package.json", JSON.stringify({ name: "fixture" }));
  file(root, "package-lock.json", JSON.stringify({ lockfileVersion: 3 }));
  file(root, "apps/desktop/package.json", JSON.stringify({ name: "desktop" }));
  file(root, "apps/desktop/src/main.ts", "export const version = 1;");
  file(root, "apps/desktop/dist/index.html", "ready");
  file(root, "packages/core/package.json", JSON.stringify({ name: "core" }));
  file(root, "packages/core/src/index.ts", "export {};");
  for (const path of ["node_modules/.package-lock.json", "node_modules/vite/bin/vite.js", "node_modules/typescript/bin/tsc", "node_modules/react/package.json", "node_modules/@tauri-apps/cli/tauri.js"]) file(root, path);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("preparazione incrementale workspace Node", () => {
  it("distingue modifiche alle dipendenze da modifiche ai sorgenti", () => {
    const root = fixture(); const initial = workspaceStatus(root);
    writeState(root, { dependencyFingerprint: initial.dependencyFingerprint, buildFingerprint: initial.buildFingerprint });
    expect(workspaceStatus(root)).toMatchObject({ installRequired: false, buildRequired: false });
    file(root, "apps/desktop/src/main.ts", "export const version = 2;");
    expect(workspaceStatus(root)).toMatchObject({ installRequired: false, buildRequired: true });
    file(root, "package-lock.json", JSON.stringify({ lockfileVersion: 3, changed: true }));
    expect(workspaceStatus(root)).toMatchObject({ installRequired: true, buildRequired: true });
  });

  it("esegue npm ci e build soltanto quando richiesti e registra il successo", () => {
    const root = fixture(); const calls: string[] = [];
    prepareWorkspace(root, { runCommand: (_root: string, command: string, args: string[]) => calls.push([command, ...args].join(" ")) });
    expect(calls).toEqual([expect.stringContaining("npm ci --include=dev"), expect.stringContaining("npm run build")]);
    calls.length = 0;
    expect(prepareWorkspace(root, { runCommand: (_root: string, command: string, args: string[]) => calls.push([command, ...args].join(" ")) })).toMatchObject({ installRequired: false, buildRequired: false });
    expect(calls).toEqual([]);
    file(root, "packages/core/src/index.ts", "export const changed = true;");
    prepareWorkspace(root, { runCommand: (_root: string, command: string, args: string[]) => calls.push([command, ...args].join(" ")) });
    expect(calls).toEqual([expect.stringContaining("npm run build")]);
  });
});
