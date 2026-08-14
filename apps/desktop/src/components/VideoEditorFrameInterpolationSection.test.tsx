import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoEditorFrameInterpolationSection } from "./VideoEditorFrameInterpolationSection";

describe("VideoEditorFrameInterpolationSection", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("localizes every interpolation method label in English", () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    render(<VideoEditorFrameInterpolationSection language="en" baseFps={30} disabled={false} value={{ enabled: true, targetFps: 60, method: "motion" }} onChange={vi.fn()} />);
    const options = [...screen.getByLabelText("Interpolation method").querySelectorAll("option")].map((option) => option.textContent ?? "");
    expect(options).toEqual([
      "Motion estimation · ffmpeg · recommended",
      "Frame blend · fast",
      "RIFE on GPU · highest quality"
    ]);
    expect(options.join(" ")).not.toMatch(/Fusione|Stima del movimento|consigliata|qualità massima/);
  });

  it("renders only the compact visible copy without the removed legacy accessibility hack", () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    const { container } = render(<VideoEditorFrameInterpolationSection language="it" baseFps={30} disabled={false} value={{ enabled: false, targetFps: 60, method: "motion" }} onChange={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Interpolazione fotogrammi (facoltativa)" })).toBeInTheDocument();
    expect(screen.getByText("Render base: 30 fps · l’aumento viene applicato dopo la verifica.")).toBeInTheDocument();
    expect(screen.getByText("Disattivata")).toBeInTheDocument();
    expect(container.querySelector(".export-interpolation__legacy-copy")).toBeNull();
    expect(container).not.toHaveTextContent("Senza interpolazione il file conserva esattamente");
  });
});
