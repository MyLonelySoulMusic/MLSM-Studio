export interface InstallationCheck { ok: boolean; detail: string }
export interface InstallationReport {
  ok: boolean;
  platform: string;
  arch: string;
  checks: Record<string, InstallationCheck>;
}
export interface RestoreJob {
  state: "idle" | "running" | "success" | "error";
  progress: number;
  detail: string;
  logs: string[];
  restartRequired: boolean;
}
export type RestoreServiceId = "upscaler" | "quantizer" | "autopost";
export interface RestoreServiceStatus {
  id: RestoreServiceId;
  running: boolean;
  compatible: boolean;
  detail: string;
  progress?: number;
}

const services: Record<RestoreServiceId, { status: string; start: string; stop: string }> = {
  upscaler: { status: "/__mlsm/python/upscaler/status", start: "/__mlsm/python/upscaler/start", stop: "/__mlsm/python/upscaler/stop" },
  quantizer: { status: "/music/ai-quantizer/api/lifecycle/status", start: "/music/ai-quantizer/api/lifecycle/start", stop: "/music/ai-quantizer/api/lifecycle/stop" },
  autopost: { status: "/__mlsm/autopost/status", start: "/__mlsm/autopost/start", stop: "/__mlsm/autopost/stop" },
};

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error((body as { error?: string; detail?: string } | null)?.error || (body as { detail?: string } | null)?.detail || `HTTP ${response.status}`);
  return body as T;
}

export function scanInstallation(): Promise<InstallationReport> {
  return jsonRequest<InstallationReport>("/__mlsm/restore/scan");
}

export function startRepair(): Promise<RestoreJob> {
  return jsonRequest<RestoreJob>("/__mlsm/restore/repair", { method: "POST" });
}

export function readRepairJob(): Promise<RestoreJob> {
  return jsonRequest<RestoreJob>("/__mlsm/restore/job");
}

export async function readServiceStatus(id: RestoreServiceId): Promise<RestoreServiceStatus> {
  try {
    const value = await jsonRequest<Record<string, unknown>>(services[id].status);
    const running = value.running === true || value.ready === true;
    const compatible = value.compatible === undefined ? running : value.compatible === true;
    return {
      id,
      running,
      compatible,
      detail: String(value.detail || value.message || (running ? "Endpoint pronto" : "Endpoint arrestato")),
      ...(typeof value.progress === "number" ? { progress: value.progress } : {}),
    };
  } catch (error) {
    return { id, running: false, compatible: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export function readAllServiceStatuses(): Promise<RestoreServiceStatus[]> {
  return Promise.all((Object.keys(services) as RestoreServiceId[]).map(readServiceStatus));
}

const delay = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds));

export async function setServiceRunning(id: RestoreServiceId, running: boolean, onStatus?: (status: RestoreServiceStatus) => void): Promise<RestoreServiceStatus> {
  await jsonRequest<unknown>(running ? services[id].start : services[id].stop, { method: "POST" });
  for (let attempt = 0; attempt < (running ? 600 : 30); attempt += 1) {
    const status = await readServiceStatus(id);
    onStatus?.(status);
    if (running ? status.running && status.compatible : !status.running) return status;
    await delay(500);
  }
  throw new Error(`${id}: timeout durante ${running ? "l’avvio" : "l’arresto"}.`);
}

export async function setAllServicesRunning(running: boolean, onStatus?: (status: RestoreServiceStatus) => void): Promise<RestoreServiceStatus[]> {
  const result: RestoreServiceStatus[] = [];
  for (const id of Object.keys(services) as RestoreServiceId[]) result.push(await setServiceRunning(id, running, onStatus));
  return result;
}

export async function testServiceCycle(onStatus?: (status: RestoreServiceStatus) => void): Promise<RestoreServiceStatus[]> {
  const before = await readAllServiceStatuses();
  let cycleFailure: unknown;
  try {
    await setAllServicesRunning(false, onStatus);
    await setAllServicesRunning(true, onStatus);
  } catch (error) {
    cycleFailure = error;
  }
  let restoreFailure: unknown;
  for (const previous of before) {
    try {
      const current = await readServiceStatus(previous.id);
      if (current.running !== previous.running) await setServiceRunning(previous.id, previous.running, onStatus);
    } catch (error) {
      restoreFailure ??= error;
    }
  }
  if (cycleFailure) throw cycleFailure;
  if (restoreFailure) throw restoreFailure;
  return readAllServiceStatuses();
}

export async function restartStudio(): Promise<void> {
  await jsonRequest<{ restarting: boolean }>("/__mlsm/restore/restart", { method: "POST" });
  await delay(2_500);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(`/?restore=${Date.now()}`, { cache: "no-store" });
      if (response.ok) { window.location.reload(); return; }
    } catch { /* the old server is expected to disappear */ }
    await delay(1_000);
  }
  throw new Error("Il launcher non è tornato disponibile. Avvialo manualmente dalla cartella scripts della piattaforma.");
}
