import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "./Timeline";

describe("Timeline", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it("controlla play, stop e seek", () => {
    const play = vi.fn(); const stop = vi.fn(); const seek = vi.fn();
    render(<Timeline peaks={[]} events={[]} beats={[]} selectedEventId={null} selectedEventIds={[]} currentTime={10} duration={60} playing={false} looping={false} onPlayPause={play} onStop={stop} onSeek={seek} onLoop={vi.fn()} onSelectEvent={vi.fn()} onAddEvent={vi.fn()} onMoveEvent={vi.fn()} onDeleteEvent={vi.fn()} onDeleteEvents={vi.fn()} />);
    fireEvent.click(screen.getByText("▶")); fireEvent.click(screen.getByText("■")); fireEvent.click(screen.getByText("↶ 5"));
    expect(play).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce(); expect(seek).toHaveBeenCalledWith(5);
  });
  it("aggiunge un elemento dai beat vuoti e cancella una selezione multipla", () => { const add = vi.fn(); const remove = vi.fn(); const events = [{ id: "a", timeSeconds: 1, eventType: "kick", strength: .8, enabled: true, action: "collision" }, { id: "b", timeSeconds: 2, eventType: "snare", strength: .7, enabled: true, action: "collision" }]; render(<Timeline peaks={[]} events={events} beats={[1, 1.5, 2]} selectedEventId="b" selectedEventIds={["a", "b"]} currentTime={0} duration={3} playing={false} looping={false} onPlayPause={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()} onLoop={vi.fn()} onSelectEvent={vi.fn()} onAddEvent={add} onMoveEvent={vi.fn()} onDeleteEvent={vi.fn()} onDeleteEvents={remove} />); fireEvent.click(screen.getByRole("button", { name: "Aggiungi elemento sul beat 2" })); expect(add).toHaveBeenCalledWith(1.5); fireEvent.click(screen.getByRole("button", { name: "Elimina 2" })); expect(remove).toHaveBeenCalledWith(["a", "b"]); });
  it("mostra, divide ed elimina i fonemi selezionati", () => {
    const split = vi.fn(); const remove = vi.fn(); const select = vi.fn();
    render(<Timeline peaks={[]} events={[]} beats={[]} showPhonemes phonemes={[{ id: "voice-a", startSeconds: .5, endSeconds: 1.2, viseme: "A", confidence: .86, manual: false }]} selectedPhonemeId="voice-a" selectedEventId={null} selectedEventIds={[]} currentTime={.8} duration={2} playing={false} looping={false} onPlayPause={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()} onLoop={vi.fn()} onSelectPhoneme={select} onDeletePhoneme={remove} onSplitPhoneme={split} onSelectEvent={vi.fn()} onAddEvent={vi.fn()} onMoveEvent={vi.fn()} onDeleteEvent={vi.fn()} onDeleteEvents={vi.fn()} />);
    expect(screen.getByText("Fonemi")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fonema A da 0.500 a 1.200 secondi" }));
    expect(select).toHaveBeenCalledWith("voice-a");
    fireEvent.click(screen.getByRole("button", { name: "Dividi A" }));
    expect(split).toHaveBeenCalledWith("voice-a", .8);
    fireEvent.click(screen.getByRole("button", { name: "Elimina fonema" }));
    expect(remove).toHaveBeenCalledWith("voice-a");
  });
  it("mantiene la corsia sottotitoli vuota e aggiunge un blocco al playhead", () => {
    const addSubtitle = vi.fn();
    render(<Timeline peaks={[]} events={[]} beats={[]} subtitles={[]} selectedEventId={null} selectedEventIds={[]} currentTime={7.5} duration={20} playing={false} looping={false} onPlayPause={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()} onLoop={vi.fn()} onAddSubtitle={addSubtitle} onSelectEvent={vi.fn()} onAddEvent={vi.fn()} onMoveEvent={vi.fn()} onDeleteEvent={vi.fn()} onDeleteEvents={vi.fn()} />);
    expect(screen.getByText("Sottotitoli")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Sottotitolo" }));
    expect(addSubtitle).toHaveBeenCalledWith(7.5);
  });
  it("mostra la pila dei livelli e consente di spostare anche video e cubo", () => {
    const moveLayer = vi.fn();
    render(<Timeline peaks={[]} events={[]} beats={[]} compositorLayers={[{ id: "rain", label: "Pioggia", color: "#89cfff", locked: false, opacity: .72 }, { id: "centerVideo", label: "Video 9:16", color: "#ffffff", locked: false, opacity: 1 }, { id: "cube", label: "Cubo 3D", color: "#ed75a7", locked: false, opacity: 1 }]} selectedEventId={null} selectedEventIds={[]} currentTime={2} duration={10} playing={false} looping={false} onPlayPause={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()} onLoop={vi.fn()} onSelectEvent={vi.fn()} onAddEvent={vi.fn()} onMoveEvent={vi.fn()} onDeleteEvent={vi.fn()} onDeleteEvents={vi.fn()} onMoveCompositorLayer={moveLayer} />);
    expect(screen.getAllByText("Video 9:16").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Sposta Pioggia sotto" }));
    expect(moveLayer).toHaveBeenCalledWith("rain", "down");
    fireEvent.click(screen.getByRole("button", { name: "Sposta Video 9:16 sopra" }));
    expect(moveLayer).toHaveBeenCalledWith("centerVideo", "up");
    expect(screen.getByRole("button", { name: "Sposta Cubo 3D sopra" })).toBeInTheDocument();
    expect(document.querySelectorAll(".compositor-layer-lane")).toHaveLength(3);
  });
  it("allarga e stringe la timeline dalla maniglia superiore", () => {
    const resize = vi.fn();
    render(<Timeline peaks={[]} events={[]} beats={[]} timelineHeight={270} onResizeHeight={resize} selectedEventId={null} selectedEventIds={[]} currentTime={0} duration={10} playing={false} looping={false} onPlayPause={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()} onLoop={vi.fn()} onSelectEvent={vi.fn()} onAddEvent={vi.fn()} onMoveEvent={vi.fn()} onDeleteEvent={vi.fn()} onDeleteEvents={vi.fn()} />);
    const handle = screen.getByRole("separator", { name: "Ridimensiona altezza timeline" });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(resize).toHaveBeenCalledWith(290);
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(resize).toHaveBeenCalledWith(250);
    fireEvent.doubleClick(handle);
    expect(resize).toHaveBeenCalledWith(270);
  });
  it("ridimensiona i cue dalle due maniglie rispettando un frame minimo e la durata totale", () => {
    const resize = vi.fn();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20, toJSON: () => ({})
    });
    render(<Timeline peaks={[]} events={[]} beats={[]} subtitles={[{ id: "subtitle-a", startSeconds: 2, endSeconds: 4, text: "Testo animato", verified: true, manual: true }]} selectedSubtitleId="subtitle-a" selectedEventId={null} selectedEventIds={[]} currentTime={2} duration={10} playing={false} looping={false} onPlayPause={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()} onLoop={vi.fn()} onResizeSubtitle={resize} onSelectEvent={vi.fn()} onAddEvent={vi.fn()} onMoveEvent={vi.fn()} onDeleteEvent={vi.fn()} onDeleteEvents={vi.fn()} />);

    const startHandle = screen.getByRole("button", { name: "Ridimensiona inizio sottotitolo Testo animato" });
    fireEvent.pointerDown(startHandle, { clientX: 20 });
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true, clientX: 100 }));
    expect(resize).toHaveBeenNthCalledWith(1, "subtitle-a", 4 - 1 / 30, 4);

    const endHandle = screen.getByRole("button", { name: "Ridimensiona fine sottotitolo Testo animato" });
    fireEvent.pointerDown(endHandle, { clientX: 40 });
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true, clientX: -20 }));
    expect(resize).toHaveBeenNthCalledWith(2, "subtitle-a", 2, 2 + 1 / 30);

    fireEvent.pointerDown(endHandle, { clientX: 40 });
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true, clientX: 160 }));
    expect(resize).toHaveBeenNthCalledWith(3, "subtitle-a", 2, 10);
  });
  it("mostra badge animazione e tre swatch colore nel blocco sottotitolo", () => {
    render(<Timeline peaks={[]} events={[]} beats={[]} subtitles={[{ id: "subtitle-style", startSeconds: 1, endSeconds: 4, text: "Kinetic words", verified: false, manual: true, animationLabel: "Sweep Through", accentColors: ["#ff3366", "#4de8ff", "#ffe45e"] }]} selectedEventId={null} selectedEventIds={[]} currentTime={1} duration={8} playing={false} looping={false} onPlayPause={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()} onLoop={vi.fn()} onSelectEvent={vi.fn()} onAddEvent={vi.fn()} onMoveEvent={vi.fn()} onDeleteEvent={vi.fn()} onDeleteEvents={vi.fn()} />);

    expect(screen.getByLabelText("Animazione Sweep Through")).toHaveTextContent("Sweep Through");
    const palette = screen.getByLabelText("Palette accenti sottotitolo");
    expect(within(palette).getAllByRole("img")).toHaveLength(3);
    expect(within(palette).getByLabelText("Colore accento 1: #ff3366")).toHaveStyle({ backgroundColor: "#ff3366" });
    expect(within(palette).getByLabelText("Colore accento 3: #ffe45e")).toHaveStyle({ backgroundColor: "#ffe45e" });
  });
  it("seleziona un cue anche con l'attivazione da tastiera ed espone lo stato selezionato", () => {
    const select = vi.fn();
    const cue = { id: "subtitle-keyboard", startSeconds: 1, endSeconds: 1.03, text: "Scelta tastiera", verified: true, manual: true };
    const { rerender } = render(<Timeline peaks={[]} events={[]} beats={[]} subtitles={[cue]} selectedSubtitleId={null} selectedEventId={null} selectedEventIds={[]} currentTime={1} duration={10} playing={false} looping={false} onPlayPause={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()} onLoop={vi.fn()} onSelectSubtitle={select} onResizeSubtitle={vi.fn()} onSelectEvent={vi.fn()} onAddEvent={vi.fn()} onMoveEvent={vi.fn()} onDeleteEvent={vi.fn()} onDeleteEvents={vi.fn()} />);
    const body = screen.getByRole("button", { name: "Sottotitolo Scelta tastiera, da 1.000 a 1.030 secondi" });
    expect(body).toHaveAttribute("aria-selected", "false");
    fireEvent.click(body, { detail: 0 });
    expect(select).toHaveBeenCalledWith("subtitle-keyboard");

    rerender(<Timeline peaks={[]} events={[]} beats={[]} subtitles={[cue]} selectedSubtitleId="subtitle-keyboard" selectedEventId={null} selectedEventIds={[]} currentTime={1} duration={10} playing={false} looping onPlayPause={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()} onLoop={vi.fn()} onSelectSubtitle={select} onResizeSubtitle={vi.fn()} onSelectEvent={vi.fn()} onAddEvent={vi.fn()} onMoveEvent={vi.fn()} onDeleteEvent={vi.fn()} onDeleteEvents={vi.fn()} />);
    expect(body).toHaveAttribute("aria-selected", "true");
    expect(body.parentElement).toHaveStyle({ minWidth: "52px" });
    expect(screen.getByRole("button", { name: "Ridimensiona inizio sottotitolo Scelta tastiera" })).toHaveStyle({ width: "24px" });
    expect(screen.getByRole("button", { name: "Ridimensiona fine sottotitolo Scelta tastiera" })).toHaveStyle({ width: "24px" });
    expect(screen.getByRole("button", { name: "Loop" })).toHaveAttribute("aria-pressed", "true");
  });
  it("non cancella da controlli interattivi e previene il default quando cancella dalla timeline", () => {
    const remove = vi.fn();
    render(<Timeline peaks={[]} events={[]} beats={[]} subtitles={[{ id: "subtitle-delete", startSeconds: 1, endSeconds: 2, text: "Da proteggere", verified: true, manual: true }]} selectedSubtitleId="subtitle-delete" selectedEventId={null} selectedEventIds={[]} currentTime={1} duration={10} playing={false} looping={false} onPlayPause={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()} onLoop={vi.fn()} onDeleteSubtitle={remove} onSelectEvent={vi.fn()} onAddEvent={vi.fn()} onMoveEvent={vi.fn()} onDeleteEvent={vi.fn()} onDeleteEvents={vi.fn()} />);

    fireEvent.keyDown(screen.getByLabelText("Zoom timeline"), { key: "Delete" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Loop" }), { key: "Backspace" });
    expect(remove).not.toHaveBeenCalled();

    const timeline = screen.getByRole("region", { name: "Timeline musicale" });
    const deletion = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    fireEvent(timeline, deletion);
    expect(remove).toHaveBeenCalledWith("subtitle-delete");
    expect(deletion.defaultPrevented).toBe(true);
  });
  it("annulla il drag su pointercancel o lost capture senza applicare spostamenti tardivi", () => {
    const move = vi.fn();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20, toJSON: () => ({})
    });
    render(<Timeline peaks={[]} events={[]} beats={[]} subtitles={[{ id: "subtitle-cancel", startSeconds: 1, endSeconds: 2, text: "Drag sicuro", verified: true, manual: true }]} selectedSubtitleId="subtitle-cancel" selectedEventId={null} selectedEventIds={[]} currentTime={1} duration={10} playing={false} looping={false} onPlayPause={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()} onLoop={vi.fn()} onSelectSubtitle={vi.fn()} onMoveSubtitle={move} onResizeSubtitle={vi.fn()} onSelectEvent={vi.fn()} onAddEvent={vi.fn()} onMoveEvent={vi.fn()} onDeleteEvent={vi.fn()} onDeleteEvents={vi.fn()} />);
    const body = screen.getByRole("button", { name: "Sottotitolo Drag sicuro, da 1.000 a 2.000 secondi" });

    fireEvent.pointerDown(body, { clientX: 10 });
    fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientX: 40 }));
    fireEvent(window, new MouseEvent("pointercancel", { bubbles: true, clientX: 40 }));
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true, clientX: 70 }));
    expect(move).not.toHaveBeenCalled();

    fireEvent.pointerDown(body, { clientX: 10 });
    fireEvent(body, new Event("lostpointercapture"));
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true, clientX: 70 }));
    expect(move).not.toHaveBeenCalled();
  });
  it("rimuove i listener di drag quando la timeline viene smontata", () => {
    const move = vi.fn();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20, toJSON: () => ({})
    });
    const { unmount } = render(<Timeline peaks={[]} events={[]} beats={[]} subtitles={[{ id: "subtitle-unmount", startSeconds: 1, endSeconds: 2, text: "Unmount", verified: true, manual: true }]} selectedSubtitleId="subtitle-unmount" selectedEventId={null} selectedEventIds={[]} currentTime={1} duration={10} playing={false} looping={false} onPlayPause={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()} onLoop={vi.fn()} onMoveSubtitle={move} onResizeSubtitle={vi.fn()} onSelectEvent={vi.fn()} onAddEvent={vi.fn()} onMoveEvent={vi.fn()} onDeleteEvent={vi.fn()} onDeleteEvents={vi.fn()} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Sottotitolo Unmount, da 1.000 a 2.000 secondi" }), { clientX: 10 });
    unmount();
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true, clientX: 70 }));
    expect(move).not.toHaveBeenCalled();
  });
  it("dispone deterministicamente i cue sovrapposti su corsie separate", () => {
    render(<Timeline peaks={[]} events={[]} beats={[]} subtitleOnly subtitles={[
      { id: "lane-c", startSeconds: 1, endSeconds: 3, text: "Corsia C", verified: true, manual: true },
      { id: "lane-a", startSeconds: 0, endSeconds: 3, text: "Corsia A", verified: true, manual: true },
      { id: "lane-b", startSeconds: 1, endSeconds: 2, text: "Corsia B", verified: true, manual: true },
      { id: "lane-d", startSeconds: 3, endSeconds: 4, text: "Corsia D", verified: true, manual: true }
    ]} selectedEventId={null} selectedEventIds={[]} currentTime={0} duration={5} playing={false} looping={false} onPlayPause={vi.fn()} onStop={vi.fn()} onSeek={vi.fn()} onLoop={vi.fn()} onSelectEvent={vi.fn()} onAddEvent={vi.fn()} onMoveEvent={vi.fn()} onDeleteEvent={vi.fn()} onDeleteEvents={vi.fn()} />);

    const cueElement = (text: string) => screen.getByRole("button", { name: new RegExp(`^Sottotitolo ${text},`) }).parentElement;
    expect(cueElement("Corsia A")).toHaveStyle({ top: "3px", height: "21px" });
    expect(cueElement("Corsia B")).toHaveStyle({ top: "30px", height: "21px" });
    expect(cueElement("Corsia C")).toHaveStyle({ top: "57px", height: "21px" });
    expect(cueElement("Corsia D")).toHaveStyle({ top: "3px", height: "21px" });
    expect(document.querySelector(".subtitle-lane")).toHaveStyle({ height: "81px" });
    expect(document.querySelector(".tracks")).toHaveClass("has-stacked-subtitles");
  });
});
