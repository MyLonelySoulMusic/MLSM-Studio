import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FaceRestorationWorkspace } from "./FaceRestorationWorkspace";
import { codeFormerDefaults, createFaceJob, faceModels, faceRequest } from "../services/face-restoration-client";
vi.mock("../services/face-restoration-client", async importOriginal => ({ ...await importOriginal<typeof import("../services/face-restoration-client")>(), faceModels: vi.fn(), createFaceJob: vi.fn(), faceRequest: vi.fn() }));

describe("Face restoration", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(faceModels).mockResolvedValue({ runtimeReady: true, models: [{ id: "codeformer", label: "CodeFormer", defaults: codeFormerDefaults }] });
    vi.mocked(faceRequest).mockResolvedValue({ ok: true });
    URL.createObjectURL = vi.fn(() => "blob:source"); URL.revokeObjectURL = vi.fn();
  });
  it("shows CodeFormer defaults and restores changed settings", async () => {
    render(<FaceRestorationWorkspace />);
    await waitFor(() => expect(faceModels).toHaveBeenCalled());
    expect(screen.getByLabelText("Fedeltà del volto")).toHaveValue(.5);
    expect(screen.getByLabelText("Ingrandimento (×)")).toHaveValue(2);
    fireEvent.change(screen.getByLabelText("Fedeltà del volto"), { target: { value: ".85" } });
    fireEvent.click(screen.getByText("Ripristina valori predefiniti"));
    expect(screen.getByLabelText("Fedeltà del volto")).toHaveValue(.5);
  });
  it("submits the selected file and parameters and exposes completed output", async () => {
    vi.mocked(createFaceJob).mockResolvedValue({ id: "abc", phase: "ready", message: "Completato", currentFrame: 1, totalFrames: 1, faces: 1, outputName: "restored.png" });
    const view = render(<FaceRestorationWorkspace />);
    await waitFor(() => expect(faceModels).toHaveBeenCalled());
    const file = new File(["image"], "portrait.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Foto o video"), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Fedeltà del volto"), { target: { value: ".7" } });
    await waitFor(() => expect(screen.getByText("Ripristina volti")).not.toBeDisabled());
    fireEvent.click(screen.getByText("Ripristina volti"));
    await screen.findByText("Scarica foto PNG");
    expect(createFaceJob).toHaveBeenCalledWith(file, { ...codeFormerDefaults, fidelity_weight: .7 });
    view.unmount();
    expect(faceRequest).toHaveBeenCalledWith("/jobs/abc", { method: "DELETE" });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:source");
  });
  it("blocks inference when the dedicated runtime is missing", async () => {
    vi.mocked(faceModels).mockResolvedValue({ runtimeReady: false, models: [] });
    render(<FaceRestorationWorkspace />);
    expect(await screen.findByRole("alert")).toHaveTextContent("face-restoration:setup");
    expect(screen.getByText("Ripristina volti")).toBeDisabled();
  });
  it("renders controls and progress in the existing editor rails", async () => {
    render(<><aside id="face-restoration-controls" /><aside id="face-restoration-inspector" /><FaceRestorationWorkspace /></>);
    await waitFor(() => expect(document.getElementById("face-restoration-controls")).toContainElement(screen.getByLabelText("Foto o video")));
    expect(document.getElementById("face-restoration-inspector")).toContainElement(screen.getByRole("heading", { name: "Face restoration" }));
    expect(screen.getByRole("region", { name: "Confronto restauro" })).toHaveClass("viewport");
  });
  it("reports invalid hidden advanced fields instead of silently blocking submit", async () => {
    render(<FaceRestorationWorkspace />);
    fireEvent.change(screen.getByLabelText("Foto o video"), { target: { files: [new File(["image"], "portrait.png")] } });
    fireEvent.change(screen.getByLabelText("Tile Real-ESRGAN (pixel)"), { target: { value: "0" } });
    await waitFor(() => expect(screen.getByText("Ripristina volti")).not.toBeDisabled());
    fireEvent.click(screen.getByText("Ripristina volti"));
    expect(await screen.findByRole("alert")).toHaveTextContent("bg_tile");
    expect(createFaceJob).not.toHaveBeenCalled();
  });

});
