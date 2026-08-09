import { afterEach, describe, expect, it, vi } from "vitest";
import {
  videoEditorInterpolate,
  videoEditorInterpolationBaseUrl,
  videoEditorInterpolationCommand,
  videoEditorInterpolationHealth,
  videoEditorInterpolationMethodLabel
} from "./video-editor-interpolation-client";

const originalFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

function jsonResponse(payload: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => payload } as unknown as Response;
}

describe("Video Editor · stato del servizio locale di interpolazione", () => {
  it("interroga il servizio locale sulla porta condivisa con l’Upscaler", async () => {
    const requested: string[] = [];
    globalThis.fetch = (async (url: string) => { requested.push(url); return jsonResponse({ ok: true, interpolation: { ffmpeg: true, rife: false, device: "mps" } }); }) as unknown as typeof fetch;
    const health = await videoEditorInterpolationHealth();
    expect(requested[0]).toBe(`${videoEditorInterpolationBaseUrl}/interpolation/health`);
    expect(videoEditorInterpolationBaseUrl).toBe("http://127.0.0.1:8765");
    expect(health).toEqual({ available: true, ffmpeg: true, rife: false, device: "mps" });
  });

  it("considera disponibile il servizio anche col solo RIFE e indisponibile senza nessun motore", async () => {
    globalThis.fetch = (async () => jsonResponse({ interpolation: { ffmpeg: false, rife: true, device: "cuda" } })) as unknown as typeof fetch;
    expect(await videoEditorInterpolationHealth()).toEqual({ available: true, ffmpeg: false, rife: true, device: "cuda" });

    globalThis.fetch = (async () => jsonResponse({ interpolation: { ffmpeg: false, rife: false } })) as unknown as typeof fetch;
    expect(await videoEditorInterpolationHealth()).toEqual({ available: false, ffmpeg: false, rife: false, device: "cpu" });
  });

  it("restituisce null quando il servizio non risponde, senza far cadere l’export", async () => {
    globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    expect(await videoEditorInterpolationHealth()).toBeNull();

    globalThis.fetch = (async () => jsonResponse({}, false)) as unknown as typeof fetch;
    expect(await videoEditorInterpolationHealth()).toBeNull();
  });

  it("indica il comando da lanciare a mano: il servizio non parte mai da solo", () => {
    expect(videoEditorInterpolationCommand).toBe("npm run upscaler:server");
  });

  it("nomina in italiano i metodi disponibili", () => {
    expect(videoEditorInterpolationMethodLabel("blend")).toContain("Fusione");
    expect(videoEditorInterpolationMethodLabel("motion")).toContain("ffmpeg");
    expect(videoEditorInterpolationMethodLabel("rife")).toContain("RIFE");
  });
});

describe("Video Editor · richiesta di interpolazione", () => {
  const signal = new AbortController().signal;

  it("rifiuta un frame rate di destinazione non superiore a quello reso", async () => {
    await expect(videoEditorInterpolate({ blob: new Blob(["x"]), fileName: "m.mp4", sourceFps: 60, targetFps: 60, method: "motion", signal }))
      .rejects.toThrow(/deve superare/);
    await expect(videoEditorInterpolate({ blob: new Blob(["x"]), fileName: "m.mp4", sourceFps: 60, targetFps: 30, method: "motion", signal }))
      .rejects.toThrow(/deve superare/);
  });

  it("invia file, frame rate e metodo come multipart e legge gli header di risposta", async () => {
    const returned = new Blob(["interpolato"], { type: "video/mp4" });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => returned,
      headers: new Headers({ "X-Interpolation-Method": "motion", "X-Interpolation-Target-Fps": "120", "X-Interpolation-Backend": "ffmpeg · motion" })
    } as unknown as Response));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await videoEditorInterpolate({ blob: new Blob(["montaggio"]), fileName: "montaggio.mp4", sourceFps: 30, targetFps: 120, method: "motion", signal });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${videoEditorInterpolationBaseUrl}/interpolate`);
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body.get("source_fps")).toBe("30");
    expect(body.get("target_fps")).toBe("120");
    expect(body.get("method")).toBe("motion");
    expect(body.get("file")).toBeInstanceOf(Blob);
    expect(result).toMatchObject({ blob: returned, method: "motion", sourceFps: 30, targetFps: 120, backend: "ffmpeg · motion" });
  });

  it("ricade sui valori richiesti quando il servizio non manda gli header", async () => {
    globalThis.fetch = (async () => ({ ok: true, status: 200, blob: async () => new Blob(["x"]), headers: new Headers() } as unknown as Response)) as unknown as typeof fetch;
    const result = await videoEditorInterpolate({ blob: new Blob(["x"]), fileName: "m.mp4", sourceFps: 24, targetFps: 48, method: "rife", signal });
    expect(result.method).toBe("rife");
    expect(result.targetFps).toBe(48);
    expect(result.backend).toBe("ffmpeg");
  });

  it("riporta il motivo dell’errore del servizio e rifiuta un file vuoto", async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 503, text: async () => "ffmpeg non trovato nel PATH" } as unknown as Response)) as unknown as typeof fetch;
    await expect(videoEditorInterpolate({ blob: new Blob(["x"]), fileName: "m.mp4", sourceFps: 30, targetFps: 60, method: "motion", signal }))
      .rejects.toThrow(/HTTP 503.*ffmpeg non trovato/s);

    globalThis.fetch = (async () => ({ ok: true, status: 200, blob: async () => new Blob([]), headers: new Headers() } as unknown as Response)) as unknown as typeof fetch;
    await expect(videoEditorInterpolate({ blob: new Blob(["x"]), fileName: "m.mp4", sourceFps: 30, targetFps: 60, method: "motion", signal }))
      .rejects.toThrow(/file vuoto/);
  });
});
