import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoEditorAudioMixModal } from "./VideoEditorAudioMixModal";
import { useProjectStore } from "../store/project-store";
import { useVideoEditorPlayback } from "../store/video-editor-playback-store";

const audio = {
  id: "mix-audio", name: "Mix.wav", kind: "audio" as const, url: "blob:mix-audio",
  durationSeconds: 8, width: 0, height: 0, hasAudio: true, bpm: null,
  beats: [], downbeats: [], waveform: []
};

describe("Video Editor Mix audio · review regressions", () => {
  let clipId: string;
  beforeEach(() => {
    useProjectStore.getState().newProject();
    useProjectStore.getState().addVideoEditorAssets([audio]);
    clipId = useProjectStore.getState().addVideoEditorClip(audio.id, { trackId: "video-editor-track-audio", startSeconds: 2 })!;
    useVideoEditorPlayback.getState().setCurrentTime(3);
    useVideoEditorPlayback.getState().setPlaying(false);
  });
  afterEach(cleanup);
  const settings = () => useProjectStore.getState().project.animation.videoEditor;

  it("◆ writes the parameter clicked, not the previously selected envelope", () => {
    render(<VideoEditorAudioMixModal clipId={clipId} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("slider", { name: "Pan" }), { target: { value: -.5 } });
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi keyframe Pan" }));
    expect(settings().automationLanes).toHaveLength(1);
    expect(settings().automationLanes[0]).toMatchObject({ target: { property: "audioMix.pan" }, keyframes: [{ value: -.5, frame: 180 }] });
    fireEvent.click(screen.getByRole("checkbox", { name: "Attiva equalizzatore" }));
    fireEvent.click(screen.getByRole("button", { name: "Aggiungi keyframe EQ medi" }));
    expect(settings().automationLanes[1]?.target.property).toBe("audioMix.eq.midGainDb");
  });

  it("reset clears this clip's audio envelopes while preserving visual and other clip automation", () => {
    const otherClip = useProjectStore.getState().addVideoEditorClip(audio.id, { trackId: "video-editor-track-audio", startSeconds: 12 })!;
    for (const [id, property] of [[clipId, "audioMix.pan"], [clipId, "volume"], [clipId, "transform.x"], [otherClip, "volume"]]) {
      useProjectStore.getState().upsertVideoEditorKeyframe({ kind: "clip", clipId: id!, property: property! }, { id: `${id}-${property}`, frame: 180, value: .5, curve: "linear" });
    }
    render(<VideoEditorAudioMixModal clipId={clipId} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Ripristina mix" }));
    expect(settings().automationLanes.map((lane) => lane.target)).toEqual([
      { kind: "clip", clipId, property: "transform.x" },
      { kind: "clip", clipId: otherClip, property: "volume" }
    ]);
    expect(settings().clips.find((clip) => clip.id === clipId)).toMatchObject({ volume: 1, audioMix: { pan: 0 } });
  });

  it("manual fade replaces preset points without leaving the old envelope active", () => {
    render(<VideoEditorAudioMixModal clipId={clipId} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Inviluppo" }));
    expect(settings().automationLanes[0]?.keyframes).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Fade in / out" }));
    expect(settings().automationLanes).toHaveLength(0);
  });

  it("preserves existing volume points when choosing envelope fades", () => {
    useProjectStore.getState().upsertVideoEditorKeyframe({ kind: "clip", clipId, property: "volume" }, { id: "my-point", frame: 180, value: .75, curve: "linear" });
    render(<VideoEditorAudioMixModal clipId={clipId} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Inviluppo" }));
    expect(settings().automationLanes[0]?.keyframes).toEqual([{ id: "my-point", frame: 180, value: .75, curve: "linear" }]);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Valore keyframe my-point" }), { target: { value: "1.25" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Transizione keyframe my-point" }), { target: { value: "hold" } });
    expect(settings().automationLanes[0]?.keyframes[0]).toMatchObject({ value: 1.25, curve: "hold" });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Tempo keyframe my-point" }), { target: { value: "4" } });
    expect(settings().automationLanes[0]?.keyframes).toHaveLength(1);
    expect(settings().automationLanes[0]?.keyframes[0]?.frame).toBe(240);
  });

  it("contains keyboard focus and does not propagate timeline editing shortcuts", () => {
    const close = vi.fn();
    const shortcut = vi.fn();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const view = render(<div onKeyDown={shortcut}><VideoEditorAudioMixModal clipId={clipId} onClose={close} /></div>);
    const closeButton = screen.getByRole("button", { name: "Chiudi Mix audio" });
    const doneButton = screen.getByRole("button", { name: "Fine" });
    expect(closeButton).toHaveFocus();
    fireEvent.keyDown(closeButton, { key: "Tab", shiftKey: true });
    expect(doneButton).toHaveFocus();
    fireEvent.keyDown(doneButton, { key: "Tab" });
    expect(closeButton).toHaveFocus();
    fireEvent.keyDown(closeButton, { key: "Delete" });
    fireEvent.keyDown(closeButton, { key: "Escape" });
    expect(shortcut).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("disabled EQ/compressor parameters are also disabled for keyboard interaction", () => {
    render(<VideoEditorAudioMixModal clipId={clipId} onClose={() => {}} />);
    expect(screen.getByRole("slider", { name: "EQ medi" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Soglia" })).toBeDisabled();
    act(() => useProjectStore.getState().updateVideoEditorClip(clipId, { audioFadeInSeconds: 1 }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Attiva compressore" }));
    expect(screen.getByRole("slider", { name: "Soglia" })).toBeEnabled();
  });

  it("offers explicit playback without auto-starting and starts within the clip", () => {
    useVideoEditorPlayback.getState().setCurrentTime(0);
    render(<VideoEditorAudioMixModal clipId={clipId} onClose={() => {}} />);
    expect(useVideoEditorPlayback.getState().playing).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Ascolta mix audio" }));
    expect(useVideoEditorPlayback.getState()).toMatchObject({ playing: true, currentTime: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Pausa anteprima audio" }));
    expect(useVideoEditorPlayback.getState().playing).toBe(false);
  });
});
