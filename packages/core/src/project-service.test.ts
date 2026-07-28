import { describe, expect, it } from "vitest";
import { createProject } from "@rbs/project-schema";
import { MemoryProjectRepository, ProjectService } from "./index";

describe("ProjectService", () => {
  it("mantiene il progetto durante save/load", async () => {
    const repository = new MemoryProjectRepository();
    const service = new ProjectService(repository);
    const original = createProject("Round trip", new Date("2026-01-01T00:00:00.000Z"));
    const saved = await service.save(original);
    const loaded = await service.load();
    expect(loaded).toEqual(saved);
    expect(loaded?.project.name).toBe("Round trip");
  });

  it("rifiuta JSON non valido", async () => {
    const repository = new MemoryProjectRepository();
    repository.content = "{\"schemaVersion\":99}";
    await expect(new ProjectService(repository).load()).rejects.toThrow();
  });
  it("rifiuta JSON sintatticamente corrotto", async () => { const repository = new MemoryProjectRepository(); repository.content = "{"; await expect(new ProjectService(repository).load()).rejects.toThrow(); });
});
