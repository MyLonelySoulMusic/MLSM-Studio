import { describe, expect, it } from "vitest";
import { applicationHelpContext, conversationalApplicationHelpAnswer, fallbackApplicationHelpAnswer, retrieveApplicationHelp } from "./application-help";

describe("application assistant knowledge base", () => {
  it("sa presentarsi e propone ambiti di assistenza concreti", () => {
    expect(retrieveApplicationHelp("Ciao, chi sei e cosa puoi fare?", "walkingCube")[0]).toMatchObject({ id: "assistant-introduction" });
    expect(fallbackApplicationHelpAnswer("Presentati e dimmi in cosa puoi aiutarmi.", "walkingCube")).toContain("Lonely Bot");
  });

  it("spiega la Home quando la domanda è contestuale e non cita una modalità casuale", () => {
    const answer = fallbackApplicationHelpAnswer("Cosa c'è in questa pagina?", "studioHome");
    expect(answer).toContain("Questa è la Home di MLSM Studio");
    expect(answer).toContain("Le sei schede centrali");
    expect(answer).not.toContain("biglia");
  });

  it("risponde ai saluti senza selezionare guide tecniche della modalità attiva", () => {
    expect(conversationalApplicationHelpAnswer("Ciao, come va?")).toContain("Tutto bene");
    expect(conversationalApplicationHelpAnswer("Ehi, tutto bene?")).toContain("pronto ad aiutarti");
    expect(retrieveApplicationHelp("Ehi, tutto bene?", "instrumentalFalling")).toEqual([
      expect.objectContaining({ id: "assistant-introduction" })
    ]);
    expect(fallbackApplicationHelpAnswer("Ehi, tutto bene?", "instrumentalFalling")).not.toContain("biglia");
  });

  it("non espone una guida per modalità rimosse", () => {
    expect(retrieveApplicationHelp("Pixel Art", "pixelArt").some((result) => result.id === "pixel-art")).toBe(false);
    expect(applicationHelpContext("insegna del locale", "pixelArt")).not.toContain("Pixel Art");
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

  it("spiega il catalogo Memory senza confonderlo con la memoria della chat", () => {
    expect(retrieveApplicationHelp("Come catalogo una cartella e ritrovo i file con il grafo?", "walkingCube")[0]).toMatchObject({ id: "intelligent-memory" });
    expect(applicationHelpContext("Come copio i risultati trovati da Memory?", "walkingCube")).toContain("Copia selezionati");
  });

  it("spiega il workflow alpha e lo stile per parola di ProSubtitles", () => {
    expect(retrieveApplicationHelp("Come esporto un overlay trasparente per CapCut?", "proSubtitles")[0]).toMatchObject({ id: "pro-subtitles" });
    expect(applicationHelpContext("palette ombra e stile di ogni parola", "proSubtitles")).toContain("Stile per parola");
  });

  it("spiega calamita, sincronizzazione e interpolazione del Video Editor", () => {
    expect(retrieveApplicationHelp("Come uso la calamita per non lasciare un vuoto tra due clip?", "videoEditor")[0]).toMatchObject({ id: "video-editor" });
    expect(retrieveApplicationHelp("Come sincronizzo le clip come su CapCut?", "videoEditor")[0]).toMatchObject({ id: "video-editor" });
    // "audio" e "video" sono sinonimi dell'esportazione: la guida del montaggio resta
    // fra i risultati anche quando la domanda usa entrambi i termini generici.
    expect(retrieveApplicationHelp("Come sincronizzo audio e video come su CapCut?", "videoEditor")).toContainEqual(expect.objectContaining({ id: "video-editor" }));
    expect(applicationHelpContext("Come aumento davvero gli fps con l’interpolazione?", "videoEditor")).toContain("Frame Booster");
  });

  it("fornisce sempre una risposta locale anche senza corrispondenze", () => {
    const answer = fallbackApplicationHelpAnswer("xyz sconosciuto", "instrumentalFalling");
    expect(answer.length).toBeGreaterThan(80);
    expect(answer).toContain("Non ho trovato una guida abbastanza pertinente");
    expect(answer).not.toContain("biglia");
  });
});
