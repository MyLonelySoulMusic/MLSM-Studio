let shutdownBarrier: Promise<void> = Promise.resolve();
let lifecycleRevision = 0;

/**
 * Stops Python processes owned by this MLSM Studio instance at an area boundary.
 * Calls are serialized so a new mode cannot restart a backend while the previous
 * process tree is still being reaped by Tauri.
 */
export function shutdownAreaPythonServices(reason = "area-boundary"): Promise<void> {
  lifecycleRevision += 1;
  const revision = lifecycleRevision;
  console.info("[MLSM Python lifecycle] shutdown queued", { revision, reason });
  shutdownBarrier = shutdownBarrier.catch(() => undefined).then(async () => {
    const requests: Promise<unknown>[] = [
      fetch("/__mlsm/python/upscaler/stop", { method: "POST", signal: AbortSignal.timeout(5_000) }),
      fetch("/music/ai-quantizer/api/lifecycle/stop", { method: "POST", signal: AbortSignal.timeout(5_000) }),
    ];
    if ("__TAURI_INTERNALS__" in globalThis) {
      requests.push(import("@tauri-apps/api/core").then(({ invoke }) => invoke("shutdown_area_python_services")));
    }
    const results = await Promise.allSettled(requests);
    console.info("[MLSM Python lifecycle] shutdown completed", {
      revision, reason,
      results: results.map((result) => result.status === "fulfilled" ? "fulfilled" : `rejected: ${String(result.reason)}`),
    });
  }).catch((error) => {
    console.warn("[MLSM Python lifecycle] shutdown failed", error);
  });
  return shutdownBarrier;
}

export function waitForAreaPythonServicesShutdown(): Promise<void> {
  return shutdownBarrier;
}

export function pythonServiceLifecycleRevision(): number {
  return lifecycleRevision;
}
