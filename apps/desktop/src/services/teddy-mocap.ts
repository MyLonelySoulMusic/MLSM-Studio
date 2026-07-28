import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

export type TeddyMocapClipId = "walking" | "startWalking" | "hipHop" | "silly" | "joyfulJump" | "jumpingUp";
export type TeddyMocapJoint = "leftArm" | "rightArm" | "leftForeArm" | "rightForeArm" | "leftUpLeg" | "rightUpLeg" | "leftLeg" | "rightLeg";

const clipUrls: Record<TeddyMocapClipId, string> = {
  walking: new URL("../assets/mixamo/Walking.fbx", import.meta.url).href,
  startWalking: new URL("../assets/mixamo/Start Walking.fbx", import.meta.url).href,
  hipHop: new URL("../assets/mixamo/Hip Hop Dancing.fbx", import.meta.url).href,
  silly: new URL("../assets/mixamo/Silly Dancing.fbx", import.meta.url).href,
  joyfulJump: new URL("../assets/mixamo/Joyful Jump.fbx", import.meta.url).href,
  jumpingUp: new URL("../assets/mixamo/Jumping Up.fbx", import.meta.url).href
};

const joints: readonly TeddyMocapJoint[] = ["leftArm", "rightArm", "leftForeArm", "rightForeArm", "leftUpLeg", "rightUpLeg", "leftLeg", "rightLeg"];
const down = new THREE.Vector3(0, -1, 0);

interface RetargetFrame {
  quaternions: Record<TeddyMocapJoint, THREE.Quaternion>;
  hipHeight: number;
}

interface ClipSampler {
  frames: RetargetFrame[];
}

export interface TeddyMocapCue {
  walkProgress: number;
  actionId: Exclude<TeddyMocapClipId, "walking" | "startWalking"> | "startWalking" | null;
  actionProgress: number;
  actionWeight: number;
  turnRadians: number;
}

export interface TeddyMocapPose {
  quaternions: Record<TeddyMocapJoint, THREE.Quaternion>;
  hipHeight: number;
  turnRadians: number;
  actionId: TeddyMocapCue["actionId"];
  actionWeight: number;
}

interface LimbSolution {
  upper: THREE.Quaternion;
  lower: THREE.Quaternion;
}

const identityPose = (): Record<TeddyMocapJoint, THREE.Quaternion> => Object.fromEntries(joints.map((joint) => [joint, new THREE.Quaternion()])) as Record<TeddyMocapJoint, THREE.Quaternion>;
const smootherstep = (value: number) => { const clamped = THREE.MathUtils.clamp(value, 0, 1); return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10); };

function clampQuaternionAngle(quaternion: THREE.Quaternion, maxAngle: number): THREE.Quaternion {
  const normalized = quaternion.clone().normalize();
  if (normalized.w < 0) normalized.set(-normalized.x, -normalized.y, -normalized.z, -normalized.w);
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(normalized.w, -1, 1));
  return angle > maxAngle ? new THREE.Quaternion().slerp(normalized, maxAngle / angle).normalize() : normalized;
}

/**
 * Risolve una catena a due segmenti nelle proporzioni dell'orsacchiotto.
 * Le direzioni arrivano dal rig Mixamo in spazio personaggio; i limiti laterali
 * impediscono alla spalla e al gomito di attraversare il volume del busto.
 */
export function solveTeddyLimbChain(
  upperDirection: THREE.Vector3,
  lowerDirection: THREE.Vector3,
  side: -1 | 1,
  kind: "arm" | "leg"
): LimbSolution {
  const upperDirectionSafe = upperDirection.clone().normalize();
  const lowerDirectionSafe = lowerDirection.clone().normalize();
  const minimumSeparation = kind === "arm" ? .16 : .035;

  if (side < 0) upperDirectionSafe.x = Math.min(upperDirectionSafe.x, -minimumSeparation);
  else upperDirectionSafe.x = Math.max(upperDirectionSafe.x, minimumSeparation);
  upperDirectionSafe.normalize();

  // Il gomito può avvicinarsi al centro, ma non puntare attraverso il torace.
  if (kind === "arm") {
    if (side < 0) lowerDirectionSafe.x = Math.min(lowerDirectionSafe.x, -.035);
    else lowerDirectionSafe.x = Math.max(lowerDirectionSafe.x, .035);
    lowerDirectionSafe.normalize();
  }

  const upperLimit = kind === "arm" ? THREE.MathUtils.degToRad(148) : THREE.MathUtils.degToRad(108);
  const lowerLimit = kind === "arm" ? THREE.MathUtils.degToRad(122) : THREE.MathUtils.degToRad(118);
  const upper = clampQuaternionAngle(new THREE.Quaternion().setFromUnitVectors(down, upperDirectionSafe), upperLimit);
  const lowerLocalDirection = lowerDirectionSafe.applyQuaternion(upper.clone().invert()).normalize();
  const lower = clampQuaternionAngle(new THREE.Quaternion().setFromUnitVectors(down, lowerLocalDirection), lowerLimit);
  return { upper, lower };
}

