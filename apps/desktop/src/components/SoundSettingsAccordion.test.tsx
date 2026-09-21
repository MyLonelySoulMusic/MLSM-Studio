import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SoundSettingsAccordion } from "./SoundSettingsAccordion";
import { readFileSync } from "node:fs";

describe("SoundSettingsAccordion", () => {
  it("hides the instrument cards despite their explicit grid layout", () => {
    // Use the actual layout and visibility rules: hidden attributes alone do
    // not override author CSS, and toBeVisible() does not catch that conflict.
    const style = document.createElement("style");
    const baseCss = readFileSync("apps/desktop/src/styles.css", "utf8");
    const workspaceCss = readFileSync("apps/desktop/src/workspace-finish.css", "utf8");
    style.textContent = [
      baseCss.match(/\.base-object-list\s*\{[^}]*\}/)?.[0],
      workspaceCss.match(/\.animation-settings-accordion\s+\[hidden\]\s*\{[^}]*\}/)?.[0]
    ].filter(Boolean).join("\n");
    document.head.append(style);
    try {
      const { container } = render(<SoundSettingsAccordion resetKey="instrumentalFalling">
        <section><h2>Elementi della base</h2><p>Descrizione</p>
          <div className="base-object-list"><label><input type="checkbox" />Grancassa</label></div>
        </section>
        <section><h2>Sottotitoli globali</h2><input aria-label="Testo" /></section>
      </SoundSettingsAccordion>);
      const cards = container.querySelector(".base-object-list")!;
      const toggle = screen.getByRole("button", { name: "Elementi della base" });
      expect(getComputedStyle(cards).display).toBe("none");
      fireEvent.click(toggle);
      expect(getComputedStyle(cards).display).toBe("grid");
      fireEvent.click(toggle);
      expect(getComputedStyle(cards).display).toBe("none");
      fireEvent.click(toggle);
      fireEvent.click(screen.getByRole("button", { name: "Sottotitoli globali" }));
      expect(getComputedStyle(cards).display).toBe("none");
    } finally {
      style.remove();
    }
  });
  it("makes the real animation setting groups closed and mutually exclusive", () => {
    render(<SoundSettingsAccordion resetKey="proSubtitles">
      <section>
        <div className="pro-workflow"><h2>1 · Video guida</h2><label>Upload video<input /></label></div>
        <div className="pro-workflow"><h2>2 · File sottotitoli</h2><button>Importa SRT</button></div>
      </section>
    </SoundSettingsAccordion>);

    const video = screen.getByRole("button", { name: "1 · Video guida" });
    const subtitles = screen.getByRole("button", { name: "2 · File sottotitoli" });
    expect(video).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Upload video").closest("label")).toHaveAttribute("hidden");

    fireEvent.click(video);
    expect(video).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Upload video").closest("label")).not.toHaveAttribute("hidden");

    fireEvent.click(subtitles);
    expect(video).toHaveAttribute("aria-expanded", "false");
    expect(subtitles).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Upload video").closest("label")).toHaveAttribute("hidden");
  });

  it("closes everything again when the animation changes", () => {
    const { rerender } = render(<SoundSettingsAccordion resetKey="first"><section><h2>Colori</h2><input aria-label="Colore" /></section></SoundSettingsAccordion>);
    fireEvent.click(screen.getByRole("button", { name: "Colori" }));
    expect(screen.getByRole("button", { name: "Colori" })).toHaveAttribute("aria-expanded", "true");
    rerender(<SoundSettingsAccordion resetKey="second"><section><h2>Colori</h2><input aria-label="Colore" /></section></SoundSettingsAccordion>);
    expect(screen.getByRole("button", { name: "Colori" })).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps a dynamic settings group open when its provider replaces the heading", async () => {
    const { rerender } = render(<SoundSettingsAccordion resetKey="upscaler">
      <section key="local"><h2 data-settings-accordion-key="upscaler-model">Modello locale</h2><select aria-label="Modello locale"><option>Canvas</option></select></section>
    </SoundSettingsAccordion>);
    fireEvent.click(screen.getByRole("button", { name: "Modello locale" }));
    expect(screen.getByLabelText("Modello locale")).toBeVisible();

    rerender(<SoundSettingsAccordion resetKey="upscaler">
      <section key="mlx"><h2 data-settings-accordion-key="upscaler-model">Modello MLX-DLSS</h2><select aria-label="Modello MLX"><option>Neural Rendering</option></select></section>
    </SoundSettingsAccordion>);

    await waitFor(() => expect(screen.getByRole("button", { name: "Modello MLX-DLSS" })).toHaveAttribute("aria-expanded", "true"));
    expect(screen.getByLabelText("Modello MLX")).toBeVisible();
  });

  it("splits the Song Player h3 subsections into independent groups", () => {
    render(<SoundSettingsAccordion resetKey="songPlayer">
      <section className="song-player-panel">
        <h2>Song Player</h2><p>Introduzione</p>
        <h3>1. Spezzone audio</h3><button>Carica spezzone</button>
        <h3>2. Canzone completa</h3><button>Carica canzone</button>
      </section>
    </SoundSettingsAccordion>);

    const fragment = screen.getByRole("button", { name: "1. Spezzone audio" });
    const track = screen.getByRole("button", { name: "2. Canzone completa" });
    expect(fragment).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Carica spezzone" })).not.toBeInTheDocument();
    fireEvent.click(fragment);
    expect(screen.getByRole("button", { name: "Carica spezzone" })).toBeInTheDocument();
    fireEvent.click(track);
    expect(fragment).toHaveAttribute("aria-expanded", "false");
    expect(track).toHaveAttribute("aria-expanded", "true");
  });

  it("does not hide nested control groups behind the preceding description", () => {
    render(<SoundSettingsAccordion resetKey="upscaler">
      <section>
        <h2>Sorgente</h2><p>Descrizione della sorgente</p>
        <fieldset>
          <h2>Modalità elaborazione</h2><button>Usa locale</button>
          <h2>Risoluzione finale</h2><input aria-label="Larghezza finale" />
        </fieldset>
      </section>
    </SoundSettingsAccordion>);

    const source = screen.getByText("Sorgente");
    const processing = screen.getByRole("button", { name: "Modalità elaborazione" });
    expect(source).not.toHaveAttribute("role");
    expect(screen.getByText("Descrizione della sorgente")).toBeVisible();
    expect(processing).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(processing);
    expect(screen.getByRole("button", { name: "Usa locale" })).toBeVisible();
  });

  it("uses a nested header as the toggle for all controls in its single-section panel", () => {
    render(<SoundSettingsAccordion resetKey="frameBooster">
      <section>
        <header><div><span>Interpolazione</span><h2>Frame Booster</h2></div></header>
        <p>Descrizione</p><label>Metodo<select aria-label="Metodo"><option>Motion</option></select></label>
      </section>
    </SoundSettingsAccordion>);

    const heading = screen.getByRole("button", { name: "Frame Booster" });
    expect(screen.queryByRole("combobox", { name: "Metodo" })).not.toBeInTheDocument();
    fireEvent.click(heading);
    expect(screen.getByRole("combobox", { name: "Metodo" })).toBeVisible();
  });

  it("leaves purely descriptive sections visible instead of turning them into empty menus", () => {
    render(<SoundSettingsAccordion resetKey="description"><section><h2>Percorso emozionale</h2><p>Solo informazioni.</p></section></SoundSettingsAccordion>);
    expect(screen.queryByRole("button", { name: "Percorso emozionale" })).not.toBeInTheDocument();
    expect(screen.getByText("Solo informazioni.")).toBeVisible();
  });
});
