import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { aiQuantizerBootstrapPayload, aiQuantizerRuntimePaths } from "./vite-ai-quantizer-service";

describe("AI Quantizer runtime interno", () => {
  it("risolve backend, UI, ambiente e dati esclusivamente dentro MLSM Studio", () => {
    const root = resolve("/tmp", "mlsm-studio");
    const paths = aiQuantizerRuntimePaths(root);
    expect(paths.server).toBe(resolve(root, "tools/ai-quantizer/server.cjs"));
    expect(paths.publicRoot).toBe(resolve(root, "tools/ai-quantizer/public"));
    expect(paths.python).toContain(resolve(root, ".venv-ai-quantizer"));
    expect(paths.readyMarker).toBe(resolve(root, ".venv-ai-quantizer/.mlsm-aiq-ready"));
    expect(paths.dataRoot).toBe(resolve(root, ".ai-quantizer-data/projects"));
    expect(JSON.stringify(paths)).not.toContain("../AI Quantizer");
  });

  it("distribuisce una UI MLSM nativa con API instradate nello stesso origin", () => {
    const html = readFileSync(resolve(process.cwd(), "tools/ai-quantizer/public/index.html"), "utf8");
    const script = readFileSync(resolve(process.cwd(), "tools/ai-quantizer/public/app.js"), "utf8");
    const i18n = readFileSync(resolve(process.cwd(), "tools/ai-quantizer/public/i18n.js"), "utf8");
    const server = readFileSync(resolve(process.cwd(), "tools/ai-quantizer/server.cjs"), "utf8");
    expect(html).toContain("MLSM Studio — AI Quantizer");
    expect(html).toContain("./mlsm.css");
    expect(html).toContain("./i18n.js");
    expect(html).not.toContain("The Gargantuas");
    expect(script).toContain("/music/ai-quantizer/api/health");
    expect(script).not.toMatch(/(['`])\/api\//);
    expect(i18n).toContain("Your projects");
    expect(i18n).toContain("mlsm-language");
    expect(i18n).toContain("MutationObserver");
    expect(server).toContain("mlsm-internal-ai-quantizer");
  });

  it("espone avanzamento e log del bootstrap senza fingere che il backend sia pronto", () => {
    expect(aiQuantizerBootstrapPayload("setting-up", "Installazione dipendenze", 42, ["pip install beat-this"])).toEqual(expect.objectContaining({
      runtime: "mlsm-ai-quantizer-bootstrap", ready: false, status: "setting-up", progress: 42,
      logs: ["pip install beat-this"], message: "Installazione dipendenze"
    }));
  });

  it("mantiene il runtime lazy fino all'ingresso nell'area e supporta lo stop di lifecycle", () => {
    const source = readFileSync(resolve(process.cwd(), "apps/desktop/vite-ai-quantizer-service.ts"), "utf8");
    expect(source).toContain("runtime lazy pronto; verrà avviato al primo ingresso nell’area");
    expect(source).toContain('pathname === "/api/lifecycle/stop"');
    expect(source).not.toContain("const backend = await ensureEngine(server)");
  });
});
