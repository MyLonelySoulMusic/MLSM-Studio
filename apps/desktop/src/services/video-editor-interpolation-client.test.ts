import { afterEach, describe, expect, it, vi } from "vitest";
import {
  videoEditorInterpolate,
  videoEditorInterpolateJob,
  videoEditorInterpolationBaseUrl,
  videoEditorInterpolationCommand,
  videoEditorInterpolationHealth,
  videoEditorInterpolationMethodLabel
} from "./video-editor-interpolation-client";

const originalFetch = globalThis.fetch;
const originalXhr = globalThis.XMLHttpRequest;

afterEach(() => { globalThis.fetch = originalFetch; globalThis.XMLHttpRequest = originalXhr; vi.restoreAllMocks(); });

function jsonResponse(payload: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => payload } as unknown as Response;
}

describe("Video Editor · stato del servizio locale di interpolazione", () => {
  it("interroga il servizio locale sulla porta condivisa con l’Upscaler", async () => {
    const requested: string[] = [];
    globalThis.fetch = (async (url: string) => { requested.push(url); return jsonResponse({ ok: true, interpolation: { ffmpeg: true, rife: false, device: "mps" } }); }) as unknown as typeof fetch;
    const health = await videoEditorInterpolationHealth();
    expect(requested[0]).toBe(`${videoEditorInterpolationBaseUrl}/interpolation/health`);
    expect(videoEditorInterpolationBaseUrl).toBe("/__mlsm/upscaler-api");
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

  it("propaga upload, frame e download progress dal job locale", async () => {
    const returned = new Blob(["interpolated"], { type: "video/mp4" });
    const statuses: Array<{ phase: string; uploadProgress?: number; downloadProgress?: number; progress: number; stageProgress?: number | null; processedBytes?: number; totalBytes?: number }> = [];
    class FakeXhr {
      static requests: FakeXhr[] = [];
      upload = { onprogress: undefined as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | undefined };
      responseType = ""; response: unknown; status = 0; onload?: () => void; onerror?: () => void; onabort?: () => void; onprogress?: (event: { loaded: number; total: number; lengthComputable: boolean }) => void;
      open() { FakeXhr.requests.push(this); }
      send() {
        if (this.responseType === "json") {
          this.status = 200;
          this.response = { id: "job-1", phase: "queued", phaseLabel: "queued", progress: 0, currentFrame: 0, totalFrames: 4, sourceFps: 30, targetFps: 60, method: "motion" };
          this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
        } else {
          this.status = 200;
          this.response = returned;
          this.onprogress?.({ loaded: returned.size, total: returned.size, lengthComputable: true });
        }
        this.onload?.();
      }
      abort() { this.onabort?.(); }
    }
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
    globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ id: "job-1", phase: "ready", phaseLabel: "ready", progress: 1, stageProgress: 1, currentFrame: 4, totalFrames: 4, sourceFps: 30, targetFps: 60, method: "motion", backend: "ffmpeg · motion" }) } as unknown as Response)) as unknown as typeof fetch;
    const result = await videoEditorInterpolateJob({ blob: new Blob(["source"]), fileName: "source.mp4", sourceFps: 30, targetFps: 60, method: "motion", signal: new AbortController().signal, onStatus: (status) => statuses.push(status) });
    expect(result.blob).toBe(returned);
    expect(statuses.some((status) => status.phase === "uploading" && status.uploadProgress === .5 && status.stageProgress === status.uploadProgress && status.processedBytes === 5 && status.totalBytes === 10)).toBe(true);
    expect(statuses.some((status) => status.downloadProgress === 1)).toBe(true);
    expect(statuses.at(-1)?.phase).toBe("ready");
  });

  it.each(["poll", "json"] as const)("annulla client e job se fallisce il %s, conservando l’errore originale", async (failure) => {
    class UploadXhr {
      upload = { onprogress: undefined as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | undefined };
      responseType = ""; response: unknown; status = 0; onload?: () => void; onerror?: () => void; onabort?: () => void;
      open() { /* test double */ }
      send() {
        this.status = 200;
        this.response = { id: "job-failure", phase: "queued", progress: 0, currentFrame: 0, totalFrames: 117 };
        this.onload?.();
      }
      abort() { this.onabort?.(); }
    }
    globalThis.XMLHttpRequest = UploadXhr as unknown as typeof XMLHttpRequest;
    const deleted: string[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        deleted.push(url);
        throw new Error("cleanup unavailable");
      }
      if (failure === "poll") throw new Error("poll network failed");
      return { ok: true, status: 200, json: async () => { throw new Error("invalid status json"); } } as unknown as Response;
    }) as unknown as typeof fetch;
    const promise = videoEditorInterpolateJob({ blob: new Blob(["source"]), fileName: "source.mp4", sourceFps: 30, targetFps: 60, method: "motion", signal: new AbortController().signal });
    await expect(promise).rejects.toThrow(failure === "poll" ? "poll network failed" : "invalid status json");
    expect(deleted).toContain(`${videoEditorInterpolationBaseUrl}/interpolation/jobs/job-failure`);
    expect(deleted.some((url) => url.startsWith(`${videoEditorInterpolationBaseUrl}/interpolation/clients/`))).toBe(true);
    expect(deleted).toHaveLength(2);
  });

  it("annulla client e job quando fallisce il download del risultato", async () => {
    class DownloadFailureXhr {
      upload = { onprogress: undefined as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | undefined };
      responseType = ""; response: unknown; status = 0; onload?: () => void; onerror?: () => void; onabort?: () => void; onprogress?: (event: { loaded: number; total: number; lengthComputable: boolean }) => void;
      open() { /* test double */ }
      send() {
        if (this.responseType === "json") {
          this.status = 200;
          this.response = { id: "job-download", phase: "queued", progress: 0, currentFrame: 0, totalFrames: 117 };
          this.onload?.();
        } else {
          this.onerror?.();
        }
      }
      abort() { this.onabort?.(); }
    }
    globalThis.XMLHttpRequest = DownloadFailureXhr as unknown as typeof XMLHttpRequest;
    const deleted: string[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        deleted.push(url);
        return { ok: true } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ id: "job-download", phase: "ready", progress: 1, stageProgress: 1, currentFrame: 117, totalFrames: 117 }) } as unknown as Response;
    }) as unknown as typeof fetch;
    await expect(videoEditorInterpolateJob({ blob: new Blob(["source"]), fileName: "source.mp4", sourceFps: 30, targetFps: 60, method: "motion", signal: new AbortController().signal })).rejects.toThrow("Download del video interpolato fallito");
    expect(deleted).toContain(`${videoEditorInterpolationBaseUrl}/interpolation/jobs/job-download`);
    expect(deleted.some((url) => url.startsWith(`${videoEditorInterpolationBaseUrl}/interpolation/clients/`))).toBe(true);
    expect(deleted).toHaveLength(2);
  });
});
