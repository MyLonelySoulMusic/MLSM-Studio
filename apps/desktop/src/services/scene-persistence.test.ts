import { describe, expect, it } from "vitest";
import { parseProject, createProject } from "@rbs/project-schema";
import { generateScene } from "./scene-generator";
import { deserializeSceneObjects, serializeSceneObjects } from "./scene-persistence";

describe("scene persistence", () => {
  it("salva oggetti conformi allo schema e conserva i valori editabili", () => {
    const scene = generateScene([], 42, "neon", 5); const serialized = serializeSceneObjects(scene);
    expect(() => parseProject({ ...createProject(), objects: serialized })).not.toThrow();
    expect(deserializeSceneObjects(serialized)).toEqual(scene);
  });
  it("rifiuta strutture oggetto incomplete", () => { expect(() => parseProject({ ...createProject(), objects: [{ id: "broken" }] })).toThrow(); });
});
