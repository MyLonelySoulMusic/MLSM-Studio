import type { RhythmBallProject } from "@rbs/project-schema";
import type { EditableSceneObject } from "../store/scene-store";

function randomGenerator(seed: number): () => number { let state = seed >>> 0; return () => { state += 0x6d2b79f5; let value = state; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4_294_967_296; }; }

export const newYorkSewerLevelDrop = 8.2;

export function newYorkSewerEntryIndex(objects: readonly EditableSceneObject[]): number {
  let largestDrop = 0; let entry = Math.max(1, Math.floor(objects.length * .56));
  for (let index = 1; index < objects.length; index += 1) { const drop = (objects[index - 1]?.position[1] ?? 0) - (objects[index]?.position[1] ?? 0); if (drop > largestDrop) { largestDrop = drop; entry = index; } }
  return entry;
}

export function normalizeNewYorkLevels(objects: readonly EditableSceneObject[]): EditableSceneObject[] {
  if (objects.length < 2) return [...objects]; const entry = newYorkSewerEntryIndex(objects); const street = objects[entry - 1]; const sewer = objects[entry]; if (!street || !sewer) return [...objects]; const currentDrop = street.position[1] - sewer.position[1]; const correctionY = Math.max(0, newYorkSewerLevelDrop - currentDrop); const correctionX = street.position[0] - sewer.position[0]; const correctionZ = street.position[2] - sewer.position[2]; if (correctionY <= .001 && Math.abs(correctionX) <= .001 && Math.abs(correctionZ) <= .001) return [...objects];
  return objects.map((object, index) => index < entry ? object : { ...object, position: [object.position[0] + correctionX, object.position[1] - correctionY, object.position[2] + correctionZ] });
}

export function generateNewYorkScene(events: RhythmBallProject["events"], seed: number, count?: number): EditableSceneObject[] {
  const random = randomGenerator(seed ^ 0x4e5953); const anchors = events.filter((event) => event.enabled && event.action !== "nearMiss" && event.action !== "freeFall"); const targetCount = Math.max(1, Math.min(count ?? (anchors.length || 8), 240)); const sewerEntry = Math.max(1, Math.min(targetCount - 1, Math.round(targetCount * .56)));
  const objects: EditableSceneObject[] = []; let x = 0; let y = 1.35; let z = 4.5; let heading = 0;
  for (let index = 0; index < targetCount; index += 1) {
    const inSewer = index >= sewerEntry;
    if (index > 0 && index === sewerEntry) { y -= newYorkSewerLevelDrop; heading *= .35; }
    else if (index > 0) {
      const step = inSewer ? 3.35 + random() * .75 : 4.15 + random() * .95; heading = Math.max(-.18, Math.min(.18, heading + (random() - .5) * (inSewer ? .12 : .085)));
      let candidateX = x + Math.sin(heading) * step + (random() - .5) * (inSewer ? .2 : .32); if (Math.abs(candidateX) > (inSewer ? 2.1 : 2.45)) { heading *= -.72; candidateX = Math.max(inSewer ? -2.1 : -2.45, Math.min(inSewer ? 2.1 : 2.45, candidateX)); }
      x = candidateX; z -= Math.cos(heading) * step; y -= inSewer ? .08 + random() * .045 : .035 + random() * .028;
    }
    const scale = .28 + random() * .24; objects.push({ id: `ny-route-${index + 1}`, name: inSewer ? `Punto percorso fognatura ${index - sewerEntry + 1}` : `Punto percorso strada ${index + 1}`, type: "pebble", railType: "bricks", position: [x, y, z], rotation: [random() * .7, random() * Math.PI, random() * .5], scale: [scale, .62 + random() * .34, scale * (.82 + random() * .25)], color: inSewer ? "#554f47" : "#706b63", roughness: .9, metalness: .025 });
  }
  return objects;
}
