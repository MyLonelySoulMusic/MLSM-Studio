import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { RhythmBallProject } from "@rbs/project-schema";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { slideHeightOffset, type MotionKind, type TrajectorySegment, type Vector3Data } from "@rbs/trajectory";
import { useSceneStore, type BallAppearance, type EditableSceneObject, type NeonAppearance, type RailColors } from "../store/scene-store";
import { railBarRadius, railGauge, railSupportDrop, railTrimEnd, railTrimStart } from "../services/route-geometry";
import type { SharedViewportRenderer } from "../services/live-video-exporter";
import { instrumentImpactPose } from "../services/instrument-impact";
import { newYorkSewerEntryIndex, normalizeNewYorkLevels } from "../services/new-york-scene-generator";
import { createNewYorkRaceEvaluator } from "../services/new-york-race";
import { createRollingOrientationEvaluator } from "../services/rolling-orientation";
import { fallingFragmentPose } from "../services/new-york-swarm";
import { resolveSceneLightFrame } from "../services/scene-light";
import { resolveSubtitleAnimation } from "../services/subtitle-animation";
import { calculateSubtitleLayout } from "../services/subtitle-layout";
import { resolveTeddyWalkMotion, teddyRoadScrollDirection, teddyWalkHeading } from "../services/teddy-walk-motion";
import { loadTeddyMocapLibrary, type TeddyMocapJoint, type TeddyMocapLibrary } from "../services/teddy-mocap";
import type { TeddyLipSyncPose } from "../services/teddy-lipsync";
import { deformStereoCoverVertex, resolveStereoUnfoldMotion } from "../services/stereo-unfold-motion";
import { createPixelArtNewYorkScene, updatePixelArtNewYorkScene } from "../services/pixel-art-new-york-renderer";
import { createWalkingCubeMotionEvaluator } from "../services/walking-cube-motion";
import { createWalkingCubeScene, updateWalkingCubeScene } from "../services/walking-cube-renderer";
import { renderProSubtitleCompositionFrame } from "../services/pro-subtitles";
import { subtitleFontWeight } from "../services/subtitle-fonts";
import { clearPixelsSubTextLayoutCache, pixelsSubFontWeight, renderPixelsSubFrame } from "../services/pixels-sub-renderer";
import { useFullscreenPreview } from "../services/use-fullscreen-preview";
import { StaticWatermarkPreview } from "./StaticWatermarkPreview";
import { UpscalerPreview } from "./UpscalerPreview";
import { FullscreenPlaybackDock } from "./FullscreenPlaybackDock";

type TintableMaterial = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
type NewYorkSettings = RhythmBallProject["animation"]["newYorkStreets"];
type CoverSphereSettings = RhythmBallProject["animation"]["coverSphere"];
type StereoUnfoldSettings = RhythmBallProject["animation"]["stereoUnfold"];
type WalkingCubeSettings = RhythmBallProject["animation"]["walkingCube"];
type PixelArtSettings = RhythmBallProject["animation"]["pixelArt"];
type TeddyWalkSettings = RhythmBallProject["animation"]["teddyWalk"];
type TeddySingSettings = RhythmBallProject["animation"]["teddySing"];
type AddSubtitlesSettings = RhythmBallProject["animation"]["addSubtitles"];
type ProSubtitlesSettings = RhythmBallProject["animation"]["proSubtitles"];
type PixelsSubSettings = RhythmBallProject["animation"]["pixelsSub"];
type StaticWatermarkSettings = RhythmBallProject["animation"]["staticWatermark"];
type UpscalerSettings = RhythmBallProject["animation"]["upscaler"];

function material(color: string, roughness: number, metalness: number, emissiveIntensity = .035): THREE.MeshStandardMaterial {
  const result = new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive: color, emissiveIntensity });
  result.userData.tintable = true;
  return result;
}

function mesh(geometry: THREE.BufferGeometry, meshMaterial: THREE.Material, objectId?: string): THREE.Mesh {
  const result = new THREE.Mesh(geometry, meshMaterial);
  result.castShadow = true;
  result.receiveShadow = true;
  if (objectId) result.userData.objectId = objectId;
  return result;
}

function cylinderBetween(start: THREE.Vector3, end: THREE.Vector3, radius: number, meshMaterial: THREE.Material, objectId?: string): THREE.Mesh {
  const center = start.clone().add(end).multiplyScalar(.5); const direction = end.clone().sub(start);
  const result = mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 12), meshMaterial, objectId);
  result.position.copy(center); result.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return result;
}

function wearTexture(seed: string, metallic = false): THREE.CanvasTexture {
  const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  let state = [...seed].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 2166136261);
  const random = () => { state = Math.imul(state ^ state >>> 15, 1 | state); state ^= state + Math.imul(state ^ state >>> 7, 61 | state); return ((state ^ state >>> 14) >>> 0) / 4294967296; };
  context.fillStyle = "#f7f5ef"; context.fillRect(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < 34; index += 1) {
    const x = random() * canvas.width; const y = random() * canvas.height; const length = 18 + random() * 92;
    context.strokeStyle = `rgba(${metallic ? "72,58,34" : "63,54,48"},${.18 + random() * .34})`; context.lineWidth = .7 + random() * 2.2;
    context.beginPath(); context.moveTo(x, y); context.lineTo(x + (random() - .5) * 18, y + length); context.stroke();
    context.strokeStyle = `rgba(255,255,255,${.22 + random() * .35})`; context.lineWidth = .55; context.beginPath(); context.moveTo(x + 2, y); context.lineTo(x + 2 + (random() - .5) * 15, y + length * .86); context.stroke();
  }
  for (let index = 0; index < 90; index += 1) {
    const radius = 1 + random() * 5; context.fillStyle = `rgba(${metallic ? "92,65,24" : "55,42,36"},${.06 + random() * .15})`; context.beginPath(); context.arc(random() * canvas.width, random() * canvas.height, radius, 0, Math.PI * 2); context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = THREE.RepeatWrapping; texture.anisotropy = 4; return texture;
}

function applyWear(surface: THREE.MeshStandardMaterial, seed: string, metallic = false): THREE.MeshStandardMaterial {
  const texture = wearTexture(seed, metallic); surface.map = texture; surface.bumpMap = texture; surface.bumpScale = metallic ? .012 : .022; return surface;
}

function drumHeadTexture(seed: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256; const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const gradient = context.createRadialGradient(128, 128, 4, 128, 128, 126); gradient.addColorStop(0, "#66676a"); gradient.addColorStop(.18, "#858589"); gradient.addColorStop(.42, "#bbb9b2"); gradient.addColorStop(.72, "#e1dfd7"); gradient.addColorStop(1, "#f4f1e8"); context.fillStyle = gradient; context.fillRect(0, 0, 256, 256);
  let state = [...seed].reduce((value, character) => (value * 33 + character.charCodeAt(0)) >>> 0, 5381); const random = () => ((state = Math.imul(state ^ state >>> 13, 1274126177)) >>> 0) / 4294967296;
  context.lineCap = "round";
  for (let index = 0; index < 38; index += 1) { const angle = random() * Math.PI * 2; const inner = 8 + random() * 34; const outer = inner + 24 + random() * 62; context.strokeStyle = `rgba(${index % 3 ? "58,58,61" : "250,247,235"},${.1 + random() * .28})`; context.lineWidth = .7 + random() * 2.4; context.beginPath(); context.moveTo(128 + Math.cos(angle) * inner, 128 + Math.sin(angle) * inner); context.lineTo(128 + Math.cos(angle + (random() - .5) * .2) * outer, 128 + Math.sin(angle + (random() - .5) * .2) * outer); context.stroke(); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8; return texture;
}

function drum(object: EditableSceneObject, variant: "drum" | "kick" | "snare"): THREE.Group {
  const group = new THREE.Group();
  const radius = variant === "kick" ? .92 : variant === "snare" ? .68 : .76;
  const depth = variant === "kick" ? .52 : variant === "snare" ? .34 : .46;
  const shellSurface = applyWear(material(object.color, Math.max(object.roughness, .38), Math.max(object.metalness, .72)), `${object.id}-shell`, true); shellSurface.userData.metalnessFloor = .72; shellSurface.userData.roughnessFloor = .38;
  const shell = mesh(new THREE.CylinderGeometry(radius, radius * .98, depth, 56, 1, false), shellSurface, object.id);
  group.add(shell);
  const headTexture = drumHeadTexture(`${object.id}-head`); const headMaterial = new THREE.MeshPhysicalMaterial({ color: "#ffffff", map: headTexture, bumpMap: headTexture, bumpScale: .012, roughness: .46, metalness: .02, clearcoat: .42, clearcoatRoughness: .34 });
  const head = mesh(new THREE.CylinderGeometry(radius * .91, radius * .91, .045, 56), headMaterial, object.id);
  head.name = "drum-impact-head";
  head.position.y = depth / 2 + .02;
  group.add(head);
  const ringMaterial = new THREE.MeshStandardMaterial({ color: variant === "kick" ? "#11131a" : "#dbe2ee", roughness: .18, metalness: .92 });
  for (const z of [-depth / 2 - .025, depth / 2 + .04]) {
    const ring = mesh(new THREE.TorusGeometry(radius * .97, .045, 12, 64), ringMaterial, object.id);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = z;
    group.add(ring);
  }
  const patinaMaterial = new THREE.MeshStandardMaterial({ color: "#786b57", roughness: .58, metalness: .66, transparent: true, opacity: .48 });
  for (const y of [-depth * .27, depth * .27]) { const band = mesh(new THREE.TorusGeometry(radius * .985, .018, 8, 56), patinaMaterial, object.id); band.rotation.x = Math.PI / 2; band.position.y = y; group.add(band); }
  const lugCount = variant === "kick" ? 10 : 8;
  for (let index = 0; index < lugCount; index += 1) {
    const angle = index / lugCount * Math.PI * 2;
    const lug = mesh(new RoundedBoxGeometry(.075, depth + .12, .075, 3, .025), ringMaterial, object.id);
    lug.position.set(Math.cos(angle) * radius * .86, 0, Math.sin(angle) * radius * .86);
    lug.rotation.y = angle;
    group.add(lug);
  }
  const scratchMaterial = new THREE.MeshStandardMaterial({ color: "#e8decb", roughness: .78, metalness: .12, transparent: true, opacity: .68, depthWrite: false });
  for (let index = 0; index < 12; index += 1) { const angle = .45 + index * 1.11; const scratch = mesh(new RoundedBoxGeometry(.018, .13 + index % 4 * .04, .01, 2, .004), scratchMaterial, object.id); scratch.position.set(Math.cos(angle) * radius * 1.006, (index % 5 - 2) * depth * .12, Math.sin(angle) * radius * 1.006); scratch.rotation.y = -angle; scratch.rotation.z = (index % 3 - 1) * .28; group.add(scratch); }
  const headWear = new THREE.Group(); headWear.position.y = depth / 2 + .048;
  const stickMarkMaterial = new THREE.MeshStandardMaterial({ color: "#5e626a", roughness: .92, transparent: true, opacity: .34, depthWrite: false });
  for (const markRadius of [radius * .29, radius * .43]) { const mark = mesh(new THREE.TorusGeometry(markRadius, .009, 5, 48, Math.PI * 1.55), stickMarkMaterial, object.id); mark.rotation.x = Math.PI / 2; mark.rotation.z = markRadius * 2.7; headWear.add(mark); }
  for (let index = 0; index < 5; index += 1) { const angle = -.65 + index * .31; const start = new THREE.Vector3(Math.cos(angle) * radius * .08, 0, Math.sin(angle) * radius * .08); const end = new THREE.Vector3(Math.cos(angle + .13) * radius * (.44 + index * .055), 0, Math.sin(angle + .13) * radius * (.44 + index * .055)); headWear.add(cylinderBetween(start, end, .008, stickMarkMaterial, object.id)); }
  group.add(headWear);
  if (variant === "kick") {
    const inner = mesh(new THREE.CircleGeometry(radius * .46, 48), new THREE.MeshStandardMaterial({ color: "#11131a", roughness: .4 }), object.id);
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = depth / 2 + .046;
    group.add(inner);
    const spurMaterial = new THREE.MeshStandardMaterial({ color: "#a9b0ba", roughness: .28, metalness: .88 });
    for (const x of [-.62, .62]) { group.add(cylinderBetween(new THREE.Vector3(x, -.2, .15), new THREE.Vector3(x * 1.25, -.65, .42), .025, spurMaterial, object.id)); const foot = mesh(new THREE.SphereGeometry(.055, 16, 10), spurMaterial, object.id); foot.position.set(x * 1.25, -.65, .42); group.add(foot); }
  }
  if (variant === "snare") {
    for (let index = -4; index <= 4; index += 1) {
      group.add(cylinderBetween(new THREE.Vector3(-radius * .82, -depth / 2 - .052, index * .055), new THREE.Vector3(radius * .82, -depth / 2 - .052, index * .055), .009, ringMaterial, object.id));
    }
    const throwOff = mesh(new RoundedBoxGeometry(.13, .25, .09, 4, .025), ringMaterial, object.id); throwOff.position.set(radius * .98, 0, 0); group.add(throwOff);
  }
  const stickMaterial = new THREE.MeshStandardMaterial({ color: "#24201c", roughness: .62, metalness: .08 }); const stickStart = new THREE.Vector3(radius * .24, depth / 2 + .12, -.28); const stickEnd = new THREE.Vector3(radius * .86, depth / 2 + .74, -.5); group.add(cylinderBetween(stickStart, stickEnd, .026, stickMaterial, object.id)); const stickTip = mesh(new THREE.SphereGeometry(.075, 20, 14), stickMaterial, object.id); stickTip.position.copy(stickEnd); group.add(stickTip);
  return group;
}

function cymbal(object: EditableSceneObject): THREE.Group {
  const group = new THREE.Group();
  const movingPlate = new THREE.Group(); movingPlate.name = "cymbal-impact-surface"; group.add(movingPlate);
  const profile = [new THREE.Vector2(.06, .16), new THREE.Vector2(.18, .13), new THREE.Vector2(.3, .075), new THREE.Vector2(.72, .025), new THREE.Vector2(.9, 0), new THREE.Vector2(.72, -.035), new THREE.Vector2(.3, .03), new THREE.Vector2(.06, .11)];
  const bronze = applyWear(material(object.color, Math.max(object.roughness, .2), .9, .05), `${object.id}-bronze`, true);
  const plate = mesh(new THREE.LatheGeometry(profile, 72), bronze, object.id);
  plate.rotation.x = .45;
  movingPlate.add(plate);
  const grooveMaterial = new THREE.MeshStandardMaterial({ color: "#f0cc69", roughness: .3, metalness: .9, transparent: true, opacity: .52 });
  for (const radius of [.26, .4, .55, .7, .82]) { const groove = mesh(new THREE.TorusGeometry(radius, .006, 5, 72), grooveMaterial, object.id); groove.rotation.x = Math.PI / 2 + .45; movingPlate.add(groove); }
  const hammerGroup = new THREE.Group(); hammerGroup.rotation.x = .45;
  for (let index = 0; index < 18; index += 1) { const angle = index * 2.399; const radius = .25 + index % 5 * .125; const dimple = mesh(new THREE.SphereGeometry(.025, 10, 6), new THREE.MeshStandardMaterial({ color: index % 2 ? "#8f6a24" : "#f2cf73", roughness: .5, metalness: .78, transparent: true, opacity: .42 }), object.id); dimple.scale.set(1.7, .22, 1); dimple.position.set(Math.cos(angle) * radius, .018, Math.sin(angle) * radius); hammerGroup.add(dimple); } movingPlate.add(hammerGroup);
  const cymbalWear = new THREE.Group(); cymbalWear.rotation.x = .45;
  const cymbalScratch = new THREE.MeshStandardMaterial({ color: "#4c3512", roughness: .65, metalness: .72, transparent: true, opacity: .62, depthWrite: false });
  for (let index = 0; index < 15; index += 1) { const angle = .2 + index * 1.73; const inner = .22 + index % 3 * .08; const outer = Math.min(.86, inner + .2 + index % 4 * .055); cymbalWear.add(cylinderBetween(new THREE.Vector3(Math.cos(angle) * inner, .028, Math.sin(angle) * inner), new THREE.Vector3(Math.cos(angle) * outer, .028, Math.sin(angle) * outer), .0065, cymbalScratch, object.id)); }
  movingPlate.add(cymbalWear);
  const standMaterial = new THREE.MeshStandardMaterial({ color: "#b8c1d0", roughness: .2, metalness: .9 });
  const stand = mesh(new THREE.CylinderGeometry(.025, .035, 1.35, 12), standMaterial, object.id);
  stand.position.set(0, -.65, -.18);
  group.add(stand);
  const collar = mesh(new THREE.SphereGeometry(.09, 18, 12), standMaterial, object.id);
  collar.position.set(0, -.02, .02);
  group.add(collar);
  for (let index = 0; index < 3; index += 1) { const angle = index / 3 * Math.PI * 2; group.add(cylinderBetween(new THREE.Vector3(0, -1.28, -.18), new THREE.Vector3(Math.cos(angle) * .48, -1.48, -.18 + Math.sin(angle) * .48), .018, standMaterial, object.id)); }
  return group;
}

function spring(object: EditableSceneObject): THREE.Group {
  const group = new THREE.Group();
  const points: THREE.Vector3[] = [];
  for (let index = 0; index <= 80; index += 1) {
    const ratio = index / 80;
    points.push(new THREE.Vector3(Math.cos(ratio * Math.PI * 10) * .34, ratio * .9 - .45, Math.sin(ratio * Math.PI * 10) * .34));
  }
  const coil = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 128, .055, 10, false), material(object.color, .16, .88, .08), object.id);
  group.add(coil);
  const baseMaterial = new THREE.MeshStandardMaterial({ color: "#202735", roughness: .3, metalness: .75 });
  const base = mesh(new RoundedBoxGeometry(.9, .16, .68, 5, .07), baseMaterial, object.id);
  base.position.y = -.54;
  group.add(base);
  const pad = mesh(new RoundedBoxGeometry(.82, .12, .62, 5, .06), material(object.color, .22, .42, .1), object.id);
  pad.position.y = .52;
  group.add(pad);
  return group;
}

function platform(object: EditableSceneObject, block: boolean): THREE.Group {
  const group = new THREE.Group();
  const width = block ? 1.15 : 2.15;
  const height = block ? .52 : .22;
  const body = mesh(new RoundedBoxGeometry(width, height, .72, 6, .09), applyWear(material(object.color, object.roughness, object.metalness, .06), `${object.id}-body`, object.metalness > .55), object.id);
  group.add(body);
  const edgeMaterial = new THREE.MeshStandardMaterial({ color: "#e9f2ff", roughness: .14, metalness: .88 });
  for (const x of [-width / 2 + .06, width / 2 - .06]) {
    const edge = mesh(new RoundedBoxGeometry(.055, height + .035, .76, 3, .02), edgeMaterial, object.id);
    edge.position.x = x;
    group.add(edge);
  }
  const inset = mesh(new RoundedBoxGeometry(width * .78, .025, .74, 3, .012), new THREE.MeshPhysicalMaterial({ color: object.color, emissive: object.color, emissiveIntensity: .75, roughness: .25 }), object.id);
  inset.position.y = height / 2 + .02;
  group.add(inset);
  return group;
}

function peg(object: EditableSceneObject): THREE.Group {
  const group = new THREE.Group();
  const body = mesh(new THREE.CylinderGeometry(.11, .16, 1.15, 24), material(object.color, .24, .72, .08), object.id);
  group.add(body);
  const cap = mesh(new THREE.SphereGeometry(.19, 24, 16), new THREE.MeshPhysicalMaterial({ color: object.color, clearcoat: 1, roughness: .12, metalness: .25 }), object.id);
  cap.position.y = .58;
  group.add(cap);
  return group;
}

function piano(object: EditableSceneObject): THREE.Group {
  const group = new THREE.Group(); const casing = applyWear(material(object.color, object.roughness, object.metalness, .05), `${object.id}-casing`);
  const body = mesh(new RoundedBoxGeometry(1.9, .26, .76, 6, .07), casing, object.id); body.position.y = -.12; group.add(body);
  const back = mesh(new RoundedBoxGeometry(1.9, .48, .16, 5, .05), casing, object.id); back.position.set(0, .18, -.31); group.add(back);
  const white = new THREE.MeshPhysicalMaterial({ color: "#f6f3e9", roughness: .24, clearcoat: .4 }); const black = new THREE.MeshStandardMaterial({ color: "#111318", roughness: .18, metalness: .2 });
  for (let index = 0; index < 14; index += 1) { const key = mesh(new RoundedBoxGeometry(.124, .055, .52, 2, .012), white, object.id); key.position.set((index - 6.5) * .132, .045, .07); group.add(key); }
  for (const index of [0, 1, 3, 4, 5, 7, 8, 10, 11, 12]) { const key = mesh(new RoundedBoxGeometry(.075, .07, .31, 2, .01), black, object.id); key.position.set((index - 6) * .132 + .064, .09, -.045); group.add(key); }
  for (const x of [-.72, .72]) { const leg = mesh(new THREE.CylinderGeometry(.045, .06, .48, 14), new THREE.MeshStandardMaterial({ color: "#252933", roughness: .25, metalness: .7 }), object.id); leg.position.set(x, -.45, -.16); group.add(leg); }
  return group;
}

function guitar(object: EditableSceneObject): THREE.Group {
  const group = new THREE.Group(); const wood = applyWear(material(object.color, object.roughness, object.metalness, .035), `${object.id}-wood`);
  const lower = mesh(new THREE.SphereGeometry(.48, 40, 24), wood, object.id); lower.scale.set(1, .28, .82); lower.position.set(-.45, 0, 0); group.add(lower);
  const upper = mesh(new THREE.SphereGeometry(.35, 36, 20), wood, object.id); upper.scale.set(.92, .25, .8); upper.position.set(-.12, .015, 0); group.add(upper);
  const neck = mesh(new RoundedBoxGeometry(1.25, .13, .16, 4, .035), new THREE.MeshStandardMaterial({ color: "#5c321e", roughness: .38 }), object.id); neck.position.set(.68, .06, 0); group.add(neck);
  const head = mesh(new RoundedBoxGeometry(.3, .16, .27, 4, .06), wood, object.id); head.position.set(1.38, .06, 0); group.add(head);
  const hole = mesh(new THREE.TorusGeometry(.15, .026, 12, 40), new THREE.MeshStandardMaterial({ color: "#21130e", roughness: .6 }), object.id); hole.rotation.x = -Math.PI / 2; hole.position.set(-.38, .145, 0); group.add(hole);
  const stringMaterial = new THREE.MeshStandardMaterial({ color: "#dce5ef", roughness: .15, metalness: .9 });
  for (let index = -2; index <= 2; index += 1) { const string = cylinderBetween(new THREE.Vector3(-.55, .17, index * .025), new THREE.Vector3(1.42, .14, index * .018), .006, stringMaterial, object.id); group.add(string); }
  return group;
}

function strings(object: EditableSceneObject): THREE.Group {
  const group = new THREE.Group(); const varnish = applyWear(material(object.color, object.roughness, object.metalness, .045), `${object.id}-varnish`); const darkWood = new THREE.MeshStandardMaterial({ color: "#3b1c15", roughness: .36 }); const stringMaterial = new THREE.MeshStandardMaterial({ color: "#ecf5ff", roughness: .12, metalness: .92 });
  const lower = mesh(new THREE.SphereGeometry(.4, 40, 24), varnish, object.id); lower.scale.set(1, .24, .76); lower.position.set(-.42, 0, 0); group.add(lower);
  const upper = mesh(new THREE.SphereGeometry(.31, 36, 20), varnish, object.id); upper.scale.set(.9, .22, .72); upper.position.set(-.05, .01, 0); group.add(upper);
  const neck = mesh(new RoundedBoxGeometry(.95, .11, .12, 4, .03), darkWood, object.id); neck.position.set(.62, .07, 0); group.add(neck);
  const scroll = mesh(new THREE.SphereGeometry(.16, 24, 16), varnish, object.id); scroll.scale.set(1.25, .65, .9); scroll.position.set(1.16, .06, 0); group.add(scroll);
  const bridge = mesh(new RoundedBoxGeometry(.07, .17, .48, 4, .025), new THREE.MeshPhysicalMaterial({ color: "#f1d29b", roughness: .32 }), object.id); bridge.position.set(-.2, .15, 0); group.add(bridge);
  const chinrest = mesh(new RoundedBoxGeometry(.32, .09, .38, 5, .08), darkWood, object.id); chinrest.position.set(-.7, .13, -.08); group.add(chinrest);
  for (let index = -2; index <= 2; index += 1) group.add(cylinderBetween(new THREE.Vector3(-.72, .2, index * .022), new THREE.Vector3(1.18, .15, index * .016), .006, stringMaterial, object.id));
  group.add(cylinderBetween(new THREE.Vector3(-.72, .1, .52), new THREE.Vector3(1.2, .1, .52), .018, new THREE.MeshStandardMaterial({ color: "#c6a073", roughness: .35 }), object.id));
  return group;
}

function pebble(object: EditableSceneObject): THREE.Group {
  const group = new THREE.Group(); const stone = applyWear(material(object.color, Math.max(.78, object.roughness), Math.min(.08, object.metalness), .008), `${object.id}-stone`);
  const body = mesh(new THREE.IcosahedronGeometry(.3, 2), stone, object.id); body.scale.set(1.15, .56, .86); body.rotation.set(object.rotation[0] * .7, object.rotation[1], object.rotation[2]); group.add(body);
  const chip = mesh(new THREE.IcosahedronGeometry(.095, 1), new THREE.MeshStandardMaterial({ color: "#403d39", roughness: .94 }), object.id); chip.position.set(.24, -.035, .08); chip.scale.set(1, .45, .72); group.add(chip);
  return group;
}

function createObject(object: EditableSceneObject): THREE.Group {
  const content = object.type === "kick" ? drum(object, "kick") : object.type === "snare" ? drum(object, "snare") : object.type === "drum" ? drum(object, "drum") : object.type === "cymbal" ? cymbal(object) : object.type === "piano" ? piano(object) : object.type === "guitar" ? guitar(object) : object.type === "strings" ? strings(object) : object.type === "pebble" ? pebble(object) : object.type === "spring" ? spring(object) : object.type === "peg" ? peg(object) : platform(object, object.type === "block");
  if (object.type === "kick" || object.type === "snare" || object.type === "drum") content.rotation.z = object.position[0] > 0 ? -.035 : .035;
  else if (object.type === "cymbal") content.rotation.x = -.36;
  else if (object.type === "piano" || object.type === "guitar" || object.type === "strings") content.rotation.y = object.position[0] > 0 ? -.2 : .2;
  const group = new THREE.Group(); group.add(content); group.userData.objectId = object.id; group.userData.objectType = object.type; return group;
}

function surfaceHeight(object: EditableSceneObject): number { if (object.type === "kick") return .31; if (object.type === "snare") return .22; if (object.type === "drum") return .27; if (object.type === "guitar" || object.type === "strings") return .2; if (object.type === "pebble") return .12; if (object.type === "spring") return .54; if (object.type === "peg") return .75; if (object.type === "block") return .28; return .14; }

function floatingRailCurve(start: THREE.Vector3, end: THREE.Vector3, supportDrop: number, zOffset = 0, yOffset = 0): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index <= 12; index += 1) {
    const progress = railTrimStart + (railTrimEnd - railTrimStart) * index / 12;
    points.push(new THREE.Vector3(
      THREE.MathUtils.lerp(start.x, end.x, progress),
      THREE.MathUtils.lerp(start.y, end.y, progress) + slideHeightOffset(progress) - supportDrop + yOffset,
      THREE.MathUtils.lerp(start.z, end.z, progress) + zOffset
    ));
  }
  return new THREE.CatmullRomCurve3(points, false, "centripetal");
}

function createRails(objects: readonly EditableSceneObject[], colors: RailColors, ballRadius: number, motionKinds: readonly MotionKind[], activeObjectIndex?: number): THREE.Group {
  const rails = new THREE.Group();
  for (let index = 0; index < objects.length - 1; index += 1) {
    if (activeObjectIndex !== undefined && (index < activeObjectIndex - 2 || index > activeObjectIndex + 1)) continue;
    const start = objects[index];
    const end = objects[index + 1];
    if (!start || !end) continue;
    const motionKind = motionKinds[index] ?? "bounce"; if (motionKind !== "slide") continue;
    const supportDrop = railSupportDrop(ballRadius, start.railType); const gauge = railGauge(ballRadius, start.railType); const barRadius = railBarRadius(start.railType);
    const startPoint = new THREE.Vector3(start.position[0], start.position[1] + surfaceHeight(start) + ballRadius, start.position[2]); const endPoint = new THREE.Vector3(end.position[0], end.position[1] + surfaceHeight(end) + ballRadius, end.position[2]);
    const curve = floatingRailCurve(startPoint, endPoint, supportDrop);
    if (start.railType === "glassTube") {
      const glass = new THREE.MeshPhysicalMaterial({ color: colors.glassTube, transmission: .93, thickness: .12, ior: 1.45, roughness: .04, metalness: 0, transparent: true, opacity: .48, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false });
      for (const zOffset of [-gauge, gauge]) rails.add(mesh(new THREE.TubeGeometry(floatingRailCurve(startPoint, endPoint, supportDrop, zOffset), 42, barRadius, 18, false), glass));
      const edge = new THREE.MeshStandardMaterial({ color: colors.glassTube, roughness: .16, metalness: .45, transparent: true, opacity: .65, emissive: colors.glassTube, emissiveIntensity: .14 });
      for (const zOffset of [-gauge, gauge]) rails.add(mesh(new THREE.TubeGeometry(floatingRailCurve(startPoint, endPoint, supportDrop, zOffset, barRadius * .38), 32, .012, 7, false), edge));
    } else if (start.railType === "bricks") {
      const brickMaterial = material(colors.bricks, .34, .32, .08);
      for (let step = 1; step <= 12; step += 1) { const ratio = step / 13; const point = curve.getPoint(ratio); const tangent = curve.getTangent(ratio); const brick = mesh(new RoundedBoxGeometry(.42, .16, .62, 4, .045), brickMaterial); brick.position.copy(point); brick.rotation.z = Math.atan2(tangent.y, tangent.x); rails.add(brick); }
    } else {
      const railMaterial = new THREE.MeshStandardMaterial({ color: colors.pinball, roughness: .38, metalness: .84, emissive: colors.pinball, emissiveIntensity: .008 });
      for (const zOffset of [-gauge, gauge]) rails.add(mesh(new THREE.TubeGeometry(floatingRailCurve(startPoint, endPoint, supportDrop, zOffset), 32, barRadius, 9, false), railMaterial));
      for (let step = 2; step <= 8; step += 2) { const point = curve.getPoint(step / 10); rails.add(cylinderBetween(point.clone().add(new THREE.Vector3(0, -.025, -gauge)), point.clone().add(new THREE.Vector3(0, -.025, gauge)), .018, railMaterial)); }
    }
  }
  return rails;
}

