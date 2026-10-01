import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VinylTurntable } from "./VinylTurntable";

describe("VinylTurntable artwork", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("crops wide YouTube artwork while preserving ordinary cover artwork", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const view = render(<VinylTurntable trackId="yt" title="YouTube cover" artwork="https://i.ytimg.com/vi/id/hqdefault.jpg" state="READY" cropArtwork />);
    expect(screen.getByRole("img", { name: "YouTube cover" }).parentElement).toHaveClass("is-cropped");
    view.rerender(<VinylTurntable trackId="local" title="Album cover" artwork="cover.png" state="READY" />);
    expect(screen.getByRole("img", { name: "Album cover" }).parentElement).not.toHaveClass("is-cropped");
  });
});
