import type { RhythmBallProject } from "@rbs/project-schema";
import type { EditableSceneObject } from "../store/scene-store";
import { getAnimationMode } from "./animation-modes";
import { generateNewYorkScene } from "./new-york-scene-generator";
import { generateScene } from "./scene-generator";

export function generateSceneForMode(project: RhythmBallProject, count?: number): EditableSceneObject[] {
  const mode = getAnimationMode(project.animation.modeId);
  if (mode.generator === "coverSphere" || mode.generator === "stereoUnfold" || mode.generator === "walkingCube" || mode.generator === "pixelArt" || mode.generator === "teddyWalk" || mode.generator === "teddySing" || mode.generator === "addSubtitles") return [];
  if (mode.generator === "newYorkStreets") return generateNewYorkScene(project.events, project.project.seed, count);
  return generateScene(project.events, project.project.seed, "neon", count, project.animation.baseObjectTypes);
}
