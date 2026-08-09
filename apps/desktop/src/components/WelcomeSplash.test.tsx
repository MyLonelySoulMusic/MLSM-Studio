import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WelcomeSplash } from "./WelcomeSplash";

describe("WelcomeSplash", () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("resta aperta finché l’utente non entra manualmente", () => {
    const onContinue = vi.fn();
    const { container } = render(<WelcomeSplash onContinue={onContinue} />);
    expect(screen.getByLabelText("Benvenuto in MLSM Studio")).toBeInTheDocument();
    expect(container.querySelector<HTMLImageElement>(".welcome-splash__banner")?.src).toContain("mlsm-welcome-banner.webp");
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByLabelText("Benvenuto in MLSM Studio")).toBeInTheDocument();
    expect(onContinue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Entra in MLSM Studio" }));
    expect(screen.getByLabelText("Benvenuto in MLSM Studio")).toHaveClass("is-leaving");
    act(() => vi.advanceTimersByTime(850));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("espone i canali ufficiali dell’artista", () => {
    render(<WelcomeSplash />);
    expect(screen.getByRole("link", { name: "YouTube" })).toHaveAttribute("href", "https://www.youtube.com/@MyLonelySoulMusic");
    expect(screen.getByRole("link", { name: "Spotify" })).toHaveAttribute("href", expect.stringContaining("open.spotify.com"));
    expect(screen.getByRole("link", { name: "TikTok" })).toHaveAttribute("href", "https://www.tiktok.com/@mylonelysoulmusic");
  });
});
