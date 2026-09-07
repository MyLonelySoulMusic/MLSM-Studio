import { describe, expect, it } from "vitest";
import { detectLonelyBotWorkflow, validateLonelyBotWorkflow } from "./lonely-bot-workflows";

describe("Lonely Bot workflow validation", () => {
  it("non scambia una domanda informativa per un comando", () => {
    expect(detectLonelyBotWorkflow("Come funziona Frame Booster?")).toBeNull();
    expect(detectLonelyBotWorkflow("Avvia Frame Booster su questo video")).toBe("frameBooster");
    expect(detectLonelyBotWorkflow("Fai upscaling 4K")).toBe("upscaler");
  });

  it("richiede un singolo video per Frame Booster e accetta un pool per Upscaler", () => {
    const video = new File(["v"], "clip.mp4", { type: "video/mp4" });
    const image = new File(["i"], "cover.png", { type: "image/png" });
    expect(validateLonelyBotWorkflow("frameBooster", [])).toMatch(/Allega/);
    expect(validateLonelyBotWorkflow("frameBooster", [video])).toBeNull();
    expect(validateLonelyBotWorkflow("frameBooster", [video, video])).toMatch(/un video alla volta/);
    expect(validateLonelyBotWorkflow("upscaler", [video, image])).toBeNull();
  });
});
