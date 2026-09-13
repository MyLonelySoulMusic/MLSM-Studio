import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SoundInspectorAccordion } from "./SoundInspectorAccordion";

describe("SoundInspectorAccordion", () => {
  it("starts closed and keeps only one inspector group open", () => {
    render(<SoundInspectorAccordion aria-label="Inspector prova">
      <section><h2>Formato</h2><button>Verticale</button></section>
      <section><h2>Colori</h2><button>Rosa</button></section>
    </SoundInspectorAccordion>);

    const format = screen.getByRole("button", { name: "Formato" });
    const colors = screen.getByRole("button", { name: "Colori" });
    expect(format).toHaveAttribute("aria-expanded", "false");
    expect(colors).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(format);
    expect(format).toHaveAttribute("aria-expanded", "true");
    expect(format.parentElement).toHaveClass("is-open");

    fireEvent.click(colors);
    expect(format).toHaveAttribute("aria-expanded", "false");
    expect(colors).toHaveAttribute("aria-expanded", "true");
    expect(format.parentElement).not.toHaveClass("is-open");
    expect(colors.parentElement).toHaveClass("is-open");
  });

  it("opens and closes groups from the keyboard", () => {
    render(<SoundInspectorAccordion><section><h3>Audio</h3><p>Stato</p></section></SoundInspectorAccordion>);
    const audio = screen.getByRole("button", { name: "Audio" });
    fireEvent.keyDown(audio, { key: "Enter" });
    expect(audio).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(audio, { key: " " });
    expect(audio).toHaveAttribute("aria-expanded", "false");
  });

  it("closes every group when the active animation changes", () => {
    const { rerender } = render(<SoundInspectorAccordion resetKey="animation-a"><section><h2>Scena</h2><p>Controlli</p></section></SoundInspectorAccordion>);
    const scene = screen.getByRole("button", { name: "Scena" });
    fireEvent.click(scene);
    expect(scene).toHaveAttribute("aria-expanded", "true");

    rerender(<SoundInspectorAccordion resetKey="animation-b"><section><h2>Scena</h2><p>Controlli</p></section></SoundInspectorAccordion>);
    expect(screen.getByRole("button", { name: "Scena" })).toHaveAttribute("aria-expanded", "false");
  });
});
