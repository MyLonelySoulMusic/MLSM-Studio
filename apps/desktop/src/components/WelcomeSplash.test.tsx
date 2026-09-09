import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WelcomeSplash } from "./WelcomeSplash";
import { ARTIST_LOGO_URL } from "../services/artist-brand";

describe("WelcomeSplash", () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("parte dall’onda, rivela il logo e termina nella pagina senza entrare automaticamente", () => {
    const onContinue = vi.fn();
    render(<WelcomeSplash onContinue={onContinue} />);
    const stage = screen.getByLabelText("Benvenuto in MLSM Studio");
    expect(stage).toHaveAttribute("data-intro", "playing");
    expect(stage.style.getPropertyValue("--intro-logo-opacity")).toBe("0.0000");
    act(() => vi.advanceTimersByTime(550));
    expect(Number(stage.style.getPropertyValue("--intro-wave-dash"))).toBeLessThan(1);
    expect(stage.style.getPropertyValue("--intro-logo-opacity")).toBe("0.0000");
    act(() => vi.advanceTimersByTime(850));
    expect(Number(stage.style.getPropertyValue("--intro-logo-opacity"))).toBeGreaterThan(0);
    expect(stage.style.getPropertyValue("--intro-copy")).toBe("0.0000");
    act(() => vi.advanceTimersByTime(5_000));
    expect(stage).toHaveAttribute("data-intro", "settled");
    expect(stage).toHaveAttribute("data-copy-ready", "true");
    expect(stage.style.getPropertyValue("--intro-flight-x")).toBe("0px");
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("congela tutta la sequenza in pausa e riparte dallo stesso punto", () => {
    render(<WelcomeSplash />);
    const stage = screen.getByLabelText("Benvenuto in MLSM Studio");
    act(() => vi.advanceTimersByTime(1_200));
    fireEvent.click(screen.getByRole("button", { name: "Pausa animazione" }));
    const frame = stage.getAttribute("style");
    act(() => vi.advanceTimersByTime(20_000));
    expect(stage.getAttribute("style")).toBe(frame);
    expect(stage).toHaveAttribute("data-intro", "playing");
    fireEvent.click(screen.getByRole("button", { name: "Riprendi animazione" }));
    act(() => vi.advanceTimersByTime(5_000));
    expect(stage).toHaveAttribute("data-intro", "settled");
  });

  it("sospende il tempo quando la scheda è nascosta", () => {
    const visibility = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    render(<WelcomeSplash />);
    const stage = screen.getByLabelText("Benvenuto in MLSM Studio");
    act(() => vi.advanceTimersByTime(600));
    act(() => { visibility.mockReturnValue(true); document.dispatchEvent(new Event("visibilitychange")); });
    const frame = stage.getAttribute("style");
    act(() => vi.advanceTimersByTime(30_000));
    expect(stage.getAttribute("style")).toBe(frame);
    act(() => { visibility.mockReturnValue(false); document.dispatchEvent(new Event("visibilitychange")); vi.advanceTimersByTime(6_000); });
    expect(stage).toHaveAttribute("data-intro", "settled");
  });

  it("consente di saltare la sequenza subito, prima che il logo compaia", () => {
    const onContinue = vi.fn();
    render(<WelcomeSplash onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: "Salta introduzione" }));
    act(() => vi.advanceTimersByTime(650));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("mostra subito la composizione finale con movimento ridotto e non avvia timer", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<WelcomeSplash />);
    const stage = screen.getByLabelText("Benvenuto in MLSM Studio");
    expect(stage).toHaveAttribute("data-intro", "settled");
    expect(stage.style.getPropertyValue("--intro-copy")).toBe("1.0000");
    expect(stage.style.getPropertyValue("--intro-reveal")).toBe("0%");
    expect(screen.queryByRole("button", { name: "Pausa animazione" })).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resta aperta finché l’utente non entra manualmente", () => {
    const onContinue = vi.fn();
    const { container } = render(<WelcomeSplash onContinue={onContinue} />);
    expect(screen.getByLabelText("Benvenuto in MLSM Studio")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "My Lonely Soul Music" })).toBeInTheDocument();
    expect(container.querySelector(".intro-sculpture__fallback image")).toHaveAttribute("href", ARTIST_LOGO_URL);
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

  it("mantiene il logo e permette tema, lingua e pausa anche senza WebGL", () => {
    render(<WelcomeSplash />);
    const logo = screen.getByRole("img", { name: "My Lonely Soul Music" });
    expect(logo).toHaveAttribute("data-renderer", "static");
    fireEvent.click(screen.getByRole("button", { name: "Aspetto: Giorno" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "night");
    fireEvent.click(screen.getByRole("button", { name: "Pausa animazione" }));
    expect(screen.getByRole("button", { name: "Riprendi animazione" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByRole("combobox", { name: "Lingua" }), { target: { value: "en" } });
    expect(screen.getByRole("button", { name: "Appearance: Night" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "My Lonely Soul Music" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter MLSM Studio" })).toBeEnabled();
  });
});
