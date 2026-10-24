// Escenario de la tormenta: el lienzo de WebGL, las dos escenas (la del mundo y la capa del cielo, que se
// dibuja encima con su propia cámara fija para que las nubes tapen la barra de arriba), las luces, la
// cámara y las tomas (de lejos, frente a la puerta, adentro, trabajando y la del final).
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { HOUSE } from "./house";
import { lerp, type Timeline, type Tween } from "./kit";

export type Shot = { x: number; y: number; z: number; tx: number; ty: number; tz: number; fov: number };
const SHOT_KEYS = ["x", "y", "z", "tx", "ty", "tz", "fov"] as const;
export const FOV = 32;

export function createStage(root: HTMLElement, tl: Timeline) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.autoClear = false;
  renderer.domElement.className = "theme-storm-canvas";
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  const hemi = new THREE.HemisphereLight(0xc4d2e2, 0x3a3f45, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(-7, 11, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 12, bottom: -8, near: 1, far: 50 });
  sun.shadow.bias = -0.0004;
  sun.shadow.radius = 3;
  scene.add(sun);
  scene.add(sun.target);

  const skyScene = new THREE.Scene();
  const skyHemi = new THREE.HemisphereLight(0xc4d2e2, 0x3a3f45, 1.0);
  skyScene.add(skyHemi);
  const skySun = new THREE.DirectionalLight(0xffffff, 1.2);
  skySun.position.set(-3, 6, 4);
  skyScene.add(skySun);
  skyScene.environment = scene.environment;
  skyScene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.05, 140);
  scene.add(camera);
  const skyCam = new THREE.PerspectiveCamera(FOV, camera.aspect, 0.1, 60);
  const cam: Shot = { x: 0, y: 0, z: 15, tx: 0, ty: 0, tz: 0, fov: FOV };
  const applyCam = () => {
    camera.position.set(cam.x, cam.y, cam.z);
    camera.lookAt(cam.tx, cam.ty, cam.tz);
    if (camera.fov !== cam.fov) {
      camera.fov = cam.fov;
      camera.updateProjectionMatrix();
    }
  };
  const moveCam = (to: Shot, dur: number, opts?: Parameters<Timeline["tween"]>[2]): Tween => {
    const from = { ...cam };
    return tl.tween(dur, (k) => {
      for (const key of SHOT_KEYS) cam[key] = lerp(from[key], to[key], k);
      applyCam();
    }, opts);
  };
  const cutCam = (to: Shot) => {
    Object.assign(cam, to);
    applyCam();
  };

  // Toma de lejos: la casa entra a la izquierda y las nubes tapan la barra de arriba.
  const wideShot = (): Shot => {
    const halfH = 15 * tanOf(FOV);
    const y = 0.72 * halfH;
    return { x: 0, y, z: 15, tx: 0, ty: y, tz: 0, fov: FOV };
  };
  cutCam(wideShot());
  const halfW = 15 * tanOf(FOV) * camera.aspect;
  const F = HOUSE.front;
  const FLOOR = HOUSE.base;
  const houseX = -halfW + 3.8;
  const doorX = houseX + (HOUSE.doorL + HOUSE.doorR) / 2;
  const shots = {
    wide: wideShot,
    // Frente a la puerta (Plastiloka y tira).
    close: (): Shot => ({ x: doorX + 0.6, y: 1.75, z: F + 4.3, tx: doorX + 0.6, ty: 0.38, tz: F + 0.3, fov: FOV }),
    // Adentro, la sala: la puerta abierta y la compuerta bajo la ventana.
    inside: (): Shot => ({ x: houseX - 0.45, y: 1.55, z: HOUSE.back + 0.32, tx: houseX - 0.6, ty: 0.55, tz: F, fov: 52 }),
    // Cerca de la compuerta ya puesta, con el estuche a un lado.
    work: (): Shot => ({ x: doorX + 0.2, y: FLOOR + 1.3, z: 0.05, tx: doorX + 0.08, ty: FLOOR + 0.24, tz: F, fov: 50 }),
    // El final: la compuerta en la puerta y la persona en la ventana.
    win: (): Shot => ({ x: houseX + 0.05, y: 1.6, z: F + 5.3, tx: houseX + 0.05, ty: 1.12, tz: F, fov: FOV }),
    // Acercándose a la puerta que se abre.
    door: (): Shot => ({ x: doorX, y: 1.25, z: F + 1.7, tx: doorX, ty: 1.0, tz: F - 1, fov: 40 }),
  };

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    skyCam.aspect = camera.aspect;
    skyCam.updateProjectionMatrix();
  };

  // De un punto del mundo a la pantalla (px).
  const toScreen = (v: THREE.Vector3) => {
    const p = v.clone().project(camera);
    return { x: ((p.x + 1) / 2) * window.innerWidth, y: ((1 - p.y) / 2) * window.innerHeight };
  };

  const render = (withSky: boolean) => {
    renderer.clear();
    renderer.render(scene, camera);
    if (withSky) {
      renderer.clearDepth();
      renderer.render(skyScene, skyCam);
    }
  };

  const dispose = () => {
    pmrem.dispose();
    renderer.dispose();
  };

  return { renderer, scene, skyScene, camera, hemi, skyHemi, moveCam, cutCam, shots, houseX, doorX, resize, toScreen, render, dispose };
}

export function tanOf(fov: number): number {
  return Math.tan(THREE.MathUtils.degToRad(fov / 2));
}

export type Stage = ReturnType<typeof createStage>;
