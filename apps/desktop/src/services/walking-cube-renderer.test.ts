import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createProject } from "@rbs/project-schema";
import { createWalkingCubeScene, updateWalkingCubeScene } from "./walking-cube-renderer";

describe("Cube Animation renderer", () => {
  beforeEach(() => {
    const gradient = { addColorStop: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient,
      fillRect: vi.fn(),
      fillText: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillStyle: "",
      font: "",
      textAlign: "center",
      textBaseline: "middle",
      filter: "",
      globalAlpha: 1
    } as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => vi.restoreAllMocks());

  it("crea un solo cubo sospeso, senza piano o copie ricorsive", () => {
    const settings = createProject().animation.walkingCube;
    const scene = createWalkingCubeScene(settings, "9:16");
    expect(scene.getObjectByName("walking-cube-hero")).toBeTruthy();
    expect(scene.getObjectByName("walking-cube-child-0")).toBeUndefined();
    expect(scene.getObjectByName("walking-cube-floor")).toBeUndefined();
    expect(scene.getObjectByName("walking-cube-grid")).toBeUndefined();
    expect(scene.getObjectsByProperty("name", "walking-cube-spectrum-bar")).toHaveLength(48);
    expect(scene.getObjectByName("walking-cube-glass-shell")).toBeTruthy();
    expect(scene.getObjectByName("walking-cube-fresnel")).toBeTruthy();
    expect(scene.getObjectByName("walking-cube-water-ripples")?.visible).toBe(true);
    const photoCore = scene.getObjectByName("walking-cube-photo-core") as THREE.Mesh;
    const photoMaterials = photoCore.material as THREE.MeshBasicMaterial[];
    expect(photoMaterials).toHaveLength(6);
    expect(photoMaterials.every((material) => material instanceof THREE.MeshBasicMaterial && material.toneMapped === false)).toBe(true);
  });

  it("applica la rotazione e aggiorna le 48 bande senza spostare il rig", () => {
    const settings = createProject().animation.walkingCube;
    const scene = createWalkingCubeScene(settings, "16:9");
    updateWalkingCubeScene(scene, {
      pose: { loopPhase: .25, stepIndex: 1, stepProgress: .4, position: { x: 0, y: 0, z: 0 }, rotationX: .4, rotationY: .2, rotationZ: .1, orientation: { x: .2, y: .1, z: .05, w: .9734 }, split: 0, zoom: 0, selectedChildIndex: 0, impactStrength: .8 },
      audioPulse: .7,
      rhythmPulse: .8,
      spectrumBands: Array.from({ length: 48 }, (_, index) => index / 47),
      stereoLeftBands: Array.from({ length: 48 }, () => .4),
      stereoRightBands: Array.from({ length: 48 }, () => .6),
      stereoWidth: .5
    });
    const rig = scene.getObjectByName("walking-cube-rig");
    const hero = scene.getObjectByName("walking-cube-hero");
    expect(rig?.position.x).toBe(0);
    expect(hero?.quaternion.x).toBeCloseTo(.2, 3);
    expect(hero?.quaternion.y).toBeCloseTo(.1, 3);
    const bars = scene.getObjectsByProperty("name", "walking-cube-spectrum-bar");
    expect(bars.at(-1)?.scale.y).toBeGreaterThan(bars[0]!.scale.y);
    const ripples = scene.getObjectByName("walking-cube-water-ripples") as THREE.Mesh;
    const rippleMaterial = ripples.material as THREE.ShaderMaterial;
    expect(rippleMaterial.uniforms.uBeatPhase!.value).toBe(.4);
    expect(rippleMaterial.uniforms.uImpact!.value).toBeGreaterThan(.7);
  });

  it("propaga lo stile della cover a spettro, particelle, orbite e atmosfera", () => {
    const base = createProject().animation.walkingCube;
    const settings = { ...base, palettePrimary: "#e33b87", paletteSecondary: "#3cc7e8", paletteAccent: "#f2b84b" };
    const scene = createWalkingCubeScene(settings, "9:16");
    const firstBar = scene.getObjectsByProperty("name", "walking-cube-spectrum-bar")[0] as THREE.Mesh;
    const particles = scene.getObjectByName("walking-cube-particles") as THREE.Points;
    const firstOrbit = scene.getObjectByName("walking-cube-orbit-0") as THREE.Mesh;
    const atmosphere = scene.getObjectByName("walking-cube-background-atmosphere") as THREE.Mesh;
    expect(firstBar.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect((firstBar.material as THREE.MeshBasicMaterial).color.getHexString(THREE.SRGBColorSpace)).toBe("e33b87");
    expect((firstBar.material as THREE.MeshBasicMaterial).toneMapped).toBe(false);
    expect((particles.material as THREE.PointsMaterial).color.getHexString(THREE.SRGBColorSpace)).toBe("f2b84b");
    expect((firstOrbit.material as THREE.MeshBasicMaterial).color.getHexString(THREE.SRGBColorSpace)).toBe("e33b87");
    expect((atmosphere.material as THREE.ShaderMaterial).uniforms.uSecondary!.value.getHexString(THREE.SRGBColorSpace)).toBe("3cc7e8");
  });

  it("separa il livello fotografico dall'overlay audiovisivo", () => {
    const scene = createWalkingCubeScene(createProject().animation.walkingCube, "16:9");
    const backdrop = scene.getObjectByName("walking-cube-background") as THREE.Mesh;
    const atmosphere = scene.getObjectByName("walking-cube-background-atmosphere") as THREE.Mesh;
    expect(backdrop.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(atmosphere.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect((atmosphere.material as THREE.ShaderMaterial).transparent).toBe(true);
  });

  it("lascia trasparente il canvas quando lo sfondo è un video esterno", () => {
    const settings = { ...createProject().animation.walkingCube, backgroundImageUrl: "data:image/png;base64,AAAA" };
    const scene = createWalkingCubeScene(settings, "9:16", true);
    const backdrop = scene.getObjectByName("walking-cube-background") as THREE.Mesh;
    const material = backdrop.material as THREE.MeshBasicMaterial;
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBe(0);
    expect(material.map).toBeNull();
  });
});
