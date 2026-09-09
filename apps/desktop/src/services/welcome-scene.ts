import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { ARTIST_LOGO_URL } from "./artist-brand";
import { buildLogoRelief } from "./logo-relief";
import { FIGURE_CLIP, FIGURE_PRINT_MASK, LOGO_VECTORS, LOGO_VIEWBOX, LOGO_WORLD_SIZE } from "./artist-logo-design";
import type { UiTheme } from "./ui-preferences";
import { welcomeMotion, WELCOME_FPS } from "./welcome-motion";

export const WELCOME_RENDER_LIMITS = { fps: WELCOME_FPS, pixelRatio: 1.5, width: 1440, height: 1200 } as const;
export interface WelcomeSceneController { setAnimating: (value: boolean) => void; setTime: (seconds: number, reducedMotion: boolean) => void; setTheme: (theme: UiTheme) => void; dispose: () => void; }
interface SceneOptions { theme: UiTheme; signal: AbortSignal; onContextLost: () => void; }

/** Original artwork as displaced geometry with metal edges. No model downloads,
 * shadows, post-processing or per-frame geometry updates. */
export async function createWelcomeScene(host: HTMLElement, options: SceneOptions): Promise<WelcomeSceneController> {
  const artwork = new Image();
  artwork.src = ARTIST_LOGO_URL;
  await artwork.decode();
  options.signal.throwIfAborted();
  const sample = document.createElement("canvas");
  sample.width = sample.height = LOGO_VIEWBOX;
  const context = sample.getContext("2d");
  if (!context) throw new Error("Logo canvas unavailable");
  context.clip(new Path2D(FIGURE_CLIP));
  context.clip(new Path2D(FIGURE_PRINT_MASK), "evenodd");
  context.drawImage(artwork, 0, 0, sample.width, sample.height);
  const figure = context.getImageData(0, 0, sample.width, sample.height);
  for (let i = 0; i < figure.data.length; i += 4) {
    figure.data[i + 3] = Math.max(0, figure.data[i + 3]! - 6 * Math.max(0, figure.data[i]! - figure.data[i + 1]!));
  }
  context.putImageData(figure, 0, 0);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, .1, 30);
  camera.position.set(0, .05, 7.5);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.domElement.setAttribute("aria-hidden", "true");
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [], textures: THREE.Texture[] = [];
  const inkFaces: THREE.MeshBasicMaterial[] = [];
  const paperFaces: THREE.MeshBasicMaterial[] = [];
  let environment: THREE.WebGLRenderTarget | undefined;
  let disposed = false, animating = false, visible = true, elapsed = 0, reducedMotion = false;
  let contextLost = false;
  let resizeObserver: ResizeObserver | undefined;
  let intersectionObserver: IntersectionObserver | undefined;
  const pointer = new THREE.Vector2(), smoothedPointer = new THREE.Vector2();
  const logo = new THREE.Group();
  scene.add(logo);
  const light = new THREE.HemisphereLight(0xfff5f9, 0x756774, 2.3);
  scene.add(light);
  const key = new THREE.DirectionalLight(0xffedf5, 2.3);
  key.position.set(-3, 4, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xedb1ce, 3.5);
  rim.position.set(4, .5, 1);
  scene.add(rim);
  const draw = () => {
    if (disposed || contextLost || !visible || document.hidden) return;
    const pose = welcomeMotion(elapsed, reducedMotion);
    if (reducedMotion) smoothedPointer.set(0, 0);
    else if (animating) smoothedPointer.lerp(pointer, .065);
    logo.rotation.set(pose.rx - smoothedPointer.y * .07 * pose.pointer, pose.ry + smoothedPointer.x * .14 * pose.pointer, pose.rz);
    logo.position.set(pose.x, pose.y, pose.z);
    logo.scale.setScalar(pose.scale);
    renderer.render(scene, camera);
  };
  const resize = () => {
    if (disposed) return;
    // The entrance scales/moves an ancestor; measure the untransformed canvas.
    const { clientWidth: width, clientHeight: height } = host;
    if (!width || !height) return;
    const scale = Math.min(window.devicePixelRatio || 1, WELCOME_RENDER_LIMITS.pixelRatio, WELCOME_RENDER_LIMITS.width / width, WELCOME_RENDER_LIMITS.height / height);
    renderer.setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), false);
    camera.aspect = width / height;
    camera.position.z = 7.5 / Math.min(1, camera.aspect);
    camera.updateProjectionMatrix(); draw();
  };
  const move = (event: PointerEvent) => {
    if (!animating || event.pointerType === "touch") return;
    const bounds = host.getBoundingClientRect();
    if (bounds.width && bounds.height) pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, (event.clientY - bounds.top) / bounds.height * 2 - 1);
  };
  const resetPointer = () => { pointer.set(0, 0); };
  const lost = (event: Event) => { event.preventDefault(); contextLost = true; animating = false; options.onContextLost(); };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    resizeObserver?.disconnect(); intersectionObserver?.disconnect();
    window.removeEventListener("resize", resize);
    host.removeEventListener("pointermove", move); host.removeEventListener("pointerleave", resetPointer);
    renderer.domElement.removeEventListener("webglcontextlost", lost);
    geometries.forEach((value) => value.dispose()); materials.forEach((value) => value.dispose()); textures.forEach((value) => value.dispose());
    scene.environment = null; environment?.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  };
  const setTheme = (theme: UiTheme) => {
    light.intensity = theme === "night" ? 2.6 : 2.3;
    rim.intensity = theme === "night" ? 4 : 3.5;
    inkFaces.forEach((face) => face.color.set(theme === "night" ? 0xf2eff5 : 0x24212a));
    paperFaces.forEach((face) => face.color.set(theme === "night" ? 0x38343e : 0xeee8ee));
    if (!disposed) draw();
  };
  try {
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    try { environment = pmrem.fromScene(room, .04, .1, 30, { size: 128 }); }
    finally { room.dispose(); pmrem.dispose(); }
    scene.environment = environment.texture;
    const face = buildLogoRelief();
    geometries.push(face);
    const texture = new THREE.CanvasTexture(sample);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    textures.push(texture);
    const enamel = new THREE.MeshBasicMaterial({ color: 0xd6d6d6, map: texture, transparent: true, alphaTest: .025, side: THREE.DoubleSide, toneMapped: false });
    materials.push(enamel);
    logo.add(new THREE.Mesh(face, enamel));
    const loader = new SVGLoader();
    const scale = LOGO_WORLD_SIZE / LOGO_VIEWBOX;
    for (const part of LOGO_VECTORS) {
      const parsed = loader.parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${part.path}" /></svg>`);
      const shapes = parsed.paths.flatMap((path) => SVGLoader.createShapes(path));
      const solid = new THREE.ExtrudeGeometry(shapes, { depth: part.depth, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: part.name.startsWith("letter") ? 1.6 : .7, bevelThickness: 1, curveSegments: 24 });
      const color = part.color === "rose" ? 0xd482a7 : part.color === "paper" ? 0xeee8ee : 0x24212a;
      const front = new THREE.MeshBasicMaterial({ color, toneMapped: false });
      const edge = new THREE.MeshStandardMaterial({ color: part.color === "rose" ? 0x985370 : 0x66525f, roughness: .48, metalness: .4 });
      geometries.push(solid); materials.push(front, edge);
      if (part.color === "ink") inkFaces.push(front);
      if (part.color === "paper") paperFaces.push(front);
      const object = new THREE.Mesh(solid, [front, edge]);
      object.scale.set(scale, -scale, scale);
      object.position.set(-LOGO_WORLD_SIZE / 2, LOGO_WORLD_SIZE / 2, part.z);
      logo.add(object);
    }
    host.append(renderer.domElement);
    renderer.domElement.addEventListener("webglcontextlost", lost);
    host.addEventListener("pointermove", move, { passive: true }); host.addEventListener("pointerleave", resetPointer);
    resize(); setTheme(options.theme);
    if (typeof ResizeObserver !== "undefined") { resizeObserver = new ResizeObserver(resize); resizeObserver.observe(host); }
    else window.addEventListener("resize", resize);
    if (typeof IntersectionObserver !== "undefined") {
      intersectionObserver = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? true; draw(); }); intersectionObserver.observe(host);
    }
    // A single clock in WelcomeScene also drives the CSS/fallback presentation.
    return { setAnimating: (value) => { animating = value; }, setTime: (seconds, reduce) => { elapsed = seconds; reducedMotion = reduce; draw(); }, setTheme, dispose };
  } catch (error) { dispose(); throw error; }
}
