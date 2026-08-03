import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortraitRangeControl } from "./PortraitLandscapePanel";

describe("PortraitRangeControl", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("mantiene lo stesso input e raggruppa gli aggiornamenti durante il trascinamento", () => {
    vi.useFakeTimers(); const change = vi.fn();
    const { rerender } = render(<PortraitRangeControl label="Dimensione cubo" ariaLabel="Dimensione cubo test" value={.5} min={.45} max={1.8} step={.05} format={(value) => `${value.toFixed(2)}×`} onChange={change} />);
    const input = screen.getByLabelText("Dimensione cubo test");
    fireEvent.pointerDown(input); fireEvent.change(input, { target: { value: ".55" } }); fireEvent.change(input, { target: { value: ".65" } });
    expect(input).toHaveValue("0.65"); expect(screen.getByText("0.65×")).toBeInTheDocument(); expect(change).not.toHaveBeenCalled();
    vi.advanceTimersByTime(32); expect(change).toHaveBeenCalledTimes(1); expect(change).toHaveBeenLastCalledWith(.65);
    fireEvent.pointerUp(input); rerender(<PortraitRangeControl label="Dimensione cubo" ariaLabel="Dimensione cubo test" value={.65} min={.45} max={1.8} step={.05} format={(value) => `${value.toFixed(2)}×`} onChange={change} />);
    expect(screen.getByLabelText("Dimensione cubo test")).toBe(input);
  });
});
