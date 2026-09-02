import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMlsmPostLipsyncAnalysis } from "../services/mlsm-post-lipsync-analysis";
import type { TimestampedWord, WhisperTranscriptDocument } from "../services/subtitle-generation";
import { MlsmWhisperWordEditor } from "./MlsmWhisperWordEditor";

const word = (text: string, start: number, end: number): TimestampedWord => ({ text, start, end, confidence: .94, confidenceSource: "model" });

function transcript(words: TimestampedWord[], durationSeconds = 5): WhisperTranscriptDocument {
  return { schemaVersion: 1, engine: "Whisper", model: "whisper-base_timestamped", durationSeconds, transcript: words.map((item) => item.text).join(" "), words, phrases: [] };
}

function analysis() {
  const source = transcript([word("The", .2, .5), word("wrong", .55, 1), word("loves", 1.4, 1.8), word("me", 1.85, 2.2)]);
  const target = transcript([word("The", .3, .6), word("Fallen", .65, 1.2), word("still", 1.3, 1.6), word("loves", 1.65, 2), word("me", 2.05, 2.4)]);
  return createMlsmPostLipsyncAnalysis({ sourceTranscript: source, targetTranscript: target, sourceDurationSeconds: 5, targetDurationSeconds: 5, targetMasterDurationSeconds: 20, targetAnalysisStartSeconds: 8, whisperTranscripts: { source, target } });
}

describe("MlsmWhisperWordEditor", () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("shows the complete words property for video and master and applies text/count/timestamp edits", async () => {
    const onApply = vi.fn();
    render(<MlsmWhisperWordEditor analysis={analysis()} sourceVideoUrl="blob:video" targetAudioUrl="blob:master" language="en" onApply={onApply} />);
    expect(screen.getByRole("region", { name: "Original video" })).toHaveTextContent("4 words");
    expect(screen.getByRole("region", { name: "Audio master" })).toHaveTextContent("5 words");

    fireEvent.change(screen.getByLabelText("Word Original video 2"), { target: { value: "Fallen" } });
    fireEvent.change(screen.getByLabelText("Start (s) Original video 2"), { target: { value: "0.600" } });
    fireEvent.click(screen.getByRole("button", { name: /Insert after: Fallen · Original video/u }));
    const sourceRegion = screen.getByRole("region", { name: "Original video" });
    expect(sourceRegion).toHaveTextContent("5 words");
    fireEvent.change(within(sourceRegion).getByLabelText("Word Original video 3"), { target: { value: "still" } });

    fireEvent.click(screen.getByRole("button", { name: /Delete word: still · Audio master/u }));
    expect(screen.getByRole("region", { name: "Audio master" })).toHaveTextContent("4 words");
    fireEvent.click(screen.getByRole("button", { name: "Apply correction" }));

    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    const [sourceWords, targetWords] = onApply.mock.calls[0]!;
    expect(sourceWords.map((item: TimestampedWord) => item.text)).toEqual(["The", "Fallen", "still", "loves", "me"]);
    expect(sourceWords[1].start).toBe(.6);
    expect(targetWords.map((item: TimestampedWord) => item.text)).toEqual(["The", "Fallen", "loves", "me"]);
    expect(await screen.findByRole("status")).toHaveTextContent(/actual time-map and export/u);
  });

  it("exposes a word-by-word audition button for both media tracks", async () => {
    render(<MlsmWhisperWordEditor analysis={analysis()} sourceVideoUrl="blob:video" targetAudioUrl="blob:master" language="en" onApply={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Audition word: The · Original video" }));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Stop audition: The · Original video" })).toBeInTheDocument();
  });
});
