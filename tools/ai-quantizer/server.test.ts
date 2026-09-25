import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

type Project = {
  id: string;
  name: string;
  tracks: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

type Api = (request: { method: string; [Symbol.asyncIterator]?: () => AsyncIterator<Buffer> }, response: ResponseCapture, url: URL) => Promise<unknown>;
type LoadedApi = Api & {
  alignmentRenderPlan: (sourceFrames: number, alignment: Record<string, unknown>) => { filters: string[]; outputFrames: number; shiftFrames: number };
};

type ResponseCapture = {
  statusCode?: number;
  headers: Record<string, string | number>;
  body?: Buffer;
  writeHead: (status: number, headers?: Record<string, string | number>) => ResponseCapture;
  end: (body?: Buffer | string) => void;
};

const requireFromTest = createRequire(import.meta.url);
const serverPath = resolve(process.cwd(), "tools/ai-quantizer/server.cjs");
const temporaryDirectories: string[] = [];

function responseCapture(): ResponseCapture {
  const response: ResponseCapture = {
    headers: {},
    writeHead(status, headers = {}) {
      response.statusCode = status;
      response.headers = headers;
      return response;
    },
    end(body) {
      response.body = body === undefined ? Buffer.alloc(0) : Buffer.from(body);
    }
  };
  return response;
}

function requestWithJson(body: unknown): { method: string; [Symbol.asyncIterator]: () => AsyncIterator<Buffer> } {
  const encoded = Buffer.from(JSON.stringify(body));
  return {
    method: "PUT",
    async *[Symbol.asyncIterator]() { yield encoded; }
  };
}

async function loadApi(dataRoot: string, realProcesses = false): Promise<LoadedApi> {
  const source = await readFile(serverPath, "utf8");
  const serverStart = source.indexOf("\nconst server = http.createServer");
  if (serverStart < 0) throw new Error("Unable to isolate the API from server startup");
  const isolatedSource = `${source.slice(0, serverStart)}\nmodule.exports = { api, alignmentRenderPlan };`;
  const module = { exports: {} as { api?: LoadedApi; alignmentRenderPlan?: LoadedApi['alignmentRenderPlan'] } };
  const childProcess = {
    spawn: () => { throw new Error("external process must not run in module API tests"); },
    spawnSync: () => ({ status: 0, stdout: "", stderr: "" })
  };
  const context = {
    Buffer,
    URL,
    console,
    module,
    exports: module.exports,
    __dirname: resolve(serverPath, ".."),
    __filename: serverPath,
    process: { ...process, env: { ...process.env, AIQ_DATA_ROOT: dataRoot } },
    require: (specifier: string) => specifier === "child_process"
      ? realProcesses ? requireFromTest(specifier) : childProcess
      : requireFromTest(specifier)
  };
  vm.runInNewContext(isolatedSource, context, { filename: serverPath });
  if (typeof module.exports.api !== "function") throw new Error("API handler was not exported");
  if (typeof module.exports.alignmentRenderPlan !== "function") throw new Error("Alignment renderer was not exported");
  module.exports.api.alignmentRenderPlan = module.exports.alignmentRenderPlan;
  return module.exports.api;
}

function fixtureProject(): Project {
  return {
    id: "project-test",
    name: "Regression Song",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    settings: { targetBpm: 120 },
    warpMap: { points: [{ source: 0, target: 0 }, { source: 1, target: 1 }], savedAt: "2026-01-01T00:00:00.000Z" },
    alignment: { enabled: true, shiftSeconds: 0.1 },
    modules: { quantize: true, align: true, restoration: true, mastering: true, ai: true },
    restoration: { clean: true, intensity: 35 },
    mastering: { gainDb: 0, limiterEnabled: true },
    loudness: { preMaster: { integratedLufs: -14 }, postMaster: { integratedLufs: -14 } },
    aiDetection: {
      original: { analyzedAt: "2026-01-01T00:00:01.000Z" },
      quantized: { analyzedAt: "2026-01-01T00:00:02.000Z" },
      restored: { analyzedAt: "2026-01-01T00:00:03.000Z" },
      mastered: { analyzedAt: "2026-01-01T00:00:04.000Z" }
    },
    tracks: [
      {
        id: "master-track", role: "master", name: "Master.wav", source: "uploads/master.wav",
        output: "outputs/master-quantized.wav", processedAt: "2026-01-01T00:00:00.000Z",
        outputDuration: 1, restored: "outputs/master-restored.wav", restoredAt: "2026-01-01T00:00:01.000Z",
        mastered: "outputs/master-mastered.wav", masteredAt: "2026-01-01T00:00:02.000Z"
      },
      {
        id: "stem-track", role: "stem", name: "Stem.wav", source: "uploads/stem.wav",
        output: "outputs/stem-quantized.wav", processedAt: "2026-01-01T00:00:00.000Z", outputDuration: 1
      }
    ]
  };
}

async function installProject(dataRoot: string, project = fixtureProject()): Promise<Project> {
  const directory = join(dataRoot, project.id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "project.json"), JSON.stringify(project, null, 2));
  return project;
}

