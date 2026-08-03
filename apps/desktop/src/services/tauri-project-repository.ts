import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { ProjectRepository } from "@rbs/core";

export class TauriProjectRepository implements ProjectRepository {
  private browserContent: string | null = null;
  constructor(private path: string | null) {}
  get filePath(): string | null { return this.path; }

  async chooseForLoad(): Promise<boolean> {
    if (!isTauri()) { const file = await new Promise<File | null>((resolve) => { const input = document.createElement("input"); input.type = "file"; input.accept = ".json,.rbs.json,application/json"; input.onchange = () => resolve(input.files?.[0] ?? null); input.addEventListener("cancel", () => resolve(null), { once: true }); input.click(); }); if (!file) return false; this.browserContent = await file.text(); this.path = file.name; return true; }
    const selected = await open({ multiple: false, filters: [{ name: "MLSM Studio", extensions: ["rbs.json", "json"] }] });
    if (typeof selected !== "string") return false;
    this.path = selected;
    return true;
  }

  async load(): Promise<string | null> {
    if (!isTauri()) return this.browserContent;
    if (!this.path) return null;
    return invoke<string>("read_project", { path: this.path });
  }

  async save(content: string): Promise<void> {
    if (!isTauri()) { const blob = new Blob([content], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = this.path ?? "progetto.rbs.json"; anchor.click(); URL.revokeObjectURL(url); this.path = anchor.download; return; }
    if (!this.path) {
      const selected = await save({ defaultPath: "progetto.rbs.json", filters: [{ name: "MLSM Studio", extensions: ["rbs.json"] }] });
      if (typeof selected !== "string") throw new Error("Salvataggio annullato");
      this.path = selected;
    }
    await invoke("write_project", { path: this.path, content });
  }
}
