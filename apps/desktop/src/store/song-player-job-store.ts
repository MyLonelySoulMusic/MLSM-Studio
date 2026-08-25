import { create } from "zustand";
import { cancelSongPlayerJob, getSongPlayerJob, isSongPlayerJobTerminal, startSongPlayerJob, subscribeSongPlayerJob, type SongPlayerJobRequest, type SongPlayerJobSnapshot } from "../services/song-player-native";

export interface SongPlayerJobOwner { projectId: string; fragmentHash?: string; fullTrackHash?: string; operationEpoch?: number; }
export interface OwnedSongPlayerJob extends SongPlayerJobSnapshot { kind: SongPlayerJobRequest["kind"]; owner: SongPlayerJobOwner; }
interface SongPlayerJobState {
  jobs: Record<string, OwnedSongPlayerJob>; activeJobId: string | null; projectId: string | null;
  begin: (request: SongPlayerJobRequest, owner: SongPlayerJobOwner) => Promise<OwnedSongPlayerJob>;
  refresh: (jobId: string) => Promise<void>; cancelActive: () => Promise<void>; clearTerminal: () => void;
  replaceProject: (projectId: string) => void; dispose: () => void;
}

const pollingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const subscriptions = new Map<string, () => void>();
function clearJobResources(jobId: string): void {
  const timer = pollingTimers.get(jobId); if (timer !== undefined) clearTimeout(timer); pollingTimers.delete(jobId);
  subscriptions.get(jobId)?.(); subscriptions.delete(jobId);
}
function clearAllResources(): void { [...new Set([...pollingTimers.keys(), ...subscriptions.keys()])].forEach(clearJobResources); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export const useSongPlayerJobStore = create<SongPlayerJobState>((set, get) => ({
  jobs: {}, activeJobId: null, projectId: null,
  begin: async (request, owner) => {
    const state = get();
    if (state.projectId && state.projectId !== owner.projectId) throw new Error("Il progetto è cambiato: richiesta Song Player ignorata.");
    const active = state.activeJobId ? state.jobs[state.activeJobId] : null;
    if (active && !isSongPlayerJobTerminal(active.status)) throw new Error("Attendi o annulla il job Song Player già in corso.");
    const initial = await startSongPlayerJob(request); if (!initial.jobId) throw new Error("Il worker non ha restituito un jobId.");
    const owned: OwnedSongPlayerJob = { ...initial, kind: initial.kind ?? request.kind, owner };
    set((current) => current.projectId && current.projectId !== owner.projectId ? current : ({ jobs: { ...current.jobs, [owned.jobId]: owned }, activeJobId: owned.jobId, projectId: owner.projectId }));
    if (get().jobs[owned.jobId] !== owned) { await cancelSongPlayerJob(owned.jobId).catch(() => undefined); throw new Error("Il progetto è cambiato durante l’avvio del job."); }
    subscriptions.set(owned.jobId, subscribeSongPlayerJob(owned.jobId, (event) => {
      const current = get(); const existing = current.jobs[event.jobId];
      if (!existing || current.projectId !== existing.owner.projectId || isSongPlayerJobTerminal(existing.status)) return;
      set((value) => ({ jobs: { ...value.jobs, [event.jobId]: { ...event, kind: event.kind ?? existing.kind, owner: existing.owner } } }));
      if (isSongPlayerJobTerminal(event.status)) clearJobResources(event.jobId);
    }));
    if (!isSongPlayerJobTerminal(owned.status)) void get().refresh(owned.jobId);
    return owned;
  },
  refresh: async (jobId) => {
    const before = get().jobs[jobId]; if (!before || get().projectId !== before.owner.projectId) { clearJobResources(jobId); return; }
    try {
      const snapshot = await getSongPlayerJob(jobId); const current = get().jobs[jobId];
      if (!current || get().projectId !== current.owner.projectId || isSongPlayerJobTerminal(current.status)) { clearJobResources(jobId); return; }
      const next: OwnedSongPlayerJob = { ...snapshot, kind: snapshot.kind ?? current.kind, owner: current.owner };
      set((state) => ({ jobs: { ...state.jobs, [jobId]: next } }));
      if (isSongPlayerJobTerminal(next.status)) { clearJobResources(jobId); return; }
      pollingTimers.set(jobId, setTimeout(() => { pollingTimers.delete(jobId); void get().refresh(jobId); }, 250));
    } catch (error) {
      const current = get().jobs[jobId]; if (!current || isSongPlayerJobTerminal(current.status)) { clearJobResources(jobId); return; } clearJobResources(jobId);
      await cancelSongPlayerJob(jobId).catch(() => undefined);
      const latest = get().jobs[jobId]; if (!latest || get().projectId !== current.owner.projectId) return;
      set((state) => ({ jobs: { ...state.jobs, [jobId]: { ...latest, status: "failed", error: { code: "poll_failed", message: errorMessage(error) } } } }));
    }
  },
  cancelActive: async () => {
    const jobId = get().activeJobId; if (!jobId) return;
    try {
      await cancelSongPlayerJob(jobId); clearJobResources(jobId);
      set((state) => { const job = state.jobs[jobId]; return job ? { jobs: { ...state.jobs, [jobId]: { ...job, status: "cancelled", error: null } } } : state; });
    } catch (error) {
      clearJobResources(jobId);
      set((state) => { const job = state.jobs[jobId]; return job ? { jobs: { ...state.jobs, [jobId]: { ...job, status: "failed", error: { code: "cancel_failed", message: errorMessage(error) } } } } : state; });
      throw error;
    }
  },
  clearTerminal: () => set((state) => ({ jobs: Object.fromEntries(Object.entries(state.jobs).filter(([, job]) => !isSongPlayerJobTerminal(job.status))), activeJobId: state.activeJobId && !isSongPlayerJobTerminal(state.jobs[state.activeJobId]?.status ?? "failed") ? state.activeJobId : null })),
  replaceProject: (projectId) => { if (get().projectId === projectId) return; const activeJobId = get().activeJobId; clearAllResources(); if (activeJobId) void cancelSongPlayerJob(activeJobId).catch(() => undefined); set({ jobs: {}, activeJobId: null, projectId }); },
  dispose: () => { const activeJobId = get().activeJobId; clearAllResources(); if (activeJobId) void cancelSongPlayerJob(activeJobId).catch(() => undefined); set({ jobs: {}, activeJobId: null }); }
}));
