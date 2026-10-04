import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VinylTurntable } from "./VinylTurntable";

describe("VinylTurntable artwork", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("crops wide YouTube artwork while preserving ordinary cover artwork", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const view = render(<VinylTurntable trackId="yt" title="YouTube cover" artwork="https://i.ytimg.com/vi/id/hqdefault.jpg" state="READY" cropArtwork />);
    expect(screen.getByRole("img", { name: "YouTube cover" }).parentElement).toHaveClass("is-cropped");
    const image = screen.getByRole("img", { name: "YouTube cover" });
    expect(image.style.width).toBe("177.77777777777777%");
    expect(image.style.height).toBe("133.33333333333331%");
    Object.defineProperties(image, { naturalWidth: { value: 1280, configurable: true }, naturalHeight: { value: 720, configurable: true } });
    fireEvent.load(image);
    expect(image.style.height).toBe("100%");
    Object.defineProperties(image, { naturalWidth: { value: 800, configurable: true }, naturalHeight: { value: 800, configurable: true } });
    fireEvent.load(image);
    expect(image.style.width).toBe("100%");
    expect(screen.queryByText(/READY|33%/)).not.toBeInTheDocument();
    view.rerender(<VinylTurntable trackId="local" title="Album cover" artwork="cover.png" state="READY" />);
    expect(screen.getByRole("img", { name: "Album cover" }).parentElement).not.toHaveClass("is-cropped");
    expect(screen.getByRole("img", { name: "Album cover" }).style.width).toBe("");
  });
});
