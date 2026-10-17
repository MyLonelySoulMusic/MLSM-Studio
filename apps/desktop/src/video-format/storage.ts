import type { VideoFormat } from './model';
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mlsm-video-formats', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('formats', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readFormats(): Promise<VideoFormat[]> {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const request = db.transaction('formats').objectStore('formats').getAll(); request.onsuccess = () => resolve(request.result as VideoFormat[]); request.onerror = () => reject(request.error); }); }
  finally { db.close(); }
}
export async function saveFormat(format: VideoFormat): Promise<void> {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('formats', 'readwrite'); tx.objectStore('formats').put(format); tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Salvataggio non riuscito.')); }); }
  finally { db.close(); }
}
