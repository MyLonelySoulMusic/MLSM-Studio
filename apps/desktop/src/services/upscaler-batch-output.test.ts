import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
const isTauri = vi.hoisted(() => vi.fn(() => true));
const open = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));

import { chooseUpscalerBatchOutputSink } from "./upscaler-batch-output";

describe("upscaler batch output sink", () => {
  afterEach(() => { invoke.mockReset(); open.mockReset(); isTauri.mockReturnValue(true); vi.restoreAllMocks(); });

  it("chooses a Tauri folder once and sends PNG bytes to the safe command", async () => {
    open.mockResolvedValue("/tmp/upscaled");
    const sink = await chooseUpscalerBatchOutputSink();
    expect(sink?.kind).toBe("tauri");
    const blob = { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as unknown as Blob;
    await sink?.write(blob, "photo.png");
    expect(invoke).toHaveBeenCalledWith("write_upscaler_batch_image", { directoryPath: "/tmp/upscaled", filename: "photo.png", payload: [1, 2, 3] });
  });
});
