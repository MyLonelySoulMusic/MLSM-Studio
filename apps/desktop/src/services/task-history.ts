export interface StudioTask { id: string; label: string; status: "running" | "completed" | "failed" | "cancelled" | "interrupted"; startedAt: number; finishedAt?: number; detail?: string }
const KEY = "mlsm.task-history.v1";
export const TASK_HISTORY_EVENT = "mlsm:task-history";
const active = new Set<string>();
export function readTaskHistory(): StudioTask[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(value) ? value.filter((x): x is StudioTask => x && typeof x.id === "string" && typeof x.label === "string" && typeof x.startedAt === "number").slice(0, 500).map(task => task.status === "running" && !active.has(task.id) ? { ...task, status: "interrupted" } : task) : []; } catch { return []; }
}
function writeHistory(tasks: StudioTask[]) { try { localStorage.setItem(KEY, JSON.stringify(tasks.slice(0, 500))); } catch { /* Operation must still run if storage is full. */ } window.dispatchEvent(new Event(TASK_HISTORY_EVENT)); }
export function hasActiveTasks() { return active.size > 0; }
export function clearTaskHistory() { writeHistory(readTaskHistory().filter(task => active.has(task.id))); }
export function beginTask(label: string) {
  const id = crypto.randomUUID(); active.add(id);
  writeHistory([{ id, label, startedAt: Date.now(), status: "running" }, ...readTaskHistory()]);
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
