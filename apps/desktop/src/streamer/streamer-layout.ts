export const widgetIds = ["vinyl", "peaks", "spectrum", "loudness", "stereo", "phase", "spectrogram", "waveform", "dynamics", "tonal", "track"] as const;
export type WidgetId = typeof widgetIds[number];
export interface PanelLayout { id: WidgetId; width: number; height: number; visible: boolean; }

// A new key deliberately replaces the original all-widgets view with the
// considered six-widget monitoring workspace. The previous custom layout is
// left untouched in browser storage, rather than silently being discarded.
const key = "mlsm.streamer.layout.v2";

const defaults: Record<WidgetId, Omit<PanelLayout, "id">> = {
  // First three rows: player/meter, spectrum/LUFS, image/correlation.
  vinyl: { width: 8, height: 4, visible: true },
  peaks: { width: 4, height: 4, visible: true },
  spectrum: { width: 8, height: 3, visible: true },
  loudness: { width: 4, height: 3, visible: true },
  stereo: { width: 8, height: 3, visible: true },
  phase: { width: 4, height: 3, visible: true },
  spectrogram: { width: 6, height: 3, visible: false },
  waveform: { width: 6, height: 3, visible: false },
  dynamics: { width: 4, height: 3, visible: false },
  tonal: { width: 4, height: 3, visible: false },
  track: { width: 4, height: 3, visible: false },
};

export const defaultLayout = (): PanelLayout[] => widgetIds.map(id => ({ id, ...defaults[id] }));

export function readLayout(): PanelLayout[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null") as PanelLayout[] | null;
    if (!Array.isArray(raw)) return defaultLayout();
    const seen = new Set<string>();
    const valid = raw
      .filter(item => item && widgetIds.includes(item.id) && !seen.has(item.id) && seen.add(item.id))
      .map(item => ({ id: item.id, width: Math.max(3, Math.min(12, Number(item.width) || 4)), height: Math.max(2, Math.min(7, Number(item.height) || 3)), visible: item.visible !== false }));
    return [...valid, ...defaultLayout().filter(item => !seen.has(item.id))];
  } catch {
    return defaultLayout();
  }
}

export function saveLayout(layout: PanelLayout[]) { localStorage.setItem(key, JSON.stringify(layout)); }
