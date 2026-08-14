import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "./project-store";

const videoAsset = {
  id: "locked-video", name: "locked.mp4", kind: "video" as const, url: "blob:locked-video",
  durationSeconds: 12, width: 1920, height: 1080, hasAudio: true, bpm: null,
  beats: [] as number[], downbeats: [] as number[], waveform: [] as number[]
};

const audioAsset = {
  id: "sync-audio", name: "sync.wav", kind: "audio" as const, url: "blob:sync-audio",
  durationSeconds: 12, width: 0, height: 0, hasAudio: true, bpm: null,
  beats: [] as number[], downbeats: [] as number[], waveform: [] as number[]
};

const editor = () => useProjectStore.getState().project.animation.videoEditor;

describe("Video Editor · protezione delle tracce bloccate", () => {
  beforeEach(() => useProjectStore.getState().newProject());

  it("rifiuta ogni mutazione diretta o indiretta della clip e dei suoi effetti", () => {
    const store = useProjectStore.getState();
    store.addVideoEditorAssets([videoAsset]);
    const clipId = useProjectStore.getState().addVideoEditorClip(videoAsset.id, { trackId: "video-editor-track-main" })!;
    const effectId = useProjectStore.getState().addVideoEditorEffectClip("fade-in", { targetClipId: clipId })!;
    useProjectStore.getState().moveVideoEditorClip(clipId, 3);
    useProjectStore.getState().updateVideoEditorTrack("video-editor-track-main", { locked: true });

    const clipBefore = structuredClone(editor().clips.find((clip) => clip.id === clipId)!);
    const effectBefore = structuredClone(editor().effectClips.find((effect) => effect.id === effectId)!);
    useProjectStore.getState().updateVideoEditorClip(clipId, { startSeconds: 8, transform: { x: .4, y: -.2, scale: .6, rotation: 25 } });
    useProjectStore.getState().updateVideoEditorClipAdjustments(clipId, { opacity: .25, contrast: 40 });
    useProjectStore.getState().moveVideoEditorClip(clipId, 9);
    useProjectStore.getState().moveVideoEditorClipToTrack(clipId, "video-editor-track-overlay");
    useProjectStore.getState().trimVideoEditorClip(clipId, "end", 7);
    useProjectStore.getState().splitVideoEditorClip(clipId, 6);
    useProjectStore.getState().duplicateVideoEditorClip(clipId);
    useProjectStore.getState().closeVideoEditorGaps("video-editor-track-main");
    useProjectStore.getState().updateVideoEditorEffectClip(effectId, { mix: .2, enabled: false });
    useProjectStore.getState().moveVideoEditorEffectClip(effectId, 5);
    useProjectStore.getState().trimVideoEditorEffectClip(effectId, "end", 6);
    useProjectStore.getState().deleteVideoEditorEffectClips([effectId]);
    useProjectStore.getState().deleteVideoEditorClips([clipId]);
    useProjectStore.getState().removeVideoEditorAsset(videoAsset.id);
    useProjectStore.getState().removeVideoEditorTrack("video-editor-track-main");
    useProjectStore.getState().updateVideoEditorTrack("video-editor-track-main", { name: "Mixer protetto", hidden: true, muted: true, volume: .1 });

    expect(editor().clips).toEqual([clipBefore]);
    expect(editor().effectClips).toEqual([effectBefore]);
    expect(editor().assets).toContainEqual(expect.objectContaining(videoAsset));
    expect(editor().assets.find((asset) => asset.id === videoAsset.id)).toMatchObject({ sourceFrameCount: 720, sourceRate: { numerator: 60, denominator: 1 }, frameIdentityId: null, timingMode: "constant" });
    expect(editor().tracks.find((track) => track.id === "video-editor-track-main")).toMatchObject({ locked: true, name: "Mixer protetto", hidden: true, muted: true, volume: .1 });
    expect(useProjectStore.getState().addVideoEditorClip(videoAsset.id, { trackId: "video-editor-track-main" })).toBeNull();
    expect(useProjectStore.getState().addVideoEditorEffectClip("fade-out", { targetClipId: clipId })).toBeNull();

    // Il mixer e il monitor di traccia restano operativi; lo sblocco rende di
    // nuovo modificabile il contenuto.
    useProjectStore.getState().updateVideoEditorTrack("video-editor-track-main", { locked: false });
    expect(editor().tracks.find((track) => track.id === "video-editor-track-main")).toMatchObject({ locked: false, name: "Mixer protetto" });
    useProjectStore.getState().updateVideoEditorClip(clipId, { volume: .5 });
    expect(editor().clips.find((clip) => clip.id === clipId)?.volume).toBe(.5);
  });

  it("nega l’ingresso in un livello bloccato e preserva i target bloccati nelle operazioni multiple", () => {
    useProjectStore.getState().addVideoEditorAssets([videoAsset]);
    const lockedClipId = useProjectStore.getState().addVideoEditorClip(videoAsset.id, { trackId: "video-editor-track-main" })!;
    const editableClipId = useProjectStore.getState().addVideoEditorClip(videoAsset.id, { trackId: "video-editor-track-overlay" })!;
    const lockedEffectId = useProjectStore.getState().addVideoEditorEffectClip("fade-in", { targetClipId: lockedClipId })!;
    const editableEffectId = useProjectStore.getState().addVideoEditorEffectClip("fade-out", { targetClipId: editableClipId })!;
    useProjectStore.getState().updateVideoEditorTrack("video-editor-track-main", { locked: true });

    useProjectStore.getState().moveVideoEditorClipToTrack(editableClipId, "video-editor-track-main");
    expect(editor().clips.find((clip) => clip.id === editableClipId)?.trackId).toBe("video-editor-track-overlay");
    useProjectStore.getState().updateVideoEditorClip(editableClipId, { trackId: "video-editor-track-main" });
    expect(editor().clips.find((clip) => clip.id === editableClipId)?.trackId).toBe("video-editor-track-overlay");

    useProjectStore.getState().deleteVideoEditorEffectClips([lockedEffectId, editableEffectId]);
    useProjectStore.getState().deleteVideoEditorClips([lockedClipId, editableClipId]);
    expect(editor().clips.map((clip) => clip.id)).toEqual([lockedClipId]);
    expect(editor().effectClips.map((effect) => effect.id)).toEqual([lockedEffectId]);

    const lockedIndex = editor().tracks.findIndex((track) => track.id === "video-editor-track-main");
    const overlayBefore = editor().tracks.findIndex((track) => track.id === "video-editor-track-overlay");
    useProjectStore.getState().reorderVideoEditorTrack("video-editor-track-overlay", lockedIndex);
    expect(editor().tracks.findIndex((track) => track.id === "video-editor-track-overlay")).toBe(overlayBefore);
  });

  it("usa una clip bloccata come riferimento di sync senza spostarla come target", () => {
    useProjectStore.getState().addVideoEditorAssets([videoAsset, audioAsset]);
    const referenceId = useProjectStore.getState().addVideoEditorClip(audioAsset.id)!;
    const lockedTargetId = useProjectStore.getState().addVideoEditorClip(videoAsset.id, { trackId: "video-editor-track-main" })!;
    const editableTargetId = useProjectStore.getState().addVideoEditorClip(videoAsset.id, { trackId: "video-editor-track-overlay" })!;
    useProjectStore.getState().updateVideoEditor({ snapEnabled: false });
    useProjectStore.getState().moveVideoEditorClip(referenceId, 1);
    useProjectStore.getState().moveVideoEditorClip(lockedTargetId, 4);
    useProjectStore.getState().moveVideoEditorClip(editableTargetId, 7);
    useProjectStore.getState().updateVideoEditorTrack("video-editor-track-main", { locked: true });

    useProjectStore.getState().syncVideoEditorClips(referenceId, [lockedTargetId, editableTargetId]);
    expect(editor().clips.find((clip) => clip.id === lockedTargetId)?.startSeconds).toBe(4);
    expect(editor().clips.find((clip) => clip.id === editableTargetId)?.startSeconds).toBe(1);

    // Una clip protetta può guidare l’allineamento perché viene soltanto letta.
    useProjectStore.getState().moveVideoEditorClip(editableTargetId, 6);
    useProjectStore.getState().syncVideoEditorClips(lockedTargetId, [editableTargetId]);
    expect(editor().clips.find((clip) => clip.id === lockedTargetId)?.startSeconds).toBe(4);
    expect(editor().clips.find((clip) => clip.id === editableTargetId)?.startSeconds).toBe(4);
  });

  it("con strictTrack rifiuta il drop incompatibile senza ripiegare su un altro livello", () => {
    useProjectStore.getState().addVideoEditorAssets([videoAsset]);
    const before = editor().clips.length;
    const clipId = useProjectStore.getState().addVideoEditorClip(videoAsset.id, {
      trackId: "video-editor-track-audio", startSeconds: 1, strictTrack: true
    });
    expect(clipId).toBeNull();
    expect(editor().clips).toHaveLength(before);
  });

  it("rifiuta un artifact se la traccia viene bloccata mentre il tool è in esecuzione", () => {
    useProjectStore.getState().addVideoEditorAssets([videoAsset]);
    const clipId = useProjectStore.getState().addVideoEditorClip(videoAsset.id, { trackId: "video-editor-track-main" })!;
    useProjectStore.getState().updateVideoEditorTrack("video-editor-track-main", { locked: true });
    const artifact = {
      id: "late-artifact", toolId: "upscaler" as const, url: "blob:late-result", name: "late.mp4", kind: "video" as const,
      sourceClipId: clipId, sourceFrameCount: 720, sourceRate: { numerator: 60, denominator: 1 },
      provenance: { toolId: "upscaler" as const, createdAt: new Date().toISOString(), inputAssetId: videoAsset.id }
    };
    expect(useProjectStore.getState().insertVideoEditorArtifact(artifact, clipId)).toBeNull();
    expect(editor().assets.some((asset) => asset.url === artifact.url)).toBe(false);
    expect(editor().clips).toHaveLength(1);
  });
});
