import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceResizeHandle } from "./WorkspaceResizeHandle";

describe("WorkspaceResizeHandle", () => {
  afterEach(cleanup);

  it("ridimensiona da tastiera e ripristina con doppio clic", () => {
    const onResize = vi.fn();
    const onReset = vi.fn();
    render(<WorkspaceResizeHandle side="left" width={230} onResize={onResize} onReset={onReset} />);
    const separator = screen.getByRole("separator", { name: "Ridimensiona pannello sinistro" });
    expect(separator).toHaveAttribute("aria-valuenow", "230");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(onResize).toHaveBeenCalledWith(246);
    fireEvent.doubleClick(separator);
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("inverte correttamente la direzione per il pannello destro", () => {
    const onResize = vi.fn();
    render(<WorkspaceResizeHandle side="right" width={260} onResize={onResize} onReset={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
    expect(onResize).toHaveBeenCalledWith(244);
  });
});
