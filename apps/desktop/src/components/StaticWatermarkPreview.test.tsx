import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createProject } from "@rbs/project-schema";
import { StaticWatermarkPreview } from "./StaticWatermarkPreview";
import { openStaticWatermarkDetailPreview } from "../services/static-watermark-detail-preview";

describe("StaticWatermarkPreview", () => {
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