export function resolveTeddyMocapCue(timeSeconds: number, bpm: number, danceEnabled: boolean): TeddyMocapCue {
  const beatRate = Math.max(40, Number.isFinite(bpm) ? bpm : 120) / 60;
  const beatPosition = Math.max(0, timeSeconds) * beatRate;
  const walkProgress = (beatPosition % 4) / 4;
  if (!danceEnabled && beatPosition < 4) return { walkProgress, actionId: "startWalking", actionProgress: beatPosition / 4, actionWeight: smootherstep(Math.min(beatPosition, 4 - beatPosition) / .58), turnRadians: 0 };
  if (!danceEnabled) return { walkProgress, actionId: null, actionProgress: 0, actionWeight: 0, turnRadians: 0 };

  const cycle = beatPosition % 32;
  const segments: readonly { id: TeddyMocapCue["actionId"]; start: number; end: number; turn?: boolean }[] = [
    { id: "hipHop", start: 0, end: 8, turn: true },
    { id: "joyfulJump", start: 12, end: 16 },
    { id: "silly", start: 20, end: 28 },
    { id: "jumpingUp", start: 28, end: 32 }
  ];
  const segment = segments.find((item) => cycle >= item.start && cycle < item.end);
  if (!segment) return { walkProgress, actionId: null, actionProgress: 0, actionWeight: 0, turnRadians: 0 };
  const length = segment.end - segment.start;
  const actionProgress = (cycle - segment.start) / length;
  const edgeBeats = Math.min(.8, length * .18);
  const fadeIn = smootherstep((cycle - segment.start) / edgeBeats);
  const fadeOut = smootherstep((segment.end - cycle) / edgeBeats);
  const actionWeight = Math.min(fadeIn, fadeOut);
  const turnProgress = segment.turn ? smootherstep((actionProgress - .28) / .6) : 0;
  return { walkProgress, actionId: segment.id, actionProgress, actionWeight, turnRadians: turnProgress * Math.PI * 2 };
}

function node(root: THREE.Object3D, name: string): THREE.Object3D {
  const result = root.getObjectByName(name);
  if (!result) throw new Error(`Osso Mixamo mancante: ${name}`);
  return result;
}

function directionBetween(from: THREE.Object3D, to: THREE.Object3D): THREE.Vector3 {
  return to.getWorldPosition(new THREE.Vector3()).sub(from.getWorldPosition(new THREE.Vector3())).normalize();
}

function ensureQuaternionContinuity(previous: RetargetFrame | undefined, current: RetargetFrame): void {
  if (!previous) return;
  for (const joint of joints) {
    const quaternion = current.quaternions[joint];
    if (previous.quaternions[joint].dot(quaternion) < 0) quaternion.set(-quaternion.x, -quaternion.y, -quaternion.z, -quaternion.w);
  }
}

