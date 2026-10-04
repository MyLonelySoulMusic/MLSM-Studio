import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveTranscriptPanel } from "./LiveTranscriptPanel";
import { emptyLiveTranscript } from "./live-transcript";
afterEach(cleanup);
beforeEach(() => localStorage.clear());
describe("Live transcript panel", () => {
  it("shows local loading, language selector, phrases and toggle in English", () => {
    const onToggle = vi.fn(), onLanguage = vi.fn(); const initial = { ...emptyLiveTranscript(), phase: "loading" as const };
    const view = render(<LiveTranscriptPanel state={initial} enabled onToggle={onToggle} language="en" speechLanguage="auto" onLanguage={onLanguage} />);
    expect(screen.getByRole("region", { name: "Live audio transcript" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading Whisper from the local cache");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "en" } }); expect(onLanguage).toHaveBeenCalledWith("en");
    view.rerender(<LiveTranscriptPanel state={{ ...initial, phase: "listening", phrases: [{ id: 1, text: "Hello world", start: 0, end: 3 }] }} enabled onToggle={onToggle} language="en" speechLanguage="en" onLanguage={onLanguage} />);
    expect(screen.getByText("world", { exact: false, selector: ".is-current span:last-child" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enable live transcription" })); expect(onToggle).toHaveBeenCalledOnce();
  });
  it("shows model download progress and replaceable provisional text", () => {
    const view = render(<LiveTranscriptPanel state={{ ...emptyLiveTranscript(), phase: "loading", stage: "download", progress: 42 }} enabled onToggle={vi.fn()} language="it" speechLanguage="auto" onLanguage={vi.fn()} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "42"); expect(screen.getByRole("status")).toHaveTextContent("Download dei pesi");
    view.rerender(<LiveTranscriptPanel state={{ ...emptyLiveTranscript(), phase: "listening", partial: "Una parola provvisoria" }} enabled onToggle={vi.fn()} language="it" speechLanguage="auto" onLanguage={vi.fn()} />);
    expect(screen.getByText(/Testo provvisorio/)).toBeInTheDocument(); expect(screen.getByText("provvisoria", { selector: ".is-current span" })).toBeInTheDocument();
  });
  it("switches between provisional and confirmed text and remembers the choice", () => {
    const props = { state: { ...emptyLiveTranscript(), phase: "listening" as const, partial: "draft words", phrases: [{ id: 1, text: "Confirmed sentence", start: 0, end: 1 }] }, enabled: true, onToggle: vi.fn(), language: "en" as const, speechLanguage: "auto", onLanguage: vi.fn() };
    const view = render(<LiveTranscriptPanel {...props} />);
    expect(screen.getByText(/Provisional text/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmed text only" }));
    expect(screen.queryByText(/Provisional text/)).not.toBeInTheDocument(); expect(screen.getByText("sentence", { selector: ".is-current span:last-child" })).toBeInTheDocument();
    expect(localStorage.getItem("mlsm-streamer-transcript-display")).toBe("confirmed");
    view.unmount(); render(<LiveTranscriptPanel {...props} />);
    expect(screen.getByRole("button", { name: "Show live processing" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Show live processing" })); expect(screen.getByText(/Provisional text/)).toBeInTheDocument();
  });
});
