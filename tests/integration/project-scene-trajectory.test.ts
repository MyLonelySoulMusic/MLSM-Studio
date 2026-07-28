import { describe, expect, it } from "vitest";
import { createProject, parseProject } from "@rbs/project-schema";
import { MemoryProjectRepository, ProjectService } from "@rbs/core";
import { createTrajectoryEvaluator, planTrajectory, type ScheduledImpact } from "@rbs/trajectory";
import { generateScene } from "../../apps/desktop/src/services/scene-generator";
import { serializeSceneObjects } from "../../apps/desktop/src/services/scene-persistence";

describe("project, scene and trajectory integration", () => {
  it("conserva scena ed eventi dopo un round-trip e mantiene gli impatti", async () => {
    const base = createProject("Integrazione", new Date("2026-01-01T00:00:00.000Z")); const sampleRate = 48_000;
    const events = [1, 1.5, 2].map((timeSeconds, index) => ({ id: `event-${index}`, timeSeconds, timeSamples: Math.round(timeSeconds * sampleRate), eventType: "manual" as const, confidence: 1, strength: .8, frequencyBand: "full" as const, assignedObjectType: null, assignedObjectId: null, enabled: true, accent: false, manualOverride: true, action: "collision" as const, expectedBallPosition: { x: 0, y: 0, z: 0 }, expectedBallVelocity: { x: 0, y: 0, z: 0 }, expectedImpactNormal: { x: 0, y: 1, z: 0 } }));
    const scene = generateScene(events, base.project.seed, "neon", 3); const impacts: ScheduledImpact[] = events.map((event, index) => ({ eventId: event.id, timeSeconds: event.timeSeconds, objectId: scene[index]?.id ?? "missing", contactPoint: { x: scene[index]?.position[0] ?? 0, y: scene[index]?.position[1] ?? 0, z: scene[index]?.position[2] ?? 0 }, contactNormal: { x: 0, y: 1, z: 0 }, impactStrength: event.strength }));
    const segments = planTrajectory(impacts); const project = parseProject({ ...base, audio: { ...base.audio, hash: "a".repeat(64), durationSeconds: 3, sampleRate }, events, objects: serializeSceneObjects(scene), trajectorySegments: segments.map((segment) => ({ ...segment, status: "valid" as const, diagnostic: "" })) });
    const repository = new MemoryProjectRepository(); const service = new ProjectService(repository); const saved = await service.save(project); const loaded = await service.load();
    expect(loaded).toEqual(saved); expect(loaded?.objects).toHaveLength(3); const evaluate = createTrajectoryEvaluator(segments); for (const impact of impacts.slice(1)) expect(evaluate(impact.timeSeconds).position).toEqual(impact.contactPoint);
  });
});
