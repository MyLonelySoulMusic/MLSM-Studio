let startup: Promise<void> | null = null;

const apiReady = async () => {
  const response = await fetch("http://127.0.0.1:1430/api/state", { signal: AbortSignal.timeout(700) });
  if (!response.ok) throw new Error(`AutoPost HTTP ${response.status}`);
};

/** The web dev server owns AutoPost in browser mode; Tauri starts the bundled
 * local service on demand. Both use the legacy ~/.mlsm-autopost data folder. */
export function ensureAutoPostService(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) {
    startup ??= fetch("/__mlsm/autopost/start", { method: "POST" }).then(response => {
      if (!response.ok) throw new Error(`AutoPost HTTP ${response.status}`);
    }).catch(error => { startup = null; throw error; });
    return startup;
  }
  startup ??= (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("ensure_autopost_service");
    let lastError: unknown;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try { await apiReady(); return; }
      catch (error) { lastError = error; await new Promise((resolve) => window.setTimeout(resolve, 100)); }
    }
    startup = null;
    throw new Error("Il servizio AutoPost non si è avviato.", { cause: lastError });
  })();
  return startup;
}

export function resetAutoPostServiceForTests() { startup = null; }
