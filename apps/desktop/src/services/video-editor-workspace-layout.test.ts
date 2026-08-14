import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH,
  MAX_VIDEO_EDITOR_LEFT_DOCK_WIDTH,
  MIN_VIDEO_EDITOR_LEFT_DOCK_WIDTH,
  clampVideoEditorLeftDockWidth,
  parseVideoEditorLeftDockWidth,
  videoEditorLeftDockMaxWidth,
  videoEditorInspectorUsesOverlay,
  videoEditorUsesLeftDockDrawer
} from "./video-editor-workspace-layout";

describe("video editor workspace layout", () => {
  it("starts with a wider left dock and parses only bounded persisted values", () => {
    expect(DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH).toBe(360);
    expect(MIN_VIDEO_EDITOR_LEFT_DOCK_WIDTH).toBe(280);
    expect(MAX_VIDEO_EDITOR_LEFT_DOCK_WIDTH).toBe(600);
    expect(parseVideoEditorLeftDockWidth(null)).toBe(DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH);
    expect(parseVideoEditorLeftDockWidth('{"left":999}')).toBe(MAX_VIDEO_EDITOR_LEFT_DOCK_WIDTH);
    expect(parseVideoEditorLeftDockWidth('{"left":1}')).toBe(MIN_VIDEO_EDITOR_LEFT_DOCK_WIDTH);
    expect(parseVideoEditorLeftDockWidth("not-json")).toBe(DEFAULT_VIDEO_EDITOR_LEFT_DOCK_WIDTH);
  });

  it("switches to a drawer at the exact preview threshold", () => {
    expect(videoEditorUsesLeftDockDrawer(713)).toBe(true);
    expect(videoEditorUsesLeftDockDrawer(714)).toBe(false);
    expect(videoEditorLeftDockMaxWidth(713)).toBe(MAX_VIDEO_EDITOR_LEFT_DOCK_WIDTH);
    expect(videoEditorLeftDockMaxWidth(714)).toBe(MIN_VIDEO_EDITOR_LEFT_DOCK_WIDTH);
    expect(videoEditorLeftDockMaxWidth(960)).toBe(526);
    expect(videoEditorLeftDockMaxWidth(1440)).toBe(MAX_VIDEO_EDITOR_LEFT_DOCK_WIDTH);
  });

  it("clamps the inline dock without reserving the inspector", () => {
    expect(clampVideoEditorLeftDockWidth(1000, 960)).toBe(526);
    expect(clampVideoEditorLeftDockWidth(100, 960)).toBe(MIN_VIDEO_EDITOR_LEFT_DOCK_WIDTH);
    expect(clampVideoEditorLeftDockWidth(1000, 713)).toBe(MAX_VIDEO_EDITOR_LEFT_DOCK_WIDTH);
  });

  it("uses an inspector overlay only when the inline composition cannot fit", () => {
    expect(videoEditorInspectorUsesOverlay(713, 360, true)).toBe(true);
    expect(videoEditorInspectorUsesOverlay(960, 360, true)).toBe(true);
    expect(videoEditorInspectorUsesOverlay(1440, 600, true)).toBe(false);
    expect(videoEditorInspectorUsesOverlay(1440, 600, false)).toBe(false);
  });
});
