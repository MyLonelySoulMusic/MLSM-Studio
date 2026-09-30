import { invoke, isTauri } from "@tauri-apps/api/core";

export async function fetchRealPostItFavicon(link: string): Promise<string | null> {
  if (!link) return null;
  try {
    if (isTauri()) return await invoke<string | null>("fetch_postit_favicon", { url: link });
    const response = await fetch("/__mlsm/postit/favicon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: link }) });
    if (!response.ok) return null;
    const payload = await response.json() as { faviconUrl?: unknown };
    return typeof payload.faviconUrl === "string" && payload.faviconUrl.startsWith("data:image/") ? payload.faviconUrl : null;
  } catch { return null; }
}

export function isGeneratedPostItFavicon(value: string): boolean { return value.startsWith("data:image/svg+xml") && decodeURIComponent(value).includes("font-family=\"Arial,sans-serif\""); }
