import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../store/project-store";
import { InspectorPanel } from "./InspectorPanel";
import { LibraryPanel } from "./LibraryPanel";
import { ProSubtitlesPanel } from "./ProSubtitlesPanel";

describe("ProSubtitles UI", () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    useProjectStore.getState().setAnimationMode("proSubtitles", ["platform"]);
  });
  afterEach(cleanup);

  it("non modifica implicitamente il primo blocco quando la selezione è nulla o non valida", () => {
    useProjectStore.getState().attachAudio({ path: "guide.mp4", fileName: "guide.mp4", hash: "7".repeat(64), durationSeconds: 8, sampleRate: 48_000, channels: 2, codec: "aac", fileSize: 100 }, []);
    useProjectStore.getState().updateProSubtitles({ videoUrl: "blob:guide", videoName: "guide.mp4" });
    useProjectStore.getState().setSubtitleCues([{ id: "cue-a", startSeconds: 1, endSeconds: 2, text: "PRIMO BLOCCO", confidence: 1, verified: true, manual: true }]);
    const props = { duration: 8, onSelectSubtitle: vi.fn(), onImportVideo: vi.fn(async () => undefined) };
    const { rerender } = render(<ProSubtitlesPanel {...props} selectedSubtitleId={null} />);

    expect(screen.queryByText("Frase selezionata")).not.toBeInTheDocument();
    expect(screen.getByText("Importa o inserisci un blocco", { exact: false })).toBeInTheDocument();
    expect(screen.queryByLabelText("Testo frase ProSubtitles")).not.toBeInTheDocument();

    rerender(<ProSubtitlesPanel {...props} selectedSubtitleId="cue-inesistente" />);
    expect(screen.queryByText("Frase selezionata")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Testo frase ProSubtitles")).not.toBeInTheDocument();
  });

  it("blocca l'import dei sottotitoli senza un video valido e annuncia lo stato", () => {
    render(<ProSubtitlesPanel duration={0} selectedSubtitleId={null} onSelectSubtitle={vi.fn()} onImportVideo={vi.fn(async () => undefined)} />);
    const input = screen.getByLabelText("Importa sottotitoli ProSubtitles");
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute("aria-describedby", "pro-subtitle-import-help");
    expect(screen.getByText("Carica prima il video guida", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("button", { name: "9:16 verticale" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "16:9 orizzontale" })).toHaveAttribute("aria-pressed", "false");
  });

  it("offre Whisper e la redazione Qwen accanto all'import SRT", () => {
    render(<ProSubtitlesPanel audioUrl="blob:guide" duration={8} selectedSubtitleId={null} onSelectSubtitle={vi.fn()} onImportVideo={vi.fn(async () => undefined)} />);
    const whisper = screen.getByRole("combobox", { name: "Modello Whisper ProSubtitles" });
    const llm = screen.getByRole("combobox", { name: "Modello LLM ProSubtitles" });
    expect(within(whisper).getByRole("option", { name: /Whisper Medium/ })).toBeInTheDocument();
    expect(within(llm).getByRole("option", { name: /Qwen2.5 0.5B Instruct/ })).toBeInTheDocument();
    expect(llm).toHaveValue("qwen2.5-0.5b-instruct");
    expect(screen.getByLabelText("Passaggi agenti ProSubtitles")).toHaveValue("5");
    expect(screen.getByLabelText("Testo completo ProSubtitles")).toHaveAttribute("placeholder", expect.stringContaining("[Instrumental]"));
    expect(screen.getByRole("button", { name: "Esporta JSON Whisper" })).toBeDisabled();
  });

  it("riapre la chat e consente di scegliere a quale agente scrivere", () => {
    useProjectStore.getState().setSubtitleCues([{ id: "cue-a", startSeconds: 1, endSeconds: 2, text: "TESTO DA CORREGGERE", confidence: .8, verified: false, manual: true }]);
    useProjectStore.getState().updateSubtitles({ llmEnabled: true });
    render(<ProSubtitlesPanel duration={8} selectedSubtitleId="cue-a" onSelectSubtitle={vi.fn()} onImportVideo={vi.fn(async () => undefined)} />);

    fireEvent.click(screen.getByRole("button", { name: "Parla con gli agenti" }));

    expect(screen.getByRole("dialog", { name: "Smart Subtitles generation" })).toBeInTheDocument();
    expect(screen.getByLabelText("Istruzione per gli agenti")).toBeEnabled();
    expect(within(screen.getByLabelText("Agente destinatario")).getByRole("option", { name: "A2 · Timing Director" })).toBeInTheDocument();
  });

  it("nasconde il formato alpha quando è selezionato un fondo pieno", () => {
    useProjectStore.getState().updateProSubtitles({ backgroundMode: "solid", backgroundColor: "#123456" });
    render(<ProSubtitlesPanel duration={0} selectedSubtitleId={null} onSelectSubtitle={vi.fn()} onImportVideo={vi.fn(async () => undefined)} />);
    expect(screen.queryByRole("combobox", { name: "Formato trasparente" })).not.toBeInTheDocument();
    expect(screen.getByText("MP4 · H.264 con fondo pieno")).toBeInTheDocument();
    expect(screen.getByLabelText("Colore fondo ProSubtitles")).toHaveValue("#123456");
  });

  it("propaga una modifica manuale della palette solo alle parole ancora collegate allo slot", () => {
    useProjectStore.getState().attachAudio({ path: "guide.mp4", fileName: "guide.mp4", hash: "6".repeat(64), durationSeconds: 8, sampleRate: 48_000, channels: 2, codec: "aac", fileSize: 100 }, []);
    useProjectStore.getState().setSubtitleCues([{ id: "cue-a", startSeconds: 1, endSeconds: 2, text: "AUTO MANUALE", confidence: 1, verified: true, manual: true }]);
    const initial = useProjectStore.getState().project.animation.proSubtitles.palette;
    useProjectStore.getState().updateProSubtitleWordStyle("cue-a", 0, { color: initial[0] });
    useProjectStore.getState().updateProSubtitleWordStyle("cue-a", 1, { color: "#123456" });
    render(<ProSubtitlesPanel duration={8} selectedSubtitleId="cue-a" onSelectSubtitle={vi.fn()} onImportVideo={vi.fn(async () => undefined)} />);

    fireEvent.change(screen.getByLabelText("Colore palette 1"), { target: { value: "#ef476f" } });

    const settings = useProjectStore.getState().project.animation.proSubtitles;
    expect(settings.palette[0]).toBe("#ef476f");
    expect(settings.cueStyles.find((style) => style.cueId === "cue-a")?.wordStyles).toEqual(expect.arrayContaining([
      expect.objectContaining({ index: 0, color: "#ef476f" }),
      expect.objectContaining({ index: 1, color: "#123456" })
    ]));
  });

  it("applica davvero font e dimensione globali alle frasi che li ereditano", () => {
    useProjectStore.getState().attachAudio({ path: "guide.mp4", fileName: "guide.mp4", hash: "5".repeat(64), durationSeconds: 8, sampleRate: 48_000, channels: 2, codec: "aac", fileSize: 100 }, []);
    useProjectStore.getState().setSubtitleCues([{ id: "cue-a", startSeconds: 1, endSeconds: 3, text: "STILE GLOBALE", confidence: 1, verified: true, manual: true }]);
    render(<ProSubtitlesPanel duration={8} selectedSubtitleId="cue-a" onSelectSubtitle={vi.fn()} onImportVideo={vi.fn(async () => undefined)} />);

    fireEvent.change(screen.getByLabelText("Font globale ProSubtitles"), { target: { value: "Orbitron" } });
    fireEvent.change(screen.getByLabelText("Dimensione globale ProSubtitles"), { target: { value: "148" } });

    const settings = useProjectStore.getState().project.animation.proSubtitles;
    const cueStyle = settings.cueStyles.find((style) => style.cueId === "cue-a");
    expect(settings.defaultFontFamily).toBe("Orbitron");
    expect(settings.defaultFontSize).toBe(148);
    expect(cueStyle).toMatchObject({
      fontFamily: "Orbitron",
      fontFamilyAutomatic: true,
      fontSize: 148,
      fontSizeAutomatic: true
    });
    expect(screen.getByLabelText("Font frase ProSubtitles")).toHaveValue("Orbitron");
    expect(screen.getByLabelText("Font frase ProSubtitles")).toBeDisabled();
    expect(screen.getByLabelText("Dimensione frase ProSubtitles")).toHaveValue("148");
    expect(screen.getByLabelText("Dimensione frase ProSubtitles")).toBeDisabled();
  });

  it("consente posizione e opacità globali oppure override indipendenti per frase", () => {
    useProjectStore.getState().attachAudio({ path: "guide.mp4", fileName: "guide.mp4", hash: "4".repeat(64), durationSeconds: 8, sampleRate: 48_000, channels: 2, codec: "aac", fileSize: 100 }, []);
    useProjectStore.getState().setSubtitleCues([{ id: "cue-a", startSeconds: 1, endSeconds: 3, text: "POSIZIONE PROFESSIONALE", confidence: 1, verified: true, manual: true }]);
    render(<ProSubtitlesPanel duration={8} selectedSubtitleId="cue-a" onSelectSubtitle={vi.fn()} onImportVideo={vi.fn(async () => undefined)} />);

    const globalPad = screen.getByRole("group", { name: "Preset posizione globale" });
    fireEvent.click(within(globalPad).getByRole("button", { name: "Basso a destra" }));
    fireEvent.change(screen.getByLabelText("Opacità globale ProSubtitles"), { target: { value: ".72" } });

    let cueStyle = useProjectStore.getState().project.animation.proSubtitles.cueStyles.find((style) => style.cueId === "cue-a");
    expect(cueStyle).toMatchObject({ positionX: 85, positionY: 85, positionAutomatic: true, opacity: .72, opacityAutomatic: true });
    expect(screen.getByLabelText("Posizione orizzontale frase")).toBeDisabled();
    expect(screen.getByLabelText("Opacità frase ProSubtitles")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Eredita posizione globale/ }));
    const cuePad = screen.getByRole("group", { name: "Preset posizione frase" });
    fireEvent.click(within(cuePad).getByRole("button", { name: "Alto a sinistra" }));
    fireEvent.change(screen.getByLabelText("Posizione verticale frase"), { target: { value: "27" } });
    fireEvent.click(screen.getByRole("button", { name: /Eredita opacità globale/ }));
    fireEvent.change(screen.getByLabelText("Opacità frase ProSubtitles"), { target: { value: ".38" } });

    cueStyle = useProjectStore.getState().project.animation.proSubtitles.cueStyles.find((style) => style.cueId === "cue-a");
    expect(cueStyle).toMatchObject({ positionX: 15, positionY: 27, positionAutomatic: false, opacity: .38, opacityAutomatic: false });
    expect(screen.getByRole("button", { name: "Eredita posizione globale" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Eredita opacità globale" })).toHaveAttribute("aria-pressed", "false");
  });

  it("mantiene gli override tipografici locali e permette di tornare allo stile globale", () => {
    useProjectStore.getState().attachAudio({ path: "guide.mp4", fileName: "guide.mp4", hash: "3".repeat(64), durationSeconds: 8, sampleRate: 48_000, channels: 2, codec: "aac", fileSize: 100 }, []);
    useProjectStore.getState().setSubtitleCues([{ id: "cue-a", startSeconds: 1, endSeconds: 3, text: "OVERRIDE LOCALE", confidence: 1, verified: true, manual: true }]);
    render(<ProSubtitlesPanel duration={8} selectedSubtitleId="cue-a" onSelectSubtitle={vi.fn()} onImportVideo={vi.fn(async () => undefined)} />);

    fireEvent.click(screen.getByRole("button", { name: /Usa font globale/ }));
    fireEvent.change(screen.getByLabelText("Font frase ProSubtitles"), { target: { value: "Montserrat" } });
    fireEvent.click(screen.getByRole("button", { name: /Usa dimensione globale/ }));
    fireEvent.change(screen.getByLabelText("Dimensione frase ProSubtitles"), { target: { value: "132" } });
    fireEvent.change(screen.getByLabelText("Font globale ProSubtitles"), { target: { value: "Orbitron" } });

    let cueStyle = useProjectStore.getState().project.animation.proSubtitles.cueStyles.find((style) => style.cueId === "cue-a");
    expect(cueStyle).toMatchObject({ fontFamily: "Montserrat", fontFamilyAutomatic: false, fontSize: 132, fontSizeAutomatic: false });

    fireEvent.click(screen.getByRole("button", { name: "Usa font globale" }));
    cueStyle = useProjectStore.getState().project.animation.proSubtitles.cueStyles.find((style) => style.cueId === "cue-a");
    expect(cueStyle).toMatchObject({ fontFamily: "Orbitron", fontFamilyAutomatic: true });
    expect(screen.getByLabelText("Font frase ProSubtitles")).toBeDisabled();
  });

  it("espone e applica le tre regie full-frame a livello globale, di frase e di parola", () => {
    useProjectStore.getState().attachAudio({ path: "guide.mp4", fileName: "guide.mp4", hash: "2".repeat(64), durationSeconds: 8, sampleRate: 48_000, channels: 2, codec: "aac", fileSize: 100 }, []);
    useProjectStore.getState().setSubtitleCues([{ id: "cue-a", startSeconds: 1, endSeconds: 3, text: "EDIT DA MILIONI", confidence: 1, verified: true, manual: true }]);
    render(<ProSubtitlesPanel duration={8} selectedSubtitleId="cue-a" onSelectSubtitle={vi.fn()} onImportVideo={vi.fn(async () => undefined)} />);

    const globalAnimation = screen.getByLabelText("Animazione predefinita ProSubtitles");
    const cueAnimation = screen.getByLabelText("Animazione frase ProSubtitles");
    const wordAnimation = screen.getByLabelText("Movimento parola 1: EDIT");
    for (const select of [globalAnimation, cueAnimation, wordAnimation]) {
      expect(within(select).getByRole("option", { name: "Orbita full-frame" })).toBeInTheDocument();
      expect(within(select).getByRole("option", { name: "Griglia editoriale" })).toBeInTheDocument();
      expect(within(select).getByRole("option", { name: "Parola protagonista" })).toBeInTheDocument();
    }

    fireEvent.change(globalAnimation, { target: { value: "fullFrameOrbit" } });
    fireEvent.change(cueAnimation, { target: { value: "editorialGrid" } });
    fireEvent.change(wordAnimation, { target: { value: "focusCarousel" } });

    const settings = useProjectStore.getState().project.animation.proSubtitles;
    const cueStyle = settings.cueStyles.find((style) => style.cueId === "cue-a");
    expect(settings.defaultAnimation).toBe("fullFrameOrbit");
    expect(cueStyle?.animation).toBe("editorialGrid");
    expect(cueStyle?.animationAutomatic).toBe(false);
    expect(cueStyle?.wordStyles.find((style) => style.index === 0)?.animation).toBe("focusCarousel");
  });

  it("espone semanticamente formato e palette nell'Inspector", () => {
    render(<InspectorPanel name="Demo" aspectRatio="9:16" event={undefined} events={[]} duration={0} availableObjectTypes={[]} onRename={vi.fn()} onAspectRatio={vi.fn()} onSelectObject={vi.fn()} onChangeObjectType={vi.fn()} onUpdateEvent={vi.fn()} onDeleteEvent={vi.fn()} />);
    const group = screen.getByRole("group", { name: "Formato montaggio ProSubtitles" });
    expect(within(group).getByRole("button", { name: "9:16" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "16:9" })).toHaveAttribute("aria-pressed", "false");
    const palette = screen.getByLabelText("Palette ProSubtitles");
    expect(within(palette).getAllByRole("img")).toHaveLength(3);
    expect(within(palette).getByRole("img", { name: /^Colore 1:/ })).toBeInTheDocument();
  });

  it("non mostra la nota generica delle altre modalità sotto il workflow Pro", () => {
    render(<LibraryPanel canRegenerate={false} onRegenerate={vi.fn()} onImportAudioFragment={vi.fn(async () => undefined)} onImportSubtitleVideo={vi.fn(async () => undefined)} audioUrl={null} duration={0} currentTime={0} selectedSubtitleId={null} onSelectSubtitle={vi.fn()} />);
    expect(screen.getByText("1 · Video guida")).toBeInTheDocument();
    expect(screen.queryByText("Ogni modalità fornisce generatore", { exact: false })).not.toBeInTheDocument();
  });
});
