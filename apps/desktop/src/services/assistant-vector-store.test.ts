import { describe, expect, it } from "vitest";
import { assistantTextVector, retrieveAssistantVectors } from "./assistant-vector-store";

describe("Lonely Bot local vector database", () => {
  it("produce embedding deterministici normalizzati", () => {
    const first = assistantTextVector("upscaling video 4k");
    const second = assistantTextVector("upscaling video 4k");
    expect(first).toEqual(second);
    expect(Math.sqrt(first.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1, 5);
  });

  it("recupera la guida del contesto e indicizza i controlli visibili", async () => {
    const hits = await retrieveAssistantVectors("quale pulsante avvia il lavoro", "frameBooster", "button: Boost frames\nselect: Metodo Frame Booster", 3);
    expect(hits.some((hit) => hit.id === "page:frameBooster")).toBe(true);
    expect(hits.some((hit) => hit.id === "frame-booster")).toBe(true);
  });
});

