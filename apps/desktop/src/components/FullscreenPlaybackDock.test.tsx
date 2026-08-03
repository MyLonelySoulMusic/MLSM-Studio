import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FullscreenPlaybackDock } from "./FullscreenPlaybackDock";

describe("FullscreenPlaybackDock", () => {
  it("mantiene play, seek e comandi distinti nel dock fullscreen", () => {
    const play = vi.fn(); const stop = vi.fn(); const seek = vi.fn();
    render(<FullscreenPlaybackDock currentTime={12} duration={65} playing={false} onPlayPause={play} onStop={stop} onSeek={seek} />);
    expect(screen.getByRole("group", { name: "Controlli riproduzione a tutto schermo" })).toHaveTextContent("0:12 / 1:05");
    fireEvent.click(screen.getByRole("button", { name: "Play" })); expect(play).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText("Posizione riproduzione a tutto schermo"), { target: { value: "24" } }); expect(seek).toHaveBeenLastCalledWith(24);
  });
});
