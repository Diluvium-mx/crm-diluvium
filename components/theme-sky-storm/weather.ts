// Clima de la tormenta: la calle con las casas de enfrente (solo se ven desde adentro), el agua de afuera
// con oleaje (no entra a la casa hasta que la casa cae), el agua de adentro, las nubes que tapan la barra,
// la lluvia y los relámpagos.
import * as THREE from "three";
import { HOUSE } from "./house";
import { box, canvasTex, E, lerp, rand, std, type Timeline, type Tween } from "./kit";
import { buildCloud } from "./pieces";
import { FOV, tanOf, type Stage } from "./stage";

type Drop = { x: number; y: number; z: number; v: number; len: number };
type CloudSlot = { obj: THREE.Group; home: THREE.Vector3; i: number };

export function createWeather(stage: Stage, tl: Timeline, dark: boolean, flash: HTMLElement) {
  const { scene, skyScene, camera, houseX } = stage;
  const F = HOUSE.front;
  const FLOOR = HOUSE.base;
  const blue = dark ? 0x2a68ad : 0x3b84cc;

  // Calle (llega hasta las casas de enfrente) y, del otro lado, casas y cielo.
  const ground = box(160, 4, 34.5, std(dark ? 0x60666d : 0x7f868d, { roughness: 0.96 }), { cast: false });
  ground.position.set(0, -2, 13.5);
  scene.add(ground);
  const acrossColors = [0xc9b8a0, 0xa9b7c4, 0xd6c9b5, 0x9fae9a, 0xc4a99a];
  for (let i = 0; i < 10; i++) {
    const w = rand(3, 5);
    const h = rand(3, 6.5);
    const b = box(w, h, 3, std(acrossColors[i % acrossColors.length], { roughness: 0.95 }), { cast: false });
    b.position.set(houseX - 14 + i * 5.3, h / 2, 25);
    scene.add(b);
  }
  const skyTex = canvasTex(4, 256, (x, w, h) => {
    const gr = x.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "#3a434f");
    gr.addColorStop(1, "#8a95a1");
    x.fillStyle = gr;
    x.fillRect(0, 0, w, h);
  });
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(200, 70), new THREE.MeshBasicMaterial({ map: skyTex, depthWrite: false }));
  backdrop.position.set(houseX, 22, 48);
  backdrop.rotation.y = Math.PI;
  scene.add(backdrop);

  // Agua de afuera: caja con oleaje, recortada para que no se dibuje dentro de la casa.
  const waterGeo = new THREE.BoxGeometry(160, 1, 33.5, 200, 1, 26);
  const wpos = waterGeo.getAttribute("position");
  const wtop: number[] = [];
  for (let i = 0; i < wpos.count; i++) {
    if (wpos.getY(i) > 0) wtop.push(i);
    else wpos.setY(i, -4);
  }
  const wClip = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -(houseX + HOUSE.half)),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), houseX - HOUSE.half),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -F),
  ];
  const waterMat = new THREE.MeshStandardMaterial({ color: blue, roughness: 0.22, metalness: 0.08, transparent: true, opacity: 0.86, clippingPlanes: wClip, clipIntersection: true });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.z = 13.5;
  water.receiveShadow = true;
  water.frustumCulled = false;
  scene.add(water);
  let waveT = 0;

  // Agua de adentro (sube con el medidor; al perder llena la sala).
  const inFlood = new THREE.Mesh(
    new THREE.BoxGeometry(2 * HOUSE.half - 2 * HOUSE.t, 0.02, F - HOUSE.back - 2 * HOUSE.t),
    new THREE.MeshStandardMaterial({ color: blue, roughness: 0.2, transparent: true, opacity: 0.6 }),
  );
  inFlood.position.set(houseX, FLOOR, (F + HOUSE.back) / 2);
  inFlood.visible = false;
  scene.add(inFlood);

  // Nubes (capa del cielo): tapan la barra; adentro de la casa se suben y no se ven.
  const cloudMat = new THREE.MeshStandardMaterial({ color: dark ? 0x4d5560 : 0x6c7581, roughness: 1, emissive: 0x15191f });
  const CD = 7;
  const cHalfH = CD * tanOf(FOV);
  const cHalfW = cHalfH * camera.aspect;
  const clouds: CloudSlot[] = [];
  for (let x = -cHalfW - 0.6, i = 0; x <= cHalfW + 0.8; x += 1.25, i++) {
    const obj = buildCloud(cloudMat, rand(0.82, 1.05));
    const home = new THREE.Vector3(x, cHalfH - 0.08 + rand(-0.06, 0.06), -CD + rand(-0.2, 0.2));
    obj.position.copy(home);
    obj.position.x -= cHalfW * 2 + 2;
    skyScene.add(obj);
    clouds.push({ obj, home, i });
  }

  // Lluvia en el mundo, solo afuera de la casa (desde adentro se ve por la puerta y la ventana).
  const DROPS = 1500;
  const rainPos = new Float32Array(DROPS * 6);
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: 0xc3dbff, transparent: true, opacity: 0 });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  scene.add(rain);
  const spawnDrop = (d: Drop, anywhere: boolean) => {
    d.x = camera.position.x + rand(-11, 11);
    d.z = F + rand(0.35, 12);
    d.y = anywhere ? rand(-0.2, 8.5) : rand(7.5, 9.5);
    d.v = rand(9, 13);
    d.len = rand(0.25, 0.4);
  };
  const drops: Drop[] = Array.from({ length: DROPS }, () => {
    const d: Drop = { x: 0, y: 0, z: 0, v: 0, len: 0 };
    spawnDrop(d, true);
    return d;
  });

  // Relámpago: rayo en el cielo (solo afuera) y destello.
  const boltMat = new THREE.LineBasicMaterial({ color: 0xfffbe6, transparent: true, opacity: 0 });
  const bolt = new THREE.Line(new THREE.BufferGeometry(), boltMat);
  bolt.frustumCulled = false;
  skyScene.add(bolt);

  let levelTween: Tween | null = null;
  const weather = {
    // Nivel del agua de afuera (m) y del agua de adentro sobre el piso (m).
    level: -0.4,
    inLevel: 0,
    cloudsUp: 0,
    waterMat,
    rainMat,
    inFlood,
    clouds,
    cloudsHalfW: cHalfW,

    setLevel(to: number, dur: number, opts: { ease?: (t: number) => number; done?: () => void } = {}): Tween {
      if (levelTween) levelTween.dead = true;
      const from = weather.level;
      levelTween = tl.tween(dur, (k) => (weather.level = lerp(from, to, k)), { ease: E.lin, ...opts });
      return levelTween;
    },

    // Cuando la casa se cae, el agua de afuera ya pasa por donde estaba.
    waterIntoHouse(on: boolean) {
      wClip[2].constant = on ? 1e4 : -F;
    },

    raiseClouds(up: boolean, dur = 0.45) {
      const from = weather.cloudsUp;
      const to = up ? 1 : 0;
      tl.tween(dur, (k) => (weather.cloudsUp = lerp(from, to, k)));
    },

    lightning(outside: boolean) {
      if (outside) {
        const z = -9;
        const hh = 9 * tanOf(FOV);
        let x = rand(-hh * camera.aspect * 0.6, hh * camera.aspect * 0.8);
        let y = hh * 0.85;
        const pts = [new THREE.Vector3(x, y, z)];
        while (y > hh * 0.05) {
          x += rand(-0.45, 0.45);
          y -= rand(0.3, 0.6);
          pts.push(new THREE.Vector3(x, y, z));
        }
        bolt.geometry.dispose();
        bolt.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      }
      tl.tween(0.42, (_, k) => {
        const f = k < 0.15 ? k / 0.15 : k < 0.35 ? 1 - (k - 0.15) / 0.2 : k < 0.5 ? ((k - 0.35) / 0.15) * 0.6 : 0.6 * (1 - (k - 0.5) / 0.5);
        flash.style.opacity = String(f * (outside ? (dark ? 0.32 : 0.45) : 0.18));
        boltMat.opacity = outside ? f : 0;
        stage.hemi.intensity = 1.0 + f * 2.2;
        stage.skyHemi.intensity = 1.0 + f * 1.6;
      }, { ease: E.lin });
    },

    update(dt: number, nowMs: number) {
      waveT += dt;
      const level = weather.level;
      for (const i of wtop) {
        const x = wpos.getX(i);
        const z = wpos.getZ(i);
        wpos.setY(i, level + 0.035 * Math.sin(x * 1.6 + waveT * 2.4) + 0.025 * Math.sin(x * 3.1 - waveT * 3.3 + z * 1.7) + 0.015 * Math.sin(z * 4 + waveT * 1.8));
      }
      wpos.needsUpdate = true;
      waterGeo.computeVertexNormals();
      for (let i = 0; i < DROPS; i++) {
        const d = drops[i];
        d.y -= d.v * dt;
        d.x -= d.v * 0.17 * dt;
        if (d.y < Math.max(level, 0)) spawnDrop(d, false);
        const o = i * 6;
        rainPos[o] = d.x;
        rainPos[o + 1] = d.y;
        rainPos[o + 2] = d.z;
        rainPos[o + 3] = d.x + d.len * 0.17;
        rainPos[o + 4] = d.y + d.len;
        rainPos[o + 5] = d.z;
      }
      rainGeo.getAttribute("position").needsUpdate = true;
      for (const c of clouds) c.obj.position.y = c.home.y + 0.03 * Math.sin(nowMs / 900 + c.i) + weather.cloudsUp * 3;
    },
  };
  return weather;
}

export type Weather = ReturnType<typeof createWeather>;