function neonTexture(text: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 256; const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  context.clearRect(0, 0, canvas.width, canvas.height); context.textAlign = "center"; context.textBaseline = "middle";
  let fontSize = 108; do { context.font = `800 ${fontSize}px Inter, Arial, sans-serif`; fontSize -= 4; } while (fontSize > 42 && context.measureText(text).width > 850);
  context.lineJoin = "round"; context.shadowColor = color; context.shadowBlur = 44; context.strokeStyle = color; context.lineWidth = 15; context.strokeText(text, 512, 128);
  context.shadowBlur = 22; context.strokeStyle = color; context.lineWidth = 7; context.strokeText(text, 512, 128);
  context.shadowBlur = 8; context.fillStyle = "#fff7fc"; context.fillText(text, 512, 128);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true; return texture;
}

function ledSubtitleTexture(text: string, fontFamily: string, fontSize: number, color: string, glowColor: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas"); canvas.width = 2048; canvas.height = 512; const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  context.clearRect(0, 0, canvas.width, canvas.height); context.textAlign = "center"; context.textBaseline = "middle"; context.lineJoin = "round";
  let size = Math.min(210, Math.max(42, fontSize * 2.55)); do { context.font = `800 ${size}px "${fontFamily}", Inter, sans-serif`; size -= 4; } while (size > 38 && context.measureText(text).width > 1840);
  context.shadowColor = glowColor; context.shadowBlur = 64; context.strokeStyle = glowColor; context.lineWidth = 18; context.strokeText(text, 1024, 256);
  context.shadowBlur = 30; context.strokeStyle = color; context.lineWidth = 8; context.strokeText(text, 1024, 256);
  context.shadowBlur = 12; context.fillStyle = color; context.fillText(text, 1024, 256);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 12; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true; return texture;
}

function createNeonSigns(objects: readonly EditableSceneObject[], neon: NeonAppearance, activeObjectIndex: number): THREE.Group {
  const signs = new THREE.Group(); signs.name = "route-neon-signs";
  const phrases = neon.text.split(/\r?\n/).map((phrase) => phrase.trim()).filter(Boolean).slice(0, 16); if (!neon.enabled || phrases.length === 0) return signs;
  for (let objectIndex = 0, signIndex = 0; objectIndex < objects.length; objectIndex += 3, signIndex += 1) {
    const anchor = objects[objectIndex]; if (!anchor) continue; const phrase = phrases[signIndex % phrases.length] ?? phrases[0]!; const width = Math.max(2.5, Math.min(4.6, 2.05 + phrase.length * .125));
    const sign = new THREE.Group(); sign.userData.routeIndex = objectIndex; sign.visible = Math.abs(objectIndex - activeObjectIndex) <= 5;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: neonTexture(phrase, neon.color), color: "#ffffff", transparent: true, opacity: .98, depthWrite: false, depthTest: true, alphaTest: .008, blending: THREE.AdditiveBlending, toneMapped: false, fog: false })); sprite.scale.set(width, width / 4, 1); sprite.renderOrder = -20; sign.add(sprite);
    const light = new THREE.PointLight(neon.color, 10.5, 8.5, 2); light.position.set(0, 0, .45); sign.add(light);
    const direction = signIndex % 2 === 0 ? 1 : -1; sign.position.set(anchor.position[0] + direction * 1.45, anchor.position[1] + 1.42 + signIndex % 2 * .28, anchor.position[2] - 2.35); sign.rotation.z = direction * .025; signs.add(sign);
  }
  return signs;
}

function urbanTexture(seed: number, base: string, mark: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 512; const context = canvas.getContext("2d"); if (!context) return new THREE.CanvasTexture(canvas);
  context.fillStyle = base; context.fillRect(0, 0, 512, 512); let state = seed >>> 0; const random = () => ((state = Math.imul(state ^ state >>> 13, 1_274_126_177)) >>> 0) / 4_294_967_296;
  for (let index = 0; index < 460; index += 1) { const alpha = .025 + random() * .11; context.fillStyle = `${mark}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`; const size = 1 + random() * 8; context.fillRect(random() * 512, random() * 512, size, size * (.4 + random())); }
  context.strokeStyle = `${mark}70`; context.lineWidth = 1.2; for (let index = 0; index < 28; index += 1) { let x = random() * 512; let y = random() * 512; context.beginPath(); context.moveTo(x, y); for (let step = 0; step < 5; step += 1) { x += (random() - .5) * 48; y += 15 + random() * 38; context.lineTo(x, y); } context.stroke(); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(2.5, 2.5); texture.anisotropy = 8; return texture;
}

function asphaltTextures(seed: number): { color: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 1024; const context = canvas.getContext("2d"); if (!context) { const fallback = new THREE.CanvasTexture(canvas); return { color: fallback, bump: fallback.clone() }; } let state = seed >>> 0; const random = () => ((state = Math.imul(state ^ state >>> 13, 1_274_126_177)) >>> 0) / 4_294_967_296;
  context.fillStyle = "#25292a"; context.fillRect(0, 0, 1024, 1024);
  for (let index = 0; index < 10_500; index += 1) { const warm = random() > .78; const shade = 20 + Math.round(random() * 54); const alpha = .08 + random() * .28; context.fillStyle = warm ? `rgba(${shade + 8},${shade + 5},${shade},${alpha})` : `rgba(${shade},${shade + 2},${shade + 3},${alpha})`; const size = .45 + random() * 3.6; context.beginPath(); context.ellipse(random() * 1024, random() * 1024, size * (1 + random() * 1.4), size * (.35 + random() * .55), random() * Math.PI, 0, Math.PI * 2); context.fill(); }
  for (let aggregate = 0; aggregate < 1_600; aggregate += 1) { const light = 82 + Math.round(random() * 94); context.fillStyle = `rgba(${light + 4},${light + 2},${light},${.08 + random() * .2})`; const radius = .25 + random() * 1.15; context.beginPath(); context.arc(random() * 1024, random() * 1024, radius, 0, Math.PI * 2); context.fill(); }
  for (let rut = 0; rut < 5; rut += 1) { const x = 160 + rut * 176 + (random() - .5) * 28; const gradient = context.createLinearGradient(x - 34, 0, x + 34, 0); gradient.addColorStop(0, "rgba(9,12,13,0)"); gradient.addColorStop(.5, "rgba(4,6,7,.34)"); gradient.addColorStop(1, "rgba(9,12,13,0)"); context.fillStyle = gradient; context.fillRect(x - 36, 0, 72, 1024); }
  for (let stain = 0; stain < 14; stain += 1) { const x = random() * 1024; const y = random() * 1024; const radius = 28 + random() * 115; const gradient = context.createRadialGradient(x, y, 0, x, y, radius); gradient.addColorStop(0, `rgba(4,7,8,${.12 + random() * .18})`); gradient.addColorStop(.58, `rgba(14,18,19,${.08 + random() * .1})`); gradient.addColorStop(1, "rgba(22,25,26,0)"); context.fillStyle = gradient; context.fillRect(x - radius, y - radius, radius * 2, radius * 2); }
  for (let patch = 0; patch < 15; patch += 1) { const x = random() * 900; const y = random() * 940; const width = 45 + random() * 190; const height = 24 + random() * 80; context.fillStyle = `rgba(7,9,10,${.18 + random() * .22})`; context.beginPath(); context.roundRect(x, y, width, height, 7 + random() * 18); context.fill(); context.strokeStyle = "rgba(112,116,113,.24)"; context.lineWidth = 3 + random() * 5; context.stroke(); }
  context.lineCap = "round"; context.lineJoin = "round";
  for (let crack = 0; crack < 18; crack += 1) { let x = random() * 1024; let y = random() * 1024; context.strokeStyle = `rgba(1,2,3,${.76 + random() * .22})`; context.lineWidth = 5 + random() * 7; context.beginPath(); context.moveTo(x, y); for (let step = 0; step < 5 + Math.floor(random() * 8); step += 1) { x += (random() - .5) * 86; y += 18 + random() * 64; context.lineTo(x, y); if (step > 1 && random() > .57) { context.moveTo(x, y); context.lineTo(x + (random() - .5) * 76, y + 12 + random() * 52); context.moveTo(x, y); } } context.stroke(); context.strokeStyle = "rgba(126,130,126,.28)"; context.lineWidth = 1.2; context.stroke(); }
  for (let repair = 0; repair < 9; repair += 1) { let x = random() * 1024; let y = random() * 1024; context.beginPath(); context.moveTo(x, y); for (let step = 0; step < 5 + repair % 4; step += 1) { x += (random() - .5) * 82; y += 24 + random() * 70; context.quadraticCurveTo(x + (random() - .5) * 28, y - 12, x, y); } context.strokeStyle = "rgba(4,6,7,.76)"; context.lineWidth = 8 + random() * 8; context.stroke(); context.strokeStyle = "rgba(92,96,94,.18)"; context.lineWidth = 1.4; context.stroke(); }
  const color = new THREE.CanvasTexture(canvas); color.colorSpace = THREE.SRGBColorSpace; color.wrapS = THREE.RepeatWrapping; color.wrapT = THREE.RepeatWrapping; color.repeat.set(.82, 1.55); color.anisotropy = 12;
  const bump = color.clone(); bump.colorSpace = THREE.NoColorSpace; bump.needsUpdate = true; return { color, bump };
}

function sewerBrickTextures(seed: number): { color: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 512; const context = canvas.getContext("2d"); if (!context) { const fallback = new THREE.CanvasTexture(canvas); return { color: fallback, bump: fallback.clone() }; } let state = seed >>> 0; const random = () => ((state = Math.imul(state ^ state >>> 13, 1_274_126_177)) >>> 0) / 4_294_967_296;
  context.fillStyle = "#19231f"; context.fillRect(0, 0, 1024, 512); const brickWidth = 86; const brickHeight = 36;
  for (let row = 0; row < Math.ceil(512 / brickHeight); row += 1) { const offset = row % 2 ? -brickWidth / 2 : 0; for (let column = -1; column < Math.ceil(1024 / brickWidth) + 1; column += 1) { const x = offset + column * brickWidth; const y = row * brickHeight; const red = 52 + Math.round(random() * 35); const green = 36 + Math.round(random() * 22); context.fillStyle = `rgb(${red},${green},${27 + Math.round(random() * 16)})`; context.fillRect(x + 2.5, y + 2.5, brickWidth - 5, brickHeight - 5); context.fillStyle = `rgba(7,14,12,${.08 + random() * .23})`; for (let pore = 0; pore < 7; pore += 1) context.fillRect(x + 7 + random() * (brickWidth - 14), y + 7 + random() * (brickHeight - 14), 1 + random() * 4, 1 + random() * 2); } }
  const damp = context.createLinearGradient(0, 0, 0, 512); damp.addColorStop(0, "rgba(8,19,16,.08)"); damp.addColorStop(.56, "rgba(7,24,18,.18)"); damp.addColorStop(1, "rgba(3,16,12,.5)"); context.fillStyle = damp; context.fillRect(0, 0, 1024, 512);
  for (let stain = 0; stain < 36; stain += 1) { context.strokeStyle = `rgba(13,44,30,${.08 + random() * .2})`; context.lineWidth = 4 + random() * 18; const x = random() * 1024; context.beginPath(); context.moveTo(x, random() * 220); context.bezierCurveTo(x + (random() - .5) * 35, 260, x + (random() - .5) * 50, 380, x + (random() - .5) * 65, 512); context.stroke(); }
  const color = new THREE.CanvasTexture(canvas); color.colorSpace = THREE.SRGBColorSpace; color.wrapS = THREE.RepeatWrapping; color.wrapT = THREE.RepeatWrapping; color.repeat.set(4.5, 2.1); color.anisotropy = 12; const bump = color.clone(); bump.colorSpace = THREE.NoColorSpace; bump.needsUpdate = true; return { color, bump };
}

function flowingWaterTexture(seed: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 1024; const context = canvas.getContext("2d"); if (!context) return new THREE.CanvasTexture(canvas); let state = seed >>> 0; const random = () => ((state = Math.imul(state ^ state >>> 13, 1_274_126_177)) >>> 0) / 4_294_967_296;
  const gradient = context.createLinearGradient(0, 0, 512, 0); gradient.addColorStop(0, "#101d19"); gradient.addColorStop(.5, "#29443b"); gradient.addColorStop(1, "#101f1b"); context.fillStyle = gradient; context.fillRect(0, 0, 512, 1024);
  for (let ripple = 0; ripple < 180; ripple += 1) { const x = random() * 512; const y = random() * 1024; context.strokeStyle = `rgba(${random() > .55 ? "151,193,174" : "42,82,68"},${.08 + random() * .24})`; context.lineWidth = .7 + random() * 2; context.beginPath(); context.moveTo(x, y); context.bezierCurveTo(x + (random() - .5) * 22, y + 16, x + (random() - .5) * 26, y + 38, x + (random() - .5) * 12, y + 65 + random() * 90); context.stroke(); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(1.4, 3.8); texture.anisotropy = 10; return texture;
}

function boxBetween(start: THREE.Vector3, end: THREE.Vector3, width: number, height: number, surface: THREE.Material): THREE.Mesh {
  const direction = end.clone().sub(start); const center = start.clone().add(end).multiplyScalar(.5); const result = mesh(new THREE.BoxGeometry(direction.length() + .15, height, width, 3, 1, 2), surface); result.position.copy(center); result.rotation.y = -Math.atan2(direction.z, direction.x); return result;
}

function horizontalFrame(start: THREE.Vector3, end: THREE.Vector3): { forward: THREE.Vector3; right: THREE.Vector3 } {
  const forward = end.clone().sub(start); forward.y = 0; if (forward.lengthSq() < .0001) forward.set(0, 0, -1); else forward.normalize(); return { forward, right: new THREE.Vector3(-forward.z, 0, forward.x) };
}

function facadeTexture(seed: number, base: string, mortar: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 1024; const context = canvas.getContext("2d"); if (!context) return new THREE.CanvasTexture(canvas); let state = seed >>> 0; const random = () => ((state = Math.imul(state ^ state >>> 13, 1_274_126_177)) >>> 0) / 4_294_967_296;
  context.fillStyle = base; context.fillRect(0, 0, 512, 1024); context.strokeStyle = mortar; context.globalAlpha = .24; context.lineWidth = 1.2;
  for (let y = 0; y < 1024; y += 16) { context.beginPath(); context.moveTo(0, y); context.lineTo(512, y); context.stroke(); const offset = y / 16 % 2 ? 18 : 0; for (let x = offset; x < 512; x += 36) { context.beginPath(); context.moveTo(x, y); context.lineTo(x, y + 16); context.stroke(); } }
  context.globalAlpha = 1; for (let index = 0; index < 420; index += 1) { context.fillStyle = `rgba(8,10,12,${.015 + random() * .07})`; const size = 2 + random() * 18; context.fillRect(random() * 512, random() * 1024, size, size * (.25 + random())); }
  for (let floor = 0; floor < 10; floor += 1) for (let column = 0; column < 4; column += 1) { const x = 32 + column * 122; const y = 38 + floor * 84; context.fillStyle = "#0c1014"; context.fillRect(x - 6, y - 7, 88, 65); const lit = random() > .72; const gradient = context.createLinearGradient(x, y, x + 75, y + 51); gradient.addColorStop(0, lit ? "#d3a45f" : "#1e2c38"); gradient.addColorStop(.55, lit ? "#7f6238" : "#101820"); gradient.addColorStop(1, lit ? "#3b3021" : "#080d12"); context.fillStyle = gradient; context.fillRect(x, y, 76, 52); context.strokeStyle = lit ? "#e3bd7c55" : "#6d879a35"; context.strokeRect(x + .5, y + .5, 75, 51); context.fillStyle = "#06090cbb"; context.fillRect(x + 36, y, 4, 52); context.fillRect(x, y + 24, 76, 4); }
  context.fillStyle = "#080b0e"; context.fillRect(0, 882, 512, 142); for (let storefront = 0; storefront < 2; storefront += 1) { const x = 20 + storefront * 252; const glass = context.createLinearGradient(x, 910, x + 220, 1005); glass.addColorStop(0, storefront ? "#182f32" : "#29231b"); glass.addColorStop(1, "#050708"); context.fillStyle = glass; context.fillRect(x, 916, 220, 82); context.strokeStyle = "#403b34"; context.lineWidth = 5; context.strokeRect(x, 916, 220, 82); context.fillStyle = storefront ? "#6e2428" : "#32534f"; context.fillRect(x, 892, 220, 15); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 8; return texture;
}

function addStreetBuilding(target: THREE.Group, start: THREE.Vector3, end: THREE.Vector3, side: number, index: number, surface: THREE.Material, trim: THREE.Material): void {
  const { right } = horizontalFrame(start, end); const sideNormal = right.multiplyScalar(side); const height = 16 + index % 5 * 2.8; const buildingStart = start.clone().addScaledVector(sideNormal, 9.05); const buildingEnd = end.clone().addScaledVector(sideNormal, 9.05); buildingStart.y += height / 2 - .08; buildingEnd.y += height / 2 - .08; const building = boxBetween(buildingStart, buildingEnd, 5.05, height, surface); target.add(building);
  const corniceStart = buildingStart.clone(); const corniceEnd = buildingEnd.clone(); corniceStart.y += height / 2; corniceEnd.y += height / 2; target.add(boxBetween(corniceStart, corniceEnd, 5.32, .24, trim));
  const facadePoint = start.clone().lerp(end, .52).addScaledVector(sideNormal, 6.48); facadePoint.y += 1.55; const awning = mesh(new THREE.BoxGeometry(1.9, .1, 1.08), index % 2 ? new THREE.MeshStandardMaterial({ color: "#4d161b", roughness: .74 }) : new THREE.MeshStandardMaterial({ color: "#1d403e", roughness: .74 })); awning.position.copy(facadePoint); awning.rotation.y = building.rotation.y; awning.rotation.x = side > 0 ? -.1 : .1; target.add(awning);
  if (index % 3 === 0) { const fireEscape = new THREE.MeshStandardMaterial({ color: "#0d1113", roughness: .52, metalness: .82 }); for (let level = 0; level < 6; level += 1) { const balcony = boxBetween(start.clone().lerp(end, .22).addScaledVector(sideNormal, 6.43).add(new THREE.Vector3(0, 3.1 + level * 2.05, 0)), start.clone().lerp(end, .78).addScaledVector(sideNormal, 6.43).add(new THREE.Vector3(0, 3.1 + level * 2.05, 0)), .72, .07, fireEscape); target.add(balcony); } }
  if (index % 5 === 0) { const tank = mesh(new THREE.CylinderGeometry(.78, .9, 1.45, 20), new THREE.MeshStandardMaterial({ color: "#28221e", roughness: .88, metalness: .16 })); tank.position.copy(start.clone().lerp(end, .55).addScaledVector(sideNormal, 9.05)); tank.position.y += height + .56; target.add(tank); }
}

function crumpledFlyerGeometry(seed: number): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(1.48, .98, 8, 6); const position = geometry.attributes.position; if (!position) return geometry;
  for (let index = 0; index < position.count; index += 1) { const x = position.getX(index); const y = position.getY(index); const fold = Math.sin(x * 12 + seed) * .0025 + Math.cos(y * 16 - seed * .7) * .003; position.setXYZ(index, x + Math.sin(y * 9 + seed) * .006, y + Math.cos(x * 10 - seed) * .005, fold + Math.sin((x + y) * 19) * .0015); }
  const uv = geometry.attributes.uv; const sourceIndex = geometry.index; if (uv && sourceIndex) { const triangles: number[] = []; for (let offset = 0; offset < sourceIndex.count; offset += 3) { const a = sourceIndex.getX(offset); const b = sourceIndex.getX(offset + 1); const c = sourceIndex.getX(offset + 2); const u = (uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3; const v = (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3; const torn = u < .08 && v > .9 || u > .92 && v < .1 || seed % 2 === 0 && u < .045 && v < .08; if (!torn) triangles.push(a, b, c); } geometry.setIndex(triangles); }
  position.needsUpdate = true; geometry.computeVertexNormals(); return geometry;
}

function createNewYorkEnvironment(objects: readonly EditableSceneObject[], flyerImageUrls: readonly string[]): THREE.Group {
  const environment = new THREE.Group(); environment.name = "new-york-streets-environment"; if (!objects.length) return environment; const sewerEntry = newYorkSewerEntryIndex(objects);
  const concreteMap = urbanTexture(73, "#777976", "#171918"); const asphaltMaps = asphaltTextures(149); const sewerMap = urbanTexture(887, "#293631", "#07100d"); const brickMaps = sewerBrickTextures(991); const waterMap = flowingWaterTexture(313); environment.userData.waterTexture = waterMap;
  const concrete = new THREE.MeshStandardMaterial({ color: "#777872", map: concreteMap, bumpMap: concreteMap, bumpScale: .055, roughness: .92, metalness: .03 }); const asphalt = new THREE.MeshPhysicalMaterial({ color: "#ffffff", map: asphaltMaps.color, bumpMap: asphaltMaps.bump, bumpScale: .18, roughness: .86, metalness: .015, clearcoat: .16, clearcoatRoughness: .74 }); const curb = new THREE.MeshStandardMaterial({ color: "#85877f", map: concreteMap, bumpMap: concreteMap, bumpScale: .045, roughness: .9 }); const sewer = new THREE.MeshStandardMaterial({ color: "#344640", map: sewerMap, bumpMap: sewerMap, bumpScale: .075, roughness: .86, metalness: .04 }); const tunnelBrick = new THREE.MeshStandardMaterial({ color: "#807064", map: brickMaps.color, bumpMap: brickMaps.bump, bumpScale: .105, roughness: .91, metalness: .015, side: THREE.BackSide });
  const wet = new THREE.MeshPhysicalMaterial({ color: "#305348", map: waterMap, bumpMap: waterMap, bumpScale: .045, roughness: .14, metalness: .16, transmission: .08, transparent: true, opacity: .9, clearcoat: 1, clearcoatRoughness: .06 }); const streetMetal = new THREE.MeshStandardMaterial({ color: "#1d2326", roughness: .44, metalness: .82 }); const lanePaint = new THREE.MeshStandardMaterial({ color: "#d6b44a", roughness: .76, metalness: .02 }); const crosswalkPaint = new THREE.MeshStandardMaterial({ color: "#d9dbd4", roughness: .84, metalness: 0 }); const crackMaterial = new THREE.MeshStandardMaterial({ color: "#020304", roughness: 1, metalness: 0 }); const roadBase = new THREE.MeshStandardMaterial({ color: "#15191a", roughness: .96, metalness: 0 });
  const facadeColors = [["#4b2924", "#211615"], ["#51473b", "#25211d"], ["#374044", "#171d20"], ["#45352f", "#211a18"]] as const; const facades = facadeColors.map(([base, mortar], index) => { const map = facadeTexture(1_013 + index * 97, base, mortar); return new THREE.MeshStandardMaterial({ color: "#bcb5a8", map, bumpMap: map, bumpScale: .022, emissive: "#4b3422", emissiveMap: map, emissiveIntensity: .12, roughness: .84, metalness: .025 }); });
  const addRoadCracks = (start: THREE.Vector3, end: THREE.Vector3, index: number) => { if (index % 2 !== 0) return; const { right } = horizontalFrame(start, end); const points: THREE.Vector3[] = []; for (let pointIndex = 0; pointIndex < 8; pointIndex += 1) { const ratio = .12 + pointIndex * .1; const point = start.clone().lerp(end, ratio); point.addScaledVector(right, -2.05 + pointIndex * .54 + Math.sin(index * 2.7 + pointIndex * 1.9) * .22); point.y -= .122; points.push(point); } const crack = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, "centripetal"), 28, .012, 5, false), crackMaterial); crack.castShadow = false; environment.add(crack); if (index % 4 === 0) { const origin = points[4]; if (origin) { const branchPoints = [origin.clone(), origin.clone().lerp(end, .16).addScaledVector(right, -.48), origin.clone().lerp(end, .28).addScaledVector(right, -.88)]; branchPoints.forEach((point) => { point.y = THREE.MathUtils.lerp(start.y, end.y, .58) - .122; }); const branch = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(branchPoints, false, "centripetal"), 12, .009, 5, false), crackMaterial); branch.castShadow = false; environment.add(branch); } } };
  const addManholeRoadSurface = (entry: THREE.Vector3, previous: THREE.Vector3) => { const { forward, right } = horizontalFrame(previous, entry); const shape = new THREE.Shape(); shape.moveTo(-4.025, -2.15); shape.lineTo(4.025, -2.15); shape.lineTo(4.025, 2.15); shape.lineTo(-4.025, 2.15); shape.closePath(); const opening = new THREE.Path(); opening.absarc(0, 0, 1.06, 0, Math.PI * 2, true); shape.holes.push(opening); const surface = mesh(new THREE.ShapeGeometry(shape, 40), asphalt); const basis = new THREE.Matrix4().makeBasis(right, forward, new THREE.Vector3(0, 1, 0)); surface.quaternion.setFromRotationMatrix(basis); surface.position.copy(entry).add(new THREE.Vector3(0, -.119, 0)); surface.castShadow = false; environment.add(surface); };
  const addStreetGround = (start: THREE.Vector3, end: THREE.Vector3, index: number, manholeAtEnd = false) => { const { forward, right } = horizontalFrame(start, end); const visibleRoadEnd = manholeAtEnd ? end.clone().addScaledVector(forward, -2.12) : end; const roadStart = start.clone().add(new THREE.Vector3(0, -.22, 0)); const roadEnd = visibleRoadEnd.clone().add(new THREE.Vector3(0, -.22, 0)); environment.add(boxBetween(roadStart, roadEnd, 8.05, .2, roadBase)); const top = boxBetween(roadStart.clone().add(new THREE.Vector3(0, .094, 0)), roadEnd.clone().add(new THREE.Vector3(0, .094, 0)), 8.05, .012, asphalt); top.castShadow = false; environment.add(top); addRoadCracks(start, visibleRoadEnd, index); if (manholeAtEnd) addManholeRoadSurface(end, start); for (const side of [-1, 1]) { const sidewalkStart = start.clone().addScaledVector(right, side * 5.24).add(new THREE.Vector3(0, -.1, 0)); const sidewalkEnd = end.clone().addScaledVector(right, side * 5.24).add(new THREE.Vector3(0, -.1, 0)); environment.add(boxBetween(sidewalkStart, sidewalkEnd, 2.55, .32, concrete)); const curbStart = start.clone().addScaledVector(right, side * 4.03).add(new THREE.Vector3(0, -.08, 0)); const curbEnd = end.clone().addScaledVector(right, side * 4.03).add(new THREE.Vector3(0, -.08, 0)); environment.add(boxBetween(curbStart, curbEnd, .25, .36, curb)); } return right; };
  const addStreetLamp = (start: THREE.Vector3, end: THREE.Vector3, side: number, index: number) => { const { right } = horizontalFrame(start, end); const base = start.clone().lerp(end, .3).addScaledVector(right, side * 3.7); base.y += .01; const top = base.clone().add(new THREE.Vector3(0, 4.35, 0)); environment.add(cylinderBetween(base, top, .055, streetMetal)); const armEnd = top.clone().addScaledVector(right, -side * .72).add(new THREE.Vector3(0, -.12, 0)); environment.add(cylinderBetween(top, armEnd, .042, streetMetal)); const housing = mesh(new THREE.SphereGeometry(.14, 18, 10), new THREE.MeshPhysicalMaterial({ color: "#ffe1ac", emissive: "#ffc66d", emissiveIntensity: 4.5, roughness: .2 })); housing.scale.set(1.35, .55, 1); housing.position.copy(armEnd).add(new THREE.Vector3(0, -.08, 0)); environment.add(housing); const lamp = new THREE.PointLight(index % 5 === 0 ? "#e7f0ff" : "#ffc87a", 24, 15, 1.75); lamp.name = "new-york-local-light"; lamp.userData.routeIndex = index; lamp.position.copy(housing.position).add(new THREE.Vector3(0, -.08, 0)); lamp.castShadow = side > 0 && index % 8 === 0; if (lamp.castShadow) lamp.shadow.mapSize.set(256, 256); environment.add(lamp); };
  const firstObject = objects[0]; const secondObject = objects[1]; if (firstObject && secondObject) { const first = new THREE.Vector3(...firstObject.position); const second = new THREE.Vector3(...secondObject.position); const { forward } = horizontalFrame(first, second); const approach = first.clone().addScaledVector(forward, -22); approach.y += .18; for (let chunk = 0; chunk < 4; chunk += 1) { const start = approach.clone().lerp(first, chunk / 4); const end = approach.clone().lerp(first, (chunk + 1) / 4); addStreetGround(start, end, chunk - 4); for (const side of [-1, 1]) addStreetBuilding(environment, start, end, side, 100 + chunk * 2 + (side > 0 ? 1 : 0), facades[(chunk + (side > 0 ? 1 : 0)) % facades.length] ?? facades[0]!, streetMetal); if (chunk % 2 === 0) for (const side of [-1, 1]) addStreetLamp(start, end, side, chunk - 4); } }
  const sewerCenterline = objects.slice(sewerEntry).map((object) => new THREE.Vector3(object.position[0], object.position[1] + 2.23, object.position[2])); if (sewerCenterline.length >= 2) { const centerCurve = new THREE.CatmullRomCurve3(sewerCenterline, false, "centripetal"); const tunnel = mesh(new THREE.TubeGeometry(centerCurve, Math.max(72, (sewerCenterline.length - 1) * 12), 2.35, 48, false), tunnelBrick); tunnel.name = "new-york-brick-sewer-tunnel"; tunnel.castShadow = false; tunnel.receiveShadow = true; environment.add(tunnel); }
  for (let index = 0; index < objects.length - 1; index += 1) {
    const current = objects[index]; const next = objects[index + 1]; if (!current || !next || index === sewerEntry - 1) continue; const inSewer = index >= sewerEntry; const start = new THREE.Vector3(...current.position); const end = new THREE.Vector3(...next.position);
    if (!inSewer) {
      const right = addStreetGround(start, end, index, index === sewerEntry - 2);
      if (index % 2 === 0) { const markingStart = start.clone().lerp(end, .18).add(new THREE.Vector3(0, -.105, 0)); const markingEnd = start.clone().lerp(end, .72).add(new THREE.Vector3(0, -.105, 0)); environment.add(boxBetween(markingStart, markingEnd, .09, .018, lanePaint)); }
      if (index === Math.max(2, Math.floor(sewerEntry * .34))) for (let stripe = -4; stripe <= 4; stripe += 1) { const center = start.clone().lerp(end, .55 + stripe * .035).add(new THREE.Vector3(0, -.104, 0)); environment.add(boxBetween(center.clone().addScaledVector(right, -3.55), center.clone().addScaledVector(right, 3.55), .3, .02, crosswalkPaint)); }
      for (const side of [-1, 1]) addStreetBuilding(environment, start, end, side, index + (side > 0 ? 1 : 0), facades[(index + (side > 0 ? 1 : 0)) % facades.length] ?? facades[0]!, streetMetal);
      if (index % 2 === 0) for (const side of [-1, 1]) addStreetLamp(start, end, side, index);
      if (index % 4 === 1) { const drain = mesh(new THREE.BoxGeometry(.68, .025, .42), streetMetal); drain.position.copy(start.clone().lerp(end, .42).addScaledVector(right, 3.72).add(new THREE.Vector3(0, -.095, 0))); drain.rotation.y = -Math.atan2(end.z - start.z, end.x - start.x); environment.add(drain); }
    } else {
      const { right } = horizontalFrame(start, end); const floorStart = start.clone().add(new THREE.Vector3(0, -.22, 0)); const floorEnd = end.clone().add(new THREE.Vector3(0, -.22, 0)); environment.add(boxBetween(floorStart, floorEnd, 5.05, .24, sewer)); const waterStart = floorStart.clone().addScaledVector(right, .92).add(new THREE.Vector3(0, .145, 0)); const waterEnd = floorEnd.clone().addScaledVector(right, .92).add(new THREE.Vector3(0, .145, 0)); const water = boxBetween(waterStart, waterEnd, 1.08, .035, wet); water.name = "new-york-sewer-water"; water.castShadow = false; environment.add(water); for (const edgeOffset of [.35, 1.49]) { const edgeStart = floorStart.clone().addScaledVector(right, edgeOffset).add(new THREE.Vector3(0, .23, 0)); const edgeEnd = floorEnd.clone().addScaledVector(right, edgeOffset).add(new THREE.Vector3(0, .23, 0)); environment.add(boxBetween(edgeStart, edgeEnd, .12, .28, sewer)); }
      if (index % 4 === 0) { const fixture = mesh(new RoundedBoxGeometry(.42, .2, .24, 4, .045), new THREE.MeshPhysicalMaterial({ color: "#d7b56e", emissive: "#c99344", emissiveIntensity: 3.2, roughness: .28 })); fixture.position.copy(start).addScaledVector(right, -2.05).add(new THREE.Vector3(0, 2.55, 0)); fixture.castShadow = false; environment.add(fixture); const light = new THREE.PointLight("#d5ad67", 7.5, 8.5, 2); light.name = "new-york-local-light"; light.userData.routeIndex = index; light.position.copy(fixture.position).addScaledVector(right, .25); environment.add(light); }
    }
  }
  const beforeEntry = objects[Math.max(0, sewerEntry - 1)]; const firstSewer = objects[sewerEntry]; if (beforeEntry && firstSewer) { const streetSurfaceY = beforeEntry.position[1] - .12; const sewerFloorY = firstSewer.position[1] - .12; const shaftDepth = Math.max(1, streetSurfaceY - sewerFloorY); const entry = new THREE.Vector3(beforeEntry.position[0], streetSurfaceY + .015, beforeEntry.position[2]); const previous = objects[Math.max(0, sewerEntry - 2)]; const { right } = horizontalFrame(new THREE.Vector3(...(previous?.position ?? beforeEntry.position)), new THREE.Vector3(...beforeEntry.position)); const manholeMaterial = new THREE.MeshStandardMaterial({ color: "#292d2e", roughness: .48, metalness: .86 }); const rim = mesh(new THREE.TorusGeometry(1.16, .14, 16, 72), manholeMaterial); rim.rotation.x = Math.PI / 2; rim.position.copy(entry); environment.add(rim); const shaftMaterial = tunnelBrick.clone(); shaftMaterial.side = THREE.BackSide; const shaft = mesh(new THREE.CylinderGeometry(1.04, 1.08, shaftDepth + .12, 48, 1, true), shaftMaterial); shaft.position.set(entry.x, (streetSurfaceY + sewerFloorY) / 2, entry.z); shaft.castShadow = false; environment.add(shaft); const shaftLight = new THREE.PointLight("#8aa08c", 2.8, shaftDepth * .8, 2); shaftLight.name = "new-york-local-light"; shaftLight.userData.routeIndex = sewerEntry - 1; shaftLight.position.set(entry.x, streetSurfaceY - shaftDepth * .72, entry.z); environment.add(shaftLight); const cover = mesh(new THREE.CylinderGeometry(1.02, 1.02, .1, 56), manholeMaterial); cover.position.copy(entry).addScaledVector(right, 1.78).add(new THREE.Vector3(0, .18, 0)); cover.rotation.z = .16; cover.rotation.x = .08; environment.add(cover); for (const radius of [.32, .58, .82]) { const groove = mesh(new THREE.TorusGeometry(radius, .018, 6, 48), new THREE.MeshStandardMaterial({ color: "#151819", roughness: .55, metalness: .72 })); groove.rotation.x = Math.PI / 2; groove.position.copy(cover.position).add(new THREE.Vector3(0, .06, 0)); environment.add(groove); } }
  const loader = new THREE.TextureLoader(); for (const [imageIndex, imageUrl] of flyerImageUrls.entries()) { for (const zone of [0, 1]) { const zoneStart = zone ? sewerEntry : 0; const zoneLength = zone ? objects.length - sewerEntry : sewerEntry; const flyerMaterial = new THREE.MeshPhysicalMaterial({ color: "#ffffff", emissive: "#ffffff", emissiveIntensity: .035, roughness: .84, metalness: 0, side: THREE.DoubleSide, clearcoat: .08 }); loader.load(imageUrl, (texture) => { if (environment.userData.disposed) { texture.dispose(); return; } texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 12; flyerMaterial.map = texture; flyerMaterial.needsUpdate = true; }); for (let copy = 0; copy < 3; copy += 1) { const anchorIndex = Math.min(objects.length - 1, zoneStart + (imageIndex * 5 + copy * 3) % Math.max(1, zoneLength)); const anchor = objects[anchorIndex]; const next = objects[Math.min(objects.length - 1, anchorIndex + 1)]; if (!anchor) continue; const flyer = mesh(crumpledFlyerGeometry(imageIndex * 17 + zone * 43 + copy * 11), flyerMaterial); flyer.castShadow = false; const anchorVector = new THREE.Vector3(...anchor.position); const nextVector = new THREE.Vector3(...(next?.position ?? anchor.position)); const frame = horizontalFrame(anchorVector, nextVector); if (zone) { const side = copy % 2 ? 1 : -1; const forwardOffset = .25 + copy * .32; flyer.position.set(anchor.position[0], anchor.position[1] + 1.2 + copy * .28, anchor.position[2]); flyer.position.addScaledVector(frame.right, side * 2.48); flyer.position.addScaledVector(frame.forward, forwardOffset); const lookTarget = new THREE.Vector3(anchor.position[0], flyer.position.y, anchor.position[2]).addScaledVector(frame.forward, forwardOffset); flyer.lookAt(lookTarget); flyer.rotateZ((imageIndex + copy % 2) * .045); flyer.scale.setScalar(1.16); } else { const forwardOffset = .35 + copy * .28; const segmentLength = Math.max(.01, Math.hypot(nextVector.x - anchorVector.x, nextVector.z - anchorVector.z)); const progress = Math.min(1, forwardOffset / segmentLength); const routeY = THREE.MathUtils.lerp(anchorVector.y, nextVector.y, progress); const streetOffset = copy === 0 ? 2.65 : copy === 1 ? -2.85 : imageIndex % 2 ? 4.55 : -4.55; const surfaceY = Math.abs(streetOffset) > 4 ? routeY + .064 : routeY - .116; flyer.position.set(anchor.position[0], surfaceY, anchor.position[2]); flyer.position.addScaledVector(frame.right, streetOffset); flyer.position.addScaledVector(frame.forward, forwardOffset); flyer.rotation.set(-Math.PI / 2, 0, (imageIndex * .73 + copy * .47) % Math.PI); flyer.scale.setScalar(copy === 2 ? 1.08 : 1.22); } environment.add(flyer); } } }
  return environment;
}

