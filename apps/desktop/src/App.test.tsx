import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";
import { useAudioStore } from "./store/audio-store";
import { useSceneStore } from "./store/scene-store";
import { useProjectStore } from "./store/project-store";
import { useUpscalerBatchStore } from "./store/upscaler-batch-store";
import { resetUpscalerRuntimeForProjectReplacement } from "./services/upscaler-batch-lifecycle";
import { getUpscalerSourceFile, registerUpscalerSourceFile } from "./services/upscaler-source-file";
const viewportMock = vi.hoisted(() => ({
  props: null as { subtitles?: { enabled?: boolean } } | null
}));
const videoEditorPreviewMock = vi.hoisted(() => ({ mounts: 0 }));
const projectRepositoryMock = vi.hoisted(() => ({ chooseForLoad: vi.fn(), load: vi.fn(), filePath: null as string | null }));
vi.mock("./services/tauri-project-repository", () => ({
  TauriProjectRepository: class {
    constructor(_path: string | null) { void _path; }
    get filePath() { return projectRepositoryMock.filePath; }
    chooseForLoad() { return projectRepositoryMock.chooseForLoad(); }
    load() { return projectRepositoryMock.load(); }
    save() { return Promise.resolve(); }
  }
}));
vi.mock("./components/Viewport", () => ({
  Viewport: (props: { subtitles?: { enabled?: boolean } }) => {
    viewportMock.props = props;
    return <main aria-label="Viewport scena" />;
  }
}));
vi.mock("./components/PortraitLandscapePreview", () => ({
  PortraitLandscapePreview: () => <main aria-label="Vista From 9:16 to 16:9" />
}));
vi.mock("./components/VideoEditorPreview", () => ({
  VideoEditorPreview: () => {
    useEffect(() => { videoEditorPreviewMock.mounts += 1; }, []);
    return <main aria-label="Vista Video Editor mock" />;
  }
}));
import { App } from "./App";

