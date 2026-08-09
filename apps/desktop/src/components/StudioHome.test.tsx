import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../store/project-store";
import { StudioHome } from "./StudioHome";

describe("StudioHome", () => {
  beforeEach(() => { localStorage.clear(); useProjectStore.getState().newProject(); });
  afterEach(cleanup);

  it("presenta le aree come ingressi grandi e apre la prima modalità pertinente", () => {
    const onEnterArea = vi.fn();
    render(<StudioHome onEnterArea={onEnterArea} />);
    expect(screen.getByRole("button", { name: /Sound Animation/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Photo & Video Studio/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Video Editor/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Music/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Photo & Video Studio/ }));
    expect(onEnterArea).toHaveBeenCalledWith("photoVideoStudio");
    expect(useProjectStore.getState().project.animation.modeId).toBe("staticWatermark");
    fireEvent.click(screen.getByRole("button", { name: /Music/ }));
    expect(onEnterArea).toHaveBeenLastCalledWith("music");
    expect(useProjectStore.getState().project.animation.modeId).toBe("aiQuantizer");
  });
});
