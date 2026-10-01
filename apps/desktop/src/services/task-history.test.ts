import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { areaActivityCounts, beginTask, clearTaskHistory, readTaskHistory, setTaskHistoryArea } from "./task-history";

describe("activity-based area usage", () => {
  beforeEach(() => { localStorage.clear(); setTaskHistoryArea(undefined); });
  afterEach(() => { setTaskHistoryArea(undefined); clearTaskHistory(); });

  it("reads historical operations without guessing ambiguous video exports", () => {
    localStorage.setItem("mlsm.task-history.v1", JSON.stringify([
      { id: "a", label: "Upscaler · Image", startedAt: 1, status: "completed" },
      { id: "b", label: "Frame Booster", startedAt: 2, status: "failed" },
      { id: "c", label: "Audio · Whisper", startedAt: 3, status: "completed" },
      { id: "d", label: "Video export", startedAt: 4, status: "completed" },
      { id: "e", label: "Lipsync · Analysis", startedAt: 5, status: "completed" },
    ]));
    expect(areaActivityCounts(readTaskHistory())).toEqual({ photoVideoStudio: 2, audio: 1, lipsync: 1 });
  });

  it("captures the originating area before navigation changes it", () => {
    setTaskHistoryArea("videoEditor");
    const finish = beginTask("Video export");
    setTaskHistoryArea("reports");
    finish("completed");
    expect(readTaskHistory()[0]?.areaId).toBe("videoEditor");
    expect(areaActivityCounts(readTaskHistory())).toEqual({ videoEditor: 1 });
    clearTaskHistory();
    expect(areaActivityCounts(readTaskHistory())).toEqual({});
  });
});
