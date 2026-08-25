import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";
import { activeRemoteUpscalerEndpoints, discoverRemoteUpscalerModels, normalizeRemoteUpscalerEndpoint, shouldGenerateUpscalerAi, usesRemoteUpscaler } from "./remote-upscaler-client";

describe("remote upscaler client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("deduplica solo gli endpoint attivi e abilita AI anche col profilo Canvas locale", () => {
    const settings = createProject().animation.upscaler;
    settings.remote = { enabled: true, model: "remote-x4", frameRetries: 2, endpoints: [
      { id: "a", label: "A", url: "https://a.gradio.live", enabled: true },
      { id: "b", label: "B", url: "https://a.gradio.live", enabled: true },
      { id: "c", label: "C", url: "https://c.gradio.live", enabled: false }
    ] };
    expect(activeRemoteUpscalerEndpoints(settings)).toEqual(["https://a.gradio.live"]);
    expect(usesRemoteUpscaler(settings)).toBe(true);
    expect(shouldGenerateUpscalerAi(settings)).toBe(true);
    expect(normalizeRemoteUpscalerEndpoint("https://a.gradio.live/gradio_api/call/upscale_image")).toBe("https://a.gradio.live");
  });

  it("carica il catalogo attraverso il coordinatore locale", async () => {
    const catalog = { ok: true, endpoints: [{ url: "https://a.gradio.live", ok: true, models: [] }], models: [{ name: "x4", scale: 4, description: "", default: true }], defaultModel: "x4" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(catalog), { status: 200 }));
    await expect(discoverRemoteUpscalerModels(["https://a.gradio.live"])).resolves.toEqual(catalog);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8765/upscale/remote/catalog", expect.objectContaining({ method: "POST", body: JSON.stringify({ endpoints: ["https://a.gradio.live"] }) }));
  });

  it("propaga il dettaglio del backend quando la discovery fallisce", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ detail: "endpoint offline" }), { status: 502 }));
    await expect(discoverRemoteUpscalerModels(["https://a.gradio.live"])).rejects.toThrow("endpoint offline");
  });
});
