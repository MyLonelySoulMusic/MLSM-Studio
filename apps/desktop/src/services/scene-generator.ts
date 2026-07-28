import type { RhythmBallProject } from "@rbs/project-schema";
import type { EditableSceneObject, RailType, SceneObjectType } from "../store/scene-store";
export type SceneStyle = "minimal" | "neon" | "industrial" | "cartoon" | "dark";
export function isVerticalDescent(start: EditableSceneObject | undefined, end: EditableSceneObject | undefined): boolean { if (!start || !end) return false; const dx = Math.abs(end.position[0] - start.position[0]); const dy = start.position[1] - end.position[1]; return dy > .9 && dy > dx * .85; }
function randomGenerator(seed: number): () => number { let state = seed >>> 0; return () => { state += 0x6d2b79f5; let value = state; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4_294_967_296; }; }
const palettes: Record<SceneStyle, string[]> = { minimal: ["#171820", "#555967", "#eceef4"], neon: ["#ef4f72", "#7657ff", "#63ecd0", "#f2c65c"], industrial: ["#a34f3d", "#6f7580", "#d19b55"], cartoon: ["#ff657a", "#5cc8ff", "#ffd45c", "#79e36f"], dark: ["#601d45", "#28213e", "#b33d62"] };
const supportedTypes = new Set<SceneObjectType>(["drum", "kick", "snare", "cymbal", "piano", "guitar", "strings", "pebble", "peg", "platform", "block", "spring"]);
const defaultBaseTypes: readonly SceneObjectType[] = ["kick", "snare", "drum", "cymbal"];
function typeFor(event: RhythmBallProject["events"][number] | undefined, index: number, requestedTypes: readonly SceneObjectType[]): SceneObjectType {
  const allowedTypes = requestedTypes.filter((type) => supportedTypes.has(type)); const pool = allowedTypes.length ? allowedTypes : [...defaultBaseTypes]; const allowed = new Set(pool); const fallback = pool[index % pool.length] ?? "drum";
  if (event?.assignedObjectType && supportedTypes.has(event.assignedObjectType as SceneObjectType)) return event.assignedObjectType as SceneObjectType;
  // The first pass creates a normalized base containing every family explicitly
  // enabled by the user. Subsequent objects remain driven by detected instruments.
  if (index < pool.length) return fallback;
  const detected = event?.eventType === "kick" ? "kick" : event?.eventType === "snare" ? "snare" : event?.eventType === "hihat" ? "cymbal" : event?.eventType === "piano" ? "piano" : event?.eventType === "guitar" ? "guitar" : event?.eventType === "strings" ? "strings" : null;
  if (detected && allowed.has(detected)) return detected;
  if (event?.eventType === "percussion") { const percussion = pool.filter((type) => type === "kick" || type === "snare" || type === "drum" || type === "cymbal"); return percussion[index % percussion.length] ?? fallback; }
  return fallback;
}
const names: Record<SceneObjectType, string> = { drum: "Tom / Tamburo", kick: "Grancassa", snare: "Rullante", cymbal: "Piatto", piano: "Pianoforte", guitar: "Chitarra / corde", strings: "Violino / archi", pebble: "Pietruzza urbana", peg: "Paletto", platform: "Piattaforma", block: "Blocco", spring: "Molla" };
function railFor(type: SceneObjectType, index: number): RailType { if (type === "piano" || type === "block") return "bricks"; if (type === "guitar" || type === "strings" || type === "spring") return "glassTube"; return index % 4 === 3 ? "bricks" : "pinball"; }
export function generateScene(events: RhythmBallProject["events"], seed: number, style: SceneStyle = "neon", count?: number, allowedTypes: readonly SceneObjectType[] = defaultBaseTypes): EditableSceneObject[] {
  const random = randomGenerator(seed); const palette = palettes[style]; const timeline = events.filter((event) => event.enabled); const anchors = timeline.filter((event) => event.action !== "nearMiss" && event.action !== "freeFall"); const objects: EditableSceneObject[] = [];
  const targetCount = Math.max(1, Math.min(count ?? (anchors.length || 5), 240)); let previousX = -4.8; let previousZ = -1.4; let currentY = 2.1; let direction = 1; let depthDirection = 1;
  for (let index = 0; index < targetCount; index += 1) {
    const event = anchors[index % Math.max(1, anchors.length)]; const type = typeFor(event, index, allowedTypes); let x = previousX; let z = previousZ; const previousEvent = index > 0 ? anchors[(index - 1) % Math.max(1, anchors.length)] : undefined;
    if (index > 0) {
      const previousTimelineIndex = previousEvent ? timeline.indexOf(previousEvent) : -1; const currentTimelineIndex = event ? timeline.indexOf(event) : -1; const between = previousTimelineIndex >= 0 && currentTimelineIndex > previousTimelineIndex ? timeline.slice(previousTimelineIndex + 1, currentTimelineIndex) : [];
      const hasFreeFall = between.some((item) => item.action === "freeFall"); const skippedBeats = between.filter((item) => item.action === "nearMiss"); const motion = hasFreeFall ? "freeFall" : skippedBeats.some((item) => item.manualOverride) || skippedBeats.length > 0 && (index - 1) % 3 === 1 ? "slide" : "bounce"; const duration = previousEvent && event ? Math.max(.25, event.timeSeconds - previousEvent.timeSeconds) : .65;
      const targetSpeed = motion === "slide" ? 4.2 : motion === "freeFall" ? 2.4 : 3.7; const lateralStep = Math.max(motion === "slide" ? 2.8 : 1.7, Math.min(motion === "slide" ? 4.8 : 4.1, duration * targetSpeed));
      let verticalStep = motion === "slide" ? .08 + random() * .035 : motion === "freeFall" ? 1.65 + random() * .5 : .12 + random() * .05;
      let candidate = previousX + direction * lateralStep; if (candidate > 6.2 || candidate < -6.2) { direction *= -1; depthDirection *= -1; candidate = previousX + direction * .28; verticalStep = Math.max(verticalStep, 2.85 + random() * .35); }
      x = Math.max(-6.2, Math.min(6.2, candidate)); currentY -= verticalStep;
      const needsDepthClearance = verticalStep > .9; const depthStep = needsDepthClearance ? 1.6 + random() * .28 : Math.min(1.15, .38 + duration * .42 + random() * .18); let depthCandidate = previousZ + depthDirection * depthStep; if (depthCandidate > 2.25 || depthCandidate < -2.25) { depthDirection *= -1; depthCandidate = previousZ + depthDirection * depthStep; } z = Math.max(-2.25, Math.min(2.25, depthCandidate));
    }
    previousX = x; previousZ = z;
    const drumType = type === "kick" || type === "snare" || type === "drum"; objects.push({ id: `${type}-${index + 1}`, name: `${names[type]} ${index + 1}`, type, railType: railFor(type, index), position: [x, currentY, z], rotation: [.025 + random() * .045, direction * (.1 + random() * .1), direction * (.025 + random() * .06)], scale: [1, 1, 1], color: type === "cymbal" ? "#d6a83f" : palette[index % palette.length] ?? "#7657ff", roughness: style === "industrial" ? .58 : drumType ? .42 : type === "cymbal" ? .24 : .34, metalness: type === "cymbal" ? .86 : drumType ? .72 : .3 });
  }
  return objects;
}