function createSecondaryMarbles(settings: NewYorkSettings, radius: number): THREE.Group {
  const swarm = new THREE.Group(); swarm.name = "new-york-secondary-marbles";
  for (let index = 0; index < settings.secondaryMarbleCount; index += 1) { const color = settings.secondaryColors[index] ?? settings.secondaryGroupColor; const marbleGroup = new THREE.Group(); marbleGroup.userData.swarmIndex = index;
    const shell = mesh(new THREE.SphereGeometry(.39, 40, 30), new THREE.MeshPhysicalMaterial({ color, transmission: .7, thickness: .8, ior: 1.46, roughness: .045, clearcoat: 1, clearcoatRoughness: .02, iridescence: .08, transparent: true, opacity: .9, attenuationColor: color, attenuationDistance: 2.1 })); shell.name = "secondary-shell"; marbleGroup.add(shell);
    const core = mesh(new THREE.IcosahedronGeometry(.21, 1), new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: .18, roughness: .24, metalness: .14, clearcoat: .65 })); core.name = "secondary-core"; marbleGroup.add(core);
    const shards = new THREE.Group(); shards.name = "secondary-shards"; shards.visible = false; for (let shardIndex = 0; shardIndex < 10; shardIndex += 1) { const direction = new THREE.Vector3(Math.sin((index + 1) * (shardIndex + 2) * 1.31), Math.cos(shardIndex * 2.17), Math.sin(shardIndex * .83 + index)).normalize(); const shard = mesh(new THREE.TetrahedronGeometry(.075 + shardIndex % 3 * .018, 0), new THREE.MeshPhysicalMaterial({ color, transmission: .72, roughness: .08, transparent: true, opacity: .82 })); shard.userData.breakDirection = direction; shards.add(shard); } marbleGroup.add(shards); marbleGroup.scale.setScalar(radius / .42); swarm.add(marbleGroup);
  }
  return swarm;
}

function disposeMaterial(item: THREE.Material): void {
  const mapped = item as THREE.Material & Record<string, unknown>; const textures = new Set<THREE.Texture>(); for (const key of ["map", "bumpMap", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "alphaMap", "envMap"]) { const value = mapped[key]; if (value instanceof THREE.Texture) textures.add(value); }
  if (item instanceof THREE.ShaderMaterial) Object.values(item.uniforms).forEach((uniform) => { if (uniform.value instanceof THREE.Texture) textures.add(uniform.value); });
  textures.forEach((texture) => texture.dispose()); item.dispose();
}

function disposeGroup(group: THREE.Group): void {
  group.userData.disposed = true;
  group.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Points || child instanceof THREE.Line) child.geometry.dispose();
    if (child instanceof THREE.Mesh || child instanceof THREE.Points || child instanceof THREE.Line || child instanceof THREE.Sprite) {
      const materials = Array.isArray(child.material) ? child.material : [child.material]; materials.forEach(disposeMaterial);
    }
  });
}

function innerGeometry(shape: BallAppearance["innerShape"]): THREE.BufferGeometry {
  if (shape === "torusKnot") return new THREE.TorusKnotGeometry(.19, .065, 80, 12, 2, 3);
  if (shape === "orb") return new THREE.SphereGeometry(.24, 32, 24);
  return new THREE.IcosahedronGeometry(.27, 2);
}

function embeddedCoverGeometry(): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(.57, .57, 48, 48); const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index) / .285; const y = positions.getY(index) / .285;
    // Lente continua: il centro avanza nel vetro e i bordi arretrano senza
    // creare la piega circolare visibile della vecchia PlaneGeometry.
    positions.setZ(index, Math.cos(x * Math.PI * .5) * Math.cos(y * Math.PI * .5) * .105);
  }
  positions.needsUpdate = true; geometry.computeVertexNormals(); return geometry;
}

function roundedCoverTexture(image: CanvasImageSource, sourceWidth: number, sourceHeight: number): THREE.CanvasTexture {
  const aspect = sourceWidth / Math.max(1, sourceHeight); const longest = 1024; const width = aspect >= 1 ? longest : Math.max(256, Math.round(longest * aspect)); const height = aspect >= 1 ? Math.max(256, Math.round(longest / aspect)) : longest;
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const radius = Math.min(width, height) * .075; context.clearRect(0, 0, width, height); context.save(); context.beginPath(); context.roundRect(1, 1, width - 2, height - 2, radius); context.clip(); context.drawImage(image, 0, 0, width, height);
  const optical = context.createLinearGradient(0, 0, width, height); optical.addColorStop(0, "rgba(255,255,255,.11)"); optical.addColorStop(.28, "rgba(255,255,255,0)"); optical.addColorStop(.78, "rgba(0,0,0,0)"); optical.addColorStop(1, "rgba(0,0,0,.08)"); context.fillStyle = optical; context.fillRect(0, 0, width, height); context.restore();
  context.strokeStyle = "rgba(255,255,255,.42)"; context.lineWidth = Math.max(2, Math.min(width, height) * .008); context.beginPath(); context.roundRect(context.lineWidth / 2, context.lineWidth / 2, width - context.lineWidth, height - context.lineWidth, radius); context.stroke();
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 16; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = true; return texture;
}

const revealDurationSeconds = 1.15;
function getRevealProgress(ball: BallAppearance, timeSeconds: number, durationSeconds: number): number {
  if (!ball.endRevealEnabled || !ball.innerImageUrl || durationSeconds <= 0) return 0;
  const start = ball.revealMode === "end" ? Math.max(0, durationSeconds - revealDurationSeconds) : Math.max(0, Math.min(durationSeconds, ball.revealTimeSeconds));
  return Math.max(0, Math.min(1, (timeSeconds - start) / revealDurationSeconds));
}

function lightGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 128; const context = canvas.getContext("2d"); if (!context) return new THREE.CanvasTexture(canvas);
  const radial = context.createRadialGradient(64, 64, 0, 64, 64, 62); radial.addColorStop(0, "rgba(255,255,255,1)"); radial.addColorStop(.08, "rgba(255,255,255,.96)"); radial.addColorStop(.24, "rgba(255,255,255,.42)"); radial.addColorStop(.58, "rgba(255,255,255,.09)"); radial.addColorStop(1, "rgba(255,255,255,0)"); context.fillStyle = radial; context.fillRect(0, 0, 128, 128);
  context.strokeStyle = "rgba(255,255,255,.72)"; context.lineWidth = 2; context.beginPath(); context.moveTo(10, 64); context.lineTo(118, 64); context.moveTo(64, 10); context.lineTo(64, 118); context.stroke();
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

function softReflectionTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 256; const context = canvas.getContext("2d"); if (!context) return new THREE.CanvasTexture(canvas);
  const glow = context.createRadialGradient(64, 108, 1, 64, 128, 88); glow.addColorStop(0, "rgba(255,255,255,.96)"); glow.addColorStop(.12, "rgba(255,255,255,.62)"); glow.addColorStop(.42, "rgba(255,255,255,.16)"); glow.addColorStop(1, "rgba(255,255,255,0)"); context.fillStyle = glow; context.fillRect(0, 0, 128, 256);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

function marbleFresnelMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: `
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      void main() {
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      void main() {
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float rim = pow(1.0 - clamp(dot(normalize(vWorldNormal), viewDirection), 0.0, 1.0), 2.45);
        float alpha = rim * 0.48;
        gl_FragColor = vec4(mix(vec3(1.0), uColor, 0.42) * (0.72 + rim * 0.5), alpha);
      }
    `,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.FrontSide, blending: THREE.AdditiveBlending, toneMapped: false
  });
}

