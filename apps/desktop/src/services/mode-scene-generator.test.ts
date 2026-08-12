import { describe, expect, it } from "vitest";
import { createProject } from "@rbs/project-schema";
import { generateSceneForMode } from "./mode-scene-generator";

describe("mode scene generator", () => {
  it("instrada New York Streets al generatore urbano", () => { const project = createProject(); project.animation.modeId = "newYorkStreets"; project.animation.baseObjectTypes = ["pebble"]; expect(generateSceneForMode(project, 5).map((object) => object.type)).toEqual(["pebble", "pebble", "pebble", "pebble", "pebble"]); });
  it("non genera ostacoli nella modalità Cover Sphere", () => { const project = createProject(); project.animation.modeId = "coverSphere"; expect(generateSceneForMode(project)).toEqual([]); });
  it("non genera ostacoli nella modalità Stereo Unfold", () => { const project = createProject(); project.animation.modeId = "stereoUnfold"; expect(generateSceneForMode(project)).toEqual([]); });
  it("non genera ostacoli nella modalità Cube Animation", () => { const project = createProject(); project.animation.modeId = "walkingCube"; expect(generateSceneForMode(project)).toEqual([]); });
  it("non genera ostacoli nella modalità Teddy Walk", () => { const project = createProject(); project.animation.modeId = "teddyWalk"; expect(generateSceneForMode(project)).toEqual([]); });
  it("non genera ostacoli nella modalità Teddy Sing", () => { const project = createProject(); project.animation.modeId = "teddySing"; expect(generateSceneForMode(project)).toEqual([]); });
});
