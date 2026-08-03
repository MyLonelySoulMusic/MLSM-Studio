import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_PANEL_WIDTHS, fitWorkspacePanelWidths, parseWorkspacePanelWidths, resizeWorkspacePanel } from "./workspace-layout";

describe("workspace layout", () => {
  it("mantiene sempre una viewport centrale utilizzabile", () => {
    expect(resizeWorkspacePanel({ left: 230, right: 260 }, "left", 900, 1_000)).toEqual({ left: 306, right: 260 });
    expect(resizeWorkspacePanel({ left: 230, right: 260 }, "right", 20, 1_000)).toEqual({ left: 230, right: 180 });
  });

  it("ripristina valori sicuri da preferenze non valide", () => {
    expect(parseWorkspacePanelWidths("not-json")).toEqual(DEFAULT_WORKSPACE_PANEL_WIDTHS);
    expect(parseWorkspacePanelWidths('{"left":999,"right":10}')).toEqual({ left: 480, right: 180 });
  });

  it("riduce proporzionalmente preferenze troppo larghe dopo il resize della finestra", () => {
    const fitted = fitWorkspacePanelWidths({ left: 480, right: 480 }, 960);
    expect(fitted.left + fitted.right).toBeLessThanOrEqual(526);
    expect(fitted.left).toBeGreaterThanOrEqual(180);
    expect(fitted.right).toBeGreaterThanOrEqual(180);
  });
});