describe("App", () => {
  it("non propone New York Streets nel selettore delle modalità", () => {
    render(<App />);
    const picker = screen.getByRole("combobox", { name: "Modalità animazione" });
    expect(within(picker).queryByRole("option", { name: "New York Streets" })).not.toBeInTheDocument();
  });
  beforeEach(() => { viewportMock.props = null; videoEditorPreviewMock.mounts = 0; projectRepositoryMock.filePath = null; projectRepositoryMock.chooseForLoad.mockReset(); projectRepositoryMock.load.mockReset(); resetUpscalerRuntimeForProjectReplacement(); useProjectStore.getState().newProject(); localStorage.clear(); });
  afterEach(() => { cleanup(); useAudioStore.getState().reset(); useSceneStore.getState().reset(); resetUpscalerRuntimeForProjectReplacement(); });

  it("preserva il pool se Nuovo viene annullato e lo termina dopo la sostituzione confermata", () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const revoke = vi.fn(); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    const controller = new AbortController(); const abort = vi.spyOn(controller, "abort");
    const sourceFile = new File(["single"], "single.jpg"); registerUpscalerSourceFile("blob:single-source", sourceFile);
    useProjectStore.getState().updateUpscaler({ sourceUrl: "blob:single-source", sourceName: sourceFile.name, sourceKind: "image" });
    useUpscalerBatchStore.setState({ items: [{ id: "photo", file: new File(["x"], "photo.jpg"), url: "blob:photo", thumbnailUrl: "blob:photo-thumb", name: "photo.jpg", sourceWidth: 10, sourceHeight: 5, target: { width: 20, height: 10 }, outputName: "photo.png", selected: true, status: "processing", progress: .5, error: null }], previewItemId: "photo", running: true, controller });
    useProjectStore.getState().renameProject("Da conservare");
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Nuovo" }));
    expect(useUpscalerBatchStore.getState().items).toHaveLength(1); expect(abort).not.toHaveBeenCalled(); expect(revoke).not.toHaveBeenCalled(); expect(getUpscalerSourceFile("blob:single-source")).toBe(sourceFile);
    fireEvent.click(screen.getByRole("button", { name: "Nuovo" }));
    expect(confirm).toHaveBeenCalledTimes(2); expect(abort).toHaveBeenCalledOnce();
    expect(revoke.mock.calls.map(([url]) => url)).toEqual(["blob:single-source", "blob:photo", "blob:photo-thumb"]);
    expect(getUpscalerSourceFile("blob:single-source")).toBeNull();
    expect(useUpscalerBatchStore.getState()).toMatchObject({ items: [], previewItemId: null, running: false });
  });

  it("preserva il pool se Apri viene annullato o fallisce e lo elimina solo dopo un caricamento valido", async () => {
    const revoke = vi.fn(); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    const sourceFile = new File(["single"], "single.jpg"); registerUpscalerSourceFile("blob:single-source", sourceFile);
    useProjectStore.getState().updateUpscaler({ sourceUrl: "blob:single-source", sourceName: sourceFile.name, sourceKind: "image" });
    useUpscalerBatchStore.setState({ items: [{ id: "photo", file: new File(["x"], "photo.jpg"), url: "blob:photo", thumbnailUrl: "blob:photo-thumb", name: "photo.jpg", sourceWidth: 10, sourceHeight: 5, target: { width: 20, height: 10 }, outputName: "photo.png", selected: true, status: "queued", progress: 0, error: null }], previewItemId: "photo" });
    projectRepositoryMock.chooseForLoad.mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    projectRepositoryMock.load.mockRejectedValueOnce(new Error("file non valido")).mockResolvedValueOnce(JSON.stringify(createProject()));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Apri" }));
    await waitFor(() => expect(projectRepositoryMock.chooseForLoad).toHaveBeenCalledTimes(1));
    expect(useUpscalerBatchStore.getState().items).toHaveLength(1); expect(revoke).not.toHaveBeenCalled(); expect(getUpscalerSourceFile("blob:single-source")).toBe(sourceFile);
    projectRepositoryMock.filePath = "progetto.rbs.json";
    fireEvent.click(screen.getByRole("button", { name: "Apri" }));
    await waitFor(() => expect(useProjectStore.getState().status).toBe("file non valido"));
    expect(useUpscalerBatchStore.getState().items).toHaveLength(1); expect(revoke).not.toHaveBeenCalled(); expect(getUpscalerSourceFile("blob:single-source")).toBe(sourceFile);
    fireEvent.click(screen.getByRole("button", { name: "Apri" }));
    await waitFor(() => expect(useUpscalerBatchStore.getState().items).toHaveLength(0));
    expect(revoke.mock.calls.map(([url]) => url)).toEqual(["blob:single-source", "blob:photo", "blob:photo-thumb"]);
    expect(getUpscalerSourceFile("blob:single-source")).toBeNull();
  });
  it("applica solo l’ultima apertura progetto quando due letture terminano fuori ordine", async () => { projectRepositoryMock.filePath = "project.rbs.json"; projectRepositoryMock.chooseForLoad.mockResolvedValue(true); let resolveFirst!: (value: string) => void; const firstLoad = new Promise<string>((resolve) => { resolveFirst = resolve; }); const first = createProject(); first.project.name = "Progetto A"; const second = createProject(); second.project.name = "Progetto B"; projectRepositoryMock.load.mockReturnValueOnce(firstLoad).mockResolvedValueOnce(JSON.stringify(second)); render(<App />); fireEvent.click(screen.getByRole("button", { name: "Apri" })); await waitFor(() => expect(projectRepositoryMock.load).toHaveBeenCalledTimes(1)); fireEvent.click(screen.getByRole("button", { name: "Apri" })); await waitFor(() => expect(useProjectStore.getState().project.project.name).toBe("Progetto B")); resolveFirst(JSON.stringify(first)); await act(async () => { await Promise.resolve(); }); expect(useProjectStore.getState().project.project.name).toBe("Progetto B"); });
  it("in Song Player riproduce lo spezzone della clip e non la canzone completa", () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    useProjectStore.getState().setAnimationMode("songPlayer", []);
    useAudioStore.setState({
      imported: { metadata: { path: "/clip.wav", fileName: "clip.wav", hash: "a".repeat(64), durationSeconds: 8, sampleRate: 44_100, channels: 2, codec: "wav", fileSize: 10 }, waveform: [0], url: "data:audio/wav;base64,Y2xpcA==" },
      fullTrack: { metadata: { path: "/song.wav", fileName: "song.wav", hash: "b".repeat(64), durationSeconds: 180, sampleRate: 44_100, channels: 2, codec: "wav", fileSize: 100 }, waveform: [0], url: "data:audio/wav;base64,c29uZw==" }
    });
    render(<App />);
    const player = document.querySelector("audio");
    expect(player).toHaveAttribute("src", "data:audio/wav;base64,Y2xpcA==");
    expect(player).not.toHaveAttribute("src", "data:audio/wav;base64,c29uZw==");
    getContext.mockRestore();
  });
  it("mostra il layout editor e permette di rinominare il progetto", () => {
    render(<App />);
    expect(screen.getByLabelText("MLSM Studio — My Lonely Soul Music Studio")).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "Viewport scena" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Timeline musicale" })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Ridimensiona pannello sinistro" })).toHaveAttribute("aria-valuenow", "230");
    expect(screen.getByRole("separator", { name: "Ridimensiona pannello destro" })).toHaveAttribute("aria-valuenow", "260");
    expect(screen.getByText("Sfondo e ambiente")).toBeInTheDocument(); expect(screen.getByText("Tubi in vetro")).toBeInTheDocument();
    const input = screen.getByLabelText("Nome");
    fireEvent.change(input, { target: { value: "Brano demo" } });
    expect(input).toHaveValue("Brano demo");
    fireEvent.click(screen.getByRole("button", { name: "16:9" })); expect(screen.getByRole("button", { name: "16:9" })).toHaveClass("active");
    fireEvent.click(screen.getByRole("button", { name: "Usurata" })); expect(screen.getByRole("button", { name: "Usurata" })).toHaveClass("active");
  });

  it("organizza le modalità in Sound Animation e persiste lingua e tema", () => {
    render(<App />);
    const navigation = screen.getByRole("region", { name: "Navigazione creativa" });
    expect(within(navigation).queryByRole("combobox", { name: "Area applicazione" })).not.toBeInTheDocument();
    const picker = within(navigation).getByRole("combobox", { name: "Modalità animazione" });
    expect(picker.querySelector('optgroup[label="Visualizer"]')).toBeInTheDocument();
    expect(picker.querySelector('optgroup[label="Storie e personaggi"]')).toBeInTheDocument();
    expect(picker.querySelector('optgroup[label="Testo e sottotitoli"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Supportami" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Lingua" }), { target: { value: "en" } });
    expect(screen.getByRole("navigation", { name: "Project actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Appearance: Day" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "night");
    expect(localStorage.getItem("dynamic-sound-animation-studio.ui.v1")).toContain('"language":"en"');
    expect(localStorage.getItem("dynamic-sound-animation-studio.ui.v1")).toContain('"theme":"night"');
  });

  it("espone Photo & Video Studio con Static Watermark Remover e soli controlli pertinenti", () => {
    useProjectStore.getState().setAnimationMode("staticWatermark", ["platform"]);
    render(<App />);
    expect(screen.getByRole("combobox", { name: "Modalità animazione" })).toHaveValue("staticWatermark");
    expect(screen.getByText("Static Watermark Remover", { selector: ".animation-mode-heading strong" })).toBeInTheDocument();
    expect(screen.getByLabelText("Carica video con watermark")).toBeInTheDocument();
    expect(screen.getByLabelText("Carica fotografia senza watermark")).toBeInTheDocument();
    expect(screen.getByLabelText("Sfumatura bordo watermark")).toBeInTheDocument();
    expect(screen.getByLabelText("Intensità correzione colore watermark")).toHaveValue("0.05");
    expect(screen.getByRole("button", { name: /Anteprima zona rimozione/ })).toBeDisabled();
    expect(screen.getByRole("complementary", { name: "Inspector Static Watermark Remover" })).toBeInTheDocument();
    expect(screen.queryByText("Sfondo e ambiente")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Importa audio" })).not.toBeInTheDocument();
  });

  it("espone Upscaler per foto e video con modelli, hardware, confronto e risoluzione finale", () => {
    useProjectStore.getState().setAnimationMode("upscaler", ["platform"]);
    render(<App />);
    expect(screen.getByLabelText("Carica sorgente Upscaler")).toHaveAttribute("accept", expect.stringContaining("video/mp4"));
    expect(screen.getByLabelText("Modello Upscaler")).toHaveTextContent("RealESRGAN x4plus Anime 6B");
    expect(screen.getByLabelText("Acceleratore Upscaler")).toHaveTextContent("NVIDIA CUDA");
    expect(screen.getByLabelText("Larghezza finale Upscaler")).toHaveValue(3840);
    expect(screen.getByLabelText("Modalità confronto Upscaler")).toHaveValue("split");
    expect(screen.getByRole("complementary", { name: "Inspector Upscaler" })).toBeInTheDocument();
    expect(screen.queryByText("Servizio PyTorch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Riprova connessione" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Timeline musicale" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Importa audio" })).not.toBeInTheDocument();
  });

  it("abilita Esporta nell’Upscaler e inoltra l’azione alla preview anche per una foto senza durata", () => {
    useProjectStore.getState().setAnimationMode("upscaler", ["platform"]);
    useProjectStore.getState().updateUpscaler({ sourceUrl: "blob:upscaled-source", sourceName: "source.png", sourceKind: "image", sourceWidth: 1200, sourceHeight: 1600, finalWidth: 2400, finalHeight: 3200 });
    const requested = vi.fn(); window.addEventListener("upscaler:export", requested);
    render(<App />);
    const exportButton = screen.getByRole("button", { name: "Esporta" }); expect(exportButton).toBeEnabled(); fireEvent.click(exportButton); expect(requested).toHaveBeenCalledOnce();
    window.removeEventListener("upscaler:export", requested);
  });

  it("non relega più le azioni Upscaler video in fondo al pannello laterale", () => {
    useProjectStore.getState().setAnimationMode("upscaler", ["platform"]);
    useProjectStore.getState().updateUpscaler({ sourceUrl: "blob:source-video", sourceName: "source.mp4", sourceKind: "video", sourceWidth: 1280, sourceHeight: 720, durationSeconds: 12, finalWidth: 2560, finalHeight: 1440 });
    render(<App />);
    expect(screen.queryByRole("button", { name: "Video intero · avvia upscaling frame per frame" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Solo prova rapida · elabora il frame corrente" })).not.toBeInTheDocument();
  });

  it("apre l’assistente locale con knowledge base e suggerimenti contestuali", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Apri assistente applicazione" }));
    const assistant = screen.getByRole("region", { name: "Assistente applicazione" });
    expect(within(assistant).getByText("Preparazione Qwen2.5 0.5B…")).toBeInTheDocument();
    expect(within(assistant).getByRole("button", { name: "Cosa puoi fare?" })).toBeInTheDocument();
    fireEvent.click(within(assistant).getByRole("button", { name: "Modalità attiva" }));
    expect(within(assistant).getByLabelText("Domanda per l’assistente")).toHaveValue("Come uso bene la modalità Instrumental Falling?");
    fireEvent.click(within(assistant).getByRole("button", { name: "Chiudi assistente" }));
    expect(screen.getByRole("button", { name: "Apri assistente applicazione" })).toBeInTheDocument();
  });

  it("alterna la riproduzione con Spazio ma non mentre si scrive", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    useAudioStore.getState().setImported({ url: "demo.mp3", waveform: [], metadata: { path: "demo.mp3", fileName: "demo.mp3", hash: "a".repeat(64), durationSeconds: 30, sampleRate: 48_000, channels: 2, codec: "audio/mpeg", fileSize: 1024 } });
    render(<App />); const name = screen.getByLabelText("Nome"); fireEvent.keyDown(name, { code: "Space", key: " " }); expect(play).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { code: "Space", key: " " }); await waitFor(() => expect(play).toHaveBeenCalledOnce()); play.mockRestore();
  });

  it("seleziona e sostituisce un elemento dal pannello destro", () => {
    render(<App />); const inspector = screen.getByRole("complementary", { name: "Inspector" }); fireEvent.click(within(inspector).getByRole("button", { name: "Grancassa" })); const type = screen.getByLabelText("Nuovo tipo"); expect(within(type).getByRole("option", { name: "Pianoforte" })).toBeInTheDocument(); expect(within(type).getByRole("option", { name: "Chitarra / corde" })).toBeInTheDocument(); expect(within(type).getByRole("option", { name: "Violino / archi" })).toBeInTheDocument(); fireEvent.change(type, { target: { value: "cymbal" } }); expect(useSceneStore.getState().objects[0]).toMatchObject({ type: "cymbal", name: "Piatto", color: "#e94f70" });
  });
  it("cambia live l'oggetto del rimbalzo dalla timeline senza rigenerare", () => { const project = useProjectStore.getState(); project.attachAudio({ path: "track.wav", fileName: "track.wav", hash: "d".repeat(64), durationSeconds: 10, sampleRate: 48_000, channels: 2, codec: "pcm", fileSize: 100 }, []); useProjectStore.getState().addEvent(1); render(<App />); const selector = screen.getByLabelText("Oggetto del rimbalzo"); expect(within(selector).getByRole("option", { name: "Pianoforte" })).toBeInTheDocument(); fireEvent.change(selector, { target: { value: "piano" } }); expect(useSceneStore.getState().objects[0]).toMatchObject({ type: "piano", color: "#e94f70" }); expect(useProjectStore.getState().project.events[0]).toMatchObject({ assignedObjectType: "piano", assignedObjectId: "kick-1" }); });
  it("mostra Instrumental Falling e configura gli elementi della base", () => { render(<App />); const modes = screen.getByRole("complementary", { name: "Modalità animazione" }); expect(within(modes).getByRole("combobox", { name: "Modalità animazione" })).toHaveValue("instrumentalFalling"); const piano = within(modes).getByRole("checkbox", { name: /Pianoforte/ }); expect(piano).not.toBeChecked(); fireEvent.click(piano); expect(useProjectStore.getState().project.animation.baseObjectTypes).toContain("piano"); expect(within(modes).getByRole("checkbox", { name: /Chitarra \/ corde/ })).toBeInTheDocument(); expect(within(modes).getByRole("checkbox", { name: /Violino \/ archi/ })).toBeInTheDocument(); });
  it("rimuove la modalità duplicata Add Subtitles e conserva Pro Subtitles", () => { render(<App />); const modes = screen.getByRole("complementary", { name: "Modalità animazione" }); const picker = within(modes).getByRole("combobox", { name: "Modalità animazione" }); expect(within(picker).queryByRole("option", { name: "Add Subtitles" })).not.toBeInTheDocument(); expect(within(picker).getByRole("option", { name: "Pro Subtitles" })).toBeInTheDocument(); });
  it("isola ProSubtitles e collega frase, animazione, palette e stile per parola", () => {
    const store = useProjectStore.getState();
    store.setAnimationMode("proSubtitles", ["platform"]);
    store.attachAudio({ path: "guide.mp4", fileName: "guide.mp4", hash: "8".repeat(64), durationSeconds: 12, sampleRate: 48_000, channels: 2, codec: "aac", fileSize: 100 }, []);
    useProjectStore.getState().updateProSubtitles({ videoUrl: "blob:guide", videoName: "guide.mp4" });
    useProjectStore.getState().setSubtitleCues([{ id: "pro-cue", startSeconds: 1, endSeconds: 3, text: "HELLO WORLD", confidence: 1, verified: true, manual: true }]);
    render(<App />);
    const modes = screen.getByRole("complementary", { name: "Modalità animazione" });
    const timeline = screen.getByRole("region", { name: "Timeline musicale" });
    expect(within(modes).getByText("1 · Video guida")).toBeInTheDocument();
    fireEvent.click(within(timeline).getByRole("button", { name: /^Sottotitolo HELLO WORLD,/ }), { detail: 0 });
    expect(within(modes).getByText("Stile per parola")).toBeInTheDocument();
    expect(within(modes).getAllByLabelText(/^Colore palette /)).toHaveLength(3);
    expect(within(timeline).getByLabelText(/^Animazione /)).toBeInTheDocument();
    expect(screen.getByText("Layer professionale")).toBeInTheDocument();
    expect(screen.queryByText("Sfondo e ambiente")).not.toBeInTheDocument();
    fireEvent.change(within(modes).getByLabelText("Colore personalizzato HELLO"), { target: { value: "#ef476f" } });
    expect(useProjectStore.getState().project.animation.proSubtitles.cueStyles.find((style) => style.cueId === "pro-cue")?.wordStyles[0]).toMatchObject({ index: 0, color: "#ef476f" });
  });
  it("renderizza sempre il layer ProSubtitles anche se il flag globale dei vecchi sottotitoli è spento", () => {
    const store = useProjectStore.getState();
    store.setAnimationMode("proSubtitles", ["platform"]);
    store.updateSubtitles({ enabled: false });
    render(<App />);
    expect(viewportMock.props?.subtitles?.enabled).toBe(true);
    expect(useProjectStore.getState().project.subtitles.enabled).toBe(false);
  });
  it("inserisce e salva blocchi manuali nella libreria riutilizzabile", () => { useProjectStore.getState().attachAudio({ path: "voice.wav", fileName: "voice.wav", hash: "f".repeat(64), durationSeconds: 20, sampleRate: 48_000, channels: 1, codec: "pcm", fileSize: 100 }, []); render(<App />); expect(screen.getByText("Blocchi manuali e libreria")).toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: /Inserisci blocco al playhead/ })); const text = screen.getByLabelText("Testo sottotitolo"); fireEvent.change(text, { target: { value: "Blocco riutilizzabile" } }); fireEvent.click(screen.getByRole("button", { name: "Salva blocchi e stile nella libreria" })); expect(screen.getByRole("combobox", { name: "Traccia sottotitoli salvata" })).toHaveTextContent("Progetto senza titolo · 1 blocco"); expect(localStorage.getItem("dynamic-sound-animation-studio.subtitle-library.v1")).toContain("Blocco riutilizzabile"); });
  it("mantiene compatibili i controlli dei vecchi progetti New York Streets", () => { useProjectStore.getState().setAnimationMode("newYorkStreets", ["pebble"]); render(<App />); const modes = screen.getByRole("complementary", { name: "Modalità animazione" }); expect(within(modes).getByText("Gara di biglie")).toBeInTheDocument(); const count = within(modes).getByLabelText("Numero di sfere secondarie"); fireEvent.change(count, { target: { value: "13" } }); expect(useProjectStore.getState().project.animation.newYorkStreets.secondaryMarbleCount).toBe(13); fireEvent.change(within(modes).getByLabelText("Colore di tutte le sfere secondarie"), { target: { value: "#123456" } }); expect(useProjectStore.getState().project.animation.newYorkStreets.secondaryColors).toHaveLength(13); expect(within(modes).getByLabelText("Colore sfera secondaria 13")).toHaveValue("#123456"); expect(within(modes).getByLabelText("Carica volantini")).toHaveAttribute("multiple"); });
  it("mostra poster, palette, atmosfera e controlli vocali di Teddy Sing", () => { render(<App />); const modes = screen.getByRole("complementary", { name: "Modalità animazione" }); fireEvent.change(within(modes).getByRole("combobox", { name: "Modalità animazione" }), { target: { value: "teddySing" } }); expect(within(modes).getByText("Lip sync 3D")).toBeInTheDocument(); expect(within(modes).getByText("Importa la traccia vocale isolata.", { exact: false })).toBeInTheDocument(); fireEvent.change(within(modes).getByLabelText("Intensità lip sync Teddy Sing"), { target: { value: "1.4" } }); fireEvent.change(within(modes).getByLabelText("Colore LED Teddy Sing"), { target: { value: "#22aaff" } }); fireEvent.change(within(modes).getByLabelText("Colore particelle Teddy Sing"), { target: { value: "#ffaa33" } }); fireEvent.change(within(modes).getByLabelText("Densità particelle Teddy Sing"), { target: { value: "1.8" } }); expect(useProjectStore.getState().project.animation.teddySing).toMatchObject({ lipSyncIntensity: 1.4, ledColor: "#22aaff", particlesEnabled: true, particleColor: "#ffaa33", particleDensity: 1.8 }); });
  it("espone Stereo Unfold con apertura, pieghe, campo ed effetti stereo configurabili", () => { render(<App />); const modes = screen.getByRole("complementary", { name: "Modalità animazione" }); const picker = within(modes).getByRole("combobox", { name: "Modalità animazione" }); expect(within(picker).getByRole("option", { name: "Stereo Unfold" })).toBeInTheDocument(); fireEvent.change(picker, { target: { value: "stereoUnfold" } }); expect(within(modes).getByText("Cover fisica")).toBeInTheDocument(); expect(within(modes).getByText("Campo spettrale stereo")).toBeInTheDocument(); expect(within(modes).getByText("Effetti stereo in primo piano")).toBeInTheDocument(); expect(within(modes).getByText("Effetti a tutto schermo")).toBeInTheDocument(); fireEvent.change(within(modes).getByLabelText("Durata apertura Stereo Unfold"), { target: { value: "3.2" } }); fireEvent.change(within(modes).getByLabelText("Pieghe residue Stereo Unfold"), { target: { value: ".72" } }); fireEvent.change(within(modes).getByLabelText("Stile spettro Stereo Unfold"), { target: { value: "prisms" } }); fireEvent.click(within(modes).getByLabelText("Particelle stereo")); fireEvent.click(within(modes).getByLabelText("Raggi cromatici")); fireEvent.change(within(modes).getByLabelText("Intensità effetti Stereo Unfold"), { target: { value: "1.6" } }); expect(useProjectStore.getState().project.animation.stereoUnfold).toMatchObject({ unfoldDuration: 3.2, residualCrease: .72, spectrumStyle: "prisms", effectIntensity: 1.6, effects: { particles: false, lightTrails: true, pulseRings: true, fullScreenWaves: true, lightRays: false, chromaDust: true } }); });
  it("espone Cube Animation con cubo, sfondo, vetro, spettrogramma e increspature", () => { render(<App />); const modes = screen.getByRole("complementary", { name: "Modalità animazione" }); const picker = within(modes).getByRole("combobox", { name: "Modalità animazione" }); expect(within(picker).getByRole("option", { name: "Cube Animation" })).toBeInTheDocument(); fireEvent.change(picker, { target: { value: "walkingCube" } }); expect(within(modes).getByText("Immagine sulle sei facce")).toBeInTheDocument(); expect(within(modes).getByLabelText("Carica immagine Cube Animation")).toBeInTheDocument(); expect(within(modes).getByLabelText("Carica sfondo Cube Animation")).toBeInTheDocument(); expect(within(modes).getByLabelText("Intensità spettrogramma Cube Animation")).toBeInTheDocument(); expect(within(modes).getByLabelText("Intensità increspature Cube Animation")).toBeInTheDocument(); expect(within(modes).getByText("Composizione centrale pulita")).toBeInTheDocument(); });
  it("espone From 9:16 to 16:9 con sorgenti separate, spettro, cubo ed effetti a livelli", () => {
    render(<App />); const modes = screen.getByRole("complementary", { name: "Modalità animazione" }); const picker = within(modes).getByRole("combobox", { name: "Modalità animazione" });
    expect(within(picker).getByRole("option", { name: "From 9:16 to 16:9" })).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: "portraitLandscape" } });
    expect(within(modes).getByLabelText("Carica video From 9:16 to 16:9")).toBeInTheDocument();
    expect(within(modes).getByLabelText("Carica immagine laterale 9:16")).toBeInTheDocument();
    expect(within(modes).getByLabelText("Carica cover From 9:16 to 16:9")).toBeInTheDocument();
    expect(within(modes).getByLabelText("Lato immagine originale")).toHaveValue("left");
    expect(within(modes).getByLabelText("Intensità spettro 9:16 to 16:9")).toBeInTheDocument();
    expect(within(modes).getByLabelText("Cadenza rotazione cubo 9:16 to 16:9")).toHaveValue("8");
    expect(within(modes).getByLabelText("Velocità movimento cubo 9:16 to 16:9")).toBeInTheDocument();
    expect(within(modes).getByLabelText("Velocità rotazione cubo 9:16 to 16:9")).toHaveValue("1");
    expect(within(modes).getByLabelText("Palette barre spettrogramma 9:16 to 16:9")).toHaveValue("cover");
    fireEvent.change(within(modes).getByLabelText("Palette barre spettrogramma 9:16 to 16:9"), { target: { value: "sideImage" } });
    expect(useProjectStore.getState().project.animation.portraitLandscape.spectrumPaletteSource).toBe("sideImage");
    fireEvent.change(within(modes).getByLabelText("Colore manuale barre spettrogramma 1"), { target: { value: "#123456" } });
    expect(useProjectStore.getState().project.animation.portraitLandscape).toMatchObject({ spectrumPaletteSource: "manual", spectrumManualPalette: ["#123456", "#ffffff", "#181317"] });
    fireEvent.click(within(modes).getByLabelText("Pioggia realistica 9:16 to 16:9"));
    fireEvent.change(within(modes).getByLabelText("Opacità Pioggia realistica"), { target: { value: ".64" } });
    expect(useProjectStore.getState().project.animation.portraitLandscape).toMatchObject({ effects: { rain: true }, effectOpacity: { rain: .64 } });
    const timeline = screen.getByRole("region", { name: "Timeline musicale" });
    expect(within(timeline).getByRole("separator", { name: "Ridimensiona altezza timeline" })).toBeInTheDocument();
    expect(within(timeline).getAllByText("Pioggia").length).toBeGreaterThan(0);
    expect(within(timeline).getByRole("button", { name: "Sposta Video 9:16 sopra" })).toBeInTheDocument();
    expect(within(timeline).getByRole("button", { name: "Sposta Cubo 3D sopra" })).toBeInTheDocument();
    fireEvent.click(within(timeline).getByRole("button", { name: "Sposta Pioggia sotto" }));
    const reordered = useProjectStore.getState().project.animation.portraitLandscape.layerOrder;
    expect(reordered.indexOf("rain")).toBeLessThan(reordered.indexOf("spectrum"));
    act(() => useProjectStore.getState().updatePortraitLandscape({ sideImageUrl: "data:image/png;base64,c2lkZQ==" }));
    fireEvent.click(within(modes).getByRole("button", { name: "Modifica immagine specchiata" }));
    expect(screen.getByRole("dialog", { name: "Immagine specchiata" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Contrasto immagine specchiata"), { target: { value: "1.35" } });
    expect(useProjectStore.getState().project.animation.portraitLandscape.sideImageAdjustments.contrast).toBe(1.35);
    expect(screen.getByRole("main", { name: "Vista From 9:16 to 16:9" })).toBeInTheDocument();
    expect(screen.getByText("Composizione 16:9", { selector: ".portrait-landscape-inspector h2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analizza" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Importa audio" })).not.toBeInTheDocument();
  });
  it("espone Pixels Subtitles con cover protetta, cornice audio, ombra e pipeline sottotitoli locale", () => {
    render(<App />); const modes = screen.getByRole("complementary", { name: "Modalità animazione" }); const picker = within(modes).getByRole("combobox", { name: "Modalità animazione" });
    for (const name of ["Pro Subtitles", "Pixels Subtitles"]) expect(within(picker).getByRole("option", { name })).toBeInTheDocument();
    expect(within(picker).queryByRole("option", { name: "Add Subtitles" })).not.toBeInTheDocument();
    expect(within(picker).queryByRole("option", { name: "ProSubtitles" })).not.toBeInTheDocument();
    expect(within(picker).queryByRole("option", { name: "PixelsSub" })).not.toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: "Pixels Subtitles" })).toBeInTheDocument(); fireEvent.change(picker, { target: { value: "pixelsSub" } });
    expect(within(modes).getByLabelText("Carica immagine PixelsSub")).toBeInTheDocument();
    expect(within(modes).getAllByLabelText(/Colore [123] PixelsSub/)).toHaveLength(3);
    expect(within(modes).getByLabelText("Dimensione pixel PixelsSub")).toHaveValue("27");
    expect(within(modes).getByLabelText("Font sottotitoli PixelsSub").querySelectorAll("option")).toHaveLength(6);
    expect(within(modes).getByLabelText("Importa sottotitoli PixelsSub")).toBeDisabled();
    expect(within(modes).getByRole("combobox", { name: "Modello Whisper locale" })).toBeInTheDocument();
    expect(within(modes).getByRole("combobox", { name: "Modello LLM locale" })).toBeInTheDocument();
    expect(screen.getByText("Cover con cornice pixel")).toBeInTheDocument();
    expect(screen.queryByText("Sfera in vetro")).not.toBeInTheDocument();
    fireEvent.change(within(modes).getByLabelText("Dimensione pixel PixelsSub"), { target: { value: "18" } });
    fireEvent.change(within(modes).getByLabelText("Colore 2 PixelsSub"), { target: { value: "#ff3366" } });
    fireEvent.change(within(modes).getByLabelText("Colore testo PixelsSub"), { target: { value: "2" } });
    fireEvent.change(within(modes).getByLabelText("Font sottotitoli PixelsSub"), { target: { value: "Silkscreen" } });
    fireEvent.change(within(modes).getByLabelText("Colore ombra PixelsSub"), { target: { value: "#001122" } });
    expect(useProjectStore.getState().project.animation.pixelsSub).toMatchObject({ pixelSize: 18, palette: ["#000000", "#ff3366", "#ed75a7"], autoPalette: false, subtitleColorIndex: 2, subtitleFontFamily: "Silkscreen", subtitleShadowEnabled: true, subtitleShadowColor: "#001122" });
  });
  it("sincronizza cover e sfondo della Cube Animation da entrambi i pannelli", async () => {
    render(<App />);
    const modes = screen.getByRole("complementary", { name: "Modalità animazione" });
    fireEvent.change(within(modes).getByRole("combobox", { name: "Modalità animazione" }), { target: { value: "walkingCube" } });
    useProjectStore.getState().updateWalkingCube({ autoPalette: false });
    const cover = new File(["cover"], "cover.png", { type: "image/png" });
    fireEvent.change(within(modes).getByLabelText("Carica immagine Cube Animation"), { target: { files: [cover] } });
    await waitFor(() => expect(useProjectStore.getState().project.animation.walkingCube.imageUrl).toMatch(/^data:image\/png;base64,/));
    expect(useProjectStore.getState().project.animation.walkingCube.autoPalette).toBe(true);
    const coverUrl = useProjectStore.getState().project.animation.walkingCube.imageUrl;
    expect(useSceneStore.getState().ball.innerImageUrl).toBeNull();

    const sceneBackground = new File(["scene-background"], "scene-background.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Carica foto o video di sfondo"), { target: { files: [sceneBackground] } });
    await waitFor(() => expect(useProjectStore.getState().project.animation.walkingCube.backgroundImageUrl).toMatch(/^data:image\/png;base64,/));
    expect(useSceneStore.getState().background.imageUrl).toBe(useProjectStore.getState().project.animation.walkingCube.backgroundImageUrl);
    expect(useProjectStore.getState().project.animation.walkingCube.imageUrl).toBe(coverUrl);
    expect(useProjectStore.getState().project.animation.walkingCube.backgroundImageUrl).not.toBe(coverUrl);

    const cubeBackground = new File(["cube-background"], "cube-background.webp", { type: "image/webp" });
    fireEvent.change(within(modes).getByLabelText("Carica sfondo Cube Animation"), { target: { files: [cubeBackground] } });
    await waitFor(() => expect(useProjectStore.getState().project.animation.walkingCube.backgroundImageUrl).toMatch(/^data:image\/webp;base64,/));
    expect(useSceneStore.getState().background).toMatchObject({ imageUrl: useProjectStore.getState().project.animation.walkingCube.backgroundImageUrl, mediaType: "image", opacity: 1, blur: 0 });
    expect(useProjectStore.getState().project.animation.walkingCube.imageUrl).toBe(coverUrl);
    expect(useProjectStore.getState().project.animation.walkingCube.backgroundImageUrl).not.toBe(coverUrl);
  });
  it("mantiene la luce personalizzata disponibile in entrambe le modalità", () => { render(<App />); const enabled = screen.getByRole("checkbox", { name: "Inserisci la luce nella scena" }); fireEvent.click(enabled); fireEvent.change(screen.getByLabelText("Colore luce"), { target: { value: "#33aaff" } }); fireEvent.change(screen.getByLabelText("Intensità luce"), { target: { value: "72" } }); fireEvent.change(screen.getByLabelText("Densità fascio"), { target: { value: ".68" } }); fireEvent.change(screen.getByLabelText("Estensione fascio"), { target: { value: "3" } }); fireEvent.click(screen.getAllByRole("button", { name: "Scegli nella scena" })[0]!); expect(screen.getByRole("checkbox", { name: "Segui la biglia per tutto il percorso" })).toBeChecked(); expect(screen.getByRole("checkbox", { name: "Luce attiva per tutto il video" })).toBeChecked(); expect(useSceneStore.getState().light).toMatchObject({ enabled: true, color: "#33aaff", intensity: 72, beamVisible: true, beamDensity: .68, beamLengthMultiplier: 3, followBall: true, activeUntilSeconds: null }); expect(useSceneStore.getState().lightPickMode).toBe("origin"); const modes = screen.getByRole("complementary", { name: "Modalità animazione" }); fireEvent.change(within(modes).getByRole("combobox", { name: "Modalità animazione" }), { target: { value: "newYorkStreets" } }); expect(screen.getByRole("checkbox", { name: "Inserisci la luce nella scena" })).toBeChecked(); expect(screen.getByLabelText("Colore luce")).toHaveValue("#33aaff"); });
  it("isola il layout del Video Editor dalla timeline musicale e conserva la preview montata durante il resize", async () => {
    const musicKey = "dynamic-sound-animation-studio.timeline-height.v1";
    const videoKey = "dynamic-sound-animation-studio.video-editor.timeline-height.v1";
    localStorage.setItem(musicKey, "190");
    localStorage.setItem(videoKey, "240");
    useProjectStore.getState().setAnimationMode("videoEditor", ["platform"]);
    render(<App />);
    expect(screen.getByRole("region", { name: "Timeline Video Editor" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Timeline musicale" })).not.toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Ridimensiona altezza timeline" })).toHaveAttribute("aria-valuenow", "240");
    expect(videoEditorPreviewMock.mounts).toBe(1);
    fireEvent.keyDown(screen.getByRole("separator", { name: "Ridimensiona altezza timeline" }), { key: "ArrowDown" });
    await waitFor(() => expect(localStorage.getItem(videoKey)).toBe("220"));
    expect(localStorage.getItem(musicKey)).toBe("190");
    expect(videoEditorPreviewMock.mounts).toBe(1);
  });
});
