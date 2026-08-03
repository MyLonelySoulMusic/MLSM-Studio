import { describe, expect, it } from "vitest";
import { assertStaticWatermarkFrameIntegrity, staticWatermarkEncodingError } from "./static-watermark-exporter";

describe("static watermark export integrity", () => {
  it("accepts an exact frame count", () => expect(() => assertStaticWatermarkFrameIntegrity(1800, 1800)).not.toThrow());
  it("rejects dropped frames", () => expect(() => assertStaticWatermarkFrameIntegrity(1800, 1799)).toThrow(/anti-drop/i));
  it("rejects empty videos", () => expect(() => assertStaticWatermarkFrameIntegrity(0, 0)).toThrow(/fotogrammi/i));
  it("rende diagnosticabile l'errore generico di WebCodecs", () => expect(staticWatermarkEncodingError(new DOMException("Encoding error", "EncodingError"), 24, 1800).message).toMatch(/frame 24 di 1800.*file parziale.*WebCodecs/i));
});