function volumetricBeamMaterial(color: string, densityScale: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uDensity: { value: .38 * densityScale * 1.4 }, uSoftness: { value: .42 } },
    vertexShader: `
      varying float vAxial;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      void main() {
        vAxial = clamp(0.5 - position.y, 0.0, 1.0);
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uDensity;
      uniform float uSoftness;
      varying float vAxial;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      void main() {
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float edge = pow(1.0 - abs(dot(normalize(vWorldNormal), viewDirection)), 0.55);
        float sourceFade = smoothstep(0.0, 0.065, vAxial);
        float endFade = 1.0 - smoothstep(mix(0.58, 0.82, uSoftness), 1.0, vAxial);
        float grain = 0.94 + 0.06 * sin(dot(vWorldPosition, vec3(12.9898, 78.233, 37.719)));
        float alpha = uDensity * mix(0.16, 0.52, edge) * sourceFade * endFade * grain;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false
  });
}

function wovenTexture(): { color: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 512; const context = canvas.getContext("2d");
  if (!context) { const fallback = new THREE.CanvasTexture(canvas); return { color: fallback, bump: fallback.clone() }; }
  context.fillStyle = "#dedbd5"; context.fillRect(0, 0, 512, 512);
  for (let index = 0; index < 4_800; index += 1) {
    const x = (Math.sin(index * 91.17) * .5 + .5) * 512; const y = (Math.cos(index * 47.31) * .5 + .5) * 512; const light = 174 + Math.round((Math.sin(index * 13.7) * .5 + .5) * 72);
    context.strokeStyle = `rgb(${light},${light - index % 5},${light - index % 7})`; context.globalAlpha = .16 + index % 5 * .055; context.lineWidth = .55 + index % 3 * .38; context.beginPath(); context.moveTo(x, y); context.quadraticCurveTo(x + Math.sin(index * .73) * 4, y - 3, x + Math.sin(index) * 8, y - 6 - index % 8); context.stroke();
  }
  context.globalAlpha = .13; context.strokeStyle = "#fff"; for (let line = 0; line < 512; line += 9) { context.beginPath(); context.moveTo(0, line); context.lineTo(512, line + 8); context.stroke(); context.beginPath(); context.moveTo(line, 0); context.lineTo(line + 8, 512); context.stroke(); }
  // Scoloriture, sporco assorbito e abrasioni interrompono la regolarità del
  // tessuto senza trasformare il pelo in macchie nere o lucide.
  for (let stain = 0; stain < 18; stain += 1) {
    const x = (Math.sin(stain * 73.13) * .5 + .5) * 512; const y = (Math.cos(stain * 41.77) * .5 + .5) * 512; const radius = 18 + stain % 5 * 13; const gradient = context.createRadialGradient(x, y, 1, x, y, radius);
    gradient.addColorStop(0, stain % 3 ? "rgba(92,73,62,.18)" : "rgba(255,247,233,.32)"); gradient.addColorStop(.55, stain % 3 ? "rgba(113,91,74,.08)" : "rgba(255,251,242,.14)"); gradient.addColorStop(1, "rgba(255,255,255,0)"); context.globalAlpha = 1; context.fillStyle = gradient; context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  context.lineCap = "round";
  for (let abrasion = 0; abrasion < 42; abrasion += 1) {
    const x = (Math.sin(abrasion * 29.31) * .5 + .5) * 512; const y = (Math.cos(abrasion * 67.19) * .5 + .5) * 512; context.globalAlpha = .1 + abrasion % 4 * .035; context.strokeStyle = abrasion % 3 ? "#6e6258" : "#fff8eb"; context.lineWidth = .7 + abrasion % 3 * .45; context.beginPath(); context.moveTo(x, y); context.bezierCurveTo(x + 5, y - 2, x + 11, y + 3, x + 18 + abrasion % 15, y - 1); context.stroke();
  }
  context.globalAlpha = 1;
  const color = new THREE.CanvasTexture(canvas); color.colorSpace = THREE.SRGBColorSpace; color.wrapS = THREE.RepeatWrapping; color.wrapT = THREE.RepeatWrapping; color.repeat.set(2.6, 2.6); color.anisotropy = 12;
  const bump = color.clone(); bump.colorSpace = THREE.NoColorSpace; bump.needsUpdate = true; return { color, bump };
}

function teddyPart(name: string, radius: number, scale: [number, number, number], partMaterial: THREE.Material, position: [number, number, number]): THREE.Mesh {
  const part = mesh(new THREE.SphereGeometry(radius, 48, 36), partMaterial); part.name = name; part.scale.set(...scale); part.position.set(...position); return part;
}

function teddyFurFibers(name: string, center: [number, number, number], radii: [number, number, number], color: string, count: number): THREE.Group {
  const strandCount = Math.round(count * 5.2); const undercoatPositions = new Float32Array(strandCount * 3); const undercoatColors = new Float32Array(strandCount * 3); const goldenAngle = Math.PI * (3 - Math.sqrt(5)); const baseColor = new THREE.Color(color);
  const fiberGeometry = new THREE.CapsuleGeometry(.0032, .018, 2, 5);
  const fiberMaterial = new THREE.MeshPhysicalMaterial({ color, roughness: .86, metalness: 0, sheen: 1, sheenColor: new THREE.Color(color).offsetHSL(0, -.08, .18), sheenRoughness: .68, vertexColors: true });
  const physicalFibers = new THREE.InstancedMesh(fiberGeometry, fiberMaterial, strandCount);
  const matrix = new THREE.Matrix4(); const quaternion = new THREE.Quaternion(); const scale = new THREE.Vector3(); const position = new THREE.Vector3(); const up = new THREE.Vector3(0, 1, 0);
  for (let index = 0; index < strandCount; index += 1) {
    const y = 1 - 2 * (index + .5) / strandCount; const radial = Math.sqrt(Math.max(0, 1 - y * y)); const angle = index * goldenAngle; const direction = new THREE.Vector3(Math.cos(angle) * radial, y, Math.sin(angle) * radial);
    const surface = new THREE.Vector3(direction.x * radii[0], direction.y * radii[1], direction.z * radii[2]);
    const normal = new THREE.Vector3(direction.x / radii[0], direction.y / radii[1], direction.z / radii[2]).normalize(); const tangent = new THREE.Vector3(-direction.z, direction.x * .2, direction.x).normalize(); const bitangent = normal.clone().cross(tangent).normalize();
    const lengthScale = .72 + index % 11 * .035; const lean = tangent.multiplyScalar(Math.sin(index * 2.17) * .13).addScaledVector(bitangent, Math.cos(index * 1.37) * .09); const fiberDirection = normal.clone().add(lean).normalize();
    position.copy(surface).addScaledVector(normal, .012 + lengthScale * .008); quaternion.setFromUnitVectors(up, fiberDirection); scale.set(.82 + index % 5 * .055, .76 + lengthScale * .58, .82 + index % 7 * .035); matrix.compose(position, quaternion, scale); physicalFibers.setMatrixAt(index, matrix);
    const fiberShade = baseColor.clone().offsetHSL((index % 9 - 4) * .0012, -.025, -.028 + (index % 7) * .008); physicalFibers.setColorAt(index, fiberShade);
    const undercoat = surface.clone().addScaledVector(normal, .011 + index % 5 * .0022);
    undercoatPositions[index * 3] = undercoat.x; undercoatPositions[index * 3 + 1] = undercoat.y; undercoatPositions[index * 3 + 2] = undercoat.z;
    const undercoatShade = baseColor.clone().offsetHSL((index % 7 - 3) * .0012, -.03, -.018 + (index % 5) * .006); undercoatColors[index * 3] = undercoatShade.r; undercoatColors[index * 3 + 1] = undercoatShade.g; undercoatColors[index * 3 + 2] = undercoatShade.b;
  }
  const group = new THREE.Group(); group.name = name; group.position.set(...center);
  const undercoatCanvas = document.createElement("canvas"); undercoatCanvas.width = 64; undercoatCanvas.height = 64; const undercoatContext = undercoatCanvas.getContext("2d");
  if (undercoatContext) { const gradient = undercoatContext.createRadialGradient(32, 32, 1, 32, 32, 31); gradient.addColorStop(0, "#fff"); gradient.addColorStop(.46, "#ffffffff"); gradient.addColorStop(.82, "#ffffff70"); gradient.addColorStop(1, "#ffffff00"); undercoatContext.fillStyle = gradient; undercoatContext.fillRect(0, 0, 64, 64); }
  const undercoatTexture = new THREE.CanvasTexture(undercoatCanvas); const undercoatGeometry = new THREE.BufferGeometry(); undercoatGeometry.setAttribute("position", new THREE.BufferAttribute(undercoatPositions, 3)); undercoatGeometry.setAttribute("color", new THREE.BufferAttribute(undercoatColors, 3));
  const undercoatPoints = new THREE.Points(undercoatGeometry, new THREE.PointsMaterial({ map: undercoatTexture, vertexColors: true, size: .023, sizeAttenuation: true, transparent: true, opacity: .62, alphaTest: .035, depthWrite: true }));
  undercoatPoints.name = `${name}-soft-undercoat`; undercoatPoints.renderOrder = 1;
  physicalFibers.instanceMatrix.needsUpdate = true; if (physicalFibers.instanceColor) physicalFibers.instanceColor.needsUpdate = true; physicalFibers.name = `${name}-physical-fibers`; physicalFibers.castShadow = false; physicalFibers.receiveShadow = true; physicalFibers.renderOrder = 2; group.add(undercoatPoints, physicalFibers); return group;
}

function addStitch(group: THREE.Group, start: THREE.Vector3, end: THREE.Vector3, stitchMaterial: THREE.Material, radius = .018, name = "teddy-stitch"): THREE.Mesh {
  const stitch = cylinderBetween(start, end, radius, stitchMaterial); stitch.name = name; stitch.castShadow = false; group.add(stitch); return stitch;
}

function createTeddyWalk(settings: TeddyWalkSettings): THREE.Group {
  const root = new THREE.Group(); root.name = "teddy-walk-scene";
  const weave = wovenTexture();
  const fur = new THREE.MeshPhysicalMaterial({ color: settings.furColor, map: weave.color, bumpMap: weave.bump, bumpScale: .055, roughness: .84, metalness: 0, sheen: 1, sheenColor: new THREE.Color(settings.furColor).offsetHSL(0, -.1, .2), sheenRoughness: .7 });
  const patch = new THREE.MeshPhysicalMaterial({ color: settings.patchColor, map: weave.color, bumpMap: weave.bump, bumpScale: .045, roughness: .96, sheen: .16, side: THREE.DoubleSide });
  const accent = new THREE.MeshPhysicalMaterial({ color: settings.accentColor, roughness: .44, metalness: .12, clearcoat: .28 });
  const stitch = new THREE.MeshStandardMaterial({ color: settings.accentColor, roughness: .68, metalness: .03 });
  const teddy = new THREE.Group(); teddy.name = "teddy-character"; teddy.position.set(0, -1.62, .72); teddy.scale.setScalar(.72); teddy.rotation.y = teddyWalkHeading;
  teddy.add(teddyPart("teddy-body", 1, [.73, .92, .58], fur, [0, .25, 0]));
  teddy.add(teddyPart("teddy-head", 1, [.86, .8, .68], fur, [0, 1.55, .02]));
  teddy.add(teddyFurFibers("teddy-body-fur-fibers", [0, .25, 0], [.73, .92, .58], settings.furColor, 760));
  teddy.add(teddyFurFibers("teddy-head-fur-fibers", [0, 1.55, .02], [.86, .8, .68], settings.furColor, 860));
  teddy.add(teddyPart("teddy-left-ear", .42, [1, 1, .6], fur, [-.62, 2.12, -.02]), teddyPart("teddy-right-ear", .42, [1, 1, .6], fur, [.62, 2.12, -.02]));
  const leftEarPatch = mesh(new THREE.CircleGeometry(.25, 36), patch); leftEarPatch.position.set(-.62, 2.12, .255); leftEarPatch.name = "teddy-ear-patch"; teddy.add(leftEarPatch);
  const rightEarPatch = mesh(new THREE.CircleGeometry(.25, 36), patch); rightEarPatch.position.set(.62, 2.12, .255); teddy.add(rightEarPatch);
  teddy.add(teddyFurFibers("teddy-left-ear-fur-fibers", [-.62, 2.12, -.02], [.42, .42, .25], settings.furColor, 190));
  teddy.add(teddyFurFibers("teddy-right-ear-fur-fibers", [.62, 2.12, -.02], [.42, .42, .25], settings.furColor, 190));
  const muzzleMaterial = fur.clone(); muzzleMaterial.color.copy(new THREE.Color(settings.furColor).offsetHSL(0, -.08, .12)); teddy.add(teddyPart("teddy-muzzle", .52, [1, .72, .52], muzzleMaterial, [0, 1.35, .56]));
  teddy.add(teddyPart("teddy-nose", .18, [1.05, .78, .6], accent, [0, 1.43, .91]));
  const button = mesh(new THREE.CylinderGeometry(.18, .18, .075, 36), accent); button.name = "teddy-button-eye"; button.rotation.x = Math.PI / 2; button.position.set(.34, 1.72, .68); teddy.add(button);
  for (const x of [-.055, .055]) for (const y of [-.055, .055]) { const hole = mesh(new THREE.CircleGeometry(.017, 14), new THREE.MeshBasicMaterial({ color: "#030305" })); hole.position.set(.34 + x, 1.72 + y, .722); teddy.add(hole); }
  addStitch(teddy, new THREE.Vector3(-.48, 1.58, .72), new THREE.Vector3(-.2, 1.86, .72), stitch, .026); addStitch(teddy, new THREE.Vector3(-.48, 1.86, .72), new THREE.Vector3(-.2, 1.58, .72), stitch, .026);
  addStitch(teddy, new THREE.Vector3(0, 1.29, .99), new THREE.Vector3(0, 1.14, .91), stitch, .014, "teddy-legacy-mouth-stitch"); addStitch(teddy, new THREE.Vector3(0, 1.14, .91), new THREE.Vector3(-.12, 1.06, .86), stitch, .014, "teddy-legacy-mouth-stitch"); addStitch(teddy, new THREE.Vector3(0, 1.14, .91), new THREE.Vector3(.12, 1.06, .86), stitch, .014, "teddy-legacy-mouth-stitch");
  const tearPoints = Array.from({ length: 18 }, (_, index) => { const angle = index / 18 * Math.PI * 2; const jag = index % 3 === 0 ? 1.16 : index % 2 === 0 ? .91 : 1.02; return new THREE.Vector2(.18 + Math.cos(angle) * .43 * jag, .24 + Math.sin(angle) * .49 * jag); });
  const tearShape = new THREE.Shape(tearPoints); const tearBacking = mesh(new THREE.ShapeGeometry(tearShape), new THREE.MeshPhysicalMaterial({ color: "#09080b", roughness: .98, metalness: 0, side: THREE.DoubleSide })); tearBacking.name = "teddy-chest-tear"; tearBacking.position.z = .592; teddy.add(tearBacking);
  const coverMaterial = new THREE.MeshBasicMaterial({ color: settings.coverImageUrl ? "#ffffff" : settings.patchColor, side: THREE.DoubleSide, toneMapped: false });
  if (settings.coverImageUrl) new THREE.TextureLoader().load(settings.coverImageUrl, (texture) => { if (root.userData.disposed) { texture.dispose(); return; } texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 12; coverMaterial.map = texture; coverMaterial.needsUpdate = true; });
  const chestCover = mesh(new THREE.PlaneGeometry(.66, .66), coverMaterial); chestCover.name = "teddy-chest-cover"; chestCover.position.set(.18, .24, .604); chestCover.rotation.z = -.04; chestCover.renderOrder = 3; teddy.add(chestCover);
  for (let index = 0; index < tearPoints.length; index += 1) { const point = tearPoints[index]!; const next = tearPoints[(index + 1) % tearPoints.length]!; const start = new THREE.Vector3(point.x, point.y, .618); const end = new THREE.Vector3(next.x, next.y, .618); addStitch(teddy, start.clone().lerp(end, .08), start.clone().lerp(end, .34), stitch, .009); addStitch(teddy, start.clone().lerp(end, .66), start.clone().lerp(end, .92), stitch, .009); }
  const limb = (name: string, x: number, y: number, arm: boolean) => {
    const pivot = new THREE.Group(); pivot.name = name; pivot.position.set(x, y, 0);
    const upperCenter: [number, number, number] = [0, arm ? -.28 : -.25, .02]; const upperRadii: [number, number, number] = arm ? [.3, .38, .29] : [.4, .38, .4];
    pivot.add(teddyPart(`${name}-upper-fur`, 1, upperRadii, fur, upperCenter), teddyFurFibers(`${name}-upper-fur-fibers`, upperCenter, upperRadii, settings.furColor, arm ? 180 : 220));
    const lower = new THREE.Group(); lower.name = `${name}-lower`; lower.position.set(0, arm ? -.56 : -.55, .01);
    const lowerCenter: [number, number, number] = [0, arm ? -.3 : -.28, .02]; const lowerRadii: [number, number, number] = arm ? [.27, .42, .27] : [.35, .39, .35];
    lower.add(teddyPart(`${name}-lower-fur`, 1, lowerRadii, fur, lowerCenter), teddyFurFibers(`${name}-lower-fur-fibers`, lowerCenter, lowerRadii, settings.furColor, arm ? 190 : 230));
    if (!arm) { const footPatch = mesh(new THREE.CircleGeometry(.27, 32), patch); footPatch.position.set(0, -.52, .34); footPatch.scale.set(1.08, .78, 1); lower.add(footPatch); }
    pivot.add(lower); teddy.add(pivot);
  };
  limb("teddy-left-arm", -.72, .8, true); limb("teddy-right-arm", .72, .8, true); limb("teddy-left-leg", -.48, -.34, false); limb("teddy-right-leg", .48, -.34, false);
  for (const [index, position] of [[-.28, 1.98, .65], [.52, .42, .57], [-.55, -.15, .48]] .entries()) { const tear = mesh(new THREE.CircleGeometry(.08 + index * .018, 12), patch); tear.name = "teddy-worn-tear"; tear.position.set(position[0]!, position[1]!, position[2]!); tear.scale.set(1.4, .58, 1); tear.rotation.z = index * .63; teddy.add(tear); }
  root.add(teddy);

  const roadscape = new THREE.Group(); roadscape.name = "teddy-roadscape"; roadscape.rotation.y = teddyWalkHeading;
  const asphaltMaps = asphaltTextures(2_683); asphaltMaps.color.repeat.set(1.5, 4.8); asphaltMaps.bump.repeat.copy(asphaltMaps.color.repeat);
  const asphalt = new THREE.MeshPhysicalMaterial({ color: settings.roadColor, map: asphaltMaps.color, bumpMap: asphaltMaps.bump, bumpScale: .17, roughness: .88, metalness: .015, clearcoat: .13, clearcoatRoughness: .72 });
  const road = mesh(new THREE.BoxGeometry(13.5, .2, 34), asphalt); road.name = "teddy-road"; road.position.set(0, -2.83, -6.2); road.castShadow = false; road.userData.colorTexture = asphaltMaps.color; road.userData.bumpTexture = asphaltMaps.bump; roadscape.add(road);
  const curbTexture = urbanTexture(1_419, "#696a66", "#171918"); const curbMaterial = new THREE.MeshStandardMaterial({ color: "#858780", map: curbTexture, bumpMap: curbTexture, bumpScale: .05, roughness: .92 });
  for (const x of [-7.15, 7.15]) { const curb = mesh(new THREE.BoxGeometry(1.25, .36, 34), curbMaterial); curb.position.set(x, -2.7, -6.2); roadscape.add(curb); }
  const markings = new THREE.Group(); markings.name = "teddy-road-markings"; const paint = new THREE.MeshStandardMaterial({ color: "#e0d7b0", roughness: .88, metalness: 0 });
  for (let index = 0; index < 9; index += 1) { const stripe = mesh(new THREE.BoxGeometry(.09, .012, 1.45), paint); stripe.position.set(-2.65, -2.72, -14 + index * 4.1); stripe.castShadow = false; stripe.userData.baseZ = stripe.position.z; markings.add(stripe); }
  roadscape.add(markings);
  const roadGlow = new THREE.PointLight("#ffd7a2", 17, 13, 1.8); roadGlow.position.set(-4.8, 2.4, 3.4); roadGlow.name = "teddy-road-light"; roadscape.add(roadGlow); root.add(roadscape);
  const warm = new THREE.PointLight(settings.furColor, 22, 15, 1.7); warm.position.set(-3.2, 3.8, 4); warm.name = "teddy-warm-light"; root.add(warm);
  const rimLight = new THREE.PointLight(settings.patchColor, 25, 16, 1.8); rimLight.position.set(3.5, .8, 2.4); rimLight.name = "teddy-rim-light"; root.add(rimLight);
  return root;
}

function createTeddySing(settings: TeddySingSettings): THREE.Group {
  const root = new THREE.Group(); root.name = "teddy-sing-scene";

  // Riutilizza esattamente lo stesso personaggio della modalità Walk, poi
  // sostituisce ambiente e posa. La sorgente viene smaltita dopo aver staccato
  // l'orso per non trattenere texture e geometrie della strada.
  const source = createTeddyWalk({
    coverImageUrl: null,
    furColor: settings.furColor,
    patchColor: settings.patchColor,
    accentColor: settings.accentColor,
    roadColor: settings.roomColor,
    walkIntensity: .65,
    pulseIntensity: 0,
    danceEnabled: false
  });
  const teddy = source.getObjectByName("teddy-character") as THREE.Group | undefined;
  if (!teddy) { disposeGroup(source); return root; }
  source.remove(teddy); disposeGroup(source);
  // Teddy Walk usa un muso ovale sporgente. Nel primo piano di Teddy Sing
  // quella seconda ellissoide leggeva come un cerchio attorno alla bocca:
  // qui viene rimossa e i componenti facciali vengono appoggiati direttamente
  // sulla testa, senza disporre le mappe condivise dal resto del peluche.
  const singerMuzzle = teddy.getObjectByName("teddy-muzzle") as THREE.Mesh | undefined;
  if (singerMuzzle) { singerMuzzle.removeFromParent(); singerMuzzle.geometry.dispose(); if (Array.isArray(singerMuzzle.material)) singerMuzzle.material.forEach((material) => material.dispose()); else singerMuzzle.material.dispose(); }
  for (const legacyStitch of [...teddy.children].filter((child) => child.name === "teddy-legacy-mouth-stitch")) { legacyStitch.removeFromParent(); if (legacyStitch instanceof THREE.Mesh) legacyStitch.geometry.dispose(); }
  const singerNose = teddy.getObjectByName("teddy-nose"); if (singerNose) { singerNose.position.z = .725; singerNose.scale.z *= .78; }
  teddy.position.set(-.38, -1.84, -1.08); teddy.rotation.set(-.095, -.1, -.085); teddy.scale.setScalar(.82); teddy.userData.singerBaseRotation = [-.095, -.1, -.085]; teddy.userData.singerBasePosition = [-.38, -1.84, -1.08];
  const leftArm = teddy.getObjectByName("teddy-left-arm"); const rightArm = teddy.getObjectByName("teddy-right-arm"); const leftLeg = teddy.getObjectByName("teddy-left-leg"); const rightLeg = teddy.getObjectByName("teddy-right-leg");
  if (leftArm) { leftArm.rotation.set(-.52, -.12, -.3); const lower = leftArm.getObjectByName("teddy-left-arm-lower"); if (lower) lower.rotation.set(-.58, .04, -.08); }
  if (rightArm) { rightArm.rotation.set(-.28, .1, .12); const lower = rightArm.getObjectByName("teddy-right-arm-lower"); if (lower) lower.rotation.set(-.82, -.04, .1); }
  if (leftLeg) { leftLeg.rotation.set(-1.28, -.12, -.3); const lower = leftLeg.getObjectByName("teddy-left-leg-lower"); if (lower) lower.rotation.set(.06, 0, -.06); }
  if (rightLeg) { rightLeg.rotation.set(-1.08, .12, .26); const lower = rightLeg.getObjectByName("teddy-right-leg-lower"); if (lower) lower.rotation.set(.04, 0, .08); }

  // Tutti i componenti della testa originaria vengono riparentati sotto un
  // unico pivot: occhi, orecchie, muso, cuciture e peluria restano solidali.
  const headRig = new THREE.Group(); headRig.name = "teddy-sing-head-rig"; headRig.position.set(0, 1.42, 0); headRig.rotation.set(-.055, .025, .075); headRig.userData.singerBaseRotation = [-.055, .025, .075]; teddy.add(headRig); teddy.updateMatrixWorld(true);
  const headChildren = teddy.children.filter((child) => child !== headRig && child.position.y > .98);
  headChildren.forEach((child) => headRig.attach(child));

  const mouthRig = new THREE.Group(); mouthRig.name = "teddy-sing-mouth-rig"; headRig.add(mouthRig);
  const mouthDark = new THREE.MeshPhysicalMaterial({ color: "#12080d", roughness: .72, metalness: 0, clearcoat: .12, side: THREE.DoubleSide });
  const mouthInner = mesh(new THREE.CircleGeometry(.185, 48), mouthDark); mouthInner.name = "teddy-sing-mouth-inner"; mouthInner.position.set(0, -.29, .694); mouthInner.scale.set(1, .12, 1); mouthInner.castShadow = false; mouthRig.add(mouthInner);
  const lipColor = new THREE.Color(settings.patchColor).offsetHSL(-.015, .08, -.17); const lipMaterial = new THREE.MeshPhysicalMaterial({ color: lipColor, roughness: .72, sheen: .42, sheenColor: new THREE.Color(settings.patchColor), sheenRoughness: .75 });
  const upperLipCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-.145, 0, 0), new THREE.Vector3(-.07, .014, .004), new THREE.Vector3(0, .019, .006), new THREE.Vector3(.07, .014, .004), new THREE.Vector3(.145, 0, 0)], false, "centripetal");
  const lowerLipCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-.138, 0, 0), new THREE.Vector3(-.065, -.009, .004), new THREE.Vector3(0, -.013, .006), new THREE.Vector3(.065, -.009, .004), new THREE.Vector3(.138, 0, 0)], false, "centripetal");
  const upperLip = mesh(new THREE.TubeGeometry(upperLipCurve, 28, .014, 8, false), lipMaterial); upperLip.name = "teddy-sing-upper-lip"; upperLip.position.set(0, -.275, .711); mouthRig.add(upperLip);
  const lowerLip = mesh(new THREE.TubeGeometry(lowerLipCurve, 28, .014, 8, false), lipMaterial.clone()); lowerLip.name = "teddy-sing-lower-lip"; lowerLip.position.set(0, -.295, .714); mouthRig.add(lowerLip);
  const toothMaterial = new THREE.MeshPhysicalMaterial({ color: "#eee7dc", roughness: .38, clearcoat: .22, transparent: true, opacity: 0 });
  const teeth = mesh(new RoundedBoxGeometry(.185, .055, .018, 4, .012), toothMaterial); teeth.name = "teddy-sing-teeth"; teeth.position.set(0, -.275, .708); teeth.castShadow = false; mouthRig.add(teeth);
  const tongueMaterial = new THREE.MeshPhysicalMaterial({ color: "#a84f64", roughness: .66, sheen: .4, transparent: true, opacity: 0 });
  const tongue = mesh(new THREE.SphereGeometry(.13, 28, 18), tongueMaterial); tongue.name = "teddy-sing-tongue"; tongue.position.set(0, -.35, .716); tongue.scale.set(1, .24, .18); tongue.castShadow = false; mouthRig.add(tongue);
  const wallTexture = urbanTexture(7_141, settings.roomColor, "#11151d"); wallTexture.repeat.set(2.4, 1.7); const wallMaterial = new THREE.MeshPhysicalMaterial({ color: settings.roomColor, map: wallTexture, bumpMap: wallTexture, bumpScale: .045, roughness: .8, metalness: .06, clearcoat: .08, clearcoatRoughness: .75 });
  const wall = mesh(new THREE.BoxGeometry(13.5, 8.5, .28), wallMaterial); wall.name = "teddy-sing-wall"; wall.position.set(0, .85, -1.75); root.add(wall);
  const floorTexture = asphaltTextures(9_371); floorTexture.color.repeat.set(3.5, 3.5); floorTexture.bump.repeat.copy(floorTexture.color.repeat); const floorMaterial = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(settings.roomColor).offsetHSL(0, -.08, -.08), map: floorTexture.color, bumpMap: floorTexture.bump, bumpScale: .085, roughness: .7, metalness: .08, clearcoat: .18, clearcoatRoughness: .66 });
  const floor = mesh(new THREE.BoxGeometry(13.5, .22, 10), floorMaterial); floor.position.set(0, -2.62, 2.9); floor.castShadow = false; root.add(floor);
  const sideWall = mesh(new THREE.BoxGeometry(.22, 8.5, 10), wallMaterial.clone()); sideWall.position.set(-6.65, .85, 2.9); root.add(sideWall);

  const trimMaterial = new THREE.MeshPhysicalMaterial({ color: "#11151d", roughness: .25, metalness: .72, clearcoat: .5 });
  const ledMaterial = new THREE.MeshBasicMaterial({ color: settings.ledColor, toneMapped: false });
  const ledWarm = new THREE.Color(settings.ledColor); const ledCool = ledWarm.clone().offsetHSL(.18, .05, .08);
  const addLedBar = (name: string, start: THREE.Vector3, end: THREE.Vector3, color: THREE.Color) => {
    const housing = cylinderBetween(start, end, .052, trimMaterial); const light = cylinderBetween(start, end, .022, ledMaterial.clone()); (light.material as THREE.MeshBasicMaterial).color.copy(color); light.name = name; light.castShadow = false; housing.castShadow = false; root.add(housing, light);
  };
  addLedBar("teddy-sing-led-top", new THREE.Vector3(-5.8, 4.25, -1.5), new THREE.Vector3(5.8, 4.25, -1.5), ledWarm);
  addLedBar("teddy-sing-led-left", new THREE.Vector3(-5.85, -2.25, -1.49), new THREE.Vector3(-5.85, 4.2, -1.49), ledCool);
  addLedBar("teddy-sing-led-accent", new THREE.Vector3(-4.6, -2.32, -1.47), new THREE.Vector3(4.9, -2.32, -1.47), ledWarm);
  for (const [index, x] of [-4.7, 0, 4.7].entries()) { const ledLight = new THREE.PointLight(index === 1 ? ledCool : ledWarm, 22, 10, 1.75); ledLight.name = "teddy-sing-led-light"; ledLight.position.set(x, index === 1 ? 3.5 : .2, .25); root.add(ledLight); }

  const panelMaterial = new THREE.MeshPhysicalMaterial({ color: "#171b23", roughness: .56, metalness: .22, clearcoat: .3 });
  for (let index = 0; index < 5; index += 1) { const panel = mesh(new RoundedBoxGeometry(.62, 2.3, .13, 5, .06), panelMaterial); panel.position.set(-4.6 + index * .72, .8 + (index % 2) * .28, -1.48); panel.rotation.z = (index % 2 ? 1 : -1) * .035; root.add(panel); }
  const posterFrame = new THREE.Group(); posterFrame.name = "teddy-sing-poster-frame"; posterFrame.position.set(-.25, 1.48, -1.5);
  const frameBack = mesh(new RoundedBoxGeometry(2.82, 3.42, .13, 5, .05), trimMaterial); posterFrame.add(frameBack);
  const posterMaterial = new THREE.MeshPhysicalMaterial({ color: settings.posterImageUrl ? "#ffffff" : settings.patchColor, roughness: .42, clearcoat: .55, clearcoatRoughness: .28, toneMapped: false });
  const poster = mesh(new THREE.PlaneGeometry(1, 1), posterMaterial); poster.name = "teddy-sing-poster"; poster.position.z = .071; poster.scale.set(2.5, 3.08, 1); poster.castShadow = false; posterFrame.add(poster); root.add(posterFrame);
  if (settings.posterImageUrl) {
    const sourceUrl = settings.posterImageUrl;
    new THREE.TextureLoader().load(sourceUrl, (texture) => {
      if (root.userData.disposed) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 12; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = true; posterMaterial.map = texture; posterMaterial.needsUpdate = true;
      const image = texture.image as { width?: number; height?: number }; const aspect = (image.width ?? 1) / Math.max(1, image.height ?? 1); const maxWidth = 2.5; const maxHeight = 3.08;
      if (aspect >= maxWidth / maxHeight) poster.scale.set(maxWidth, maxWidth / aspect, 1); else poster.scale.set(maxHeight * aspect, maxHeight, 1);
    });
  }

  const key = new THREE.SpotLight("#fff1dc", 62, 16, THREE.MathUtils.degToRad(38), .58, 1.7); key.name = "teddy-sing-key"; key.position.set(2.4, 4.8, 5.4); key.target.position.set(-.4, -.75, -.65); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); root.add(key, key.target);
  const faceFill = new THREE.PointLight(ledCool, 19, 9, 1.6); faceFill.name = "teddy-sing-face-fill"; faceFill.position.set(-2.4, 1.4, 3.3); root.add(faceFill);
  const posterLight = new THREE.SpotLight(ledWarm, 32, 10, THREE.MathUtils.degToRad(25), .62, 1.8); posterLight.position.set(.2, 4.2, 2); posterLight.target.position.copy(posterFrame.position); root.add(posterLight, posterLight.target);
  if (settings.particlesEnabled) {
    const particleCount = Math.round(170 * settings.particleDensity); const positions = new Float32Array(particleCount * 3); const seeds = Array.from({ length: particleCount }, (_, index) => ({ x: Math.sin(index * 91.17) * 5.5, y: (Math.sin(index * 37.71) * .5 + .5) * 6.5 - 2.3, z: (Math.cos(index * 53.19) * .5 + .5) * 5.2 - 1.25, phase: Math.sin(index * 17.13) * Math.PI, speed: .055 + index % 9 * .008, drift: .018 + index % 5 * .006 }));
    for (const [index, seed] of seeds.entries()) positions.set([seed.x, seed.y, seed.z], index * 3);
    const particleGeometry = new THREE.BufferGeometry(); const positionAttribute = new THREE.BufferAttribute(positions, 3); positionAttribute.setUsage(THREE.DynamicDrawUsage); particleGeometry.setAttribute("position", positionAttribute);
    const particles = new THREE.Points(particleGeometry, new THREE.PointsMaterial({ color: settings.particleColor, size: .022, transparent: true, opacity: .58, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true })); particles.name = "teddy-sing-particles"; particles.userData.seeds = seeds; particles.frustumCulled = false; particles.renderOrder = 3; root.add(particles);
  }
  root.add(teddy);
  return root;
}

function createCoverVisualizer(settings: CoverSphereSettings): THREE.Group {
  const root = new THREE.Group(); root.name = "cover-sphere-visualizer";
  const spectrum = new THREE.Group(); spectrum.name = "cover-spectrum";
  for (let index = 0; index < 48; index += 1) { const bandColor = new THREE.Color(settings.spectrumColor).offsetHSL((index / 47 - .5) * .075, 0, index % 2 ? .025 : 0); const barMaterial = new THREE.MeshPhysicalMaterial({ color: bandColor, emissive: bandColor, emissiveIntensity: 2.4, roughness: .16, metalness: .34, clearcoat: 1, clearcoatRoughness: .035, transparent: true, opacity: .96 }); const bar = mesh(new RoundedBoxGeometry(.095, 1, .2, 5, .035), barMaterial); bar.name = "cover-spectrum-band"; bar.userData.bandIndex = index; bar.castShadow = false; bar.position.set((index - 23.5) * .145, -2.7, .3); bar.renderOrder = 2; spectrum.add(bar); }
  const spectrumGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightGlowTexture(), color: settings.spectrumColor, transparent: true, opacity: .32, depthWrite: false, blending: THREE.AdditiveBlending })); spectrumGlow.name = "cover-spectrum-glow"; spectrumGlow.position.set(0, -2.15, -.05); spectrumGlow.scale.set(8, 2.4, 1); spectrum.add(spectrumGlow);
  root.add(spectrum);
  const frontLight = new THREE.PointLight(settings.spectrumColor, 18, 14, 1.6); frontLight.position.set(-2.6, 1.5, 4); frontLight.name = "cover-key-light"; root.add(frontLight);
  const rimLight = new THREE.PointLight(settings.effectColor, 22, 15, 1.7); rimLight.position.set(3, .5, 1.8); rimLight.name = "cover-rim-light"; root.add(rimLight);
  const atmosphere = new THREE.Group(); atmosphere.name = "cover-atmosphere";
  if (settings.effects.smoke) for (let index = 0; index < 9; index += 1) { const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightGlowTexture(), color: settings.effectColor, transparent: true, opacity: .08, depthWrite: false, blending: THREE.AdditiveBlending })); sprite.name = "cover-smoke"; sprite.userData.effectIndex = index; sprite.position.set(Math.sin(index * 2.3) * 3.4, -1.5 + index % 4 * 1.25, -.3); sprite.scale.setScalar(2.4 + index % 3); atmosphere.add(sprite); }
  if (settings.effects.particles) { const positions: number[] = []; for (let index = 0; index < 110; index += 1) positions.push(Math.sin(index * 71.3) * 4.8, Math.cos(index * 37.9) * 3.8, -.1 + Math.sin(index * 19.1) * .7); const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); const particles = new THREE.Points(geometry, new THREE.PointsMaterial({ color: settings.effectColor, size: .035, transparent: true, opacity: .72, depthWrite: false, blending: THREE.AdditiveBlending })); particles.name = "cover-particles"; atmosphere.add(particles); }
  if (settings.effects.rain) { const rainCount = 120; const positions = new Float32Array(rainCount * 6); const seeds = Array.from({ length: rainCount }, (_, index) => ({ x: Math.sin(index * 49.2) * 5.2, z: -.4 + (Math.sin(index * 19.7) * .5 + .5) * 1.8, phase: (Math.sin(index * 31.1) * .5 + .5) * 8, speed: 3.2 + index % 7 * .17, length: .42 + index % 5 * .085, drift: .08 + index % 4 * .025 })); for (const [index, seed] of seeds.entries()) { const offset = index * 6; const y = 4 - seed.phase; positions[offset] = seed.x; positions[offset + 1] = y; positions[offset + 2] = seed.z; positions[offset + 3] = seed.x + .08; positions[offset + 4] = y - seed.length; positions[offset + 5] = seed.z; } const geometry = new THREE.BufferGeometry(); const position = new THREE.BufferAttribute(positions, 3); position.setUsage(THREE.DynamicDrawUsage); geometry.setAttribute("position", position); const rain = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: settings.effectColor, transparent: true, opacity: .68, depthWrite: false, blending: THREE.AdditiveBlending })); rain.name = "cover-rain"; rain.userData.seeds = seeds; rain.frustumCulled = false; atmosphere.add(rain); }
  if (settings.effects.windLeaves) for (let index = 0; index < 26; index += 1) { const leafColor = new THREE.Color(settings.effectColor).offsetHSL((index % 5 - 2) * .035, .08, (index % 4 - 1.5) * .035); const leaf = mesh(new THREE.CircleGeometry(.18 + index % 3 * .025, 7), new THREE.MeshPhysicalMaterial({ color: leafColor, emissive: leafColor, emissiveIntensity: .3, roughness: .62, clearcoat: .18, side: THREE.DoubleSide })); leaf.name = "cover-leaf"; leaf.userData.effectIndex = index; leaf.scale.set(1.45, .72, 1); leaf.position.set(index % 2 ? -4.5 + index * .17 : 4.5 - index * .16, 3.7 - index % 8, .2 + Math.sin(index) * .8); leaf.castShadow = false; leaf.frustumCulled = false; atmosphere.add(leaf); }
  if (settings.effects.flyers) for (const [index, url] of settings.flyerImageUrls.entries()) { const flyerMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", side: THREE.DoubleSide, transparent: true, opacity: .9 }); new THREE.TextureLoader().load(url, (texture) => { texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8; flyerMaterial.map = texture; flyerMaterial.needsUpdate = true; }); const flyer = mesh(new THREE.PlaneGeometry(.7, .7), flyerMaterial); flyer.name = "cover-flyer"; flyer.userData.effectIndex = index; flyer.castShadow = false; atmosphere.add(flyer); }
  root.add(atmosphere); return root;
}

function applyCoverVisualizerPalette(root: THREE.Group, spectrumColor: string, effectColor: string): void {
  const spectrum = new THREE.Color(spectrumColor);
  const effect = new THREE.Color(effectColor);
  root.traverse((child) => {
    if (child.name === "cover-spectrum-band" && child instanceof THREE.Mesh && child.material instanceof THREE.MeshPhysicalMaterial) {
      const index = Number(child.userData.bandIndex);
      const bandColor = spectrum.clone().offsetHSL((index / 47 - .5) * .075, 0, index % 2 ? .025 : 0);
      child.material.color.copy(bandColor);
      child.material.emissive.copy(bandColor);
      child.material.needsUpdate = true;
    } else if (child.name === "cover-spectrum-glow" && child instanceof THREE.Sprite && child.material instanceof THREE.SpriteMaterial) {
      child.material.color.copy(spectrum);
    } else if (child.name === "cover-key-light" && child instanceof THREE.PointLight) {
      child.color.copy(spectrum);
    } else if (child.name === "cover-rim-light" && child instanceof THREE.PointLight) {
      child.color.copy(effect);
    } else if ((child.name === "cover-smoke" || child.name === "cover-particles") && "material" in child) {
      const visual = child as THREE.Sprite | THREE.Points;
      const visualMaterial = visual.material as THREE.SpriteMaterial | THREE.PointsMaterial;
      visualMaterial.color.copy(effect);
    } else if (child.name === "cover-rain" && child instanceof THREE.LineSegments && child.material instanceof THREE.LineBasicMaterial) {
      child.material.color.copy(effect);
    } else if (child.name === "cover-leaf" && child instanceof THREE.Mesh && child.material instanceof THREE.MeshPhysicalMaterial) {
      const index = Number(child.userData.effectIndex);
      const leafColor = effect.clone().offsetHSL((index % 5 - 2) * .035, .08, (index % 4 - 1.5) * .035);
      child.material.color.copy(leafColor);
      child.material.emissive.copy(leafColor);
    }
  });
}

function createStereoUnfoldScene(settings: StereoUnfoldSettings): THREE.Group {
  const root = new THREE.Group(); root.name = "stereo-unfold-scene";
  root.userData.coverHalfWidth = 2.275;
  const field = new THREE.Group(); field.name = "stereo-unfold-field"; root.add(field);
  for (const side of [-1, 1] as const) for (let index = 0; index < 24; index += 1) {
    const base = new THREE.Color(side < 0 ? settings.primaryColor : settings.secondaryColor); const bandColor = base.offsetHSL((index / 23 - .5) * .09, .04, (index % 3 - 1) * .025);
    const thickness = settings.spectrumStyle === "prisms" ? .2 : settings.spectrumStyle === "aurora" ? .045 : .085;
    const bandMaterial = new THREE.MeshPhysicalMaterial({ color: bandColor, emissive: bandColor, emissiveIntensity: 2.8, roughness: .18, metalness: settings.spectrumStyle === "prisms" ? .48 : .12, clearcoat: 1, clearcoatRoughness: .04, transparent: true, opacity: settings.spectrumStyle === "aurora" ? .42 : .78, blending: THREE.AdditiveBlending, depthWrite: false });
    const bandHeight = settings.spectrumStyle === "prisms" ? .155 : settings.spectrumStyle === "aurora" ? .19 : .175;
    const band = mesh(new RoundedBoxGeometry(1, bandHeight, thickness, 4, .035), bandMaterial); band.name = "stereo-unfold-band"; band.userData.side = side; band.userData.bandIndex = index * 2; band.userData.baseY = (index / 23 - .5) * 4.48; band.castShadow = false; band.receiveShadow = false; band.renderOrder = 7; field.add(band);
  }
  const haloTexture = lightGlowTexture();
  for (const [name, color, x] of [["left", settings.primaryColor, -3.2], ["right", settings.secondaryColor, 3.2]] as const) {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture, color, transparent: true, opacity: .3, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })); halo.name = `stereo-unfold-${name}-halo`; halo.position.set(x, .15, .88); halo.scale.set(4.2, 6, 1); field.add(halo);
  }
  if (settings.effects.particles) {
    for (const side of [-1, 1] as const) {
      const positions: number[] = []; const seeds: { x: number; y: number; z: number; phase: number; speed: number }[] = [];
      for (let index = 0; index < 72; index += 1) {
        const x = .08 + (Math.sin(index * 73.71) * .5 + .5) * 1.95; const y = (Math.cos(index * 41.37) * .5 + .5) * 4.48 - 2.24; const z = 1.05 + (Math.sin(index * 19.23) * .5 + .5) * .34;
        positions.push(side * x, y, z); seeds.push({ x: side * x, y, z, phase: index * 1.917, speed: .18 + index % 7 * .025 });
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const particles = new THREE.Points(geometry, new THREE.PointsMaterial({ color: side < 0 ? settings.primaryColor : settings.secondaryColor, size: .045, transparent: true, opacity: .62, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false }));
      particles.name = "stereo-unfold-particles"; particles.userData.side = side; particles.userData.seeds = seeds; particles.frustumCulled = false; particles.renderOrder = 9; field.add(particles);
    }
  }
  if (settings.effects.lightTrails) {
    for (const side of [-1, 1] as const) for (let trailIndex = 0; trailIndex < 3; trailIndex += 1) {
      const positions: number[] = [];
      for (let index = 0; index < 64; index += 1) {
        const y = (index / 63 - .5) * 4.5; const x = Math.sin(index * .42 + trailIndex * 1.9) * (.06 + trailIndex * .028);
        positions.push(x, y, 0);
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const trail = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: side < 0 ? settings.primaryColor : settings.secondaryColor, transparent: true, opacity: .32, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      trail.name = "stereo-unfold-light-trail"; trail.userData.side = side; trail.userData.trailIndex = trailIndex; trail.renderOrder = 8; field.add(trail);
    }
  }
  if (settings.effects.pulseRings) {
    for (const side of [-1, 1] as const) for (let ringIndex = 0; ringIndex < 3; ringIndex += 1) {
      const ringColor = side < 0 ? settings.primaryColor : settings.secondaryColor;
      const ring = mesh(new THREE.TorusGeometry(.34, .012 + ringIndex * .004, 8, 64), new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: .24, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      ring.name = "stereo-unfold-pulse-ring"; ring.userData.side = side; ring.userData.ringIndex = ringIndex; ring.position.z = 1.15 + ringIndex * .03; ring.renderOrder = 10; field.add(ring);
    }
  }
  field.traverse((child) => { if (child.name.includes("stereo-unfold-") && "material" in child) child.renderOrder = Math.max(child.renderOrder, 7); });
  const fullScreenField = new THREE.Group(); fullScreenField.name = "stereo-unfold-full-screen-field"; root.add(fullScreenField);
  const primary = new THREE.Color(settings.primaryColor); const secondary = new THREE.Color(settings.secondaryColor);
  if (settings.effects.fullScreenWaves) {
    for (let waveIndex = 0; waveIndex < 6; waveIndex += 1) {
      const waveColor = primary.clone().lerp(secondary, waveIndex / 5);
      const wave = mesh(new THREE.TorusGeometry(1, .009 + waveIndex % 2 * .004, 6, 128), new THREE.MeshBasicMaterial({ color: waveColor, transparent: true, opacity: .12, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      wave.name = "stereo-unfold-full-wave"; wave.userData.waveIndex = waveIndex; wave.position.z = .82 + waveIndex * .025; wave.renderOrder = 6; fullScreenField.add(wave);
    }
  }
  if (settings.effects.lightRays) {
    for (let rayIndex = 0; rayIndex < 7; rayIndex += 1) {
      const mix = rayIndex / 6; const rayColor = primary.clone().lerp(secondary, mix);
      const ray = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture, color: rayColor, transparent: true, opacity: .08, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, rotation: (rayIndex - 3) * .105 }));
      ray.name = "stereo-unfold-full-ray"; ray.userData.rayIndex = rayIndex; ray.position.set(-4.8 + rayIndex * 1.6, Math.sin(rayIndex * 2.1) * 1.2, .7 + rayIndex * .018); ray.scale.set(.72 + rayIndex % 2 * .18, 10.5, 1); ray.renderOrder = 5; fullScreenField.add(ray);
    }
  }
  if (settings.effects.chromaDust) {
    const positions: number[] = []; const colors: number[] = []; const seeds: { x: number; y: number; z: number; phase: number; speed: number; depth: number }[] = [];
    for (let index = 0; index < 180; index += 1) {
      const x = Math.sin(index * 91.73) * 5.6; const y = Math.cos(index * 47.19) * 4.2; const depth = Math.sin(index * 23.61) * .5 + .5; const z = .72 + depth * .55; const color = primary.clone().lerp(secondary, THREE.MathUtils.clamp(x / 11.2 + .5, 0, 1));
      positions.push(x, y, z); colors.push(color.r, color.g, color.b); seeds.push({ x, y, z, phase: index * 2.173, speed: .12 + index % 9 * .018, depth });
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const dust = new THREE.Points(geometry, new THREE.PointsMaterial({ vertexColors: true, size: .032, transparent: true, opacity: .38, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, sizeAttenuation: true }));
    dust.name = "stereo-unfold-full-dust"; dust.userData.seeds = seeds; dust.frustumCulled = false; dust.renderOrder = 8; fullScreenField.add(dust);
  }
  const leftLight = new THREE.PointLight(settings.primaryColor, 22, 14, 1.65); leftLight.name = "stereo-unfold-left-light"; leftLight.position.set(-3.6, .5, 1.4); root.add(leftLight);
  const rightLight = new THREE.PointLight(settings.secondaryColor, 22, 14, 1.65); rightLight.name = "stereo-unfold-right-light"; rightLight.position.set(3.6, .5, 1.4); root.add(rightLight);
  const coverRig = new THREE.Group(); coverRig.name = "stereo-unfold-cover-rig"; root.add(coverRig);
  const geometry = new THREE.PlaneGeometry(4.55, 4.55, 32, 32); const positions = geometry.getAttribute("position") as THREE.BufferAttribute; geometry.userData.basePositions = new Float32Array(positions.array as ArrayLike<number>);
  const coverColors = new Float32Array(positions.count * 3); coverColors.fill(1); geometry.setAttribute("color", new THREE.BufferAttribute(coverColors, 3));
  const coverMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
  const cover = mesh(geometry, coverMaterial); cover.name = "stereo-unfold-cover"; cover.castShadow = true; cover.receiveShadow = true; cover.renderOrder = 4; coverRig.add(cover);
  if (settings.coverImageUrl) {
    new THREE.TextureLoader().load(settings.coverImageUrl, (texture) => {
      if (root.userData.disposed) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 16; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter; coverMaterial.map = texture; coverMaterial.needsUpdate = true;
      const image = texture.image as { width?: number; height?: number }; const aspect = (image.width ?? 1) / Math.max(1, image.height ?? 1);
      const widthScale = aspect >= 1 ? 1 : aspect; const heightScale = aspect >= 1 ? 1 / aspect : 1;
      coverRig.scale.set(widthScale, heightScale, 1); field.scale.y = heightScale; root.userData.coverHalfWidth = 2.275 * widthScale;
    });
  }
  return root;
}

export function Viewport({ timeSeconds, durationSeconds, playing, ballPosition, ballVelocity, activeObjectIndex, aspectRatio, animationModeId, newYorkSettings, coverSphereSettings, stereoUnfoldSettings, walkingCubeSettings, pixelArtSettings, teddyWalkSettings, teddySingSettings, addSubtitlesSettings, proSubtitlesSettings, pixelsSubSettings, staticWatermarkSettings, upscalerSettings, pixelsSubRhythmHits, teddyLipSync, subtitles, spectrumBands, stereoLeftBands, stereoRightBands, stereoWidth, stereoLeftPulse, stereoRightPulse, audioPulse, rhythmPulse, globalBpm, trajectorySegments, projectSeed, motionKinds, impactResponses, onRendererReady, onSelectObject, onPlayPause, onStop, onSeek }: { timeSeconds: number; durationSeconds: number; playing: boolean; ballPosition: Vector3Data | undefined; ballVelocity: Vector3Data | undefined; activeObjectIndex: number; aspectRatio: string; animationModeId: string; newYorkSettings: NewYorkSettings; coverSphereSettings: CoverSphereSettings; stereoUnfoldSettings: StereoUnfoldSettings; walkingCubeSettings: WalkingCubeSettings; pixelArtSettings: PixelArtSettings; teddyWalkSettings: TeddyWalkSettings; teddySingSettings: TeddySingSettings; addSubtitlesSettings: AddSubtitlesSettings; proSubtitlesSettings: ProSubtitlesSettings; pixelsSubSettings: PixelsSubSettings; staticWatermarkSettings: StaticWatermarkSettings; upscalerSettings: UpscalerSettings; pixelsSubRhythmHits: readonly { timeSeconds: number; strength: number; type: "kick" | "snare" }[]; teddyLipSync: TeddyLipSyncPose; subtitles: RhythmBallProject["subtitles"]; spectrumBands: readonly number[]; stereoLeftBands: readonly number[]; stereoRightBands: readonly number[]; stereoWidth: number; stereoLeftPulse: number; stereoRightPulse: number; audioPulse: number; rhythmPulse: number; globalBpm: number; trajectorySegments: readonly TrajectorySegment[]; projectSeed: number; motionKinds: readonly MotionKind[]; impactResponses: readonly { timeSeconds: number; strength: number }[]; onRendererReady: (renderer: SharedViewportRenderer | null) => void; onSelectObject: (id: string | null) => void; onPlayPause?: () => void; onStop?: () => void; onSeek?: (seconds: number) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const backgroundVideo = useRef<HTMLVideoElement>(null);
  const [teddyMocap, setTeddyMocap] = useState<TeddyMocapLibrary | null>(null);
  const [subtitleFontRevision, setSubtitleFontRevision] = useState(0);
  const [pixelsSubImage, setPixelsSubImage] = useState<HTMLImageElement | null>(null);
  const { fullscreenPreview, toggleFullscreenPreview } = useFullscreenPreview();
  const storedObjects = useSceneStore((state) => state.objects);
  const objects = useMemo(() => animationModeId === "newYorkStreets" ? normalizeNewYorkLevels(storedObjects) : storedObjects, [animationModeId, storedObjects]);
  const ballAppearance = useSceneStore((state) => state.ball);
  const background = useSceneStore((state) => state.background);
  const effectiveWalkingCubeSettings = useMemo<WalkingCubeSettings>(() => {
    const globalImage = background.mediaType === "image" ? background.imageUrl : null;
    return {
      ...walkingCubeSettings,
      imageUrl: walkingCubeSettings.imageUrl,
      backgroundImageUrl: globalImage ?? walkingCubeSettings.backgroundImageUrl
    };
  }, [background.imageUrl, background.mediaType, walkingCubeSettings]);
  const walkingCubeExternalVideo = background.mediaType === "video" && Boolean(background.imageUrl);
  const walkingCubeExternalBackdrop = walkingCubeExternalVideo || Boolean(effectiveWalkingCubeSettings.backgroundImageUrl);
  const railColors = useSceneStore((state) => state.railColors);
  const sceneLight = useSceneStore((state) => state.light);
  const lightPickMode = useSceneStore((state) => state.lightPickMode);
  const initialObjects = useRef(objects);
  const initialBall = useRef(ballAppearance);
  const ballAppearanceRef = useRef(ballAppearance); ballAppearanceRef.current = ballAppearance;
  const initialBackground = useRef(background);
  const initialRailColors = useRef(railColors);
  const initialSceneLight = useRef(sceneLight);
  const sceneLightRef = useRef(sceneLight); sceneLightRef.current = sceneLight;
  const initialMotionKinds = useRef(motionKinds);
  const initialActiveObjectIndex = useRef(activeObjectIndex);
  const initialAnimationModeId = useRef(animationModeId);
  const timeSecondsRef = useRef(timeSeconds); timeSecondsRef.current = timeSeconds;
  const activeObjectIndexRef = useRef(activeObjectIndex); activeObjectIndexRef.current = activeObjectIndex;
  const selectedId = useSceneStore((state) => state.selectedId);
  const objectGroups = useRef(new Map<string, THREE.Group>());
  const marble = useRef<THREE.Group | null>(null);
  const marbleShell = useRef<THREE.Mesh | null>(null);
  const marbleCore = useRef<THREE.Mesh | null>(null);
  const marbleImage = useRef<THREE.Mesh | null>(null);
  const marbleImageSource = useRef<string | null>(null);
  const marbleShards = useRef<THREE.Group | null>(null);
  const rails = useRef<THREE.Group | null>(null);
  const neonSigns = useRef<THREE.Group | null>(null);
  const newYorkEnvironment = useRef<THREE.Group | null>(null);
  const secondaryMarbles = useRef<THREE.Group | null>(null);
  const coverVisualizer = useRef<THREE.Group | null>(null);
  const stereoUnfoldScene = useRef<THREE.Group | null>(null);
  const walkingCubeScene = useRef<THREE.Group | null>(null);
  const pixelArtScene = useRef<THREE.Group | null>(null);
  const teddyWalkScene = useRef<THREE.Group | null>(null);
  const teddySingScene = useRef<THREE.Group | null>(null);
  const stars = useRef<THREE.Points | null>(null);
  const customLightRig = useRef<THREE.Group | null>(null);
  const customSpotLight = useRef<THREE.SpotLight | null>(null);
  const customLightSpill = useRef<THREE.PointLight | null>(null);
  const customLightTarget = useRef<THREE.Object3D | null>(null);
  const customLightSource = useRef<THREE.Mesh | null>(null);
  const customLightHalo = useRef<THREE.Sprite | null>(null);
  const customLightBeam = useRef<THREE.Group | null>(null);
  const marbleGlint = useRef<THREE.Sprite | null>(null);
  const subtitleSprite = useRef<THREE.Sprite | null>(null);
  const proSubtitleCanvas = useRef<HTMLCanvasElement | null>(null);
  const pixelsSubCanvas = useRef<HTMLCanvasElement | null>(null);
  const pixelsSubSprite = useRef<THREE.Sprite | null>(null);
  const camera = useRef<THREE.PerspectiveCamera | null>(null);
  const desiredCameraPosition = useRef(new THREE.Vector3(0, 0, 11.5));
  const desiredCameraTarget = useRef(new THREE.Vector3(0, -.25, 0));
  const smoothCameraTarget = useRef(new THREE.Vector3(0, -.25, 0));
  const sceneRef = useRef<THREE.Scene | null>(null);
  const raceEvaluator = useMemo(() => createNewYorkRaceEvaluator(trajectorySegments, newYorkSettings.secondaryMarbleCount, projectSeed, ballAppearance.radius, durationSeconds), [ballAppearance.radius, durationSeconds, newYorkSettings.secondaryMarbleCount, projectSeed, trajectorySegments]);
  const rollingOrientation = useMemo(() => createRollingOrientationEvaluator(trajectorySegments, ballAppearance.radius), [ballAppearance.radius, trajectorySegments]);
  const walkingCubeMotion = useMemo(() => createWalkingCubeMotionEvaluator({ durationSeconds: durationSeconds || 30, bpm: globalBpm, impacts: impactResponses, seed: projectSeed, intensity: walkingCubeSettings.rotationIntensity }), [durationSeconds, globalBpm, impactResponses, projectSeed, walkingCubeSettings.rotationIntensity]);

  useEffect(() => {
    if (animationModeId !== "teddyWalk") { setTeddyMocap(null); return; }
    let active = true; void loadTeddyMocapLibrary().then((library) => { if (active) setTeddyMocap(library); }).catch(() => { if (active) setTeddyMocap(null); });
    return () => { active = false; };
  }, [animationModeId]);

  useEffect(() => {
    if (animationModeId !== "pixelsSub" || !pixelsSubSettings.imageUrl) { setPixelsSubImage(null); return; }
    let active = true; const source = new Image(); source.decoding = "async";
    source.onload = () => { if (active) setPixelsSubImage(source); };
    source.onerror = () => { if (active) setPixelsSubImage(null); };
    source.src = pixelsSubSettings.imageUrl;
    return () => { active = false; };
  }, [animationModeId, pixelsSubSettings.imageUrl]);

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = null;
    // La profondità deve provenire da luce, materiali e prospettiva. Una nebbia
    // globale così densa desaturava ogni modalità e produceva la "patina" opaca.
    scene.fog = null;
    const activeCamera = new THREE.PerspectiveCamera(38, 1, .1, 350);
    activeCamera.position.set(0, 0, 11.5);
    camera.current = activeCamera;
    scene.add(activeCamera);
    // ProSubtitles is read back frame-by-frame by the deterministic encoder.
    // Keeping its drawing buffer avoids transparent/black captures on browsers
    // that discard the WebGL back buffer immediately after presentation.
    const activeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: initialAnimationModeId.current === "proSubtitles" });
    activeRenderer.setClearColor(0x000000, 0);
    const previewPixelRatio = Math.min(devicePixelRatio, 1.25);
    activeRenderer.setPixelRatio(previewPixelRatio);
    activeRenderer.shadowMap.enabled = true;
    activeRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    activeRenderer.outputColorSpace = THREE.SRGBColorSpace;
    activeRenderer.toneMapping = THREE.AgXToneMapping;
    activeRenderer.toneMappingExposure = 1.28;
    const pmrem = new THREE.PMREMGenerator(activeRenderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), .035).texture;
    scene.environmentIntensity = 1.18;
    element.append(activeRenderer.domElement);

    const hemisphere = new THREE.HemisphereLight("#c8d8ff", "#180d2d", 1.25); hemisphere.name = "global-hemisphere"; scene.add(hemisphere);
    const key = new THREE.DirectionalLight("#ffffff", 4.2);
    key.name = "global-key";
    key.position.set(4, 6, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const cyanRim = new THREE.PointLight("#56f3d1", 13, 18);
    cyanRim.name = "global-cyan-rim";
    cyanRim.position.set(-4, 1, 5);
    scene.add(cyanRim);
    const violetRim = new THREE.PointLight("#7657ff", 15, 20);
    violetRim.name = "global-violet-rim";
    violetRim.position.set(4, -3, 3);
    scene.add(violetRim);

    const lightRig = new THREE.Group(); lightRig.name = "custom-scene-light"; lightRig.userData.lightGizmo = true;
    const configuredLight = initialSceneLight.current;
    const spot = new THREE.SpotLight(configuredLight.color, configuredLight.intensity * 24, configuredLight.distance, THREE.MathUtils.degToRad(configuredLight.angleDegrees), configuredLight.penumbra, configuredLight.decay);
    spot.name = "custom-scene-spotlight"; spot.position.set(...configuredLight.origin); spot.castShadow = configuredLight.castShadow; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -.00035; spot.shadow.normalBias = .025;
    const spotTarget = new THREE.Object3D(); spotTarget.name = "custom-scene-light-target"; spotTarget.position.set(...configuredLight.target); spot.target = spotTarget; lightRig.add(spot, spotTarget);
    const spill = new THREE.PointLight(configuredLight.color, configuredLight.intensity * 1.8, configuredLight.distance > 0 ? configuredLight.distance * .58 : 0, Math.max(1.5, configuredLight.decay)); spill.name = "custom-scene-light-spill"; spill.position.set(...configuredLight.origin); spill.visible = configuredLight.enabled; lightRig.add(spill);
    const sourceMaterial = new THREE.MeshPhysicalMaterial({ color: configuredLight.color, emissive: configuredLight.color, emissiveIntensity: 8, roughness: .08, metalness: .08, clearcoat: 1, clearcoatRoughness: .02 });
    const source = mesh(new THREE.SphereGeometry(1, 28, 18), sourceMaterial); source.name = "custom-scene-light-source"; source.userData.lightGizmo = true; source.position.set(...configuredLight.origin); source.scale.setScalar(configuredLight.sourceRadius); lightRig.add(source);
    const glowMap = lightGlowTexture();
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: configuredLight.color, transparent: true, opacity: .72, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); halo.name = "custom-scene-light-halo"; halo.userData.lightGizmo = true; halo.position.set(...configuredLight.origin); halo.scale.setScalar(configuredLight.sourceRadius * 7); lightRig.add(halo);
    const beam = new THREE.Group(); beam.name = "custom-scene-volumetric-beam"; beam.userData.lightGizmo = true;
    const beamGeometry = new THREE.ConeGeometry(1, 1, 64, 12, true); const beamOuterMaterial = volumetricBeamMaterial(configuredLight.color, 1); beamOuterMaterial.uniforms["uDensity"]!.value = configuredLight.beamDensity * 1.4; beamOuterMaterial.uniforms["uSoftness"]!.value = configuredLight.penumbra; const beamOuter = mesh(beamGeometry, beamOuterMaterial); beamOuter.userData.beamDensityScale = 1.4; beamOuter.castShadow = false; beamOuter.receiveShadow = false; beam.add(beamOuter);
    const beamInnerMaterial = volumetricBeamMaterial(configuredLight.color, .55); beamInnerMaterial.uniforms["uDensity"]!.value = configuredLight.beamDensity * .77; beamInnerMaterial.uniforms["uSoftness"]!.value = configuredLight.penumbra; const beamInner = mesh(beamGeometry.clone(), beamInnerMaterial); beamInner.userData.beamDensityScale = .77; beamInner.scale.set(.46, 1, .46); beamInner.castShadow = false; beamInner.receiveShadow = false; beam.add(beamInner);
    const beamPlaneGeometry = new THREE.BufferGeometry(); beamPlaneGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, .5, 0, -1, -.5, 0, 1, -.5, 0], 3)); beamPlaneGeometry.setIndex([0, 1, 2]); beamPlaneGeometry.computeVertexNormals();
    for (let planeIndex = 0; planeIndex < 6; planeIndex += 1) { const planeMaterial = volumetricBeamMaterial(configuredLight.color, .2); planeMaterial.uniforms["uDensity"]!.value = configuredLight.beamDensity * .22; planeMaterial.uniforms["uSoftness"]!.value = configuredLight.penumbra; const plane = mesh(beamPlaneGeometry.clone(), planeMaterial); plane.userData.beamDensityScale = .22; plane.rotation.y = planeIndex / 6 * Math.PI; plane.castShadow = false; plane.receiveShadow = false; beam.add(plane); }
    for (let hazeIndex = 0; hazeIndex < 3; hazeIndex += 1) { const hazeMaterial = volumetricBeamMaterial(configuredLight.color, .05); hazeMaterial.depthTest = false; hazeMaterial.uniforms["uDensity"]!.value = configuredLight.beamDensity * .045; hazeMaterial.uniforms["uSoftness"]!.value = configuredLight.penumbra; const haze = mesh(beamPlaneGeometry.clone(), hazeMaterial); haze.name = "custom-scene-beam-aerial-haze"; haze.userData.beamDensityScale = .045; haze.rotation.y = hazeIndex / 3 * Math.PI; haze.renderOrder = 4; haze.castShadow = false; haze.receiveShadow = false; beam.add(haze); }
    const initialBeamOrigin = new THREE.Vector3(...configuredLight.origin); const initialBeamDirection = new THREE.Vector3(...configuredLight.target).sub(initialBeamOrigin); const initialBeamLength = initialBeamDirection.length();
    if (initialBeamLength > .001) { initialBeamDirection.normalize(); beam.position.copy(initialBeamOrigin).addScaledVector(initialBeamDirection, initialBeamLength / 2); beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), initialBeamDirection); const initialBeamRadius = Math.min(Math.tan(THREE.MathUtils.degToRad(configuredLight.angleDegrees)) * initialBeamLength, initialBeamLength * 8); beam.scale.set(initialBeamRadius, initialBeamLength, initialBeamRadius); }
    beam.visible = configuredLight.enabled && configuredLight.beamVisible && configuredLight.beamDensity > 0 && initialBeamLength > .001; lightRig.add(beam);
    spot.visible = configuredLight.enabled; source.visible = configuredLight.enabled && configuredLight.sourceVisible; halo.visible = configuredLight.enabled && configuredLight.sourceVisible; scene.add(lightRig);
    customLightRig.current = lightRig; customSpotLight.current = spot; customLightSpill.current = spill; customLightTarget.current = spotTarget; customLightSource.current = source; customLightHalo.current = halo; customLightBeam.current = beam;

    const marbleGroup = new THREE.Group();
    const reflectionTarget = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const reflectionCamera = new THREE.CubeCamera(.08, 45, reflectionTarget); scene.add(reflectionCamera);
    const shellMaterial = new THREE.MeshPhysicalMaterial({ color: initialBall.current.color, emissive: initialBall.current.color, emissiveIntensity: .11, transmission: .97, thickness: 1.15, ior: 1.49, roughness: .018, metalness: 0, clearcoat: 1, clearcoatRoughness: .006, iridescence: .2, iridescenceIOR: 1.31, dispersion: .045, specularIntensity: 1, specularColor: "#ffffff", envMap: reflectionTarget.texture, envMapIntensity: 2.3, transparent: true, opacity: .9, attenuationColor: initialBall.current.color, attenuationDistance: 3.8 });
    const shell = mesh(new THREE.SphereGeometry(.42, 96, 72), shellMaterial);
    shell.renderOrder = 3;
    marbleGroup.add(shell);
    marbleShell.current = shell;
    const reflectionMap = softReflectionTexture();
    const studioHighlight = new THREE.Sprite(new THREE.SpriteMaterial({ map: reflectionMap, color: "#ffffff", transparent: true, opacity: .42, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    studioHighlight.name = "marble-studio-highlight"; studioHighlight.position.set(-.2, .2, .35); studioHighlight.scale.set(.095, .19, 1); studioHighlight.renderOrder = 6; marbleGroup.add(studioHighlight);
    const edgeHighlight = new THREE.Sprite(new THREE.SpriteMaterial({ map: reflectionMap, color: initialBall.current.color, transparent: true, opacity: .2, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    edgeHighlight.name = "marble-edge-highlight"; edgeHighlight.position.set(.25, -.16, .3); edgeHighlight.scale.set(.075, .13, 1); edgeHighlight.renderOrder = 6; marbleGroup.add(edgeHighlight);
    const fresnelRim = mesh(new THREE.SphereGeometry(.424, 72, 54), marbleFresnelMaterial(initialBall.current.color)); fresnelRim.name = "marble-fresnel-rim"; fresnelRim.castShadow = false; fresnelRim.receiveShadow = false; fresnelRim.renderOrder = 5; marbleGroup.add(fresnelRim);
    const coreMaterial = new THREE.MeshPhysicalMaterial({ color: initialBall.current.innerColor, emissive: initialBall.current.innerColor, emissiveIntensity: initialBall.current.emission, roughness: .18, metalness: .18, clearcoat: .85, clearcoatRoughness: .08, envMap: reflectionTarget.texture, envMapIntensity: 1.15 });
    const core = mesh(innerGeometry(initialBall.current.innerShape), coreMaterial);
    core.renderOrder = 1;
    marbleGroup.add(core);
    marbleCore.current = core;
    const imageMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 1, alphaTest: .025, side: THREE.DoubleSide, depthWrite: true, depthTest: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const imageInsert = mesh(embeddedCoverGeometry(), imageMaterial); imageInsert.name = "marble-embedded-cover"; imageInsert.position.z = -.025; imageInsert.renderOrder = 2; imageInsert.visible = false;
    const lensBodyMaterial = new THREE.MeshPhysicalMaterial({ color: initialBall.current.innerColor, emissive: initialBall.current.innerColor, emissiveIntensity: .12, roughness: .18, metalness: .04, clearcoat: 1, clearcoatRoughness: .035, transparent: true, opacity: .82, envMap: reflectionTarget.texture, envMapIntensity: 1.4 });
    lensBodyMaterial.name = "marble-cover-lens-body-material"; const lensBody = mesh(new RoundedBoxGeometry(.59, .59, .055, 8, .07), lensBodyMaterial); lensBody.name = "marble-cover-lens-body"; lensBody.position.z = -.055; lensBody.renderOrder = 1; imageInsert.add(lensBody);
    const lensGlow = new THREE.PointLight(initialBall.current.innerColor, 1.8, 1.8, 2); lensGlow.name = "marble-cover-inner-glow"; lensGlow.position.set(0, 0, -.12); imageInsert.add(lensGlow);
    marbleGroup.add(imageInsert); marbleImage.current = imageInsert;
    const shards = new THREE.Group();
    for (let index = 0; index < 26; index += 1) { const direction = new THREE.Vector3(Math.sin(index * 2.41), Math.cos(index * 1.73), Math.sin(index * .91)).normalize(); const size = .09 + index % 5 * .018; const shardGeometry = new THREE.BufferGeometry(); shardGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, size * 1.5, 0, -size, -size, size * .22, size * 1.15, -size * .72, -size * .16], 3)); shardGeometry.computeVertexNormals(); const shard = mesh(shardGeometry, new THREE.MeshPhysicalMaterial({ color: initialBall.current.color, transmission: .96, thickness: .08, roughness: .06, metalness: 0, clearcoat: 1, transparent: true, opacity: .78, side: THREE.DoubleSide })); shard.position.copy(direction).multiplyScalar(.32); shard.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction); shard.userData.shatterDirection = direction; shard.visible = false; shards.add(shard); } marbleGroup.add(shards); marbleShards.current = shards;
    for (let index = 0; index < 7; index += 1) {
      const bubble = mesh(new THREE.SphereGeometry(.018 + index * .002, 12, 8), new THREE.MeshPhysicalMaterial({ color: "#ffffff", transmission: 1, roughness: 0, transparent: true, opacity: .5 }));
      bubble.position.set(Math.sin(index * 2.3) * .23, Math.cos(index * 1.7) * .21, Math.sin(index * .9) * .2);
      marbleGroup.add(bubble);
    }
    marbleGroup.scale.setScalar(initialBall.current.radius / .42);
    marbleGroup.position.set(0, 2.25, .25);
    scene.add(marbleGroup);
    marble.current = marbleGroup;
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: configuredLight.color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, toneMapped: false }));
    glint.name = "marble-physical-glint"; glint.userData.lightGizmo = true; glint.renderOrder = 5; scene.add(glint); marbleGlint.current = glint;
    const caption = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.NormalBlending, toneMapped: false }));
    caption.name = "global-led-subtitle"; caption.position.set(0, 2.6, -8); caption.scale.set(7.2, 1.8, 1); caption.renderOrder = 100; caption.frustumCulled = false; activeCamera.add(caption); subtitleSprite.current = caption;
    const pixelCanvas = document.createElement("canvas"); pixelCanvas.width = 720; pixelCanvas.height = 1280;
    const pixelTexture = new THREE.CanvasTexture(pixelCanvas); pixelTexture.colorSpace = THREE.SRGBColorSpace; pixelTexture.minFilter = THREE.NearestFilter; pixelTexture.magFilter = THREE.NearestFilter;
    const pixelSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: pixelTexture, transparent: false, depthTest: false, depthWrite: false, toneMapped: false }));
    pixelSprite.name = "pixels-sub-full-frame"; pixelSprite.position.set(0, 0, -8); pixelSprite.renderOrder = 98; pixelSprite.frustumCulled = false; pixelSprite.visible = false; activeCamera.add(pixelSprite); pixelsSubCanvas.current = pixelCanvas; pixelsSubSprite.current = pixelSprite;
    // ProSubtitles is already a high-resolution RGBA canvas. Display it
    // directly above WebGL instead of converting it to a CanvasTexture first:
    // that extra GPU upload could leave the preview/export with a transparent
    // texture on some drivers even though the text canvas contained pixels.
    const kineticCanvas = document.createElement("canvas");
    kineticCanvas.width = 720;
    kineticCanvas.height = 1280;
    kineticCanvas.className = "pro-subtitles-canvas-layer";
    kineticCanvas.style.display = "none";
    kineticCanvas.setAttribute("aria-hidden", "true");
    element.append(kineticCanvas);
    proSubtitleCanvas.current = kineticCanvas;

    const groupMap = objectGroups.current;
    if (initialAnimationModeId.current === "instrumentalFalling") for (const object of initialObjects.current) {
      const group = createObject(object);
      group.position.set(...object.position);
      group.rotation.set(...object.rotation);
      group.scale.set(...object.scale);
      scene.add(group);
      groupMap.set(object.id, group);
    }
    const railGroup = initialAnimationModeId.current === "instrumentalFalling" ? createRails(initialObjects.current, initialRailColors.current, initialBall.current.radius, initialMotionKinds.current, initialActiveObjectIndex.current) : new THREE.Group();
    scene.add(railGroup);
    rails.current = railGroup;
    const initialNeonSigns = ["coverSphere", "stereoUnfold", "walkingCube", "pixelArt", "teddyWalk", "teddySing", "addSubtitles", "proSubtitles", "pixelsSub"].includes(initialAnimationModeId.current) ? new THREE.Group() : createNeonSigns(initialObjects.current, initialBackground.current.neon, initialActiveObjectIndex.current); scene.add(initialNeonSigns); neonSigns.current = initialNeonSigns;

    const lowest = initialObjects.current.at(-1)?.position[1] ?? -12;
    const starPositions = new Float32Array(Math.min(900, Math.max(240, initialObjects.current.length * 8)) * 3);
    for (let index = 0; index < starPositions.length / 3; index += 1) {
      starPositions[index * 3] = Math.sin(index * 12.9898) * 6.5;
      starPositions[index * 3 + 1] = 5 - index / (starPositions.length / 3) * (8 - lowest);
      starPositions[index * 3 + 2] = -2.5 - Math.abs(Math.cos(index * 4.173)) * 3;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const starField = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: "#8197c6", size: .025, transparent: true, opacity: .55, sizeAttenuation: true })); starField.visible = initialAnimationModeId.current !== "addSubtitles" && initialAnimationModeId.current !== "proSubtitles" && initialAnimationModeId.current !== "pixelsSub" && initialAnimationModeId.current !== "pixelArt" && initialAnimationModeId.current !== "walkingCube" && initialBackground.current.effects.particles; scene.add(starField); stars.current = starField;

    const resize = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      activeRenderer.setSize(width, height, false);
      activeCamera.aspect = width / Math.max(1, height);
      activeCamera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    let reflectionFrame = 0;
    // A local cubemap captures the actual route lights and neon sprites, including
    // signs behind the marble, instead of faking their colors with a static tint.
    const updateMarbleReflections = (force: boolean) => {
      if (initialAnimationModeId.current === "stereoUnfold" || initialAnimationModeId.current === "walkingCube" || initialAnimationModeId.current === "pixelArt" || initialAnimationModeId.current === "teddyWalk" || initialAnimationModeId.current === "teddySing" || initialAnimationModeId.current === "addSubtitles" || initialAnimationModeId.current === "proSubtitles" || initialAnimationModeId.current === "pixelsSub") return;
      reflectionFrame += 1;
      if (!force && reflectionFrame % 7 !== 0) return;
      reflectionCamera.position.copy(marbleGroup.position);
      const marbleWasVisible = marbleGroup.visible; const glintWasVisible = glint.visible; const toneMapping = activeRenderer.toneMapping;
      try { marbleGroup.visible = false; glint.visible = false; activeRenderer.toneMapping = THREE.NoToneMapping; reflectionCamera.update(activeRenderer, scene); }
      finally { activeRenderer.toneMapping = toneMapping; marbleGroup.visible = marbleWasVisible; glint.visible = glintWasVisible; }
    };
    const updateLightForFrame = () => {
      const lightSettings = sceneLightRef.current; const resolved = resolveSceneLightFrame(lightSettings, [marbleGroup.position.x, marbleGroup.position.y, marbleGroup.position.z], timeSecondsRef.current); const origin = new THREE.Vector3(...resolved.origin); const targetPosition = new THREE.Vector3(...resolved.target); const beamEnd = new THREE.Vector3(...resolved.beamEnd);
      spot.visible = resolved.active; spill.visible = resolved.active; source.visible = resolved.active && lightSettings.sourceVisible; halo.visible = resolved.active && lightSettings.sourceVisible; beam.visible = resolved.active && lightSettings.beamVisible && lightSettings.beamDensity > 0;
      spot.position.copy(origin); spill.position.copy(origin); source.position.copy(origin); halo.position.copy(origin); spotTarget.position.copy(targetPosition); spotTarget.updateMatrixWorld(true); spot.target = spotTarget; spot.updateMatrixWorld(true);
      const beamDirection = beamEnd.sub(origin); const beamLength = beamDirection.length();
      if (beamLength > .001) { beamDirection.normalize(); beam.position.copy(origin).addScaledVector(beamDirection, beamLength / 2); beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), beamDirection); const beamRadius = Math.min(Math.tan(THREE.MathUtils.degToRad(lightSettings.angleDegrees)) * beamLength, beamLength * 8); beam.scale.set(beamRadius, beamLength, beamRadius); } else beam.visible = false;
    };
    const updatePhysicalGlint = () => {
      const lightSettings = sceneLightRef.current; const glintMaterial = glint.material as THREE.SpriteMaterial;
      if (spot.visible && marbleGroup.visible) {
        const origin = spot.position.clone(); const targetPosition = spotTarget.position.clone(); const toMarble = marbleGroup.position.clone().sub(origin); const lightDistance = toMarble.length(); const spotDirection = targetPosition.sub(origin).normalize(); const marbleDirection = toMarble.clone().normalize(); const angleCosine = spotDirection.dot(marbleDirection); const outerCosine = Math.cos(THREE.MathUtils.degToRad(lightSettings.angleDegrees)); const innerCosine = Math.cos(THREE.MathUtils.degToRad(lightSettings.angleDegrees * Math.max(.05, 1 - lightSettings.penumbra))); const coneFactor = THREE.MathUtils.smoothstep(angleCosine, outerCosine, Math.max(outerCosine + .0001, innerCosine)); const rangeFactor = lightSettings.distance <= 0 ? 1 : THREE.MathUtils.clamp(1 - lightDistance / lightSettings.distance, 0, 1); const decayFactor = 1 / (1 + Math.pow(lightDistance / 12, Math.max(0, lightSettings.decay))); const brightness = THREE.MathUtils.clamp(lightSettings.intensity / 32 * rangeFactor * decayFactor * coneFactor * lightSettings.reflectionBoost, 0, 2.4);
        const lightVector = spot.position.clone().sub(marbleGroup.position).normalize(); const viewVector = activeCamera.position.clone().sub(marbleGroup.position).normalize(); const highlightNormal = lightVector.add(viewVector).normalize(); const marbleRadius = ballAppearanceRef.current.radius; glint.position.copy(marbleGroup.position).addScaledVector(highlightNormal, marbleRadius * .97); glint.scale.setScalar(marbleRadius * (.14 + brightness * .11)); glintMaterial.color.set(lightSettings.color); glintMaterial.opacity = Math.min(.92, brightness * .66); glint.visible = brightness > .025;
      } else { glint.visible = false; glintMaterial.opacity = 0; }
    };
    const renderScene = (forceReflection = false) => {
      updateLightForFrame(); updatePhysicalGlint(); updateMarbleReflections(forceReflection);
      activeRenderer.render(scene, activeCamera);
    };
    let exportRendering = false;
    onRendererReady({ canvas: activeRenderer.domElement, setExportSize: (width, height) => { exportRendering = true; activeRenderer.setPixelRatio(1); activeRenderer.setSize(width, height, false); activeCamera.aspect = width / Math.max(1, height); activeCamera.updateProjectionMatrix(); }, restorePreviewSize: () => { exportRendering = false; activeRenderer.setPixelRatio(previewPixelRatio); resize(); }, renderNow: () => renderScene(true) });
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const click = (event: PointerEvent) => {
      const bounds = activeRenderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
      raycaster.setFromCamera(pointer, activeCamera);
      const pickMode = useSceneStore.getState().lightPickMode;
      if (pickMode) {
        const belongsToLightGizmo = (object: THREE.Object3D) => { let current: THREE.Object3D | null = object; while (current) { if (current.userData.lightGizmo) return true; current = current.parent; } return false; };
        const surfaceHit = raycaster.intersectObjects(scene.children, true).find((intersection) => intersection.object.visible && !belongsToLightGizmo(intersection.object));
        const point = surfaceHit?.point.clone() ?? raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(activeCamera.getWorldDirection(new THREE.Vector3()), smoothCameraTarget.current), new THREE.Vector3());
        if (point) {
          const selectedPoint: [number, number, number] = [Number(point.x.toFixed(3)), Number(point.y.toFixed(3)), Number(point.z.toFixed(3))];
          useSceneStore.getState().updateLight({ [pickMode]: selectedPoint });
          useSceneStore.getState().setLightPickMode(null);
        }
        event.preventDefault(); event.stopPropagation(); return;
      }
      const candidates = [...groupMap.values()].flatMap((group) => group.children);
      const hit = raycaster.intersectObjects(candidates, true)[0];
      onSelectObject(typeof hit?.object.userData.objectId === "string" ? hit.object.userData.objectId : null);
    };
    activeRenderer.domElement.addEventListener("pointerdown", click);
    let frame = 0; const renderClock = new THREE.Clock();
    const render = () => {
      const delta = Math.min(.05, renderClock.getDelta()); const positionDamping = 1 - Math.exp(-5.8 * delta); const targetDamping = 1 - Math.exp(-7.2 * delta);
      if (initialAnimationModeId.current === "walkingCube") { activeCamera.position.copy(desiredCameraPosition.current); smoothCameraTarget.current.copy(desiredCameraTarget.current); }
      else { activeCamera.position.lerp(desiredCameraPosition.current, positionDamping); smoothCameraTarget.current.lerp(desiredCameraTarget.current, targetDamping); }
      activeCamera.lookAt(smoothCameraTarget.current);
      if (!exportRendering) renderScene();
      frame = requestAnimationFrame(render);
    };
    render();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      activeRenderer.domElement.removeEventListener("pointerdown", click);
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Points || child instanceof THREE.Sprite) {
          if (child instanceof THREE.Mesh || child instanceof THREE.Points) child.geometry.dispose();
          const materials = Array.isArray(child.material) ? child.material : [child.material]; materials.forEach(disposeMaterial);
        }
      });
      pmrem.dispose();
      reflectionTarget.dispose();
      activeRenderer.dispose();
      activeRenderer.domElement.remove();
      onRendererReady(null);
      groupMap.clear();
      marble.current = null;
      marbleShell.current = null;
      marbleCore.current = null;
      marbleImage.current = null;
      marbleShards.current = null;
      marbleImageSource.current = null;
      rails.current = null;
      neonSigns.current = null;
      newYorkEnvironment.current = null;
      secondaryMarbles.current = null;
      stars.current = null;
      customLightRig.current = null;
      customSpotLight.current = null;
      customLightSpill.current = null;
      customLightTarget.current = null;
      customLightSource.current = null;
      customLightHalo.current = null;
      customLightBeam.current = null;
      marbleGlint.current = null;
      subtitleSprite.current = null;
      proSubtitleCanvas.current = null;
      pixelsSubCanvas.current = null;
      pixelsSubSprite.current = null;
      pixelTexture.dispose();
      kineticCanvas.remove();
      camera.current = null;
      sceneRef.current = null;
    };
  }, [onRendererReady, onSelectObject]);

  useEffect(() => {
    let active = true;
    void document.fonts.load(`${subtitleFontWeight(subtitles.fontFamily)} 64px "${subtitles.fontFamily}"`).then(() => {
      if (active) setSubtitleFontRevision((revision) => revision + 1);
    });
    return () => { active = false; };
  }, [subtitles.fontFamily]);

  useEffect(() => {
    if (animationModeId !== "proSubtitles") return;
    let active = true; const families = new Set([proSubtitlesSettings.defaultFontFamily, ...proSubtitlesSettings.cueStyles.map((style) => style.fontFamily)]);
    void Promise.all([...families].map((family) => document.fonts.load(`${subtitleFontWeight(family)} 64px "${family}"`))).then(() => { if (active) setSubtitleFontRevision((revision) => revision + 1); });
    return () => { active = false; };
  }, [animationModeId, proSubtitlesSettings.cueStyles, proSubtitlesSettings.defaultFontFamily]);

  useEffect(() => {
    if (animationModeId !== "pixelsSub") return;
    let active = true;
    void document.fonts.load(`${pixelsSubFontWeight(pixelsSubSettings.subtitleFontFamily)} 64px "${pixelsSubSettings.subtitleFontFamily}"`).then(() => {
      if (!active) return;
      clearPixelsSubTextLayoutCache();
      setSubtitleFontRevision((revision) => revision + 1);
    });
    return () => { active = false; };
  }, [animationModeId, pixelsSubSettings.subtitleFontFamily]);

  useLayoutEffect(() => {
    const sprite = subtitleSprite.current; if (!sprite || !(sprite.material instanceof THREE.SpriteMaterial)) return;
    if (animationModeId === "proSubtitles" || animationModeId === "pixelsSub") { sprite.visible = false; sprite.material.opacity = 0; return; }
    const cue = subtitles.enabled ? subtitles.cues.find((item) => timeSeconds >= item.startSeconds && timeSeconds <= item.endSeconds) : undefined;
    if (!cue) { sprite.visible = false; sprite.material.opacity = 0; return; }
    const textureKey = `${cue.id}:${cue.text}:${subtitles.fontFamily}:${subtitles.fontSize}:${subtitles.color}:${subtitles.glowColor}:${subtitleFontRevision}`;
    if (sprite.userData.textureKey !== textureKey) { sprite.material.map?.dispose(); sprite.material.map = ledSubtitleTexture(cue.text, subtitles.fontFamily, subtitles.fontSize, subtitles.color, subtitles.glowColor); sprite.material.needsUpdate = true; sprite.userData.textureKey = textureKey; }
    const progress = THREE.MathUtils.clamp((timeSeconds - cue.startSeconds) / Math.max(.08, cue.endSeconds - cue.startSeconds), 0, 1);
    const activeCamera = camera.current;
    const layout = calculateSubtitleLayout({
      verticalFovDegrees: activeCamera?.fov ?? (aspectRatio === "16:9" ? 39 : 43),
      viewportAspect: activeCamera?.aspect ?? (aspectRatio === "16:9" ? 16 / 9 : 9 / 16),
      distance: Math.abs(sprite.position.z)
    });
    const pose = resolveSubtitleAnimation(subtitles.animation, progress, layout, subtitles.fallSpeed);
    sprite.position.set(pose.x, pose.y, -8); sprite.scale.set(layout.width * pose.scale, layout.height * pose.scale, 1);
    sprite.material.opacity = pose.opacity; sprite.visible = true;
  }, [animationModeId, aspectRatio, subtitleFontRevision, subtitles, timeSeconds]);

  useLayoutEffect(() => {
    const canvas = proSubtitleCanvas.current;
    if (!canvas) return;
    if (animationModeId !== "proSubtitles") { canvas.style.display = "none"; return; }
    const rendererCanvas = host.current?.querySelector("canvas"); const width = Math.max(1, rendererCanvas?.width ?? (aspectRatio === "16:9" ? 1920 : 1080)); const height = Math.max(1, rendererCanvas?.height ?? (aspectRatio === "16:9" ? 1080 : 1920));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const composition = renderProSubtitleCompositionFrame(canvas, subtitles.cues, proSubtitlesSettings, { timeSeconds, width, height, clear: true });
    canvas.style.display = composition.activeCueIds.length ? "block" : "none";
  }, [animationModeId, aspectRatio, proSubtitlesSettings, subtitleFontRevision, subtitles, timeSeconds]);

  useLayoutEffect(() => {
    const canvas = pixelsSubCanvas.current; const sprite = pixelsSubSprite.current; const activeCamera = camera.current;
    if (!canvas || !sprite || !activeCamera) return;
    if (animationModeId !== "pixelsSub") { sprite.visible = false; return; }
    const rendererCanvas = host.current?.querySelector("canvas");
    const width = Math.max(1, rendererCanvas?.width ?? (aspectRatio === "16:9" ? 1920 : 1080));
    const height = Math.max(1, rendererCanvas?.height ?? (aspectRatio === "16:9" ? 1080 : 1920));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    renderPixelsSubFrame(canvas, { timeSeconds, audioPulse, rhythmPulse, spectrumBands, rhythmHits: pixelsSubRhythmHits, image: pixelsSubImage, cues: subtitles.enabled ? subtitles.cues : [], settings: pixelsSubSettings });
    const distance = Math.abs(sprite.position.z); const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(activeCamera.fov) / 2) * distance;
    sprite.scale.set(viewHeight * activeCamera.aspect, viewHeight, 1); sprite.visible = true;
    if (sprite.material.map) sprite.material.map.needsUpdate = true;
  }, [animationModeId, aspectRatio, audioPulse, pixelsSubImage, pixelsSubRhythmHits, pixelsSubSettings, rhythmPulse, spectrumBands, subtitleFontRevision, subtitles, timeSeconds]);

  useLayoutEffect(() => {
    const spot = customSpotLight.current; const spill = customLightSpill.current; const target = customLightTarget.current; const source = customLightSource.current; const halo = customLightHalo.current; const beam = customLightBeam.current;
    if (!spot || !spill || !target || !source || !halo || !beam) return;
    spot.visible = sceneLight.enabled; spot.color.set(sceneLight.color); spot.intensity = sceneLight.intensity * 24; spot.distance = sceneLight.distance; spot.angle = THREE.MathUtils.degToRad(sceneLight.angleDegrees); spot.penumbra = sceneLight.penumbra; spot.decay = sceneLight.decay; spot.castShadow = sceneLight.enabled && sceneLight.castShadow; spot.position.set(...sceneLight.origin);
    spill.visible = sceneLight.enabled; spill.color.set(sceneLight.color); spill.intensity = sceneLight.intensity * 1.8; spill.distance = sceneLight.distance > 0 ? sceneLight.distance * .58 : 0; spill.decay = Math.max(1.5, sceneLight.decay); spill.position.set(...sceneLight.origin);
    spot.shadow.camera.far = sceneLight.distance > 0 ? Math.max(2, sceneLight.distance) : 350; spot.shadow.camera.updateProjectionMatrix();
    target.position.set(...sceneLight.target); target.updateMatrixWorld(true); spot.target = target; spot.updateMatrixWorld(true);
    source.position.set(...sceneLight.origin); source.scale.setScalar(sceneLight.sourceRadius); source.visible = sceneLight.enabled && sceneLight.sourceVisible; source.castShadow = false; source.receiveShadow = false;
    const sourceMaterial = source.material as THREE.MeshPhysicalMaterial; sourceMaterial.color.set(sceneLight.color); sourceMaterial.emissive.set(sceneLight.color); sourceMaterial.emissiveIntensity = 5 + Math.min(15, sceneLight.intensity * .16);
    halo.position.set(...sceneLight.origin); halo.scale.setScalar(sceneLight.sourceRadius * (5.5 + Math.min(5, sceneLight.intensity / 24))); halo.visible = sceneLight.enabled && sceneLight.sourceVisible; const haloMaterial = halo.material as THREE.SpriteMaterial; haloMaterial.color.set(sceneLight.color); haloMaterial.opacity = Math.min(.9, .35 + sceneLight.intensity / 120);
    const beamOrigin = new THREE.Vector3(...sceneLight.origin); const beamDirection = new THREE.Vector3(...sceneLight.target).sub(beamOrigin); const beamLength = beamDirection.length();
    if (beamLength > .001) { beamDirection.normalize(); beam.position.copy(beamOrigin).addScaledVector(beamDirection, beamLength / 2); beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), beamDirection); const beamRadius = Math.min(Math.tan(THREE.MathUtils.degToRad(sceneLight.angleDegrees)) * beamLength, beamLength * 8); beam.scale.set(beamRadius, beamLength, beamRadius); }
    beam.visible = sceneLight.enabled && sceneLight.beamVisible && sceneLight.beamDensity > 0 && beamLength > .001;
    beam.children.forEach((child) => { if (!(child instanceof THREE.Mesh) || !(child.material instanceof THREE.ShaderMaterial)) return; child.material.uniforms["uColor"]!.value.set(sceneLight.color); child.material.uniforms["uDensity"]!.value = sceneLight.beamDensity * Number(child.userData.beamDensityScale ?? .22); child.material.uniforms["uSoftness"]!.value = sceneLight.penumbra; });
    const shellMaterial = marbleShell.current?.material as THREE.MeshPhysicalMaterial | undefined; if (shellMaterial) { shellMaterial.envMapIntensity = 1.85 * (sceneLight.enabled ? Math.max(1, sceneLight.reflectionBoost) : 1); shellMaterial.specularIntensity = 1; shellMaterial.emissiveIntensity = sceneLight.enabled ? .1 + Math.min(.12, sceneLight.reflectionBoost * .04) : .06; }
    const coreMaterial = marbleCore.current?.material as THREE.MeshPhysicalMaterial | undefined; if (coreMaterial) coreMaterial.envMapIntensity = 1.15 * (sceneLight.enabled ? Math.max(1, Math.min(2.4, sceneLight.reflectionBoost)) : 1);
  }, [sceneLight]);

  useLayoutEffect(() => {
    const scene = sceneRef.current; if (!scene) return; const activeIds = new Set(objects.map((object) => object.id));
    if (animationModeId !== "instrumentalFalling") { for (const [id, group] of objectGroups.current) { scene.remove(group); disposeGroup(group); objectGroups.current.delete(id); } return; }
    for (const [id, staleGroup] of objectGroups.current) { if (activeIds.has(id)) continue; scene.remove(staleGroup); disposeGroup(staleGroup); objectGroups.current.delete(id); }
    for (const object of objects) {
      let group = objectGroups.current.get(object.id);
      if (!group || group.userData.objectType !== object.type) { if (group) { scene.remove(group); disposeGroup(group); } group = createObject(object); scene.add(group); objectGroups.current.set(object.id, group); }
      group.visible = true;
      group.position.set(...object.position);
      group.rotation.set(...object.rotation);
      group.scale.set(...object.scale);
      group.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || !child.material.userData.tintable) return;
        const item = child.material as TintableMaterial;
        item.color.set(object.color);
        item.emissive.set(object.color);
        item.roughness = Math.max(object.roughness, Number(item.userData.roughnessFloor ?? 0));
        item.metalness = Math.max(object.metalness, Number(item.userData.metalnessFloor ?? 0));
        item.emissiveIntensity = selectedId === object.id ? .32 : .045;
      });
    }
  }, [animationModeId, objects, selectedId]);

  useLayoutEffect(() => {
    for (const [index, object] of objects.entries()) {
      const group = objectGroups.current.get(object.id); if (!group) continue; group.position.set(...object.position); group.rotation.set(...object.rotation); group.scale.set(...object.scale);
      const head = group.getObjectByName("drum-impact-head"); if (head) head.scale.set(1, 1, 1);
      const cymbalSurface = group.getObjectByName("cymbal-impact-surface"); if (cymbalSurface) { cymbalSurface.position.set(0, 0, 0); cymbalSurface.rotation.set(0, 0, 0); }
      const impact = impactResponses[index]; if (!impact) continue; const pose = instrumentImpactPose(object.type, timeSeconds - impact.timeSeconds, impact.strength);
      if (object.type === "kick" || object.type === "snare" || object.type === "drum") { group.position.y += pose.offsetY; group.rotation.x += pose.rotationX; group.rotation.z += pose.rotationZ; if (head) head.scale.set(1 + pose.headCompression * .18, 1 - pose.headCompression, 1 + pose.headCompression * .18); }
      else if (object.type === "cymbal" && cymbalSurface) { cymbalSurface.position.y = pose.offsetY; cymbalSurface.rotation.x = pose.rotationX; cymbalSurface.rotation.z = pose.rotationZ * (object.position[0] >= 0 ? 1 : -1); }
    }
  }, [impactResponses, objects, timeSeconds]);

  useEffect(() => {
    if (!sceneRef.current) return;
    if (rails.current) { sceneRef.current.remove(rails.current); disposeGroup(rails.current); }
    const nextRails = animationModeId === "instrumentalFalling" ? createRails(objects, railColors, ballAppearance.radius, motionKinds, activeObjectIndex) : new THREE.Group(); sceneRef.current.add(nextRails); rails.current = nextRails;
  }, [activeObjectIndex, animationModeId, ballAppearance.radius, motionKinds, objects, railColors]);

  useEffect(() => {
    const scene = sceneRef.current; if (!scene) return; if (newYorkEnvironment.current) { scene.remove(newYorkEnvironment.current); disposeGroup(newYorkEnvironment.current); newYorkEnvironment.current = null; }
    if (animationModeId !== "newYorkStreets") return; const environment = createNewYorkEnvironment(objects, newYorkSettings.flyerImageUrls); environment.traverse((child) => { if (child.name === "new-york-local-light") child.visible = Math.abs(Number(child.userData.routeIndex) - activeObjectIndexRef.current) <= 5; }); scene.add(environment); newYorkEnvironment.current = environment;
  }, [animationModeId, newYorkSettings.flyerImageUrls, objects]);

  useEffect(() => { newYorkEnvironment.current?.traverse((child) => { if (child.name === "new-york-local-light") child.visible = Math.abs(Number(child.userData.routeIndex) - activeObjectIndex) <= 5; }); }, [activeObjectIndex]);

  useLayoutEffect(() => {
    const texture = newYorkEnvironment.current?.userData.waterTexture as THREE.Texture | undefined; if (!texture) return; texture.offset.set(Math.sin(timeSeconds * .37) * .025, -timeSeconds * .34);
  }, [timeSeconds]);

  useEffect(() => {
    const scene = sceneRef.current; if (!scene) return; if (secondaryMarbles.current) { scene.remove(secondaryMarbles.current); disposeGroup(secondaryMarbles.current); secondaryMarbles.current = null; }
    if (animationModeId !== "newYorkStreets") return; const swarm = createSecondaryMarbles(newYorkSettings, ballAppearance.radius); scene.add(swarm); secondaryMarbles.current = swarm;
  }, [animationModeId, ballAppearance.radius, newYorkSettings]);

  useLayoutEffect(() => {
    const scene = sceneRef.current; if (!scene) return; if (coverVisualizer.current) { scene.remove(coverVisualizer.current); disposeGroup(coverVisualizer.current); coverVisualizer.current = null; }
    if (animationModeId !== "coverSphere") return; const visualizer = createCoverVisualizer(coverSphereSettings); scene.add(visualizer); coverVisualizer.current = visualizer;
  }, [animationModeId, coverSphereSettings]);

  useLayoutEffect(() => {
    const scene = sceneRef.current; if (!scene) return;
    if (stereoUnfoldScene.current) { stereoUnfoldScene.current.userData.disposed = true; scene.remove(stereoUnfoldScene.current); disposeGroup(stereoUnfoldScene.current); stereoUnfoldScene.current = null; }
    if (animationModeId !== "stereoUnfold") return;
    const unfoldScene = createStereoUnfoldScene(stereoUnfoldSettings); scene.add(unfoldScene); stereoUnfoldScene.current = unfoldScene;
  }, [animationModeId, stereoUnfoldSettings]);

  useLayoutEffect(() => {
    const scene = sceneRef.current; if (!scene) return;
    if (walkingCubeScene.current) { scene.remove(walkingCubeScene.current); disposeGroup(walkingCubeScene.current); walkingCubeScene.current = null; }
    if (animationModeId !== "walkingCube") return;
    const cubeScene = createWalkingCubeScene(effectiveWalkingCubeSettings, aspectRatio, walkingCubeExternalBackdrop); scene.add(cubeScene); walkingCubeScene.current = cubeScene;
  }, [animationModeId, aspectRatio, effectiveWalkingCubeSettings, walkingCubeExternalBackdrop]);

  useLayoutEffect(() => {
    const cubeScene = walkingCubeScene.current; if (!cubeScene || animationModeId !== "walkingCube") return;
    updateWalkingCubeScene(cubeScene, { pose: walkingCubeMotion(timeSeconds), audioPulse, rhythmPulse, spectrumBands, stereoLeftBands, stereoRightBands, stereoWidth });
  }, [animationModeId, audioPulse, rhythmPulse, spectrumBands, stereoLeftBands, stereoRightBands, stereoWidth, timeSeconds, walkingCubeMotion]);

  useLayoutEffect(() => {
    const scene = sceneRef.current; if (!scene) return;
    if (pixelArtScene.current) { scene.remove(pixelArtScene.current); disposeGroup(pixelArtScene.current); pixelArtScene.current = null; }
    if (animationModeId !== "pixelArt") return;
    const nextScene = createPixelArtNewYorkScene(pixelArtSettings, aspectRatio); scene.add(nextScene); pixelArtScene.current = nextScene;
  }, [animationModeId, aspectRatio, pixelArtSettings]);

  useLayoutEffect(() => {
    const scene = pixelArtScene.current; if (!scene || animationModeId !== "pixelArt") return;
    updatePixelArtNewYorkScene(scene, { timeSeconds, durationSeconds, rhythmPulse, audioPulse, bpm: globalBpm, spectrumBands, stereoLeftBands, stereoRightBands, stereoWidth });
  }, [animationModeId, audioPulse, durationSeconds, globalBpm, rhythmPulse, spectrumBands, stereoLeftBands, stereoRightBands, stereoWidth, timeSeconds]);

  useLayoutEffect(() => {
    const visualizer = coverVisualizer.current;
    if (!visualizer || animationModeId !== "coverSphere") return;
    applyCoverVisualizerPalette(visualizer, coverSphereSettings.spectrumColor, coverSphereSettings.effectColor);
  }, [animationModeId, coverSphereSettings.effectColor, coverSphereSettings.spectrumColor]);

  useLayoutEffect(() => {
    const scene = sceneRef.current; if (!scene) return; if (teddyWalkScene.current) { scene.remove(teddyWalkScene.current); disposeGroup(teddyWalkScene.current); teddyWalkScene.current = null; }
    if (animationModeId !== "teddyWalk") return; const teddyScene = createTeddyWalk(teddyWalkSettings); scene.add(teddyScene); teddyWalkScene.current = teddyScene;
  }, [animationModeId, teddyWalkSettings]);

  useLayoutEffect(() => {
    const scene = sceneRef.current; if (!scene) return; if (teddySingScene.current) { scene.remove(teddySingScene.current); disposeGroup(teddySingScene.current); teddySingScene.current = null; }
    if (animationModeId !== "teddySing") return; const singerScene = createTeddySing(teddySingSettings); scene.add(singerScene); teddySingScene.current = singerScene;
  }, [animationModeId, teddySingSettings]);

  useLayoutEffect(() => {
    const visualizer = coverVisualizer.current; if (!visualizer || animationModeId !== "coverSphere") return;
    visualizer.traverse((child) => {
      if (child.name === "cover-spectrum-band" && child instanceof THREE.Mesh) { const index = Number(child.userData.bandIndex); const value = Math.max(.025, spectrumBands[index] ?? 0); const height = .12 + Math.pow(value, .64) * 2.08; child.scale.y = height; child.position.y = -2.72 + height / 2; const item = child.material as THREE.MeshPhysicalMaterial; item.emissiveIntensity = 2.1 + value * 5.2; }
      else if (child.name === "cover-spectrum-glow" && child instanceof THREE.Sprite) (child.material as THREE.SpriteMaterial).opacity = .24 + audioPulse * .28;
      else if (child.name === "cover-key-light" && child instanceof THREE.PointLight) child.intensity = 18 + audioPulse * 12;
      else if (child.name === "cover-rim-light" && child instanceof THREE.PointLight) child.intensity = 22 + audioPulse * 15;
      else if (child.name === "cover-smoke" && child instanceof THREE.Sprite) { const index = Number(child.userData.effectIndex); child.position.x = Math.sin(index * 2.3 + timeSeconds * (.13 + index % 3 * .025)) * 3.4; child.position.y = -1.8 + (index % 4) * 1.3 + Math.sin(timeSeconds * .2 + index) * .32; (child.material as THREE.SpriteMaterial).opacity = .045 + audioPulse * .055; }
      else if (child.name === "cover-particles") child.rotation.z = timeSeconds * .035;
      else if (child.name === "cover-rain" && child instanceof THREE.LineSegments) { const positions = child.geometry.getAttribute("position") as THREE.BufferAttribute; const seeds = child.userData.seeds as { x: number; z: number; phase: number; speed: number; length: number; drift: number }[]; for (const [index, seed] of seeds.entries()) { const travel = (seed.phase + timeSeconds * seed.speed) % 8; const y = 4 - travel; const x = seed.x + Math.sin(timeSeconds * 1.4 + index) * seed.drift; const offset = index * 2; positions.setXYZ(offset, x, y, seed.z); positions.setXYZ(offset + 1, x + .08, y - seed.length, seed.z); } positions.needsUpdate = true; }
      else if (child.name === "cover-leaf") { const index = Number(child.userData.effectIndex); const x = ((timeSeconds * (.72 + index % 5 * .065) + index * .61) % 10.8) - 5.4; const y = 3.8 - ((timeSeconds * (.34 + index % 4 * .045) + index * .83) % 7.6) + Math.sin(timeSeconds * 1.1 + index) * .28; child.position.set(x, y, .25 + Math.sin(index * 1.9) * .85); child.rotation.set(timeSeconds * (.7 + index % 3 * .16) + index, timeSeconds * .54 + index * .7, Math.sin(timeSeconds * .9 + index) * 1.2); }
      else if (child.name === "cover-flyer") { const index = Number(child.userData.effectIndex); child.position.set(((timeSeconds * (.34 + index * .035) + index * 1.8) % 9) - 4.5, Math.sin(timeSeconds * .55 + index * 2.1) * 3.1, .5); child.rotation.set(Math.sin(timeSeconds + index) * .55, timeSeconds * .28 + index, Math.cos(timeSeconds * .7 + index) * .8); }
    });
  }, [animationModeId, audioPulse, spectrumBands, timeSeconds]);

  useLayoutEffect(() => {
    const unfoldScene = stereoUnfoldScene.current; if (!unfoldScene || animationModeId !== "stereoUnfold") return;
    const motion = resolveStereoUnfoldMotion(timeSeconds, stereoUnfoldSettings.unfoldDuration);
    const coverRig = unfoldScene.getObjectByName("stereo-unfold-cover-rig"); const cover = unfoldScene.getObjectByName("stereo-unfold-cover") as THREE.Mesh | undefined;
    if (coverRig) { coverRig.position.set(0, motion.coverY + audioPulse * .025, .28); coverRig.rotation.set(motion.rotationX, motion.rotationY, motion.rotationZ); }
    if (cover) {
      const position = cover.geometry.getAttribute("position") as THREE.BufferAttribute; const base = cover.geometry.userData.basePositions as Float32Array;
      for (let index = 0; index < position.count; index += 1) { const vertex = deformStereoCoverVertex(base[index * 3] ?? 0, base[index * 3 + 1] ?? 0, motion.unfold, stereoUnfoldSettings.residualCrease, audioPulse); position.setXYZ(index, vertex.x, vertex.y, vertex.z); }
      position.needsUpdate = true; cover.geometry.computeVertexNormals();
      const normals = cover.geometry.getAttribute("normal") as THREE.BufferAttribute; const colors = cover.geometry.getAttribute("color") as THREE.BufferAttribute;
      for (let index = 0; index < position.count; index += 1) {
        const facing = Math.abs(normals.getZ(index)); const sideSlope = Math.abs(normals.getX(index)) * .22 + Math.abs(normals.getY(index)) * .12; const creaseDepth = Math.min(.11, Math.abs(position.getZ(index)) * .12);
        const shade = THREE.MathUtils.clamp(.75 + facing * .25 - sideSlope - creaseDepth, .62, 1); colors.setXYZ(index, shade, shade, shade);
      }
      colors.needsUpdate = true;
    }
    const coverEdge = Number(unfoldScene.userData.coverHalfWidth ?? 2.275);
    unfoldScene.traverse((child) => {
      if (child.name === "stereo-unfold-band" && child instanceof THREE.Mesh && child.material instanceof THREE.MeshPhysicalMaterial) {
        const side = Number(child.userData.side); const bandIndex = Number(child.userData.bandIndex); const source = side < 0 ? stereoLeftBands : stereoRightBands; const value = Math.max(.01, ((source[bandIndex] ?? 0) + (source[bandIndex + 1] ?? 0)) * .5);
        const shaped = Math.pow(value, .62) * stereoUnfoldSettings.spectrumIntensity; const length = .34 + shaped * (2.05 + stereoWidth * stereoUnfoldSettings.stereoDepth * .9); const baseY = Number(child.userData.baseY);
        const bandHeight = stereoUnfoldSettings.spectrumStyle === "aurora" ? 1.02 + shaped * 1.35 : stereoUnfoldSettings.spectrumStyle === "prisms" ? .94 + shaped * .48 : .96 + shaped * .72;
        child.scale.set(length, bandHeight, 1 + shaped * stereoUnfoldSettings.stereoDepth * .8);
        child.position.set(side * (coverEdge - .14 + length * .5), baseY + Math.sin(timeSeconds * .31 + bandIndex * .4) * .026, 1.08 + shaped * stereoUnfoldSettings.stereoDepth * .18);
        child.rotation.z = side * baseY * -.018; child.material.emissiveIntensity = 2.2 + shaped * 6.4; child.material.opacity = Math.min(.92, (.28 + shaped * .68) * motion.arrival);
      } else if (child.name === "stereo-unfold-left-light" && child instanceof THREE.PointLight) child.intensity = (15 + stereoLeftPulse * 35) * stereoUnfoldSettings.glowIntensity;
      else if (child.name === "stereo-unfold-right-light" && child instanceof THREE.PointLight) child.intensity = (15 + stereoRightPulse * 35) * stereoUnfoldSettings.glowIntensity;
      else if ((child.name === "stereo-unfold-left-halo" || child.name === "stereo-unfold-right-halo") && child instanceof THREE.Sprite && child.material instanceof THREE.SpriteMaterial) {
        const isLeft = child.name.includes("left"); const pulse = isLeft ? stereoLeftPulse : stereoRightPulse; child.position.x = (isLeft ? -1 : 1) * (coverEdge + 1.45); child.position.z = .88; child.material.opacity = Math.min(.5, (.08 + pulse * .22 + stereoWidth * .08) * stereoUnfoldSettings.glowIntensity * motion.arrival);
      } else if (child.name === "stereo-unfold-particles" && child instanceof THREE.Points && child.material instanceof THREE.PointsMaterial) {
        const side = Number(child.userData.side); const pulse = side < 0 ? stereoLeftPulse : stereoRightPulse; const seeds = child.userData.seeds as { x: number; y: number; z: number; phase: number; speed: number }[]; const positions = child.geometry.getAttribute("position") as THREE.BufferAttribute;
        for (const [index, seed] of seeds.entries()) {
          const wrappedY = -2.24 + ((seed.y + 2.24 + timeSeconds * seed.speed) % 4.48 + 4.48) % 4.48; const drift = Math.sin(timeSeconds * (.38 + seed.speed) + seed.phase);
          positions.setXYZ(index, seed.x + side * drift * (.025 + pulse * .055), wrappedY, seed.z + Math.cos(timeSeconds * .27 + seed.phase) * .06);
        }
        positions.needsUpdate = true; child.position.x = side * (coverEdge - .04); child.material.opacity = Math.min(.88, (.28 + pulse * .5) * stereoUnfoldSettings.effectIntensity * motion.arrival); child.material.size = .032 + pulse * .025 * stereoUnfoldSettings.effectIntensity;
      } else if (child.name === "stereo-unfold-light-trail" && child instanceof THREE.Line && child.material instanceof THREE.LineBasicMaterial) {
        const side = Number(child.userData.side); const trailIndex = Number(child.userData.trailIndex); const pulse = side < 0 ? stereoLeftPulse : stereoRightPulse;
        child.position.set(side * (coverEdge + .03 + trailIndex * .16), 0, .98 + trailIndex * .035); child.scale.x = 1 + pulse * (1.1 + trailIndex * .35); child.rotation.z = Math.sin(timeSeconds * .2 + trailIndex * 1.4) * .018 * side;
        child.material.opacity = Math.min(.72, (.16 + pulse * .42) * stereoUnfoldSettings.effectIntensity * motion.arrival);
      } else if (child.name === "stereo-unfold-pulse-ring" && child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
        const side = Number(child.userData.side); const ringIndex = Number(child.userData.ringIndex); const pulse = side < 0 ? stereoLeftPulse : stereoRightPulse; const phase = (timeSeconds * (.46 + pulse * .22) + ringIndex / 3) % 1; const scale = .55 + phase * (1.45 + stereoWidth * .45);
        child.position.set(side * (coverEdge + .24), -1.5 + ringIndex * 1.5, 1.15 + ringIndex * .025); child.scale.set(scale, scale, 1); child.material.opacity = Math.min(.64, (1 - phase) * (.18 + pulse * .48) * stereoUnfoldSettings.effectIntensity * motion.arrival);
      } else if (child.name === "stereo-unfold-full-wave" && child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
        const waveIndex = Number(child.userData.waveIndex); const stereoMix = waveIndex / 5; const pulse = THREE.MathUtils.lerp(stereoLeftPulse, stereoRightPulse, stereoMix); const phase = (timeSeconds * (.105 + pulse * .035) + waveIndex / 6) % 1; const scale = 1.65 + phase * (5.2 + stereoWidth * .8);
        child.scale.set(scale * (1.18 + stereoWidth * .12), scale * .76, 1); child.rotation.z = timeSeconds * (waveIndex % 2 ? -.018 : .014) + waveIndex * .12;
        child.material.opacity = Math.min(.34, Math.pow(1 - phase, 1.7) * (.055 + pulse * .18 + audioPulse * .06) * stereoUnfoldSettings.effectIntensity * motion.arrival);
      } else if (child.name === "stereo-unfold-full-ray" && child instanceof THREE.Sprite && child.material instanceof THREE.SpriteMaterial) {
        const rayIndex = Number(child.userData.rayIndex); const stereoMix = rayIndex / 6; const pulse = THREE.MathUtils.lerp(stereoLeftPulse, stereoRightPulse, stereoMix); const drift = Math.sin(timeSeconds * .11 + rayIndex * 1.37);
        child.position.x = -4.8 + rayIndex * 1.6 + drift * .34; child.position.y = Math.sin(timeSeconds * .09 + rayIndex * 2.1) * 1.35; child.scale.set(.64 + pulse * .52 + rayIndex % 2 * .16, 10.5 + audioPulse * 1.8, 1); child.material.rotation = (rayIndex - 3) * .105 + Math.sin(timeSeconds * .08 + rayIndex) * .035;
        child.material.opacity = Math.min(.2, (.025 + pulse * .07 + audioPulse * .035) * stereoUnfoldSettings.effectIntensity * motion.arrival);
      } else if (child.name === "stereo-unfold-full-dust" && child instanceof THREE.Points && child.material instanceof THREE.PointsMaterial) {
        const seeds = child.userData.seeds as { x: number; y: number; z: number; phase: number; speed: number; depth: number }[]; const positions = child.geometry.getAttribute("position") as THREE.BufferAttribute;
        for (const [index, seed] of seeds.entries()) {
          const wrappedY = -4.2 + ((seed.y + 4.2 + timeSeconds * seed.speed) % 8.4 + 8.4) % 8.4; const drift = Math.sin(timeSeconds * (.14 + seed.depth * .08) + seed.phase);
          positions.setXYZ(index, seed.x + drift * (.035 + stereoWidth * .055), wrappedY, seed.z + Math.cos(timeSeconds * .12 + seed.phase) * .04);
        }
        positions.needsUpdate = true; child.rotation.z = Math.sin(timeSeconds * .035) * .012; child.material.opacity = Math.min(.72, (.2 + audioPulse * .3 + (stereoLeftPulse + stereoRightPulse) * .09) * stereoUnfoldSettings.effectIntensity * motion.arrival); child.material.size = .022 + audioPulse * .018 * stereoUnfoldSettings.effectIntensity;
      }
    });
  }, [animationModeId, audioPulse, stereoLeftBands, stereoLeftPulse, stereoRightBands, stereoRightPulse, stereoUnfoldSettings, stereoWidth, timeSeconds]);

  useLayoutEffect(() => {
    const teddyScene = teddyWalkScene.current; if (!teddyScene || animationModeId !== "teddyWalk") return;
    const motion = resolveTeddyWalkMotion(timeSeconds, globalBpm, teddyWalkSettings.walkIntensity, teddyWalkSettings.danceEnabled, rhythmPulse);
    const teddy = teddyScene.getObjectByName("teddy-character"); const mocapPose = teddyMocap?.sample(timeSeconds, globalBpm, teddyWalkSettings.danceEnabled);
    if (teddy && mocapPose) {
      const facing = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, teddyWalkHeading + mocapPose.turnRadians, 0, "YXZ")); teddy.quaternion.copy(facing); teddy.position.set(0, -1.62 + mocapPose.hipHeight, .72);
      const channels: readonly [string, TeddyMocapJoint, number][] = [
        ["teddy-left-arm", "leftArm", .94], ["teddy-right-arm", "rightArm", .94],
        ["teddy-left-arm-lower", "leftForeArm", .9], ["teddy-right-arm-lower", "rightForeArm", .9],
        ["teddy-left-leg", "leftUpLeg", .92], ["teddy-right-leg", "rightUpLeg", .92],
        ["teddy-left-leg-lower", "leftLeg", .88], ["teddy-right-leg-lower", "rightLeg", .88]
      ];
      for (const [name, bone, weight] of channels) { const target = teddyScene.getObjectByName(name); if (target) target.quaternion.identity().slerp(mocapPose.quaternions[bone], weight); }
    } else {
      if (teddy) { teddy.position.y = -1.62 + motion.bob + motion.danceHop; teddy.position.x = 0; teddy.rotation.x = motion.danceNod; teddy.rotation.z = motion.lean * .3; teddy.rotation.y = teddyWalkHeading + motion.danceSpin; }
      const leftLeg = teddyScene.getObjectByName("teddy-left-leg"); const rightLeg = teddyScene.getObjectByName("teddy-right-leg"); const leftArm = teddyScene.getObjectByName("teddy-left-arm"); const rightArm = teddyScene.getObjectByName("teddy-right-arm"); const airborne = Math.min(1, motion.danceLegTuck / .42); const groundedStride = motion.stride * (1 - airborne * .75); const armStride = motion.stride * (1 - motion.danceArmLift);
      if (leftLeg) { leftLeg.rotation.x = groundedStride + motion.danceLegTuck; leftLeg.rotation.z = groundedStride * .12; } if (rightLeg) { rightLeg.rotation.x = -groundedStride - motion.danceLegTuck; rightLeg.rotation.z = -groundedStride * .12; } if (leftArm) { leftArm.rotation.x = -armStride * .78; leftArm.rotation.z = -.08 - motion.danceArmLift * 2.48; } if (rightArm) { rightArm.rotation.x = armStride * .78; rightArm.rotation.z = .08 + motion.danceArmLift * 2.48; }
    }
    const head = teddyScene.getObjectByName("teddy-head"); const headFibers = teddyScene.getObjectByName("teddy-head-fur-fibers"); if (head) { head.rotation.set(0, 0, 0); head.scale.y = .8 * (1 - rhythmPulse * .025); if (headFibers) headFibers.scale.y = 1 - rhythmPulse * .025; }
    const cover = teddyScene.getObjectByName("teddy-chest-cover"); if (cover) { const pulse = 1 + (audioPulse * .075 + rhythmPulse * .035) * teddyWalkSettings.pulseIntensity; cover.scale.setScalar(pulse); }
    const road = teddyScene.getObjectByName("teddy-road") as THREE.Mesh | undefined; if (road) { const colorTexture = road.userData.colorTexture as THREE.Texture | undefined; const bumpTexture = road.userData.bumpTexture as THREE.Texture | undefined; const offset = motion.roadTravel * .035 * teddyRoadScrollDirection; if (colorTexture) colorTexture.offset.y = offset; if (bumpTexture) bumpTexture.offset.y = offset; }
    const markings = teddyScene.getObjectByName("teddy-road-markings"); if (markings) for (const stripe of markings.children) { const distance = Number(stripe.userData.baseZ) + 14 + motion.roadTravel * 2.2 * teddyRoadScrollDirection; const wrapped = (distance % 36.9 + 36.9) % 36.9; stripe.position.z = -14 + wrapped; }
    const warm = teddyScene.getObjectByName("teddy-warm-light") as THREE.PointLight | undefined; const rim = teddyScene.getObjectByName("teddy-rim-light") as THREE.PointLight | undefined; if (warm) warm.intensity = 22 + rhythmPulse * 6; if (rim) rim.intensity = 25 + audioPulse * 9;
  }, [animationModeId, audioPulse, globalBpm, rhythmPulse, teddyMocap, teddyWalkSettings.danceEnabled, teddyWalkSettings.pulseIntensity, teddyWalkSettings.walkIntensity, timeSeconds]);

  useLayoutEffect(() => {
    const singerScene = teddySingScene.current; if (!singerScene || animationModeId !== "teddySing") return;
    const mouthInner = singerScene.getObjectByName("teddy-sing-mouth-inner") as THREE.Mesh | undefined; const upperLip = singerScene.getObjectByName("teddy-sing-upper-lip"); const lowerLip = singerScene.getObjectByName("teddy-sing-lower-lip"); const teeth = singerScene.getObjectByName("teddy-sing-teeth") as THREE.Mesh | undefined; const tongue = singerScene.getObjectByName("teddy-sing-tongue") as THREE.Mesh | undefined; const headRig = singerScene.getObjectByName("teddy-sing-head-rig"); const teddy = singerScene.getObjectByName("teddy-character"); const { jawOpen, lipRound, lipWide, lipPress, voicing } = teddyLipSync;
    const mouthWidth = THREE.MathUtils.clamp(1 + lipWide * .46 - lipRound * .32, .66, 1.5); const mouthHeight = .1 + jawOpen * 1.28 - lipPress * .08;
    if (mouthInner) { mouthInner.scale.set(mouthWidth, Math.max(.055, mouthHeight), 1); mouthInner.position.y = -.29 - jawOpen * .055; }
    if (upperLip) { upperLip.scale.set(mouthWidth, 1 + lipRound * .3, 1); upperLip.position.y = -.275 + lipPress * .013; upperLip.position.z = .711 + lipRound * .018; }
    if (lowerLip) { lowerLip.scale.set(mouthWidth, 1 + lipRound * .38, 1); lowerLip.position.y = -.295 - jawOpen * .19 + lipPress * .02; lowerLip.position.z = .714 + lipRound * .024; }
    if (teeth?.material instanceof THREE.MeshPhysicalMaterial) { teeth.material.opacity = THREE.MathUtils.clamp((jawOpen - .1) * 2.5 * (1 - lipRound * .45), 0, .82); teeth.visible = teeth.material.opacity > .01; }
    if (tongue?.material instanceof THREE.MeshPhysicalMaterial) { tongue.material.opacity = THREE.MathUtils.clamp((jawOpen - .16) * 1.65 * teddyLipSync.tongue, 0, .86); tongue.visible = tongue.material.opacity > .01; tongue.position.y = -.345 - jawOpen * .065; tongue.scale.set(1 + lipWide * .18, .22 + jawOpen * .18, .18); }
    const performance = teddySingSettings.headMotion; if (headRig) { const emphasis = .25 + voicing * .75; const headBase = headRig.userData.singerBaseRotation as [number, number, number] | undefined; headRig.rotation.set((headBase?.[0] ?? -.055) + Math.sin(timeSeconds * 1.13) * .018 * performance * emphasis - jawOpen * .018, (headBase?.[1] ?? .025) + Math.sin(timeSeconds * .57 + .6) * .025 * performance, (headBase?.[2] ?? .075) + Math.sin(timeSeconds * .83) * .014 * performance); }
    if (teddy) { const base = teddy.userData.singerBaseRotation as [number, number, number] | undefined; const basePosition = teddy.userData.singerBasePosition as [number, number, number] | undefined; teddy.rotation.set((base?.[0] ?? -.095) + Math.sin(timeSeconds * .42) * .006 * performance, (base?.[1] ?? -.1) + Math.sin(timeSeconds * .31) * .009 * performance, (base?.[2] ?? -.085) + Math.sin(timeSeconds * .47) * .006 * performance); teddy.position.set(basePosition?.[0] ?? -.38, (basePosition?.[1] ?? -1.84) + Math.sin(timeSeconds * .86) * .009 * (1 + voicing), basePosition?.[2] ?? -1.08); }
    singerScene.traverse((child) => { if (child.name === "teddy-sing-led-light" && child instanceof THREE.PointLight) child.intensity = 20 + audioPulse * 7; });
    const particles = singerScene.getObjectByName("teddy-sing-particles") as THREE.Points | undefined; if (particles) { const positions = particles.geometry.getAttribute("position") as THREE.BufferAttribute; const seeds = particles.userData.seeds as { x: number; y: number; z: number; phase: number; speed: number; drift: number }[]; for (const [index, seed] of seeds.entries()) { const wrappedY = -2.3 + ((seed.y + 2.3 + timeSeconds * seed.speed) % 6.5 + 6.5) % 6.5; positions.setXYZ(index, seed.x + Math.sin(timeSeconds * .24 + seed.phase) * seed.drift, wrappedY, seed.z + Math.cos(timeSeconds * .17 + seed.phase) * seed.drift * 1.8); } positions.needsUpdate = true; const particleMaterial = particles.material as THREE.PointsMaterial; particleMaterial.opacity = .46 + audioPulse * .18; particleMaterial.size = .021 + audioPulse * .006; }
    const faceFill = singerScene.getObjectByName("teddy-sing-face-fill") as THREE.PointLight | undefined; if (faceFill) faceFill.intensity = 18 + voicing * 5 + audioPulse * 3;
  }, [animationModeId, audioPulse, teddyLipSync, teddySingSettings.headMotion, timeSeconds]);

  useEffect(() => {
    if (!sceneRef.current) return;
    if (neonSigns.current) { sceneRef.current.remove(neonSigns.current); disposeGroup(neonSigns.current); }
    const nextSigns = animationModeId === "coverSphere" || animationModeId === "stereoUnfold" || animationModeId === "walkingCube" || animationModeId === "pixelArt" || animationModeId === "teddyWalk" || animationModeId === "teddySing" || animationModeId === "addSubtitles" || animationModeId === "proSubtitles" || animationModeId === "pixelsSub" ? new THREE.Group() : createNeonSigns(objects, background.neon, activeObjectIndexRef.current); sceneRef.current.add(nextSigns); neonSigns.current = nextSigns;
  }, [animationModeId, background.neon, objects]);

  useEffect(() => { neonSigns.current?.children.forEach((sign) => { sign.visible = Math.abs(Number(sign.userData.routeIndex) - activeObjectIndex) <= 5; }); }, [activeObjectIndex]);

  useEffect(() => {
    if (!marble.current || !marbleShell.current || !marbleCore.current || !marbleImage.current) return;
    marble.current.scale.setScalar(animationModeId === "coverSphere" ? 1.62 / .42 : ballAppearance.radius / .42);
    const shellMaterial = marbleShell.current.material as THREE.MeshPhysicalMaterial;
    const glassTint = new THREE.Color(ballAppearance.color); if (ballAppearance.innerImageUrl) glassTint.lerp(new THREE.Color("#ffffff"), .78);
    shellMaterial.color.copy(glassTint);
    shellMaterial.emissive.set(ballAppearance.color);
    shellMaterial.attenuationColor.copy(glassTint);
    // La cover rimane realmente dentro un involucro di vetro: azzerare la
    // trasmissione trasformava invece la biglia in una sfera scura e opaca.
    shellMaterial.transmission = ballAppearance.innerImageUrl ? .94 : .97;
    shellMaterial.thickness = ballAppearance.innerImageUrl ? .62 : 1.15;
    shellMaterial.attenuationDistance = ballAppearance.innerImageUrl ? 18 : 3.8;
    shellMaterial.depthWrite = !ballAppearance.innerImageUrl;
    shellMaterial.specularColor.set("#ffffff");
    const edgeHighlight = marble.current.getObjectByName("marble-edge-highlight") as THREE.Sprite | undefined;
    if (edgeHighlight?.material instanceof THREE.SpriteMaterial) edgeHighlight.material.color.set(ballAppearance.color);
    const fresnelRim = marble.current.getObjectByName("marble-fresnel-rim") as THREE.Mesh | undefined;
    if (fresnelRim?.material instanceof THREE.ShaderMaterial) fresnelRim.material.uniforms["uColor"]!.value.set(ballAppearance.color);
    const lensBody = marble.current.getObjectByName("marble-cover-lens-body") as THREE.Mesh | undefined;
    if (lensBody?.material instanceof THREE.MeshPhysicalMaterial) { lensBody.material.color.set(ballAppearance.innerColor); lensBody.material.emissive.set(ballAppearance.innerColor); }
    const lensGlow = marble.current.getObjectByName("marble-cover-inner-glow") as THREE.PointLight | undefined;
    if (lensGlow) { lensGlow.color.set(ballAppearance.innerColor); lensGlow.intensity = ballAppearance.innerImageUrl ? 1.8 : 0; }
    const coreMaterial = marbleCore.current.material as THREE.MeshPhysicalMaterial;
    coreMaterial.color.set(ballAppearance.innerColor);
    coreMaterial.emissive.set(ballAppearance.innerColor);
    coreMaterial.emissiveIntensity = ballAppearance.emission;
    marbleCore.current.visible = !ballAppearance.innerImageUrl;
    const imageMaterial = marbleImage.current.material as THREE.MeshBasicMaterial; marbleImageSource.current = ballAppearance.innerImageUrl;
    if (ballAppearance.innerImageUrl) { const source = ballAppearance.innerImageUrl; new THREE.TextureLoader().load(source, (texture) => { if (marbleImageSource.current !== source) { texture.dispose(); return; } const image = texture.image as CanvasImageSource & { width?: number; height?: number }; const width = image.width ?? 1; const height = image.height ?? 1; const aspect = width / Math.max(1, height); const embeddedTexture = roundedCoverTexture(image, width, height); texture.dispose(); imageMaterial.map?.dispose(); imageMaterial.map = embeddedTexture; const coverScale = animationModeId === "coverSphere" ? .94 : .9; marbleImage.current?.scale.set((aspect >= 1 ? 1 : aspect) * coverScale, (aspect >= 1 ? 1 / aspect : 1) * coverScale, 1); if (marbleImage.current) marbleImage.current.visible = true; imageMaterial.needsUpdate = true; }, undefined, () => { if (marbleImage.current) marbleImage.current.visible = false; if (marbleCore.current) marbleCore.current.visible = true; }); }
    else { imageMaterial.map?.dispose(); imageMaterial.map = null; marbleImage.current.visible = false; imageMaterial.needsUpdate = true; }
  }, [animationModeId, ballAppearance]);

  useEffect(() => {
    if (!sceneRef.current) return;
    const night = animationModeId === "newYorkStreets"; const singer = animationModeId === "teddySing";
    // Solo le ambientazioni che lo richiedono mantengono una foschia minima.
    // Tutte le altre restano otticamente limpide e conservano saturazione.
    sceneRef.current.fog = night ? new THREE.FogExp2("#18232a", .0038) : singer ? new THREE.FogExp2(teddySingSettings.roomColor, .0018) : null;
    const hemisphere = sceneRef.current.getObjectByName("global-hemisphere") as THREE.HemisphereLight | undefined; const key = sceneRef.current.getObjectByName("global-key") as THREE.DirectionalLight | undefined; const cyan = sceneRef.current.getObjectByName("global-cyan-rim") as THREE.PointLight | undefined; const violet = sceneRef.current.getObjectByName("global-violet-rim") as THREE.PointLight | undefined;
    if (hemisphere) { hemisphere.intensity = night ? .34 : singer ? .62 : 1.25; hemisphere.color.set(night ? "#48617b" : singer ? "#9ea9c4" : "#c8d8ff"); hemisphere.groundColor.set(night ? "#050708" : singer ? "#11131a" : "#180d2d"); } if (key) { key.intensity = night ? .58 : singer ? 1.5 : 4.2; key.color.set(night ? "#8295ad" : singer ? "#f7e9dc" : "#ffffff"); } if (cyan) cyan.intensity = night ? .35 : singer ? .8 : 13; if (violet) violet.intensity = night ? .25 : singer ? .8 : 15;
    if (stars.current) stars.current.visible = animationModeId !== "addSubtitles" && animationModeId !== "proSubtitles" && animationModeId !== "pixelsSub" && animationModeId !== "pixelArt" && animationModeId !== "walkingCube" && background.effects.particles;
    if (customLightRig.current) customLightRig.current.visible = animationModeId !== "addSubtitles" && animationModeId !== "proSubtitles" && animationModeId !== "pixelsSub" && animationModeId !== "pixelArt" && animationModeId !== "walkingCube";
  }, [animationModeId, background, teddySingSettings.roomColor]);

  useEffect(() => {
    const video = backgroundVideo.current;
    const videoSource = animationModeId === "addSubtitles" ? addSubtitlesSettings.videoUrl : animationModeId === "proSubtitles" ? proSubtitlesSettings.videoUrl : background.mediaType === "video" ? background.imageUrl : null;
    if (!video || !videoSource) return;
    const sync = () => { if (!Number.isFinite(video.duration) || video.duration <= 0) return; const target = timeSeconds % video.duration; if (Math.abs(video.currentTime - target) > .12) video.currentTime = target; };
    sync(); if (playing) void video.play().catch(() => undefined); else video.pause();
  }, [addSubtitlesSettings.videoUrl, animationModeId, background.imageUrl, background.mediaType, playing, proSubtitlesSettings.videoUrl, timeSeconds]);

  useLayoutEffect(() => {
    const swarm = secondaryMarbles.current; if (!swarm || animationModeId !== "newYorkStreets") return; const states = raceEvaluator(timeSeconds);
    for (const [index, child] of swarm.children.entries()) { const state = states[index]; if (!state) continue; const marbleGroup = child as THREE.Group; const broken = state.breakElapsedSeconds > 0; const shell = marbleGroup.getObjectByName("secondary-shell"); const core = marbleGroup.getObjectByName("secondary-core"); const shards = marbleGroup.getObjectByName("secondary-shards") as THREE.Group | undefined;
      marbleGroup.visible = true; marbleGroup.position.set(state.position.x, state.position.y, state.position.z); if (broken) marbleGroup.rotation.set(0, 0, 0); else marbleGroup.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
      if (shell) shell.visible = !broken; if (core) { core.visible = !broken; core.rotation.set(-timeSeconds * .8, timeSeconds * 1.1, index * .3); } if (!shards) continue; shards.visible = broken; for (const [shardIndex, shardObject] of shards.children.entries()) { const shard = shardObject as THREE.Mesh; const shardDirection = shard.userData.breakDirection as THREE.Vector3; const pose = fallingFragmentPose(shardDirection, shardIndex, state.breakElapsedSeconds, ballAppearance.radius); shard.position.set(pose.position.x, pose.position.y, pose.position.z); shard.rotation.set(pose.rotation.x, pose.rotation.y, pose.rotation.z); }
    }
  }, [animationModeId, ballAppearance.radius, raceEvaluator, timeSeconds]);

  useLayoutEffect(() => {
    if (!marble.current) return;
    marble.current.visible = animationModeId !== "stereoUnfold" && animationModeId !== "walkingCube" && animationModeId !== "pixelArt" && animationModeId !== "teddyWalk" && animationModeId !== "teddySing" && animationModeId !== "addSubtitles" && animationModeId !== "proSubtitles" && animationModeId !== "pixelsSub" && animationModeId !== "staticWatermark" && animationModeId !== "upscaler";
    const position = animationModeId === "coverSphere" ? { x: 0, y: .55 + audioPulse * .08, z: 0 } : animationModeId === "stereoUnfold" ? { x: 0, y: .34, z: .28 } : ballPosition ?? { x: 0, y: 2.25 + Math.sin(timeSeconds * 2.2) * .1, z: 0 };
    marble.current.position.set(position.x, position.y, position.z);
    if (animationModeId === "coverSphere") { const rotation = timeSeconds * .48 * coverSphereSettings.rotationIntensity; marble.current.rotation.set(Math.sin(timeSeconds * .28) * .13, rotation, Math.sin(timeSeconds * .41) * .075); marble.current.scale.setScalar((1.62 + audioPulse * .055) / .42); }
    else { const orientation = rollingOrientation(timeSeconds); marble.current.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w); }
    if (marbleCore.current) marbleCore.current.rotation.set(-timeSeconds * .9, timeSeconds * 1.35, timeSeconds * .4);
    const reveal = getRevealProgress(ballAppearance, timeSeconds, durationSeconds);
    if (marbleShell.current) { const shellMaterial = marbleShell.current.material as THREE.MeshPhysicalMaterial; const imageClarity = ballAppearance.innerImageUrl ? animationModeId === "coverSphere" ? .2 : .24 : .9; shellMaterial.opacity = imageClarity * (1 - Math.min(1, reveal * 2.2)); shellMaterial.roughness = ballAppearance.innerImageUrl ? .004 : .018; shellMaterial.attenuationDistance = ballAppearance.innerImageUrl ? 18 : 3.8; shellMaterial.emissiveIntensity = animationModeId === "coverSphere" ? .07 + audioPulse * .035 : ballAppearance.innerImageUrl ? .045 : sceneLight.enabled ? .13 + Math.min(.14, sceneLight.reflectionBoost * .045) : .11; shellMaterial.envMapIntensity = animationModeId === "coverSphere" ? 4.1 + audioPulse * 1.05 : 2.65 * (sceneLight.enabled ? Math.max(1, sceneLight.reflectionBoost) : 1); marbleShell.current.scale.setScalar(1 + Math.sin(Math.min(1, reveal * 2) * Math.PI) * .1); }
    if (marbleCore.current) marbleCore.current.scale.setScalar(Math.max(.01, 1 - reveal * 1.25));
    if (marbleImage.current) marbleImage.current.visible = Boolean((marbleImage.current.material as THREE.MeshBasicMaterial).map) && reveal <= .15;
    const fresnelRim = marble.current.getObjectByName("marble-fresnel-rim"); if (fresnelRim) fresnelRim.visible = reveal <= .15;
    if (marbleShards.current) { if (reveal > .015) marbleShards.current.quaternion.copy(marble.current.quaternion).invert(); else marbleShards.current.quaternion.identity(); for (const [shardIndex, child] of marbleShards.current.children.entries()) { const direction = child.userData.shatterDirection as THREE.Vector3; child.visible = reveal > .015; const pose = fallingFragmentPose(direction, shardIndex, reveal * 3, ballAppearance.radius); child.position.set(pose.position.x, pose.position.y, pose.position.z); child.rotation.set(pose.rotation.x, pose.rotation.y, pose.rotation.z); const material = (child as THREE.Mesh).material as THREE.MeshPhysicalMaterial; material.opacity = .78 * (1 - reveal * .62); } }
    if (camera.current) {
      if (animationModeId === "newYorkStreets") {
        const start = objects[Math.max(0, activeObjectIndex)]; const end = objects[Math.min(objects.length - 1, activeObjectIndex + 1)]; const forward = start && end ? new THREE.Vector3(end.position[0] - start.position[0], 0, end.position[2] - start.position[2]).normalize() : new THREE.Vector3(0, 0, -1); const right = new THREE.Vector3(-forward.z, 0, forward.x); const distance = aspectRatio === "9:16" ? 7.6 : 6.45; const dropSegment = trajectorySegments.find((segment) => segment.motionKind === "sewerDrop" && timeSeconds >= segment.startTime && timeSeconds <= segment.endTime);
        if (dropSegment) { const entryIndex = newYorkSewerEntryIndex(objects); const streetStart = objects[Math.max(0, entryIndex - 2)]; const streetEnd = objects[Math.max(0, entryIndex - 1)]; const sewerStart = objects[entryIndex]; const sewerEnd = objects[Math.min(objects.length - 1, entryIndex + 1)]; const streetForward = streetStart && streetEnd ? new THREE.Vector3(streetEnd.position[0] - streetStart.position[0], 0, streetEnd.position[2] - streetStart.position[2]).normalize() : forward; const sewerForward = sewerStart && sewerEnd ? new THREE.Vector3(sewerEnd.position[0] - sewerStart.position[0], 0, sewerEnd.position[2] - sewerStart.position[2]).normalize() : forward; const progress = THREE.MathUtils.clamp((timeSeconds - dropSegment.startTime) / Math.max(.001, dropSegment.endTime - dropSegment.startTime), 0, 1); const blendRaw = THREE.MathUtils.clamp((progress - .52) / .48, 0, 1); const blend = blendRaw * blendRaw * (3 - 2 * blendRaw); const streetCamera = new THREE.Vector3(dropSegment.startPosition.x, dropSegment.startPosition.y + 2.45, dropSegment.startPosition.z).addScaledVector(streetForward, -6.4); const sewerCamera = new THREE.Vector3(position.x, position.y + 2.15, position.z).addScaledVector(sewerForward, -distance); desiredCameraPosition.current.copy(streetCamera).lerp(sewerCamera, blend); const shaftTarget = new THREE.Vector3(position.x, position.y, position.z); const sewerTarget = new THREE.Vector3(position.x, position.y + .12, position.z).addScaledVector(sewerForward, 4.2); desiredCameraTarget.current.copy(shaftTarget).lerp(sewerTarget, blend); }
        else { desiredCameraPosition.current.set(position.x, position.y, position.z).addScaledVector(forward, -distance).addScaledVector(right, .22).add(new THREE.Vector3(0, 2.15, 0)); desiredCameraTarget.current.set(position.x, position.y, position.z).addScaledVector(forward, 4.2).add(new THREE.Vector3(0, .12, 0)); }
        const nextFov = aspectRatio === "9:16" ? 46 : 41; if (camera.current.fov !== nextFov) { camera.current.fov = nextFov; camera.current.updateProjectionMatrix(); }
      } else if (animationModeId === "coverSphere") {
        desiredCameraPosition.current.set(0, .15, aspectRatio === "9:16" ? 10.8 : 9.5); desiredCameraTarget.current.set(0, -.35, 0); const nextFov = aspectRatio === "9:16" ? 43 : 39; if (camera.current.fov !== nextFov) { camera.current.fov = nextFov; camera.current.updateProjectionMatrix(); }
      } else if (animationModeId === "stereoUnfold") {
        desiredCameraPosition.current.set(0, .18, aspectRatio === "9:16" ? 11.7 : 10.1); desiredCameraTarget.current.set(0, .05, -.35); const nextFov = aspectRatio === "9:16" ? 44 : 40; if (camera.current.fov !== nextFov) { camera.current.fov = nextFov; camera.current.updateProjectionMatrix(); }
      } else if (animationModeId === "walkingCube") {
        const focus = walkingCubeScene.current?.userData.focusPosition as THREE.Vector3 | undefined; const target = focus ?? new THREE.Vector3(0, -.03, 0);
        desiredCameraPosition.current.set(0, target.y + (aspectRatio === "9:16" ? .06 : .02), aspectRatio === "9:16" ? 7.45 : 6.35); desiredCameraTarget.current.set(0, target.y, -.2); const nextFov = aspectRatio === "9:16" ? 40 : 37; if (camera.current.fov !== nextFov) { camera.current.fov = nextFov; camera.current.updateProjectionMatrix(); }
      } else if (animationModeId === "pixelArt") {
        desiredCameraPosition.current.set(0, 0, 10.6); desiredCameraTarget.current.set(0, 0, .65); const nextFov = 34; if (camera.current.fov !== nextFov) { camera.current.fov = nextFov; camera.current.updateProjectionMatrix(); }
      } else if (animationModeId === "teddyWalk") {
        desiredCameraPosition.current.set(0, -.05, aspectRatio === "9:16" ? 11.2 : 9.6); desiredCameraTarget.current.set(0, -.38, -.35); const nextFov = aspectRatio === "9:16" ? 39 : 42; if (camera.current.fov !== nextFov) { camera.current.fov = nextFov; camera.current.updateProjectionMatrix(); }
      } else if (animationModeId === "teddySing") {
        desiredCameraPosition.current.set(.15, -2.08, aspectRatio === "9:16" ? 6.15 : 5.55); desiredCameraTarget.current.set(-.18, .02, -1.02); const nextFov = aspectRatio === "9:16" ? 42 : 39; if (camera.current.fov !== nextFov) { camera.current.fov = nextFov; camera.current.updateProjectionMatrix(); }
      } else if (animationModeId === "addSubtitles" || animationModeId === "proSubtitles" || animationModeId === "pixelsSub") {
        desiredCameraPosition.current.set(0, 0, 11.5); desiredCameraTarget.current.set(0, 0, 0); const nextFov = aspectRatio === "9:16" ? 43 : 39; if (camera.current.fov !== nextFov) { camera.current.fov = nextFov; camera.current.updateProjectionMatrix(); }
      } else {
        const horizontalLookAhead = ballVelocity ? Math.max(-.85, Math.min(.85, ballVelocity.x * .16)) : 0; desiredCameraPosition.current.set(position.x + .42, position.y + .45, 11.5); desiredCameraTarget.current.set(position.x + horizontalLookAhead, position.y - .4, position.z * .72); if (camera.current.fov !== 38) { camera.current.fov = 38; camera.current.updateProjectionMatrix(); }
      }
    }
  }, [activeObjectIndex, animationModeId, aspectRatio, audioPulse, ballAppearance, ballPosition, ballVelocity, coverSphereSettings.rotationIntensity, durationSeconds, objects, rollingOrientation, sceneLight.enabled, sceneLight.reflectionBoost, timeSeconds, trajectorySegments]);

  const proSubtitleMode = animationModeId === "proSubtitles";
  const pixelsSubMode = animationModeId === "pixelsSub";
  const staticWatermarkMode = animationModeId === "staticWatermark";
  const upscalerMode = animationModeId === "upscaler";
  const subtitleVideoMode = animationModeId === "addSubtitles" || proSubtitleMode;
  const walkingCubeMode = animationModeId === "walkingCube";
  const activeVideoUrl = proSubtitleMode ? proSubtitlesSettings.videoUrl : animationModeId === "addSubtitles" ? addSubtitlesSettings.videoUrl : background.mediaType === "video" ? background.imageUrl : null;
  const cubeBackgroundUrl = walkingCubeMode ? effectiveWalkingCubeSettings.backgroundImageUrl?.replace(/["\\]/g, "") : undefined;
  const safeImageUrl = cubeBackgroundUrl ?? (!subtitleVideoMode && background.mediaType === "image" ? background.imageUrl?.replace(/["\\]/g, "") : undefined);
  const cubeDim = Math.round(walkingCubeSettings.backgroundDim * 255).toString(16).padStart(2, "0");
  const backdropStyle = { backgroundImage: subtitleVideoMode ? "none" : walkingCubeMode && safeImageUrl ? `linear-gradient(#000000${cubeDim}, #000000${cubeDim}), url("${safeImageUrl}")` : safeImageUrl ? `linear-gradient(180deg, ${background.colors[0]}22, ${background.colors[1]}55), url("${safeImageUrl}")` : `radial-gradient(circle at 50% 35%, ${walkingCubeMode ? walkingCubeSettings.paletteSecondary : background.colors[1]}, ${walkingCubeMode ? walkingCubeSettings.palettePrimary : background.colors[0]} 72%)`, backgroundColor: subtitleVideoMode ? "#000000" : undefined, backgroundPosition: "center", backgroundRepeat: "no-repeat", backgroundSize: walkingCubeMode && safeImageUrl ? "100% 100%" : "cover", inset: walkingCubeMode ? 0 : "-10px", transform: walkingCubeMode ? "none" : "scale(1.02)", opacity: walkingCubeMode ? 1 : activeVideoUrl ? 1 : background.opacity, filter: `blur(${walkingCubeMode || activeVideoUrl ? 0 : background.blur}px)` };
  const videoStyle = subtitleVideoMode ? { opacity: 1, filter: "none", objectFit: proSubtitleMode ? proSubtitlesSettings.fit : addSubtitlesSettings.fit, backgroundColor: "#000000" } : walkingCubeMode ? { inset: 0, width: "100%", height: "100%", transform: "none", opacity: 1, filter: "none", objectFit: "fill" as const, backgroundColor: "#070b18" } : { opacity: background.opacity, filter: `blur(${background.blur}px)`, objectFit: "cover" as const };
  const revealProgress = getRevealProgress(ballAppearance, timeSeconds, durationSeconds); const imageProgress = Math.max(0, Math.min(1, (revealProgress - .16) / .84)); const easedImage = 1 - Math.pow(1 - imageProgress, 3);
  const revealStyle = animationModeId !== "stereoUnfold" && !walkingCubeMode && animationModeId !== "pixelArt" && animationModeId !== "teddyWalk" && animationModeId !== "teddySing" && !pixelsSubMode && !subtitleVideoMode && ballAppearance.innerImageUrl ? { backgroundImage: `url("${ballAppearance.innerImageUrl.replace(/["\\]/g, "")}")`, opacity: easedImage, transform: `perspective(1200px) rotateY(${(1 - easedImage) * 104}deg) scale(${.58 + easedImage * .42})`, filter: `blur(${(1 - easedImage) * 5}px) drop-shadow(0 28px 45px #000c)` } : undefined;
  const flashOpacity = revealProgress > 0 ? Math.max(0, Math.sin(Math.min(1, revealProgress * 2.6) * Math.PI)) : 0;
  const standaloneGpuMode = subtitleVideoMode || pixelsSubMode || staticWatermarkMode || upscalerMode || walkingCubeMode || animationModeId === "pixelArt";
  const viewportLabel = upscalerMode ? "Upscaler" : staticWatermarkMode ? "Static Watermark Remover" : pixelsSubMode ? "Vista Pixels Subtitles" : animationModeId === "coverSphere" ? "Vista visualizer" : animationModeId === "stereoUnfold" ? "Vista Stereo Unfold" : walkingCubeMode ? "Vista Cube Animation" : animationModeId === "pixelArt" ? "Vista Pixel Art" : animationModeId === "teddyWalk" ? "Vista Teddy Walk" : animationModeId === "teddySing" ? "Vista Teddy Sing" : proSubtitleMode ? "Vista Pro Subtitles" : subtitleVideoMode ? "Vista sottotitoli" : "Vista percorso";
  const qualityLabel = upscalerMode ? "Confronto 1:1 · correzione live · output personalizzato" : staticWatermarkMode ? "Compositing 2D · preview frame-accurate" : pixelsSubMode ? "Cover protetta · cornice audio pixel · testo pixel nativo" : proSubtitleMode ? "Kinetic typography RGBA · title-safe · stile per parola" : subtitleVideoMode ? "Video originale · overlay sottotitoli GPU" : walkingCubeMode ? "Cover fedele · vetro PBR · increspature GPU" : animationModeId === "pixelArt" ? "Personaggi articolati · spettro stereo pixel · export GPU" : "PBR · AgX · Preview GPU ottimizzata";
  const footerLabel = upscalerMode ? `Upscaler · ${upscalerSettings.sourceName || "carica una sorgente"} · ${upscalerSettings.finalWidth} × ${upscalerSettings.finalHeight} · ${upscalerSettings.model}` : staticWatermarkMode ? `Static Watermark Remover · ${staticWatermarkSettings.videoName || "carica un video"} · ${staticWatermarkSettings.referenceImageUrl ? "riferimento pronto" : "manca fotografia pulita"}` : pixelsSubMode ? `Pixels Subtitles · ${pixelsSubSettings.imageUrl ? "cover pulita" : "carica un’immagine"} · ${subtitles.cues.length} frasi · palette 3 colori` : proSubtitleMode ? `Pro Subtitles · ${proSubtitlesSettings.videoName || "carica un video"} · ${subtitles.cues.length} blocchi · ${proSubtitlesSettings.backgroundMode === "transparent" ? "alpha" : "fondo pieno"}` : subtitleVideoMode ? `Add Subtitles · ${addSubtitlesSettings.videoName || "carica un video"} · ${subtitles.cues.length} blocchi` : animationModeId === "newYorkStreets" ? `New York Streets · ${newYorkSettings.secondaryMarbleCount + 1} biglie · strada + fognature` : animationModeId === "coverSphere" ? "Cover Sphere · spettrogramma reale a 48 bande · effetti audio-reattivi" : animationModeId === "stereoUnfold" ? `Stereo Unfold · analisi L/R reale · ampiezza stereo ${Math.round(stereoWidth * 100)}%` : walkingCubeMode ? `Cube Animation · rotazione 3D · increspature sui beat · spettrogramma 48 bande · stereo ${Math.round(stereoWidth * 100)}%` : animationModeId === "pixelArt" ? `Pixel Art · Walking Through New York · deck 48 bande L/R · ingresso ${durationSeconds > 0 ? (durationSeconds / 2).toFixed(1) : "—"} s · ${pixelArtSettings.venueName || "BAR"}` : animationModeId === "teddyWalk" ? `Teddy Walk · ${teddyMocap ? "motion capture Mixamo attivo" : "caricamento motion capture"} · strada PBR` : animationModeId === "teddySing" ? `Teddy Sing · labiale 3D ${teddyLipSync.voicing > .02 ? "attivo" : "in attesa della voce"} · stanza LED` : `${background.finish === "worn" ? "Ambiente usurato" : "Ambiente limpido"} · viaggio orizzontale audio-reattivo`;
  const fullscreenTransport = fullscreenPreview && !upscalerMode && onPlayPause && onStop && onSeek;
  return <main className={`viewport${fullscreenPreview ? " viewport-fullscreen" : ""}${fullscreenTransport ? " has-fullscreen-transport" : ""}`} aria-label="Viewport scena">
    <div className="viewport-tools"><button className="active-control">{viewportLabel}</button>{standaloneGpuMode ? null : <><button disabled>Sposta</button><button disabled>Ruota</button><button disabled>Scala</button></>}<span /><span className="viewport-quality">{qualityLabel}</span><button type="button" className="viewport-fullscreen-toggle" aria-label={fullscreenPreview ? "Esci da tutto schermo" : "Animazione a tutto schermo"} aria-pressed={fullscreenPreview} title={fullscreenPreview ? "Torna all’editor (Esc)" : "Mostra soltanto l’animazione"} onClick={toggleFullscreenPreview}>{fullscreenPreview ? "↙ Torna all’editor" : "⛶ Tutto schermo"}</button></div>
    <div className="three-stage"><div
      className={`preview-frame ${(upscalerMode ? upscalerSettings.finalWidth >= upscalerSettings.finalHeight : aspectRatio === "16:9") ? "ratio-landscape" : "ratio-portrait"}`}
      style={upscalerMode ? { aspectRatio: `${Math.max(1, upscalerSettings.finalWidth)} / ${Math.max(1, upscalerSettings.finalHeight)}` } : undefined}
    >
      <div className="scene-backdrop" style={backdropStyle} />
      {activeVideoUrl ? <video key={activeVideoUrl} ref={backgroundVideo} className={`scene-backdrop scene-backdrop-video${subtitleVideoMode ? " subtitle-source-video" : ""}`} src={activeVideoUrl} style={videoStyle} muted loop playsInline preload="auto" /> : null}
      {subtitleVideoMode && (proSubtitleMode ? proSubtitlesSettings.dimming : addSubtitlesSettings.dimming) > 0 ? <div className="subtitle-video-dimming" style={{ opacity: proSubtitleMode ? proSubtitlesSettings.dimming : addSubtitlesSettings.dimming }} /> : null}
      {walkingCubeMode && activeVideoUrl && walkingCubeSettings.backgroundDim > 0 ? <div className="subtitle-video-dimming" style={{ opacity: walkingCubeSettings.backgroundDim }} /> : null}
      {!standaloneGpuMode && background.effects.glow ? <div className="scene-effect scene-glow" /> : null}
      {!standaloneGpuMode && background.effects.particles ? <div className="scene-effect scene-particles" /> : null}
      {!standaloneGpuMode && background.finish === "worn" ? <div className="scene-effect scene-wear" /> : null}
      {!standaloneGpuMode && background.effects.vignette ? <div className="scene-effect scene-vignette" /> : null}
      <div ref={host} className={`three-canvas-host${lightPickMode && !standaloneGpuMode ? " light-picking" : ""}`} />
      {staticWatermarkMode ? <StaticWatermarkPreview settings={staticWatermarkSettings} currentTime={timeSeconds} playing={playing} /> : null}
      {upscalerMode ? <UpscalerPreview settings={upscalerSettings} fullscreen={fullscreenPreview} /> : null}
      {revealStyle ? <><div className="final-reveal-scrim" style={{ opacity: easedImage * .68 }} aria-hidden="true" /><div className="final-break-flash" style={{ opacity: flashOpacity }} aria-hidden="true" /><div className="final-image-reveal" style={revealStyle} aria-hidden="true" /></> : null}
    </div></div>
    {fullscreenTransport ? <FullscreenPlaybackDock currentTime={timeSeconds} duration={durationSeconds} playing={playing} onPlayPause={onPlayPause} onStop={onStop} onSeek={onSeek} /> : null}
    <div className="viewport-footer"><span>● WebGL 2 · preview leggera {aspectRatio} · export pieno</span><span>{footerLabel}</span></div>
  </main>;
}
