export const ANALYSIS_DATABASE_NAME = "rhythm-ball-analysis";
export const ANALYSIS_STORE_NAME = "analyses";
export const SONG_PLAYER_ANALYSIS_STORE_NAME = "song-player-analysis";
export const MLSM_POST_LIPSYNC_STORE_NAME = "mlsm-post-lipsync-analysis";

const requiredStores = [ANALYSIS_STORE_NAME, SONG_PLAYER_ANALYSIS_STORE_NAME, MLSM_POST_LIPSYNC_STORE_NAME] as const;

function createMissingStores(database: IDBDatabase): void {
  requiredStores.forEach((storeName) => {
    if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName);
  });
}

function openRequest(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = version === undefined
      ? indexedDB.open(ANALYSIS_DATABASE_NAME)
      : indexedDB.open(ANALYSIS_DATABASE_NAME, version);
    request.onupgradeneeded = () => createMissingStores(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Impossibile aprire la cache delle analisi audio."));
    request.onblocked = () => reject(new Error("La cache audio è bloccata da un’altra scheda. Chiudi le altre schede e riprova."));
  });
}

function hasRequiredStores(database: IDBDatabase): boolean {
  return requiredStores.every((storeName) => database.objectStoreNames.contains(storeName));
}

export async function openAnalysisDatabase(): Promise<IDBDatabase> {
  // Opening without a requested version always adopts the newest database. This
  // prevents VersionError when an older app path meets a cache already upgraded.
  const current = await openRequest();
  if (hasRequiredStores(current)) return current;

  const nextVersion = current.version + 1;
  current.close();
  try {
    return await openRequest(nextVersion);
  } catch (error) {
    // Another tab may have completed the same migration first. Re-open its latest
    // version instead of retrying a now-stale numeric version.
    if (error instanceof DOMException && error.name === "VersionError") {
      const latest = await openRequest();
      if (hasRequiredStores(latest)) return latest;
      latest.close();
    }
    throw error;
  }
}
