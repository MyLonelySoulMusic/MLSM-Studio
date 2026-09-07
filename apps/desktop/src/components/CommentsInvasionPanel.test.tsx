import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCommentsInvasionRuntime } from "../store/comments-invasion-store";
import { useProjectStore } from "../store/project-store";
import { CommentsInvasionPanel } from "./CommentsInvasionPanel";

describe("CommentsInvasionPanel", () => {
  beforeEach(() => { useProjectStore.getState().newProject(); resetCommentsInvasionRuntime(); });
  afterEach(() => { cleanup(); resetCommentsInvasionRuntime(); });

  it("espone cartella, multi-upload e valori iniziali utili", () => {
    render(<CommentsInvasionPanel onImportVideo={vi.fn()} />);
    const folder = screen.getByLabelText("Carica cartella commenti");
    expect(folder).toHaveAttribute("multiple");
    expect(folder).toHaveAttribute("webkitdirectory");
    expect(screen.getByLabelText("Aggiungi immagini commenti")).toHaveAttribute("multiple");
    expect(screen.getByLabelText("Numero commenti visibili")).toHaveValue("5");
    expect(screen.getByLabelText("Dimensione commenti")).toHaveValue("0.34");
    expect(screen.getByLabelText("Permanenza commenti")).toHaveValue("5");
    expect(screen.getByLabelText("Animazione uscita commenti")).toHaveValue("fade");
  });

  it("conserva il video nel picker dopo la selezione", () => {
    const onImportVideo = vi.fn();
    render(<CommentsInvasionPanel onImportVideo={onImportVideo} />);
    const picker = screen.getByLabelText("Carica video Comments Invasion") as HTMLInputElement;
    const file = new File(["video"], "comments-source.mp4", { type: "video/mp4" });

    fireEvent.change(picker, { target: { files: [file] } });

    expect(onImportVideo).toHaveBeenCalledWith(file);
    expect(picker.files?.[0]).toBe(file);
  });

  it("salva indipendentemente quantità, dimensione e forza del timbro", () => {
    render(<CommentsInvasionPanel onImportVideo={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Numero commenti visibili"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Dimensione commenti"), { target: { value: ".46" } });
    fireEvent.change(screen.getByLabelText("Potenza timbro commenti"), { target: { value: "1.7" } });
    fireEvent.change(screen.getByLabelText("Permanenza commenti"), { target: { value: "7.5" } });
    fireEvent.change(screen.getByLabelText("Animazione uscita commenti"), { target: { value: "spin" } });
    expect(useProjectStore.getState().project.animation.commentsInvasion).toMatchObject({ maxVisible: 8, commentScale: .46, impactIntensity: 1.7, holdDurationSeconds: 7.5, exitAnimation: "spin" });
  });
});
