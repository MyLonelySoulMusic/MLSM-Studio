import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
const isTauri = vi.hoisted(() => vi.fn(() => false));
const save = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save }));

import { chooseUpscalerVideoSaveTarget, prepareUpscalerVideoSaveTarget, saveUpscalerVideoArtifact } from "./upscaler-video-artifact";

describe("upscaler video artifact delivery", () => {
  beforeEach(() => { invoke.mockReset(); isTauri.mockReset(); isTauri.mockReturnValue(false); save.mockReset(); Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined }); });

  it("scrive il Blob nel file scelto dal browser", async () => {
    const write = vi.fn(); const close = vi.fn();
    const handle = { createWritable: vi.fn(async () => ({ write, close })), getFile: vi.fn(async () => new File(["video"], "result.mp4", { type: "video/mp4" })) } as unknown as FileSystemFileHandle;
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: vi.fn(async () => handle) });
    const target = await chooseUpscalerVideoSaveTarget("result.mp4");
    const blob = new Blob(["video"], { type: "video/mp4" });
    expect(target).toEqual({ kind: "file-system-access", handle });
    await expect(saveUpscalerVideoArtifact(target!, { blob, fileName: "result.mp4" })).resolves.toEqual({ bytes: blob.size, destination: "result.mp4" });
    expect(write).toHaveBeenCalledWith(blob); expect(close).toHaveBeenCalledOnce();
  });

  it("in desktop copia atomicamente il risultato locale senza trasferire il video via IPC", async () => {
    isTauri.mockReturnValue(true); save.mockResolvedValue("/Users/test/result.mp4");
    const target = await chooseUpscalerVideoSaveTarget("result.mp4");
    const blob = new Blob(["unused"]); invoke.mockResolvedValue(blob.size);
    await saveUpscalerVideoArtifact(target!, { blob, fileName: "result.mp4", resultPath: "/cache/job/upscaled-video.mp4" });
    expect(invoke).toHaveBeenCalledWith("copy_upscaler_video_result", { sourcePath: "/cache/job/upscaled-video.mp4", destinationPath: "/Users/test/result.mp4" });
  });

  it("non crea un file browser vuoto prima che il lungo job sia completato", async () => {
    const picker = vi.fn();
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: picker });
    await expect(prepareUpscalerVideoSaveTarget("result.mp4")).resolves.toEqual({ kind: "download" });
    expect(picker).not.toHaveBeenCalled();
  });

  it("rifiuta una copia desktop con un conteggio byte diverso dall'artifact verificato", async () => {
    invoke.mockResolvedValue(1);
    const blob = new Blob(["verified-video"]);
    await expect(saveUpscalerVideoArtifact({ kind: "tauri", path: "/Users/test/result.mp4" }, { blob, fileName: "result.mp4", resultPath: "/cache/job/upscaled-video.mp4" })).rejects.toThrow("copiati 1/");
  });
});
