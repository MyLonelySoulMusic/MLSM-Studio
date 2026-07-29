import * as THREE from "three";
import type { RhythmBallProject } from "@rbs/project-schema";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { WalkingCubePose } from "./walking-cube-motion";

type WalkingCubeSettings = RhythmBallProject["animation"]["walkingCube"];

export interface WalkingCubeRenderFrame {
  pose: WalkingCubePose;
  audioPulse: number;
  rhythmPulse: number;
  spectrumBands: readonly number[];
  stereoLeftBands: readonly number[];
  stereoRightBands: readonly number[];
  stereoWidth: number;
}

interface ParticleSeed { x: number; y: number; z: number; phase: number; radius: number; }

function hash(index: number): number { const value = Math.sin(index * 91.173 + 14.71) * 43_758.5453; return value - Math.floor(value); }
function paletteColor(settings: WalkingCubeSettings, ratio: number): THREE.Color {
  const primary = new THREE.Color(settings.palettePrimary);
  if (ratio < .52) return primary.lerp(new THREE.Color(settings.paletteSecondary), ratio / .52);
  return new THREE.Color(settings.paletteSecondary).lerp(new THREE.Color(settings.paletteAccent), (ratio - .52) / .48);
}

function photoCanvas(settings: WalkingCubeSettings): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const gradient = context.createLinearGradient(0, 0, 1024, 1024);
  gradient.addColorStop(0, settings.palettePrimary);
  gradient.addColorStop(.55, settings.paletteSecondary);
  gradient.addColorStop(1, settings.paletteAccent);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1024, 1024);
  context.fillStyle = "rgba(2,4,12,.3)";
  context.fillRect(26, 26, 972, 972);
  context.fillStyle = "rgba(255,255,255,.9)";
  context.font = "700 66px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("CUBE ANIMATION", 512, 512);
  return canvas;
}

function loadContainedImage(canvas: HTMLCanvasElement, imageUrl: string): void {
  const image = new Image();
  image.onload = () => {
    const context = canvas.getContext("2d");
    if (!context) return;
    const containedScale = Math.min(1000 / image.naturalWidth, 1000 / image.naturalHeight);
    const width = image.naturalWidth * containedScale;
    const height = image.naturalHeight * containedScale;
    const coverScale = Math.max(1024 / image.naturalWidth, 1024 / image.naturalHeight);
    const coverWidth = image.naturalWidth * coverScale;
    const coverHeight = image.naturalHeight * coverScale;
    context.save();
    context.filter = "blur(38px) brightness(.48) saturate(1.16)";
    context.globalAlpha = .82;
    context.drawImage(image, (1024 - coverWidth) / 2, (1024 - coverHeight) / 2, coverWidth, coverHeight);
    context.restore();
    context.fillStyle = "rgba(2,4,10,.12)";
    context.fillRect(0, 0, 1024, 1024);
    context.drawImage(image, (1024 - width) / 2, (1024 - height) / 2, width, height);
    canvas.dispatchEvent(new Event("walking-cube-image-ready"));
  };
  image.src = imageUrl;
}

function createFresnelMaterial(settings: WalkingCubeSettings): THREE.ShaderMaterial {
  const paleGlass = new THREE.Color(settings.palettePrimary).lerp(new THREE.Color("#ffffff"), .92);
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    uniforms: {
      uColor: { value: paleGlass },
      uOpacity: { value: .13 + settings.glassOpacity * .3 },
      uEnergy: { value: 0 }
    },
    vertexShader: `
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }`,
    fragmentShader: `
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uEnergy;
      void main() {
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - clamp(dot(normalize(vWorldNormal), viewDirection), 0.0, 1.0), 3.2);
        float fineEdge = pow(fresnel, .42);
        float alpha = (fresnel * .72 + fineEdge * .18) * uOpacity * (1.0 + uEnergy * .42);
        gl_FragColor = vec4(mix(uColor, vec3(1.0), fineEdge * .62), alpha);
      }`
  });
}

