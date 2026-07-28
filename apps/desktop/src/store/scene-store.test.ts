import { describe, expect, it } from "vitest";
import { enforceDescendingRoute, mergeGeneratedScene, rebaseSceneLight, useSceneStore, type EditableSceneObject } from "./scene-store";

function object(id: string, y: number): EditableSceneObject {
  return { id, name: id, type: "block", railType: "pinball", position: [0, y, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#ffffff", roughness: .3, metalness: .2 };
}

describe("descending scene route", () => {
  it("normalizza anche scene importate con altezze invertite", () => {
    const normalized = enforceDescendingRoute([object("a", 3), object("b", 4), object("c", 3.8), object("d", -2)]);
    expect(normalized[0]?.position[1]).toBe(3);
    expect(normalized[1]?.position[1]).toBeCloseTo(2.85);
    expect(normalized[2]?.position[1]).toBeCloseTo(2.7);
    expect(normalized[3]?.position[1]).toBe(-2);
    for (let index = 1; index < normalized.length; index += 1) {
      expect((normalized[index - 1]?.position[1] ?? 0) - (normalized[index]?.position[1] ?? 0)).toBeGreaterThan(.149999);
    }
  });

  it("non modifica una scena già discendente", () => {
    const input = [object("a", 2), object("b", .5), object("c", -1.5)];
    expect(enforceDescendingRoute(input)).toEqual(input);
  });

  it("consente di applicare un binario globale e poi mixare un singolo tratto", () => {
    useSceneStore.getState().reset(); useSceneStore.getState().setAllRails("glassTube"); const first = useSceneStore.getState().objects[0];
    expect(useSceneStore.getState().objects.every((item) => item.railType === "glassTube")).toBe(true);
    if (first) useSceneStore.getState().update(first.id, { railType: "bricks" });
    expect(useSceneStore.getState().objects[0]?.railType).toBe("bricks"); expect(useSceneStore.getState().objects[1]?.railType).toBe("glassTube"); useSceneStore.getState().reset();
  });

  it("propaga la palette estratta a sfera, strumenti, sfondo e binari", () => {
    useSceneStore.getState().reset(); useSceneStore.getState().applyExtractedPalette(["#112233", "#445566", "#778899"]); const state = useSceneStore.getState();
    expect(state.background.colors).toEqual(["#112233", "#445566"]); expect(state.ball.innerColor).toBe("#112233"); expect(state.objects[0]?.color).toBe("#112233"); expect(state.railColors.bricks).toBe("#778899"); state.reset();
  });
  it("conserva la scelta tra ambiente limpido e usurato", () => { useSceneStore.getState().reset(); useSceneStore.getState().updateBackground({ finish: "worn" }); expect(useSceneStore.getState().background.finish).toBe("worn"); useSceneStore.getState().reset(); });
  it("conserva un video come sfondo personalizzato", () => { useSceneStore.getState().reset(); useSceneStore.getState().updateBackground({ imageUrl: "data:video/mp4;base64,AAAA", mediaType: "video", presetId: "custom" }); expect(useSceneStore.getState().background).toMatchObject({ imageUrl: "data:video/mp4;base64,AAAA", mediaType: "video", presetId: "custom" }); useSceneStore.getState().reset(); });
  it("conserva testo, colore e attivazione delle insegne neon", () => { useSceneStore.getState().reset(); useSceneStore.getState().updateBackground({ neon: { enabled: true, text: "RUN WITH ME\nNO SURRENDER", color: "#00ffaa" } }); expect(useSceneStore.getState().background.neon).toEqual({ enabled: true, text: "RUN WITH ME\nNO SURRENDER", color: "#00ffaa" }); useSceneStore.getState().reset(); });
  it("cambia il colore per tipo senza perdere le modifiche del singolo elemento", () => { useSceneStore.getState().reset(); useSceneStore.getState().updateTypeColor("cymbal", "#bb8844"); const cymbals = useSceneStore.getState().objects.filter((item) => item.type === "cymbal"); expect(cymbals.every((item) => item.color === "#bb8844")).toBe(true); const kick = useSceneStore.getState().objects.find((item) => item.type === "kick"); expect(kick?.color).not.toBe("#bb8844"); if (cymbals[0]) useSceneStore.getState().update(cymbals[0].id, { color: "#ffffff" }); expect(useSceneStore.getState().objects.find((item) => item.id === cymbals[0]?.id)?.color).toBe("#ffffff"); useSceneStore.getState().reset(); });
  it("sostituisce il tipo mantenendo trasformazione, collegamento e materiale personalizzato", () => { useSceneStore.getState().reset(); const before = useSceneStore.getState().objects[0]; expect(before).toBeDefined(); if (!before) return; useSceneStore.getState().update(before.id, { color: "#123456", roughness: .63, metalness: .44 }); useSceneStore.getState().changeType(before.id, "cymbal"); const after = useSceneStore.getState().objects[0]; expect(after).toMatchObject({ id: before.id, type: "cymbal", name: "Piatto", color: "#123456", roughness: .63, metalness: .44, position: before.position, rotation: before.rotation, scale: before.scale, railType: before.railType }); expect(useSceneStore.getState().selectedId).toBe(before.id); useSceneStore.getState().reset(); });
  it("rigenera il percorso senza perdere colori, materiali, scala e binari", () => { const current = [object("old-a", 2), { ...object("old-b", 1), type: "cymbal" as const, color: "#ba8732", roughness: .71, metalness: .93, railType: "glassTube" as const, scale: [1.3, 1.3, 1.3] as [number, number, number] }]; const generated = [{ ...object("new-a", 3), position: [-2, 3, 1] as [number, number, number] }, { ...object("new-b", 2), type: "cymbal" as const, color: "#d6a83f", position: [2, 2, -1] as [number, number, number] }]; const merged = mergeGeneratedScene(generated, current); expect(merged[1]).toMatchObject({ id: "old-b", type: "cymbal", color: "#ba8732", roughness: .71, metalness: .93, railType: "glassTube", scale: [1.3, 1.3, 1.3], position: [2, 2, -1] }); });
  it("usa piatti dorati per impostazione predefinita", () => { useSceneStore.getState().reset(); expect(useSceneStore.getState().objects.filter((item) => item.type === "cymbal").every((item) => item.color === "#d6a83f")).toBe(true); });
  it("conserva pianificazione e durata del finale", () => { useSceneStore.getState().reset(); useSceneStore.getState().updateBall({ endRevealEnabled: true, revealMode: "time", revealTimeSeconds: 12.5, revealHoldSeconds: 4 }); const ball = useSceneStore.getState().ball; expect(ball.revealMode).toBe("time"); expect(ball.revealTimeSeconds).toBe(12.5); expect(ball.revealHoldSeconds).toBe(4); useSceneStore.getState().reset(); });
  it("aggiorna la luce e gestisce la selezione dei due punti", () => { useSceneStore.getState().reset(); useSceneStore.getState().updateLight({ enabled: true, origin: [-2, 5, 7], target: [1, 0, -4], color: "#ffaa33", intensity: 61, angleDegrees: 48, beamVisible: true, beamDensity: .74, reflectionBoost: 1.8 }); useSceneStore.getState().setLightPickMode("target"); expect(useSceneStore.getState().light).toMatchObject({ enabled: true, origin: [-2, 5, 7], target: [1, 0, -4], color: "#ffaa33", intensity: 61, angleDegrees: 48, beamVisible: true, beamDensity: .74, reflectionBoost: 1.8 }); expect(useSceneStore.getState().lightPickMode).toBe("target"); useSceneStore.getState().reset(); expect(useSceneStore.getState().light.enabled).toBe(false); expect(useSceneStore.getState().lightPickMode).toBeNull(); });
  it("mantiene origine e destinazione relative al percorso quando l'analisi rigenera la scena", () => { useSceneStore.getState().reset(); const light = { ...useSceneStore.getState().light, origin: [3, 7, 4] as [number, number, number], target: [-1, 2, -3] as [number, number, number] }; const rebased = rebaseSceneLight(light, [object("old", 1)], [{ ...object("new", 3), position: [-2, 3, 5] }]); expect(rebased.origin).toEqual([1, 9, 9]); expect(rebased.target).toEqual([-3, 4, 2]); useSceneStore.getState().reset(); });
});
