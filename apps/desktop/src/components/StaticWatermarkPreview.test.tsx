import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";
import { StaticWatermarkPreview } from "./StaticWatermarkPreview";
import { openStaticWatermarkDetailPreview } from "../services/static-watermark-detail-preview";

describe("StaticWatermarkPreview", () => {
  it("seeks a shorter clean video to the same second instead of slowing it down", () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const settings = { ...createProject().animation.staticWatermark, videoUrl: "blob:source", referenceKind: "video" as const, referenceVideoUrl: "blob:reference", videoDurationSeconds: 30, referenceVideoDurationSeconds: 20, referenceFrameRate: 24 };
    const view = render(<StaticWatermarkPreview settings={settings} currentTime={10} playing={false} />);
    try {
      const [source, reference] = Array.from(view.container.querySelectorAll("video"));
      Object.defineProperty(source!, "duration", { value: 30 });
      Object.defineProperty(reference!, "duration", { value: 20 });
      fireEvent.loadedMetadata(source!);
      fireEvent.loadedMetadata(reference!);
      expect(source!.currentTime).toBe(10);
      expect(reference!.currentTime).toBe(10);
      view.rerender(<StaticWatermarkPreview settings={settings} currentTime={19} playing={false} />);
      expect(reference!.currentTime).toBe(19);
      view.rerender(<StaticWatermarkPreview settings={settings} currentTime={25} playing={false} />);
      // No proportional seek to 16.67s, nor frozen-last-frame substitution.
      expect(reference!.currentTime).toBe(19);
    } finally { view.unmount(); load.mockRestore(); pause.mockRestore(); context.mockRestore(); }
  });

  it("apre la zona ingrandita senza guida e replica i controlli di correzione", () => {
    const settings = createProject().animation.staticWatermark;
    render(<StaticWatermarkPreview settings={settings} currentTime={0} playing={false} />);
    act(() => openStaticWatermarkDetailPreview());
    expect(screen.getByRole("dialog", { name: "Anteprima zona rimozione" })).toBeInTheDocument();
    expect(screen.getByLabelText("Zona rimozione ingrandita")).toBeInTheDocument();
    expect(screen.getByLabelText("Intensità correzione anteprima zoom")).toHaveValue("0.05");
    expect(screen.queryByText("WATERMARK AREA")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Chiudi anteprima zona rimozione" }));
    expect(screen.queryByRole("dialog", { name: "Anteprima zona rimozione" })).not.toBeInTheDocument();
  });
});
