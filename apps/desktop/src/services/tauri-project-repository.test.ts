import { afterEach, describe, expect, it, vi } from "vitest";
import { TauriProjectRepository } from "./tauri-project-repository";

describe("browser project repository", () => {
  afterEach(() => vi.restoreAllMocks());
  it("salva tramite download senza invocare Tauri", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:project") }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const repository = new TauriProjectRepository(null); await repository.save("{\"schemaVersion\":1}");
    expect(click).toHaveBeenCalledOnce(); expect(repository.filePath).toBe("progetto.rbs.json"); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:project");
  });
});