function samplerFromRig(root: THREE.Group, clip: THREE.AnimationClip): ClipSampler {
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();

  const bones = {
    hips: node(root, "mixamorigHips"),
    mixamoLeftArm: node(root, "mixamorigLeftArm"),
    mixamoLeftForeArm: node(root, "mixamorigLeftForeArm"),
    mixamoLeftHand: node(root, "mixamorigLeftHand"),
    mixamoRightArm: node(root, "mixamorigRightArm"),
    mixamoRightForeArm: node(root, "mixamorigRightForeArm"),
    mixamoRightHand: node(root, "mixamorigRightHand"),
    mixamoLeftUpLeg: node(root, "mixamorigLeftUpLeg"),
    mixamoLeftLeg: node(root, "mixamorigLeftLeg"),
    mixamoLeftFoot: node(root, "mixamorigLeftFoot"),
    mixamoRightUpLeg: node(root, "mixamorigRightUpLeg"),
    mixamoRightLeg: node(root, "mixamorigRightLeg"),
    mixamoRightFoot: node(root, "mixamorigRightFoot")
  };

  // Precampionamento a 60 Hz: durante preview ed export non vengono più
  // rivalutati sei scheletri FBX e il risultato resta identico e deterministico.
  const frameCount = Math.max(2, Math.ceil(Math.max(.001, clip.duration) * 60) + 1);
  const frames: RetargetFrame[] = [];
  let hipReferenceY = 0;
  for (let index = 0; index < frameCount; index += 1) {
    mixer.setTime((index / (frameCount - 1)) * Math.max(.001, clip.duration));
    root.updateMatrixWorld(true);
    const hipY = bones.hips.getWorldPosition(new THREE.Vector3()).y;
    if (index === 0) hipReferenceY = hipY;

    // I nomi left/right dell'orsacchiotto sono riferiti allo spettatore:
    // il lato Mixamo destro corrisponde quindi al suo lato X negativo.
    const leftArm = solveTeddyLimbChain(
      directionBetween(bones.mixamoRightArm, bones.mixamoRightForeArm),
      directionBetween(bones.mixamoRightForeArm, bones.mixamoRightHand),
      -1,
      "arm"
    );
    const rightArm = solveTeddyLimbChain(
      directionBetween(bones.mixamoLeftArm, bones.mixamoLeftForeArm),
      directionBetween(bones.mixamoLeftForeArm, bones.mixamoLeftHand),
      1,
      "arm"
    );
    const leftLeg = solveTeddyLimbChain(
      directionBetween(bones.mixamoRightUpLeg, bones.mixamoRightLeg),
      directionBetween(bones.mixamoRightLeg, bones.mixamoRightFoot),
      -1,
      "leg"
    );
    const rightLeg = solveTeddyLimbChain(
      directionBetween(bones.mixamoLeftUpLeg, bones.mixamoLeftLeg),
      directionBetween(bones.mixamoLeftLeg, bones.mixamoLeftFoot),
      1,
      "leg"
    );
    const frame: RetargetFrame = {
      quaternions: {
        leftArm: leftArm.upper,
        leftForeArm: leftArm.lower,
        rightArm: rightArm.upper,
        rightForeArm: rightArm.lower,
        leftUpLeg: leftLeg.upper,
        leftLeg: leftLeg.lower,
        rightUpLeg: rightLeg.upper,
        rightLeg: rightLeg.lower
      },
      // I file forniti conservano le traslazioni Mixamo in centimetri.
      hipHeight: THREE.MathUtils.clamp((hipY - hipReferenceY) * .0085, -.05, .42)
    };
    ensureQuaternionContinuity(frames.at(-1), frame);
    frames.push(frame);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  return { frames };
}

function sampleClip(sampler: ClipSampler, progress: number): RetargetFrame {
  const framePosition = THREE.MathUtils.clamp(progress, 0, 1) * (sampler.frames.length - 1);
  const lowerIndex = Math.floor(framePosition);
  const upperIndex = Math.min(sampler.frames.length - 1, lowerIndex + 1);
  // SLERP lineare fra campioni già fitti: applicare un easing a ogni singolo
  // intervallo creerebbe 60 micro-arresti al secondo, percepiti come convulsioni.
  const blend = framePosition - lowerIndex;
  const lower = sampler.frames[lowerIndex]!;
  const upper = sampler.frames[upperIndex]!;
  const quaternions = identityPose();
  for (const joint of joints) quaternions[joint].copy(lower.quaternions[joint]).slerp(upper.quaternions[joint], blend).normalize();
  return { quaternions, hipHeight: THREE.MathUtils.lerp(lower.hipHeight, upper.hipHeight, blend) };
}

export class TeddyMocapLibrary {
  constructor(private readonly samplers: Record<TeddyMocapClipId, ClipSampler>) {}

  sample(timeSeconds: number, bpm: number, danceEnabled: boolean): TeddyMocapPose {
    const cue = resolveTeddyMocapCue(timeSeconds, bpm, danceEnabled);
    const walking = sampleClip(this.samplers.walking, cue.walkProgress);
    if (!cue.actionId || cue.actionWeight <= 0) return { ...walking, turnRadians: 0, actionId: null, actionWeight: 0 };
    const action = sampleClip(this.samplers[cue.actionId], cue.actionProgress);
    const quaternions = identityPose();
    for (const joint of joints) quaternions[joint].copy(walking.quaternions[joint]).slerp(action.quaternions[joint], cue.actionWeight).normalize();
    return {
      quaternions,
      hipHeight: THREE.MathUtils.lerp(walking.hipHeight, action.hipHeight, cue.actionWeight),
      turnRadians: cue.turnRadians,
      actionId: cue.actionId,
      actionWeight: cue.actionWeight
    };
  }
}

let libraryPromise: Promise<TeddyMocapLibrary> | null = null;
export function loadTeddyMocapLibrary(): Promise<TeddyMocapLibrary> {
  libraryPromise ??= Promise.all((Object.entries(clipUrls) as [TeddyMocapClipId, string][]).map(async ([id, url]) => {
    const root = await new FBXLoader().loadAsync(url);
    const clip = root.animations[0];
    if (!clip) throw new Error(`Animazione Mixamo vuota: ${id}`);
    return [id, samplerFromRig(root, clip)] as const;
  })).then((entries) => new TeddyMocapLibrary(Object.fromEntries(entries) as Record<TeddyMocapClipId, ClipSampler>));
  return libraryPromise;
}
