import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFullscreenPreview } from "./use-fullscreen-preview";

describe("useFullscreenPreview", () => {
  it("entra, esce dal comando e torna all'editor con Escape", () => {
    const { result } = renderHook(() => useFullscreenPreview());
    act(() => result.current.toggleFullscreenPreview());
    expect(result.current.fullscreenPreview).toBe(true);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(result.current.fullscreenPreview).toBe(false);
    act(() => result.current.toggleFullscreenPreview());
    act(() => result.current.toggleFullscreenPreview());
    expect(result.current.fullscreenPreview).toBe(false);
  });
});
