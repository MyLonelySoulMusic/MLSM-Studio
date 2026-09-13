let shutdownBarrier: Promise<void> = Promise.resolve();
let lifecycleRevision = 0;

/**
 * Stops Python processes owned by this MLSM Studio instance at an area boundary.
 * Calls are serialized so a new mode cannot restart a backend while the previous
 * process tree is still being reaped by Tauri.
 */
export function shutdownAreaPythonServices(): Promise<void> {
  lifecycleRevision += 1;
  shutdownBarrier = shutdownBarrier.catch(() => undefined).then(async () => {
    const requests: Promise<unknown>[] = [
      fetch("/__mlsm/python/upscaler/stop", { method: "POST" }).catch(() => undefined),
      fetch("/music/ai-quantizer/api/lifecycle/stop", { method: "POST" }).catch(() => undefined),
    ];
    if ("__TAURI_INTERNALS__" in globalThis) {
      requests.push(import("@tauri-apps/api/core").then(({ invoke }) => invoke("shutdown_area_python_services")));
    }
    await Promise.allSettled(requests);
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
