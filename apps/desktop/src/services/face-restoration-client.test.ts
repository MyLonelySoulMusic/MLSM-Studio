import { afterEach, describe, expect, it, vi } from "vitest";
import { faceModels } from "./face-restoration-client";
import { pythonUpscalerHealth } from "./upscaler-python-client";
vi.mock("./upscaler-python-client", () => ({ pythonUpscalerBaseUrl: "/__mlsm/upscaler-api", pythonUpscalerHealth: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
describe("Face restoration startup", () => {
  it("waits for HTTP readiness before requesting models", async () => {
    let ready!: (value: Awaited<ReturnType<typeof pythonUpscalerHealth>>) => void;
    vi.mocked(pythonUpscalerHealth).mockReturnValue(new Promise(resolve => { ready = resolve; }));
    const payload = { models: [], runtimeReady: true };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
    vi.stubGlobal("fetch", fetchMock);
    const pending = faceModels();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    ready({ ok: true, mps: true, cuda: false, recommendedBackend: "metal", gpuName: "Apple" });
    await expect(pending).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("/__mlsm/upscaler-api/face-restoration/models", undefined);
  });
  it("does not contact models if backend startup fails", async () => {
    vi.mocked(pythonUpscalerHealth).mockResolvedValue(null);
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(faceModels()).rejects.toThrow("Servizio locale non disponibile");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
