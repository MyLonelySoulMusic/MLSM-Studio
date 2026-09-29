import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@rbs/project-schema";
import { activeRemoteUpscalerEndpoints, discoverRemoteUpscalerModels, normalizeRemoteUpscalerEndpoint, shouldGenerateUpscalerAi, upscaleRemoteImageDirect, usesRemoteUpscaler } from "./remote-upscaler-client";

describe("remote upscaler client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("deduplica solo gli endpoint attivi e abilita AI anche col profilo Canvas locale", () => {
    const settings = createProject().animation.upscaler;
    settings.remote = { ...settings.remote, enabled: true, model: "remote-x4", frameRetries: 2, endpoints: [
      { id: "a", label: "A", url: "https://a.gradio.live", enabled: true },
      { id: "b", label: "B", url: "https://a.gradio.live", enabled: true },
      { id: "c", label: "C", url: "https://c.gradio.live", enabled: false }
    ] };
    expect(activeRemoteUpscalerEndpoints(settings)).toEqual(["https://a.gradio.live"]);
    expect(usesRemoteUpscaler(settings)).toBe(true);
    expect(shouldGenerateUpscalerAi(settings)).toBe(true);
    expect(normalizeRemoteUpscalerEndpoint("https://a.gradio.live/gradio_api/call/upscale_image")).toBe("https://a.gradio.live");
    expect(normalizeRemoteUpscalerEndpoint("https://a.gradio.live/gradio_api/call/upscale_models")).toBe("https://a.gradio.live");
    settings.remote.model = "";
    expect(usesRemoteUpscaler(settings)).toBe(true);
  });

  it("carica il catalogo attraverso il coordinatore locale", async () => {
    const catalog = { ok: true, endpoints: [{ url: "https://a.gradio.live", ok: true, models: [] }], models: [{ name: "x4", scale: 4, description: "", default: true }], defaultModel: "x4" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(catalog), { status: 200 }));
    await expect(discoverRemoteUpscalerModels(["https://a.gradio.live"])).resolves.toEqual({ ...catalog, transport: "coordinator" });
    expect(fetchMock).toHaveBeenCalledWith("/__mlsm/upscaler-api/upscale/remote/catalog", expect.objectContaining({ method: "POST", body: JSON.stringify({ endpoints: ["https://a.gradio.live"] }) }));
  });

  it("propaga il dettaglio del backend quando la discovery fallisce", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ detail: "endpoint offline" }), { status: 502 }));
    await expect(discoverRemoteUpscalerModels(["https://a.gradio.live"])).rejects.toThrow("endpoint offline");
  });

  it("interroga Gradio direttamente quando il coordinatore locale non risponde", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ event_id: "catalog-123" }), { status: 200 }))
      .mockResolvedValueOnce(new Response([
        "event: complete",
        `data: ${JSON.stringify([{
          ok: true,
          default_model: "RealESRGAN_x4plus",
          models: [{ name: "RealESRGAN_x4plus", scale: 4, description: "photo", default: true }]
        }])}`,
        ""
      ].join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } }));

    await expect(discoverRemoteUpscalerModels(["https://live.gradio.live/"])).resolves.toMatchObject({
      transport: "direct",
      defaultModel: "RealESRGAN_x4plus",
      endpoints: [{ url: "https://live.gradio.live", ok: true }]
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/__mlsm/upscaler-api/upscale/remote/catalog",
      "https://live.gradio.live/gradio_api/call/upscale_models",
      "https://live.gradio.live/gradio_api/call/upscale_models/catalog-123"
    ]);
  });

  it("completa direttamente il job Gradio in coda e decodifica l'immagine", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ event_id: "event-123" }), { status: 200 }))
      .mockResolvedValueOnce(new Response([
        "event: complete",
        `data: ${JSON.stringify([{ ok: true, image: "data:image/png;base64,AQID" }])}`,
        ""
      ].join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } }));

    const result = await upscaleRemoteImageDirect(
      "https://live.gradio.live/",
      new Blob([new Uint8Array([4, 5, 6])], { type: "image/png" }),
      "RealESRGAN_x4plus"
    );

    expect(result.type).toBe("image/png");
    expect(result.size).toBe(3);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://live.gradio.live/gradio_api/call/upscale_image",
      "https://live.gradio.live/gradio_api/call/upscale_image/event-123"
    ]);
  });
});
