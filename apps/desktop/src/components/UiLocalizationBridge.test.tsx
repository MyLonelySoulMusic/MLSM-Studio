import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { updateUiPreferences } from "../services/ui-preferences";
import { UiLocalizationBridge } from "./UiLocalizationBridge";

describe("UiLocalizationBridge", () => {
  afterEach(() => { cleanup(); localStorage.clear(); });

  it("traduce contenuto, tooltip e aria-label e torna alla sorgente cambiando lingua", async () => {
    updateUiPreferences({ language: "it" });
    render(<><UiLocalizationBridge /><section><p>Detection sensitivity</p><button aria-label="Remove">Remove</button></section></>);
    expect(screen.getByText("Sensibilità rilevamento")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rimuovi" })).toBeInTheDocument();

    updateUiPreferences({ language: "en" });
    await waitFor(() => expect(screen.getByText("Detection sensitivity")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("traduce anche messaggi e controlli aggiunti dinamicamente", async () => {
    updateUiPreferences({ language: "en" });
    const { container } = render(<><UiLocalizationBridge /><div data-testid="dynamic-area" /></>);
    const area = screen.getByTestId("dynamic-area");
    const message = document.createElement("p");
    message.textContent = "Nessun effetto attivo.";
    const input = document.createElement("input");
    input.placeholder = "Carica immagini";
    area.append(message, input);

    await waitFor(() => expect(screen.getByText("No active effects.")).toBeInTheDocument());
    expect(container.querySelector("input")).toHaveAttribute("placeholder", "Upload images");
  });
});
