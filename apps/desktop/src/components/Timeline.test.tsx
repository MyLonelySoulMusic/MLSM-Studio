import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "./Timeline";

describe("Timeline", () => {
  afterEach(cleanup);
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
});