function createCube(settings: WalkingCubeSettings, texture: THREE.CanvasTexture): THREE.Group {
  const group = new THREE.Group();
  group.name = "walking-cube-hero";
  // La fotografia non viene illuminata né tonemappata: conserva esattamente
  // luminosità e saturazione della cover. Volume e riflessi sono demandati
  // esclusivamente ai due gusci ottici esterni.
  const faceMaterials = Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial({
    color: "#ffffff",
    map: texture,
    toneMapped: false
  }));
  const core = new THREE.Mesh(new THREE.BoxGeometry(1.48, 1.48, 1.48), faceMaterials);
  core.name = "walking-cube-photo-core";
  group.add(core);

  const paleGlass = new THREE.Color(settings.palettePrimary).lerp(new THREE.Color("#ffffff"), .96);
  const shellMaterial = new THREE.MeshPhysicalMaterial({
    color: paleGlass,
    emissive: "#ffffff",
    emissiveIntensity: .006,
    transparent: true,
    opacity: .018 + settings.glassOpacity * .11,
    transmission: 1,
    roughness: .008,
    metalness: 0,
    thickness: .19,
    ior: 1.52,
    clearcoat: 1,
    clearcoatRoughness: .006,
    specularIntensity: 1,
    specularColor: "#ffffff",
    iridescence: .025,
    iridescenceIOR: 1.3,
    envMapIntensity: 7.2,
    attenuationColor: paleGlass,
    attenuationDistance: 42,
    depthWrite: false
  });
  const shellGeometry = new RoundedBoxGeometry(1.72, 1.72, 1.72, 10, .105);
  const shell = new THREE.Mesh(shellGeometry, shellMaterial);
  shell.name = "walking-cube-glass-shell";
  shell.renderOrder = 5;
  group.add(shell);

  const fresnel = new THREE.Mesh(new RoundedBoxGeometry(1.735, 1.735, 1.735, 10, .108), createFresnelMaterial(settings));
  fresnel.name = "walking-cube-fresnel";
  fresnel.renderOrder = 6;
  group.add(fresnel);

  const opticalEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new RoundedBoxGeometry(1.745, 1.745, 1.745, 6, .11), 34),
    new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: .075, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  opticalEdge.name = "walking-cube-optical-edge";
  opticalEdge.renderOrder = 7;
  group.add(opticalEdge);
  return group;
}

