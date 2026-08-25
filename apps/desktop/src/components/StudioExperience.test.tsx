import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioExperience } from "./StudioExperience";

vi.mock("../App", () => ({
  App: ({ onHome }: { onHome?: () => void }) => <main aria-label="Editor MLSM"><button type="button" onClick={onHome}>Home editor</button></main>
}));
vi.mock("./LongCatVideoWorkspace", () => ({ LongCatVideoWorkspace: ({ onHome }: { onHome?: () => void }) => <main aria-label="LongCat Video"><button type="button" onClick={onHome}>Home LongCat</button></main> }));

describe("StudioExperience", () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("naviga da intro ad aree, editor e di nuovo home", () => {
    render(<StudioExperience />);
    fireEvent.click(screen.getByRole("button", { name: "Entra in MLSM Studio" }));
    act(() => vi.advanceTimersByTime(850));
    expect(screen.getByRole("region", { name: "Aree creative disponibili" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sound Animation/ }));
    expect(screen.getByRole("main", { name: "Editor MLSM" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Home editor" }));
    expect(screen.getByRole("region", { name: "Aree creative disponibili" })).toBeInTheDocument();
  });

  it("apre LongCat Video come area autonoma e torna alla home", () => {
    render(<StudioExperience />);
    fireEvent.click(screen.getByRole("button", { name: "Entra in MLSM Studio" })); act(() => vi.advanceTimersByTime(850));
    fireEvent.click(screen.getByRole("button", { name: /LongCat Video/ }));
    expect(screen.getByRole("main", { name: "LongCat Video" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Home LongCat" }));
    expect(screen.getByRole("region", { name: "Aree creative disponibili" })).toBeInTheDocument();
  });
});
