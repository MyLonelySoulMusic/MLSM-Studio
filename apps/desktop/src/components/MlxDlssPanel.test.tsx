import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";
import type { MlxDlssCapabilities } from "../services/mlx-dlss-client";

vi.mock("../services/mlx-dlss-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/mlx-dlss-client")>();
  return {
    ...actual,
    extractMlxDlssNeuralModel: vi.fn(),
    importMlxDlssModel: vi.fn(),
    installMlxDlss: vi.fn(),
    removeMlxDlssModel: vi.fn(),
    uninstallMlxDlss: vi.fn(),
  };
});

import { MlxDlssPanel } from "./MlxDlssPanel";

const capabilities: MlxDlssCapabilities = {
  id: "mlx-dlss", label: "Apple Silicon · Metal nativo", platform: "Darwin", architecture: "arm64", macOSVersion: "26.1",
  appleSilicon: true, metal: true, memoryBytes: 32 * 1024 ** 3, supported: true, reason: "", installReady: true,
  missingInstallTools: [], automaticInstallTools: [], manualInstallTools: [], packageManager: "homebrew", minimumMacOS: "26.0",
  installed: true, usable: true, healthError: "", runtimeRoot: "/tmp/mlx", logPath: "/tmp/mlx.log", version: "revision",
  models: [{ id: "nr.dlssmodel", name: "NeuralRendering.dlssmodel", kind: "neural-rendering", bytes: 4096, sha256: "a" }],
  profiles: ["standard"], codecs: ["h264"], containers: ["mp4"], limitations: ["Super Resolution 2× sperimentale"],
};

describe("MlxDlssPanel", () => {
  afterEach(cleanup);

  it("espone DLSS 5 per le foto e indica il file esatto richiesto dal 2×", () => {
    const settings = createProject().animation.upscaler;
    settings.sourceKind = "image";
    settings.sourceWidth = 1000;
    settings.sourceHeight = 500;
    settings.mlxDlss = { ...settings.mlxDlss, mode: "native-2x", neuralModel: "nr.dlssmodel" };
    render(<MlxDlssPanel settings={settings} update={vi.fn()} capabilities={capabilities} setCapabilities={vi.fn()} />);

    expect(screen.getByText("Foto · DLSS 5 attivo")).toBeVisible();
    expect(screen.getByText(/libnvidia-ngx-vsr\.so\.1\.8\.2/)).toBeVisible();
    expect(screen.getByRole("combobox", { name: "RTX VSR · immagini 2× · modello locale" })).toBeVisible();
    expect(screen.getByText("Importa modello 2×")).toBeVisible();
  });
});
