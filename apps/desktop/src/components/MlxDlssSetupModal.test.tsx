import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MlxDlssCapabilities, MlxDlssInstallStatus } from "../services/mlx-dlss-client";

const extractModel = vi.hoisted(() => vi.fn());
const installRuntime = vi.hoisted(() => vi.fn());
vi.mock("../services/mlx-dlss-client", async () => {
  const actual = await vi.importActual<typeof import("../services/mlx-dlss-client")>("../services/mlx-dlss-client");
  return { ...actual, extractMlxDlssNeuralModel: extractModel, installMlxDlss: installRuntime };
});

import { MlxDlssSetupModal } from "./MlxDlssSetupModal";

const readyCapabilities: MlxDlssCapabilities = {
  id: "mlx-dlss", label: "MLX-DLSS · Apple Metal", platform: "Darwin", architecture: "arm64", macOSVersion: "26.1",
  appleSilicon: true, metal: true, memoryBytes: 16 * 1024 ** 3, supported: true, reason: "", installReady: true,
  missingInstallTools: [], automaticInstallTools: [], manualInstallTools: [], packageManager: "homebrew", minimumMacOS: "26.0",
  installed: true, usable: true, healthError: "", runtimeRoot: "/tmp/mlx", logPath: "/tmp/mlx.log", version: "abc", models: [],
  profiles: ["standard"], codecs: ["h264"], containers: ["mp4"], limitations: [],
};

describe("MlxDlssSetupModal", () => {
  beforeEach(() => { extractModel.mockReset(); installRuntime.mockReset(); });
  afterEach(cleanup);

  it("lascia scegliere la DLL prima del runtime e la mantiene in coda", () => {
    const pendingCapabilities = { ...readyCapabilities, installed: false, usable: false, installReady: false, manualInstallTools: ["Xcode completo"], missingInstallTools: ["Xcode completo"] };
    render(<MlxDlssSetupModal open capabilities={pendingCapabilities} loading={false} connectionError="" selectedModel={null} onCapabilities={vi.fn()} onRefresh={vi.fn()} onSelectModel={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Installa prerequisiti e MLX-DLSS" })).toBeEnabled();
    const dll = new File([new Uint8Array(1024)], "nvngx_dlssnr.dll", { type: "application/octet-stream" });
    fireEvent.change(screen.getByLabelText("Carica DLL DLSS 5"), { target: { files: [dll] } });

    expect(screen.getByRole("button", { name: "DLL selezionata · nvngx_dlssnr.dll" })).toBeEnabled();
    expect(screen.getByText(/estrazione partirà automaticamente/i)).toBeVisible();
    expect(extractModel).not.toHaveBeenCalled();
  });

  it("mantiene visibile l'errore quando l'installazione termina", async () => {
    const pendingCapabilities = { ...readyCapabilities, installed: false, usable: false, installReady: false, manualInstallTools: ["Xcode completo"], automaticInstallTools: ["ninja"], missingInstallTools: ["ninja", "Xcode completo"] };
    installRuntime.mockImplementation(async (_signal: AbortSignal | undefined, onProgress?: (status: MlxDlssInstallStatus) => void) => {
      onProgress?.({ phase: "dependencies", progress: .04, message: "Installazione automatica: ninja" });
      onProgress?.({ phase: "error", progress: 0, message: "Installazione non riuscita", error: "Prerequisiti ancora mancanti: Xcode completo" });
      throw new Error("Prerequisiti ancora mancanti: Xcode completo");
    });
    render(<MlxDlssSetupModal open capabilities={pendingCapabilities} loading={false} connectionError="" selectedModel={null} onCapabilities={vi.fn()} onRefresh={vi.fn()} onSelectModel={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Installa prerequisiti e MLX-DLSS" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Prerequisiti ancora mancanti: Xcode completo");
    expect(screen.getByText("Errore")).toBeVisible();
    expect(screen.getByRole("link", { name: "Scarica Xcode dall’App Store ↗" })).toHaveAttribute("href", "https://apps.apple.com/app/xcode/id497799835");
    expect(screen.getByRole("button", { name: "Installa prerequisiti e MLX-DLSS" })).toBeEnabled();
  });

  it("distingue Xcode installato con licenza ancora da accettare", () => {
    const licenseCapabilities = { ...readyCapabilities, installed: false, usable: false, installReady: false, manualInstallTools: ["Licenza Xcode"], missingInstallTools: ["Licenza Xcode"] };
    render(<MlxDlssSetupModal open capabilities={licenseCapabilities} loading={false} connectionError="" selectedModel={null} onCapabilities={vi.fn()} onRefresh={vi.fn()} onSelectModel={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText("sudo xcodebuild -license accept")).toBeVisible();
    expect(screen.getByRole("button", { name: "Ho accettato la licenza · verifica" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: /Scarica Xcode/i })).not.toBeInTheDocument();
  });

  it("ripristina l'errore salvato quando si riapre la configurazione", () => {
    const failed = { ...readyCapabilities, installed: false, usable: false, installStatus: { phase: "error" as const, progress: 0, message: "Installazione non riuscita", error: "Verifica finale fallita" } };
    render(<MlxDlssSetupModal open capabilities={failed} loading={false} connectionError="" selectedModel={null} onCapabilities={vi.fn()} onRefresh={vi.fn()} onSelectModel={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Verifica finale fallita");
    expect(screen.getByRole("alert").parentElement?.firstElementChild).toBe(screen.getByRole("alert"));
  });

  it("sblocca i controlli e mostra l'errore quando cade la connessione", async () => {
    installRuntime.mockImplementation(async (_signal: AbortSignal | undefined, onProgress?: (status: MlxDlssInstallStatus) => void) => {
      onProgress?.({ phase: "building", progress: .45, message: "Compilazione" });
      throw new Error("Connessione interrotta");
    });
    render(<MlxDlssSetupModal open capabilities={{ ...readyCapabilities, installed: false, usable: false }} loading={false} connectionError="" selectedModel={null} onCapabilities={vi.fn()} onRefresh={vi.fn()} onSelectModel={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Installa MLX-DLSS" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connessione interrotta");
    expect(screen.getByRole("button", { name: "Chiudi configurazione MLX-DLSS" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Installa MLX-DLSS" })).toBeEnabled();
  });

  it("importa nvngx_dlssnr.dll e seleziona automaticamente il modello estratto", async () => {
    const extracted = { id: "neural-rendering-abc.dlssmodel", name: "NeuralRendering.dlssmodel", kind: "neural-rendering" as const, bytes: 4096, sha256: "abc" };
    extractModel.mockResolvedValue({ ...readyCapabilities, models: [extracted] });
    const onCapabilities = vi.fn(); const onSelectModel = vi.fn();
    render(<MlxDlssSetupModal open capabilities={readyCapabilities} loading={false} connectionError="" selectedModel={null} onCapabilities={onCapabilities} onRefresh={vi.fn()} onSelectModel={onSelectModel} onClose={vi.fn()} />);

    const dll = new File([new Uint8Array(1024)], "nvngx_dlssnr.dll", { type: "application/octet-stream" });
    fireEvent.change(screen.getByLabelText("Carica DLL DLSS 5"), { target: { files: [dll] } });

    await waitFor(() => expect(extractModel).toHaveBeenCalledWith(dll));
    expect(onCapabilities).toHaveBeenCalledWith(expect.objectContaining({ models: [extracted] }));
    expect(onSelectModel).toHaveBeenCalledWith(extracted.id);
  });
});
