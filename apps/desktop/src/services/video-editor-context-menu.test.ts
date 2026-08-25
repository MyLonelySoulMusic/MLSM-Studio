import { describe, expect, it } from "vitest";
import { videoEditorContextMenuPosition } from "./video-editor-context-menu";

describe("Video Editor · posizione menu contestuale", () => {
  it("sposta il menu dentro i bordi destro e inferiore", () => {
    expect(videoEditorContextMenuPosition({ x: 799, y: 499, menuWidth: 260, menuHeight: 420, viewportWidth: 800, viewportHeight: 500 })).toEqual({ x: 532, y: 72 });
  });

  it("ancora in alto un menu più alto della viewport", () => {
    expect(videoEditorContextMenuPosition({ x: 700, y: 490, menuWidth: 260, menuHeight: 600, viewportWidth: 800, viewportHeight: 500 })).toEqual({ x: 532, y: 8 });
  });

  it("rispetta il margine minimo anche per coordinate negative", () => {
    expect(videoEditorContextMenuPosition({ x: -40, y: -20, menuWidth: 260, menuHeight: 300, viewportWidth: 800, viewportHeight: 500 })).toEqual({ x: 8, y: 8 });
  });
});
