import type { RhythmBallProject } from "@rbs/project-schema";
import type { EditableSceneObject, SceneObjectType } from "../store/scene-store";

type PersistedSceneObject = RhythmBallProject["objects"][number];
const editableTypes = new Set<SceneObjectType>(["drum", "kick", "snare", "cymbal", "piano", "guitar", "strings", "pebble", "peg", "platform", "block", "spring"]);

export function serializeSceneObjects(objects: readonly EditableSceneObject[]): PersistedSceneObject[] {
  return objects.map((object) => ({
    id: object.id, name: object.name, type: object.type, railType: object.railType,
    transform: {
      position: { x: object.position[0], y: object.position[1], z: object.position[2] },
      rotation: { x: object.rotation[0], y: object.rotation[1], z: object.rotation[2] },
      scale: { x: object.scale[0], y: object.scale[1], z: object.scale[2] }
    },
    material: { color: object.color, palette: [], roughness: object.roughness, metalness: object.metalness, emission: 0, opacity: 1, textureAssetId: null },
    restitution: .72, friction: .35, visible: true, locked: false, castShadow: true, receiveShadow: true, assetId: null
  }));
}

export function deserializeSceneObjects(objects: readonly PersistedSceneObject[]): EditableSceneObject[] {
  return objects.filter((object): object is PersistedSceneObject & { type: SceneObjectType } => editableTypes.has(object.type as SceneObjectType)).map((object) => ({
    id: object.id, name: object.name, type: object.type, railType: object.railType,
    position: [object.transform.position.x, object.transform.position.y, object.transform.position.z],
    rotation: [object.transform.rotation.x, object.transform.rotation.y, object.transform.rotation.z],
    scale: [object.transform.scale.x, object.transform.scale.y, object.transform.scale.z],
    color: object.material.color, roughness: object.material.roughness, metalness: object.material.metalness
  }));
}
