import { describe, expect, it } from "vitest";
import { songPlayerLocalTime, songPlayerMediaTime, songPlayerPersistedOffsetMs, songPlayerPlaybackRange } from "./song-player-playback";

describe("song player playback mapping", () => {
  it("maps local fragment time into the selected full-track segment", () => { const range = songPlayerPlaybackRange(30, 12, 90); expect(songPlayerMediaTime(4.25, range)).toBe(34.25); expect(songPlayerLocalTime(34.25, range)).toBe(4.25); });
  it("clamps offset and time so playback cannot escape the segment", () => { const range = songPlayerPlaybackRange(95, 12, 100); expect(range).toEqual({ startSeconds: 88, endSeconds: 100, durationSeconds: 12 }); expect(songPlayerMediaTime(20, range)).toBe(100); expect(songPlayerLocalTime(20, range)).toBe(0); });
  it("limits a malformed short full track without negative ranges", () => { expect(songPlayerPlaybackRange(-3, 12, 5)).toEqual({ startSeconds: 0, endSeconds: 5, durationSeconds: 5 }); });
  it("uses the same range authority for persisted millisecond offsets", () => { expect(songPlayerPersistedOffsetMs(95_000, 12, 100)).toBe(88_000); expect(songPlayerPersistedOffsetMs(10_000, 12, 5)).toBe(0); });
  it("sanitizes non-finite durations", () => { expect(songPlayerPlaybackRange(3, Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ startSeconds: 0, endSeconds: 0, durationSeconds: 0 }); });
});