async function callModules(api: Api, projectId: string, body: unknown) {
  const response = responseCapture();
  await api(requestWithJson(body), response, new URL(`http://localhost/api/projects/${projectId}/modules`));
  return { response, project: JSON.parse(await readFile(join(currentDataRoot!, projectId, "project.json"), "utf8")) as Project };
}

let currentDataRoot: string | undefined;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
  currentDataRoot = undefined;
});

async function setup(realProcesses = false) {
  const dataRoot = await mkdtemp(join(tmpdir(), "mlsm-aiq-server-test-"));
  temporaryDirectories.push(dataRoot);
  currentDataRoot = dataRoot;
  const api = await loadApi(dataRoot, realProcesses);
  const project = fixtureProject();
  await installProject(dataRoot, project);
  return { api, project };
}

describe("AI Quantizer modules API", () => {
  it("accepts only the five boolean module flags and persists partial changes", async () => {
    const { api, project } = await setup();
    const { response, project: saved } = await callModules(api, project.id, {
      quantize: true, align: true, restoration: true, mastering: false, ai: false
    });

    expect(response.statusCode).toBe(200);
    expect(saved.modules).toEqual({ quantize: true, align: true, restoration: true, mastering: false, ai: false });
    expect(saved.tracks[0]).toMatchObject({ output: "outputs/master-quantized.wav", restored: "outputs/master-restored.wav", mastered: "outputs/master-mastered.wav" });
    expect(saved.loudness).toEqual(project.loudness);

    for (const invalid of [{ quantize: "false" }, { unknown: true }, [], null]) {
      await expect(api(requestWithJson(invalid), responseCapture(), new URL(`http://localhost/api/projects/${project.id}/modules`)))
        .rejects.toThrow("Impostazioni dei passaggi non valide");
    }
  });

  it("invalidates processed audio for quantization changes but preserves it for alignment choices", async () => {
    const quantizeSetup = await setup();
    const quantized = await callModules(quantizeSetup.api, quantizeSetup.project.id, { quantize: false });
    expect(quantized.project.tracks.every(track => track.output == null && track.restored == null && track.mastered == null)).toBe(true);

    const alignmentSetup = await setup();
    const aligned = await callModules(alignmentSetup.api, alignmentSetup.project.id, { align: false });
    expect(aligned.response.statusCode).toBe(200);
    expect(aligned.project.modules).toMatchObject({ align: false });
    expect(aligned.project.tracks[0]).toMatchObject({ output: "outputs/master-quantized.wav" });
    expect(aligned.project.tracks[1]).toMatchObject({ output: "outputs/stem-quantized.wav" });
  });

  it("rejects an unreliable beat map without rewriting or processing it", async () => {
    const { api, project } = await setup();
    const before = JSON.parse(await readFile(join(currentDataRoot!, project.id, "project.json"), "utf8")) as Project;
    await expect(api(requestWithJson({
      points: [
        { source: 0, target: 0 },
        { source: 0, target: 0 },
        { source: 1, target: 1 }
      ],
      sourceDuration: 3,
      estimatedBpm: 120,
      confidence: 80,
      settings: { targetBpm: 120 }
    }), responseCapture(), new URL(`http://localhost/api/projects/${project.id}/warp-map`)))
      .rejects.toThrow("Il brano non è quantizzabile automaticamente");

    const after = JSON.parse(await readFile(join(currentDataRoot!, project.id, "project.json"), "utf8")) as Project;
    expect(after.warpMap).toEqual(before.warpMap);
    expect(after.tracks).toEqual(before.tracks);
  });

  it("builds alignment-only FFmpeg filters without any quantization stage", async () => {
    const { api } = await setup();
    const forward = api.alignmentRenderPlan(480_000, { enabled: true, shiftSeconds: 1, fadeSeconds: .15 });
    expect(forward.shiftFrames).toBe(48_000);
    expect(forward.outputFrames).toBe(528_000);
    expect(forward.filters).toContain("adelay=1000.000000:all=1");
    expect(forward.filters.join(",")).toContain("afade=t=in:st=1.000000:d=0.150000");

    const source = await readFile(serverPath, "utf8");
    const alignmentOnly = source.slice(source.indexOf("async function applyAlignmentToTrack"), source.indexOf("async function serveFile"));
    expect(alignmentOnly).toContain("run(FFMPEG");
    expect(alignmentOnly).not.toContain("rubberband");
    expect(alignmentOnly).not.toContain("sharedWarpTimeline");
  });

  it("applies alignment to existing quantized WAVs and keeps a reusable base", async () => {
    const { api, project } = await setup(true);
    project.alignment = null;
    project.restoration = undefined;
    project.mastering = undefined;
    project.loudness = null;
    for (const track of project.tracks) {
      track.alignment = null;
      track.restored = null;
      track.mastered = null;
      const output = join(currentDataRoot!, project.id, String(track.output));
      await mkdir(resolve(output, ".."), { recursive: true });
      const generated = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.25", "-ar", "48000", "-c:a", "pcm_f32le", output]);
      expect(generated.status).toBe(0);
    }
    await writeFile(join(currentDataRoot!, project.id, "project.json"), JSON.stringify(project, null, 2));
    const response = responseCapture();
    await api(requestWithJson({
      modules: { align: true },
      alignment: { enabled: true, shiftSeconds: .1, fadeSeconds: .02, mode: "forward" }
    }), response, new URL(`http://localhost/api/projects/${project.id}/alignment`));

    expect(response.statusCode).toBe(200);
    const saved = JSON.parse(await readFile(join(currentDataRoot!, project.id, "project.json"), "utf8")) as Project;
    expect(saved.workflow).toMatchObject({ alignmentReviewed: true });
    for (const track of saved.tracks) {
      expect(track.quantizedBase).toMatch(/^work[/\\]/);
      const base = join(currentDataRoot!, project.id, String(track.quantizedBase));
      expect((await readFile(base)).byteLength).toBeGreaterThan(1_000);
      const output = join(currentDataRoot!, project.id, String(track.output));
      const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", output], { encoding: "utf8" });
      expect(Number(probe.stdout.trim())).toBeGreaterThan(.3);
    }
    const masterOutput = join(currentDataRoot!, project.id, String(saved.tracks[0].output));
    const firstModified = (await stat(masterOutput)).mtimeMs;
    await api(requestWithJson({
      modules: { align: true },
      alignment: { enabled: true, shiftSeconds: .1, fadeSeconds: .02, mode: "forward" }
    }), responseCapture(), new URL(`http://localhost/api/projects/${project.id}/alignment`));
    expect((await stat(masterOutput)).mtimeMs).toBe(firstModified);
  });

  it("keeps restored audio but invalidates derived mastering when restoration toggles", async () => {
    const { api, project } = await setup();
    const { response, project: saved } = await callModules(api, project.id, { restoration: false });

    expect(response.statusCode).toBe(200);
    expect(saved.modules).toMatchObject({ restoration: false });
    expect(saved.tracks[0]).toMatchObject({ output: "outputs/master-quantized.wav", restored: "outputs/master-restored.wav", mastered: null, masteredAt: null, masteredDerivedFrom: null });
    expect(saved.tracks[1]).toMatchObject({ output: "outputs/stem-quantized.wav" });
    expect(saved.loudness).toBeNull();
    expect(saved.restoration).toEqual(project.restoration);
    expect(saved.mastering).toBeUndefined();
    expect(saved.aiDetection).not.toHaveProperty("mastered");
  });
});
