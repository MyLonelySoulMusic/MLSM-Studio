import type { AnimationCategoryId } from "./animation-modes";

export type StudioTaskArea = AnimationCategoryId | "autopost" | "stickman" | "reports" | "postit" | "streamer" | "documentation";
export interface StudioTask { id: string; label: string; status: "running" | "completed" | "failed" | "cancelled" | "interrupted"; startedAt: number; finishedAt?: number; detail?: string; areaId?: StudioTaskArea }
const KEY = "mlsm.task-history.v1";
export const TASK_HISTORY_EVENT = "mlsm:task-history";
const active = new Set<string>();
let currentArea: StudioTaskArea | undefined;
export function setTaskHistoryArea(areaId: StudioTaskArea | undefined) { currentArea = areaId; }

/** Older activity entries do not carry an area. Only map unambiguous labels. */
export function taskHistoryArea(task: StudioTask): StudioTaskArea | undefined {
  if (task.areaId) return task.areaId;
  if (/^(?:Upscaler|Frame Booster)\b/i.test(task.label)) return "photoVideoStudio";
  if (/^Audio\b/i.test(task.label)) return "audio";
  if (/^Lipsync\b/i.test(task.label)) return "lipsync";
  return undefined;
}

export function areaActivityCounts(tasks: readonly StudioTask[]): Partial<Record<StudioTaskArea, number>> {
  const counts: Partial<Record<StudioTaskArea, number>> = {};
  for (const task of tasks) {
    const areaId = taskHistoryArea(task);
    if (areaId) counts[areaId] = (counts[areaId] ?? 0) + 1;
  }
  return counts;
}
export function readTaskHistory(): StudioTask[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(value) ? value.filter((x): x is StudioTask => x && typeof x.id === "string" && typeof x.label === "string" && typeof x.startedAt === "number").slice(0, 500).map(task => task.status === "running" && !active.has(task.id) ? { ...task, status: "interrupted" } : task) : []; } catch { return []; }
}
function writeHistory(tasks: StudioTask[]) { try { localStorage.setItem(KEY, JSON.stringify(tasks.slice(0, 500))); } catch { /* Operation must still run if storage is full. */ } window.dispatchEvent(new Event(TASK_HISTORY_EVENT)); }
export function hasActiveTasks() { return active.size > 0; }
export function clearTaskHistory() { writeHistory(readTaskHistory().filter(task => active.has(task.id))); }
export function beginTask(label: string) {
  const id = crypto.randomUUID(); active.add(id);
  writeHistory([{ id, label, startedAt: Date.now(), status: "running", ...(currentArea ? { areaId: currentArea } : {}) }, ...readTaskHistory()]);
  return (status: StudioTask["status"], detail?: string) => {
    const tasks = readTaskHistory().map(task => task.id === id ? { ...task, status, finishedAt: Date.now(), ...(detail ? { detail: detail.slice(0, 600) } : {}) } : task);
    active.delete(id); writeHistory(tasks);
  };
}
export async function trackTask<T>(label: string, action: () => Promise<T>): Promise<T> {
  const finish = beginTask(label);
  try { const result = await action(); finish("completed"); return result; }
  catch (error) { finish(error instanceof DOMException && error.name === "AbortError" ? "cancelled" : "failed", error instanceof Error ? error.message : String(error)); throw error; }
}
