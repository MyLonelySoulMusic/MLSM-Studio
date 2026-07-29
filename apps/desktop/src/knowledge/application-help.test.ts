import { describe, expect, it } from "vitest";
import { applicationHelpContext, fallbackApplicationHelpAnswer, retrieveApplicationHelp } from "./application-help";

describe("application assistant knowledge base", () => {
  it("recupera la guida della modalità corrente per domande contestuali", () => {
    const results = retrieveApplicationHelp("Come imposto il nome del bar e i led?", "pixelArt");
    expect(results[0]).toMatchObject({ id: "pixel-art" });
    expect(applicationHelpContext("insegna del locale", "pixelArt")).toContain("insegna LED");
  });

  it("riconosce sinonimi italiani e inglesi dell’esportazione", () => {
    expect(retrieveApplicationHelp("Il render MP4 dà errore di storage", "coverSphere")[0]).toMatchObject({ id: "export" });
  });

  it("spiega vetro, spettrogramma e loop della modalità Cube Animation", () => {
    expect(retrieveApplicationHelp("Come funziona il cubo di vetro e il loop?", "walkingCube")[0]).toMatchObject({ id: "walking-cube" });
    expect(applicationHelpContext("spettrogramma e sfondo", "walkingCube")).toContain("48 bande spettrali");
  });

  it("spiega fallback, timeout e memoria della chat locale", () => {
    expect(retrieveApplicationHelp("Il chatbot resta in caricamento e non risponde", "walkingCube")[0]).toMatchObject({ id: "studio-assistant" });
    expect(applicationHelpContext("Come azzero la memoria del bot?", "walkingCube")).toContain("Azzera memoria");
  });

  it("fornisce sempre una risposta locale anche senza corrispondenze", () => {
    expect(fallbackApplicationHelpAnswer("xyz sconosciuto", "instrumentalFalling").length).toBeGreaterThan(80);
  });
});
