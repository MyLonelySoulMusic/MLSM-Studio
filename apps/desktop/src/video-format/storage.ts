import type { VideoFormat } from './model';
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mlsm-video-formats', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('formats')) request.result.createObjectStore('formats', { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains('videos')) request.result.createObjectStore('videos', { keyPath: 'id' });
    };
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


export interface SavedFormatVideo { id: string; formatId: string; name: string; updatedAt: number; snapshot: VideoFormat }
export function cleanTemplate(format: VideoFormat): VideoFormat {
  return { ...format, uploads: [], clips: [], transitions: {} };
}
export async function readFormatVideos(): Promise<SavedFormatVideo[]> {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const request = db.transaction('videos').objectStore('videos').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  finally { db.close(); }
}
export async function saveFormatVideo(video: SavedFormatVideo): Promise<void> {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['formats', 'videos'], 'readwrite');
    tx.objectStore('formats').put(cleanTemplate(video.snapshot));
    tx.objectStore('videos').put(video);
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function deleteFormatVideo(id: string): Promise<void> {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('videos', 'readwrite'); tx.objectStore('videos').delete(id); tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); }); }
  finally { db.close(); }
}
