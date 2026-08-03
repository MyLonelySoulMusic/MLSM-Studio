import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WelcomeSplash } from "./WelcomeSplash";

describe("WelcomeSplash", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("presenta MLSM Studio con il banner ottimizzato e si rimuove al termine", () => {
    const { container } = render(<WelcomeSplash />);
    expect(screen.getByLabelText("Benvenuto in MLSM Studio")).toBeInTheDocument();
    expect(container.querySelector<HTMLImageElement>(".welcome-splash__banner")?.src).toContain("mlsm-welcome-banner.webp");
    act(() => vi.advanceTimersByTime(4_300));
    expect(screen.queryByLabelText("Benvenuto in MLSM Studio")).not.toBeInTheDocument();
  });

  it("permette di saltare immediatamente l'introduzione", () => {
    render(<WelcomeSplash />);
    fireEvent.click(screen.getByRole("button", { name: "Salta introduzione" }));
    expect(screen.getByLabelText("Benvenuto in MLSM Studio")).toHaveClass("is-leaving");
  });
});
