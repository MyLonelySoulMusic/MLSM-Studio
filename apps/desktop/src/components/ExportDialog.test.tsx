import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportDialog } from "./ExportDialog";

describe("ExportDialog", () => {
  afterEach(cleanup);
  it("indica il rapporto in ogni risoluzione disponibile", () => {
    render(<ExportDialog duration={10} running={false} progress={0} currentFrame={0} totalFrames={0} error={null} onClose={vi.fn()} onCancel={vi.fn()} onStart={vi.fn()} />);
    const resolutions = screen.getByLabelText("Risoluzione").querySelectorAll("option");
    expect(resolutions).toHaveLength(5);
    for (const option of resolutions) expect(option.textContent).toMatch(/\((?:9:16|16:9)(?: · .+)?\)$/);
  });
  it("usa la qualità massima come impostazione predefinita", () => {
    const onStart = vi.fn(); render(<ExportDialog duration={10} running={false} progress={0} currentFrame={0} totalFrames={0} error={null} onClose={vi.fn()} onCancel={vi.fn()} onStart={onStart} />);
    expect(screen.getByLabelText("Qualità codifica")).toHaveValue("maximum"); fireEvent.click(screen.getByText("Scegli destinazione e crea video")); expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ quality: "maximum" }));
  });
});