function backgroundEffectsMaterial(settings: WalkingCubeSettings, planeAspect: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uPlaneAspect: { value: planeAspect },
      uPrimary: { value: new THREE.Color(settings.palettePrimary) },
      uSecondary: { value: new THREE.Color(settings.paletteSecondary) },
      uAccent: { value: new THREE.Color(settings.paletteAccent) },
      uPhase: { value: 0 },
      uEnergy: { value: 0 },
      uStereo: { value: 0 },
      uSweep: { value: settings.effects.lightSweeps ? 1 : 0 },
      uIntensity: { value: settings.backgroundIntensity }
    },
    vertexShader: "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader: `
      varying vec2 vUv;
      uniform float uPlaneAspect;
      uniform vec3 uPrimary;
      uniform vec3 uSecondary;
      uniform vec3 uAccent;
      uniform float uPhase;
      uniform float uEnergy;
      uniform float uStereo;
      uniform float uSweep;
      uniform float uIntensity;
      void main() {
        vec2 p = (vUv - .5) * vec2(uPlaneAspect, 1.0);
        float radius = length(p);
        vec3 color = vec3(0.0);
        float wave = .5 + .5 * sin(radius * 34.0 - uPhase * 6.283185 * 2.0 + p.x * uStereo * 3.0);
        color += mix(uPrimary, uAccent, vUv.x) * wave * (.012 + uEnergy * .035) * uIntensity;
        float sweep = exp(-pow((vUv.x + vUv.y * .34) - fract(uPhase + .18), 2.0) * 180.0);
        color += mix(uSecondary, uAccent, vUv.y) * sweep * (.025 + uEnergy * .075) * uSweep;
        float alpha = clamp(length(color) * 1.8, 0.0, .48);
        gl_FragColor = vec4(color, alpha);
      }`
  });
}

function waterRippleMaterial(settings: WalkingCubeSettings, planeAspect: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uPlaneAspect: { value: planeAspect },
      uPrimary: { value: new THREE.Color(settings.palettePrimary) },
      uSecondary: { value: new THREE.Color(settings.paletteSecondary) },
      uAccent: { value: new THREE.Color(settings.paletteAccent) },
      uBeatPhase: { value: 0 },
      uImpact: { value: 0 },
      uAudio: { value: 0 },
      uIntensity: { value: settings.rippleIntensity }
    },
    vertexShader: "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader: `
      varying vec2 vUv;
      uniform float uPlaneAspect;
      uniform vec3 uPrimary;
      uniform vec3 uSecondary;
      uniform vec3 uAccent;
      uniform float uBeatPhase;
      uniform float uImpact;
      uniform float uAudio;
      uniform float uIntensity;

      float ripple(vec2 point, vec2 origin, float age, float weight) {
        float radiusLimit = length(vec2(uPlaneAspect * .58, .58));
        float radius = age * radiusLimit * 1.22;
        float delta = length(point - origin) - radius;
        float envelope = exp(-abs(delta) * 22.0);
        float crests = pow(.5 + .5 * cos(delta * 138.0), 5.0);
        float birth = smoothstep(0.0, .055, age);
        float decay = pow(max(0.0, 1.0 - age), .72);
        return crests * envelope * birth * decay * weight;
      }

      void main() {
        vec2 point = (vUv - .5) * vec2(uPlaneAspect, 1.0);
        float current = ripple(point, vec2(0.0, .035), uBeatPhase, 1.0);
        float echoAge = fract(uBeatPhase + .52);
        float echo = ripple(point, vec2(-.12, -.08), echoAge, .46);
        float sideAge = fract(uBeatPhase + .76);
        float side = ripple(point, vec2(.16, .11), sideAge, .26);
        float field = (current + echo + side) * uIntensity;
        vec3 waterColor = mix(uPrimary, uSecondary, smoothstep(-.35, .5, point.x));
        waterColor = mix(waterColor, uAccent, side * .55);
        waterColor = mix(waterColor, vec3(1.0), min(1.0, field) * .18);
        float opacity = field * (.13 + uImpact * .3 + uAudio * .1);
        gl_FragColor = vec4(waterColor, min(.62, opacity));
      }`
  });
}

function canvasRgb(color: THREE.Color): string {
  const srgb = color.clone().convertLinearToSRGB();
  return `${Math.round(srgb.r * 255)},${Math.round(srgb.g * 255)},${Math.round(srgb.b * 255)}`;
}

function radialGlowTexture(color: THREE.Color): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
    const rgb = canvasRgb(color);
    gradient.addColorStop(0, `rgba(${rgb},.86)`);
    gradient.addColorStop(.24, `rgba(${rgb},.32)`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function lightSweepTexture(color: THREE.Color): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 256, 0);
    const rgb = canvasRgb(color);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(.42, `rgba(${rgb},0)`);
    gradient.addColorStop(.5, `rgba(${rgb},.72)`);
    gradient.addColorStop(.58, `rgba(${rgb},0)`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function configureBackgroundMapping(texture: THREE.Texture): void {
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(1, 1);
  texture.offset.set(0, 0);
}

function addBackgroundImage(root: THREE.Group, material: THREE.MeshBasicMaterial, settings: WalkingCubeSettings): void {
  if (!settings.backgroundImageUrl) return;
  new THREE.TextureLoader().load(settings.backgroundImageUrl, (texture) => {
    if (root.userData.disposed) { texture.dispose(); return; }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 8;
    configureBackgroundMapping(texture);
    material.map?.dispose();
    material.map = texture;
    const brightness = 1 - settings.backgroundDim;
    material.color.setRGB(brightness, brightness, brightness);
    material.opacity = 1;
    material.transparent = false;
    material.needsUpdate = true;
  });
}

function createSpectrum(settings: WalkingCubeSettings, portrait: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = "walking-cube-spectrum";
  const totalWidth = portrait ? 3.15 : 6.15;
  const spacing = totalWidth / 48;
  const barWidth = spacing * .52;
  const barDepth = portrait ? .055 : .08;
  const maximumHeight = portrait ? .76 : .68;
  group.position.set(0, portrait ? -2.34 : -1.86, -.46);
  group.userData.maximumHeight = maximumHeight;

  const baselineColor = new THREE.Color(settings.paletteSecondary).lerp(new THREE.Color("#ffffff"), .22);
  const baseline = new THREE.Mesh(
    new RoundedBoxGeometry(totalWidth + .18, .025, .035, 3, .01),
    new THREE.MeshBasicMaterial({ color: baselineColor, transparent: true, opacity: .48, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  baseline.name = "walking-cube-spectrum-baseline";
  group.add(baseline);

  for (let index = 0; index < 48; index += 1) {
    const color = paletteColor(settings, index / 47);
    const bar = new THREE.Mesh(
      new RoundedBoxGeometry(barWidth, 1, barDepth, 3, Math.min(.018, barWidth * .28)),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: .9,
        depthWrite: false,
        toneMapped: false
      })
    );
    bar.name = "walking-cube-spectrum-bar";
    bar.userData.bandIndex = index;
    bar.position.x = (index - 23.5) * spacing;
    group.add(bar);
    const peak = new THREE.Mesh(
      new RoundedBoxGeometry(barWidth * 1.08, .022, barDepth * 1.08, 2, .007),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color("#ffffff"), .34), transparent: true, opacity: .72, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    peak.name = "walking-cube-spectrum-peak";
    peak.userData.bandIndex = index;
    peak.position.x = bar.position.x;
    group.add(peak);
  }
  return group;
}

export function createWalkingCubeScene(settings: WalkingCubeSettings, aspectRatio: string, externalBackdrop = false): THREE.Group {
  const root = new THREE.Group();
  root.name = "walking-cube-scene";
  const portrait = aspectRatio === "9:16";
  root.userData.portrait = portrait;
  root.userData.settings = settings;

  const planeAspect = portrait ? 9 / 16 : 16 / 9;
  const fallbackColor = new THREE.Color(settings.palettePrimary).multiplyScalar(.045).lerp(new THREE.Color(settings.paletteSecondary).multiplyScalar(.075), .48);
  const awaitingBackground = Boolean(settings.backgroundImageUrl) || externalBackdrop;
  const backdropMaterial = new THREE.MeshBasicMaterial({ color: fallbackColor, transparent: awaitingBackground, opacity: awaitingBackground ? 0 : 1, depthWrite: false, depthTest: false });
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(28, 18), backdropMaterial);
  backdrop.name = "walking-cube-background";
  backdrop.position.set(0, .2, -7);
  backdrop.renderOrder = -20;
  root.add(backdrop);
  if (!externalBackdrop) addBackgroundImage(root, backdropMaterial, settings);
  const atmosphere = new THREE.Mesh(new THREE.PlaneGeometry(28, 18), backgroundEffectsMaterial(settings, planeAspect));
  atmosphere.name = "walking-cube-background-atmosphere";
  atmosphere.position.set(0, .2, -6.96);
  atmosphere.renderOrder = -19;
  root.add(atmosphere);
  const waterRipples = new THREE.Mesh(new THREE.PlaneGeometry(28, 18), waterRippleMaterial(settings, planeAspect));
  waterRipples.name = "walking-cube-water-ripples";
  waterRipples.position.set(0, .2, -1.92);
  waterRipples.renderOrder = -2;
  waterRipples.visible = settings.effects.waterRipples;
  root.add(waterRipples);

  const haloColor = new THREE.Color(settings.palettePrimary).lerp(new THREE.Color(settings.paletteAccent), .35);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialGlowTexture(haloColor), color: "#ffffff", transparent: true, opacity: .32, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  halo.name = "walking-cube-halo";
  halo.position.set(0, .15, -1.7);
  halo.scale.set(portrait ? 4.4 : 5.2, portrait ? 4.4 : 5.2, 1);
  halo.visible = settings.effects.halo;
  root.add(halo);

  const orbitRig = new THREE.Group();
  orbitRig.name = "walking-cube-orbits";
  orbitRig.position.set(0, .15, -1.15);
  orbitRig.visible = settings.effects.orbitRings;
  for (let index = 0; index < 3; index += 1) {
    const color = paletteColor(settings, index / 2);
    const orbit = new THREE.Mesh(
      new THREE.TorusGeometry(1.55 + index * .34, .012 + index * .003, 6, 128),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .12 - index * .018, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    orbit.name = `walking-cube-orbit-${index}`;
    orbit.rotation.set(.38 + index * .27, -.3 + index * .34, index * .48);
    orbitRig.add(orbit);
  }
  root.add(orbitRig);

  const sweeps = new THREE.Group();
  sweeps.name = "walking-cube-light-sweeps";
  sweeps.visible = settings.effects.lightSweeps;
  for (let index = 0; index < 2; index += 1) {
    const color = paletteColor(settings, index);
    const sweep = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightSweepTexture(color), transparent: true, opacity: .13, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    sweep.name = `walking-cube-light-sweep-${index}`;
    sweep.position.set(index ? 2.7 : -2.7, .3, -2.8);
    sweep.scale.set(7.2, 1.5, 1);
    sweep.material.rotation = index ? -.62 : .62;
    sweeps.add(sweep);
  }
  root.add(sweeps);

  const canvas = photoCanvas(settings);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 12;
  canvas.addEventListener("walking-cube-image-ready", () => { texture.needsUpdate = true; });
  if (settings.imageUrl) loadContainedImage(canvas, settings.imageUrl);
  const rig = new THREE.Group();
  rig.name = "walking-cube-rig";
  rig.position.set(0, portrait ? .16 : .12, 0);
  rig.add(createCube(settings, texture));
  root.add(rig);

  root.add(createSpectrum(settings, portrait));

  const particleSeeds: ParticleSeed[] = Array.from({ length: 130 }, (_, index) => ({
    x: (hash(index * 3.1) - .5) * (portrait ? 4.4 : 9.5),
    y: (hash(index * 5.7) - .5) * (portrait ? 7.2 : 4.5),
    z: -4.8 + hash(index * 8.4) * 3,
    phase: hash(index * 11.2) * Math.PI * 2,
    radius: .04 + hash(index * 14.8) * .2
  }));
  const positions = new Float32Array(particleSeeds.length * 3);
  particleSeeds.forEach((seed, index) => positions.set([seed.x, seed.y, seed.z], index * 3));
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const particles = new THREE.Points(particleGeometry, new THREE.PointsMaterial({ color: settings.paletteAccent, size: .022, transparent: true, opacity: .48, blending: THREE.AdditiveBlending, depthWrite: false }));
  particles.name = "walking-cube-particles";
  particles.userData.seeds = particleSeeds;
  particles.frustumCulled = false;
  particles.visible = settings.effects.particles;
  root.add(particles);

  const key = new THREE.PointLight("#ffffff", 37, 16, 1.55);
  key.name = "walking-cube-key";
  key.position.set(-3.4, 3.6, 4.2);
  root.add(key);
  const rim = new THREE.PointLight(settings.paletteAccent, 29, 14, 1.65);
  rim.name = "walking-cube-rim";
  rim.position.set(3.1, 1.15, 1.25);
  root.add(rim);
  const fill = new THREE.PointLight(settings.palettePrimary, 18, 12, 1.7);
  fill.name = "walking-cube-fill";
  fill.position.set(-1.8, -2.5, 2.6);
  root.add(fill);

  root.userData.focusPosition = new THREE.Vector3(0, portrait ? .02 : -.03, 0);
  root.userData.cameraPush = 0;
  return root;
}

export function updateWalkingCubeScene(root: THREE.Group, frame: WalkingCubeRenderFrame): void {
  const settings = root.userData.settings as WalkingCubeSettings;
  const pose = frame.pose;
  const energy = THREE.MathUtils.clamp(Math.max(frame.audioPulse, frame.rhythmPulse * .86), 0, 1);
  const hero = root.getObjectByName("walking-cube-hero");
  if (hero) {
    hero.position.set(0, 0, 0);
    hero.scale.setScalar(1);
    hero.quaternion.set(pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w).normalize();
  }

  const background = root.getObjectByName("walking-cube-background-atmosphere") as THREE.Mesh | undefined;
  if (background?.material instanceof THREE.ShaderMaterial) {
    background.material.uniforms.uPhase!.value = pose.loopPhase;
    background.material.uniforms.uEnergy!.value = energy;
    background.material.uniforms.uStereo!.value = frame.stereoWidth;
  }
  const ripples = root.getObjectByName("walking-cube-water-ripples") as THREE.Mesh | undefined;
  if (ripples?.material instanceof THREE.ShaderMaterial) {
    ripples.material.uniforms.uBeatPhase!.value = pose.stepProgress;
    ripples.material.uniforms.uImpact!.value = THREE.MathUtils.clamp(pose.impactStrength * .72 + frame.rhythmPulse * .48, 0, 1);
    ripples.material.uniforms.uAudio!.value = energy;
  }

  const maximumHeight = Number(root.getObjectByName("walking-cube-spectrum")?.userData.maximumHeight ?? .72);
  root.traverse((child) => {
    if (child.name === "walking-cube-glass-shell" && child instanceof THREE.Mesh && child.material instanceof THREE.MeshPhysicalMaterial) {
      child.material.emissiveIntensity = .006 + energy * .018;
      child.material.envMapIntensity = 7.2 + energy * 2.4;
    } else if (child.name === "walking-cube-fresnel" && child instanceof THREE.Mesh && child.material instanceof THREE.ShaderMaterial) {
      child.material.uniforms.uEnergy!.value = energy;
    } else if (child.name === "walking-cube-spectrum-bar" && child instanceof THREE.Mesh) {
      const index = Number(child.userData.bandIndex);
      const source = Math.max(frame.spectrumBands[index] ?? 0, ((frame.stereoLeftBands[index] ?? 0) + (frame.stereoRightBands[index] ?? 0)) * .42);
      const value = Math.pow(Math.max(.012, source), .64);
      const height = .045 + Math.min(maximumHeight, value * maximumHeight * settings.spectrumIntensity);
      child.scale.y = height;
      child.position.y = height * .5;
      if (child.material instanceof THREE.MeshBasicMaterial) child.material.opacity = .78 + value * .2;
    } else if (child.name === "walking-cube-spectrum-peak" && child instanceof THREE.Mesh) {
      const index = Number(child.userData.bandIndex);
      const source = Math.max(frame.spectrumBands[index] ?? 0, ((frame.stereoLeftBands[index] ?? 0) + (frame.stereoRightBands[index] ?? 0)) * .42);
      const value = Math.pow(Math.max(.012, source), .64);
      const height = .045 + Math.min(maximumHeight, value * maximumHeight * settings.spectrumIntensity);
      child.position.y = height + .035;
      if (child.material instanceof THREE.MeshBasicMaterial) child.material.opacity = .42 + value * .44;
    } else if (child.name === "walking-cube-particles" && child instanceof THREE.Points) {
      const seeds = child.userData.seeds as ParticleSeed[];
      const positions = child.geometry.getAttribute("position") as THREE.BufferAttribute;
      const phase = pose.loopPhase * Math.PI * 2;
      seeds.forEach((seed, index) => positions.setXYZ(
        index,
        seed.x + Math.sin(phase + seed.phase) * seed.radius * (1 + frame.stereoWidth * .45),
        seed.y + Math.cos(phase + seed.phase) * seed.radius,
        seed.z + Math.sin(phase + seed.phase * .7) * seed.radius
      ));
      positions.needsUpdate = true;
      if (child.material instanceof THREE.PointsMaterial) {
        child.material.opacity = .28 + energy * .36;
        child.material.size = .018 + energy * .025;
      }
    } else if (child.name.startsWith("walking-cube-orbit-")) {
      const index = Number(child.name.at(-1) ?? 0);
      child.rotation.z = (index % 2 ? -1 : 1) * pose.loopPhase * Math.PI * 2 * (.18 + index * .04);
      const scale = 1 + energy * (.025 + index * .008);
      child.scale.setScalar(scale);
    } else if (child.name.startsWith("walking-cube-light-sweep-") && child instanceof THREE.Sprite) {
      const index = Number(child.name.at(-1) ?? 0);
      child.position.x = Math.sin(pose.loopPhase * Math.PI * 2 + index * Math.PI) * (root.userData.portrait ? 1.7 : 3.2);
      if (child.material instanceof THREE.SpriteMaterial) child.material.opacity = .055 + energy * .11;
    } else if (child.name === "walking-cube-halo" && child instanceof THREE.Sprite && child.material instanceof THREE.SpriteMaterial) {
      const pulse = 1 + energy * .09;
      const base = root.userData.portrait ? 4.4 : 5.2;
      child.scale.set(base * pulse, base * pulse, 1);
      child.material.opacity = .2 + energy * .2;
    } else if (child.name === "walking-cube-key" && child instanceof THREE.PointLight) child.intensity = 34 + energy * 24;
    else if (child.name === "walking-cube-rim" && child instanceof THREE.PointLight) child.intensity = 25 + energy * 24;
    else if (child.name === "walking-cube-fill" && child instanceof THREE.PointLight) child.intensity = 16 + energy * 13;
  });
}
