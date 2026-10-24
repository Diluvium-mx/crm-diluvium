// La tormenta: tercer efecto del cielo de la píldora del tema (clic derecho; theme-sky-effects.ts la
// carga solo cuando le toca, junto con three.js). Prototipo aprobado por el dueño (14 al 24-oct-2026).
//
// Nubes que tapan la barra, lluvia, relámpagos y el agua que sube; entra una casa con una persona que
// pide ayuda. Sin clic en 10 s, la casa se inunda y se cae y la persona se va flotando en una llanta.
// Con clic en la casa: afuera, la Plastiloka (2 barritas → amasar → una bolita por esquina, 3 clics) y
// la tira de hule por el marco; se abre la puerta y, adentro, la compuerta al hueco, el dado a la
// matraca y la matraca al gato y a los 3 tornillos, girando en círculos. Si el medidor «Agua dentro de
// la casa» se llena, la sala se inunda y viene el mismo final. Solo visual: no toca datos ni el tema.
import * as THREE from "three";
import { buildGate, type Gate } from "./gate";
import { clock, createHud, createShell } from "./hud";
import { buildHouse, HOUSE, type Fall, type House } from "./house";
import { disposeTree, E, lerp, mesh, rand, std, Timeline, type Tween } from "./kit";
import { animatePerson, buildPerson, type Person } from "./person";
import {
  buildLump,
  buildPlastiBar,
  buildRatchet,
  buildRubberRoll,
  buildSocket,
  buildStool,
  buildToolCase,
  mixLump,
  PLASTI_GREEN,
  PLASTI_MIXED,
  PLASTI_WHITE,
  SOCKETS,
  type SocketFit,
} from "./pieces";
import { boltsDone, canPlace, canTurn, freshState, jackDone, leakRate, RULES, sealed, type StormState } from "./rules";
import { createStage } from "./stage";
import { createWeather } from "./weather";

const LOGO_URL = "/logo-compuerta.png";
const RECORD_KEY = "theme-sky:storm-best";

export type StormHandle = { leave: () => void };
let active: StormHandle | null = null;

export function startStorm(onClose?: () => void): StormHandle | null {
  if (active) return active;
  if (!window.innerWidth || !window.innerHeight) return null;
  try {
    active = createStorm(() => {
      active = null;
      onClose?.();
    });
  } catch {
    // Sin WebGL no hay tormenta.
    active = null;
  }
  return active;
}

type Kind = "barG" | "barW" | "roll" | "gate" | "kit" | "ratchet" | "socket" | "lump" | "ball";
type Item = {
  obj: THREE.Object3D;
  kind: Kind;
  side: "out" | "in";
  rest: { p: THREE.Vector3; r: THREE.Euler; s: number };
  locked: boolean;
  // Herramientas: llegan cuando la compuerta ya está en la puerta.
  tool: boolean;
  fits: SocketFit;
  body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null;
  mounted: boolean;
};
type Head = { type: "jack" | "bolt"; i: number; pos: THREE.Vector3 };
type Phase = "boot" | "intro" | "play" | "won" | "destroy" | "result" | "leaving";
type Point = { x: number; y: number };

function createStorm(onClose: () => void): StormHandle {
  const dark = document.documentElement.classList.contains("dark");
  const tl = new Timeline();
  const shell = createShell();
  const { root, dim, flash } = shell;
  let stage: ReturnType<typeof createStage>;
  try {
    stage = createStage(root, tl);
  } catch (err) {
    root.remove();
    throw err;
  }
  const hud = createHud(root, () => leave());
  const { scene, shots, houseX, doorX, toScreen } = stage;
  const weather = createWeather(stage, tl, dark, flash);
  const F = HOUSE.front;
  const FLOOR = HOUSE.base;
  const DOOR_HALF = (HOUSE.doorR - HOUSE.doorL) / 2;

  let state: Phase = "boot";
  let house: House | null = null;
  let houseDown = false;
  let person: Person | null = null;
  let tire: THREE.Group | null = null;
  let meter = 0;
  let playT = 0;
  let nextBolt = rand(2.2, 4);
  let shake = 0;
  let logoTex: THREE.Texture = new THREE.Texture();
  let floating = false;
  let floatT = 0;
  let G: StormState = freshState();
  let waitTween: Tween | null = null;

  const windowSpot = () => new THREE.Vector3(HOUSE.win.x, 0.25, F - HOUSE.t - 0.22);
  const spawnHouse = (fromLeft: boolean) => {
    const h = buildHouse(dark);
    h.group.position.x = fromLeft ? houseX - 10 : houseX;
    scene.add(h.group);
    weather.waterIntoHouse(false);
    const p = buildPerson();
    p.group.position.copy(windowSpot());
    p.group.scale.setScalar(0.95);
    p.group.visible = false;
    h.group.add(p.group);
    house = h;
    person = p;
    houseDown = false;
  };
  const fadeCut = (fn: () => void) => {
    hud.fade.style.opacity = "1";
    tl.after(0.34, () => {
      fn();
      tl.after(0.1, () => (hud.fade.style.opacity = "0"));
    });
  };

  /* ── Inicio: tormenta, casa y persona pidiendo ayuda (sin avisos) ── */
  const intro = () => {
    const h = house;
    const p = person;
    if (!h || !p) return;
    state = "intro";
    dim.style.background = `rgb(8 18 32 / ${dark ? 0.38 : 0.3})`;
    dim.style.opacity = "1";
    for (const c of weather.clouds) {
      const from = c.obj.position.x;
      tl.tween(1.3, (k) => (c.obj.position.x = lerp(from, c.home.x, k)), { delay: c.i * 0.06, ease: E.out });
    }
    tl.tween(1.2, (k) => (weather.rainMat.opacity = 0.55 * k), { delay: 0.5 });
    tl.tween(1.4, (k) => (h.group.position.x = lerp(houseX - 10, houseX, k)), { delay: 0.9, ease: E.back });
    tl.after(2.4, () => {
      p.group.visible = true;
      const y0 = p.group.position.y;
      tl.tween(0.45, (k) => (p.group.position.y = lerp(y0 - 0.7, y0, k)), { ease: E.back });
      hud.setBubble("¡Ayuda! ¡Ya viene el agua!");
    });
    tl.after(1.5, () => weather.setLevel(0.09, 10));
    // 10 s para tocar la casa (sin mostrar nada).
    tl.after(3.0, () => {
      if (state !== "intro") return;
      hud.hit.style.display = "block";
      waitTween = tl.tween(10, () => {}, { ease: E.lin, done: () => state === "intro" && floodAndDestroy(false) });
    });
  };

  /* ── Clic en la casa: empieza afuera, frente a la puerta ── */
  hud.hit.addEventListener("click", () => startPlay());
  const startPlay = () => {
    if (state !== "intro" || !person?.group.visible) return;
    state = "play";
    if (waitTween) waitTween.dead = true;
    hud.hit.style.display = "none";
    root.classList.add("playing");
    dim.style.background = `rgb(8 18 32 / ${dark ? 0.6 : 0.5})`;
    hud.setBubble("¡Rápido, que se mete el agua!");
    tl.after(3, () => state === "play" && !G.inside && hud.setBubble(""));
    stage.moveCam(shots.close(), 1.5);
    const o0 = weather.waterMat.opacity;
    tl.tween(1.2, (k) => (weather.waterMat.opacity = lerp(o0, 0.42, k)));
    bringItems();
    hud.showBoard(true);
    meter = 0;
    playT = 0;
    // Agua lenta: llega al escalón de la entrada hacia los 40 s y luego sigue subiendo despacio.
    weather.setLevel(Math.max(weather.level, 0.09), 2.5, {
      done: () => state === "play" && weather.setLevel(FLOOR - 0.005, 38, { done: () => state === "play" && weather.setLevel(0.55, 150) }),
    });
  };

  /* ── Piezas ── */
  let itemsGroup = new THREE.Group();
  let items: Item[] = [];
  let rootOf = new WeakMap<THREE.Object3D, Item>();
  let gate: Gate | null = null;
  const tag = (obj: THREE.Object3D, kind: Kind, side: Item["side"], extra: Partial<Item> = {}): Item => {
    const it: Item = {
      obj,
      kind,
      side,
      rest: { p: obj.position.clone(), r: obj.rotation.clone(), s: obj.scale.x },
      locked: false,
      tool: false,
      fits: null,
      body: null,
      mounted: false,
      ...extra,
    };
    items.push(it);
    obj.traverse((o) => rootOf.set(o, it));
    return it;
  };
  const itemOf = (kind: Kind) => items.find((it) => it.kind === kind) ?? null;

  const buildItems = () => {
    itemsGroup.removeFromParent();
    disposeTree(itemsGroup);
    itemsGroup = new THREE.Group();
    itemsGroup.position.y = -40;
    scene.add(itemsGroup);
    items = [];
    rootOf = new WeakMap();
    // Afuera, en la banqueta: las 2 barritas de Plasti Loka y el rollo de la tira de hule.
    const barG = buildPlastiBar(PLASTI_GREEN.getHex());
    barG.position.set(doorX + 1.3, 0, F + 0.75);
    barG.rotation.y = 0.3;
    barG.scale.setScalar(1.6);
    const barW = buildPlastiBar(PLASTI_WHITE.getHex());
    barW.position.set(doorX + 1.62, 0, F + 1.05);
    barW.rotation.y = -0.25;
    barW.scale.setScalar(1.6);
    const roll = buildRubberRoll();
    roll.position.set(doorX + 0.95, 0, F + 1.35);
    roll.rotation.y = 0.35;
    roll.scale.setScalar(1.25);
    // Adentro: la compuerta recargada bajo la ventana (se ve su parte de atrás).
    gate = buildGate(logoTex);
    gate.group.position.set(houseX + 0.35, FLOOR + 0.3, F - HOUSE.t - 0.085);
    gate.group.rotation.set(0.13, 0, 0);
    // Banquito con el estuche junto a la pared, a la izquierda de la puerta (visto desde adentro).
    const KX = doorX + 0.66;
    const KZ = 1.0;
    const KY = FLOOR + 0.42;
    const stool = buildStool();
    stool.position.set(KX, FLOOR, KZ);
    stool.rotation.y = Math.PI / 2;
    const kit = buildToolCase();
    kit.position.set(KX, KY, KZ);
    kit.rotation.y = -Math.PI / 2;
    const ratchet = buildRatchet();
    ratchet.position.set(KX + 0.07, KY + 0.082, KZ + 0.17);
    ratchet.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    ratchet.scale.setScalar(1.3);
    const sockets = SOCKETS.map((sz, i) => {
      const s = buildSocket(sz);
      s.group.position.set(KX - 0.08, KY + 0.098, KZ - 0.15 + i * 0.11);
      s.group.rotation.set(-Math.PI / 2, 0, 0);
      s.group.scale.setScalar(1.3);
      return { ...s, fits: sz.fits };
    });
    [barG, barW, roll, gate.group, stool, kit, ratchet, ...sockets.map((s) => s.group)].forEach((o) => itemsGroup.add(o));
    tag(barG, "barG", "out");
    tag(barW, "barW", "out");
    tag(roll, "roll", "out");
    tag(gate.group, "gate", "in");
    for (const o of [stool, kit]) tag(o, "kit", "in", { tool: true });
    tag(ratchet, "ratchet", "in", { tool: true });
    for (const s of sockets) tag(s.group, "socket", "in", { tool: true, fits: s.fits, body: s.body });
    for (const it of items) if (it.tool) it.obj.visible = false;
  };
  const bringItems = () => {
    itemsGroup.position.y = 0;
    items
      .filter((it) => it.side === "out")
      .forEach((it, i) => {
        const y = it.rest.p.y;
        it.obj.position.y = y + 1.6;
        tl.tween(0.7, (k) => (it.obj.position.y = lerp(y + 1.6, y, k)), { delay: 0.9 + i * 0.18, ease: E.back });
      });
  };
  const bringTools = () => {
    for (const it of items) {
      if (!it.tool) continue;
      const y = it.rest.p.y;
      it.obj.visible = true;
      it.obj.position.y = y + 1.2;
      tl.tween(0.55, (k) => (it.obj.position.y = lerp(y + 1.2, y, k)), { delay: 0.35, ease: E.back });
    }
  };

  // Lo que se va colocando: la tira por el marco, las bolitas en las esquinas y las guías al arrastrar.
  const placed = new THREE.Group();
  scene.add(placed);
  const rubberMat = std(0x141516, { roughness: 0.6 });
  const JAMB = DOOR_HALF - 0.016;
  const STRIP_H = 0.62;
  const stripPath = [
    new THREE.Vector3(doorX - JAMB, FLOOR + STRIP_H, F - 0.014),
    new THREE.Vector3(doorX - JAMB, FLOOR + 0.008, F - 0.03),
    new THREE.Vector3(doorX + JAMB, FLOOR + 0.008, F - 0.03),
    new THREE.Vector3(doorX + JAMB, FLOOR + STRIP_H, F - 0.014),
  ];
  const segLen = [STRIP_H, JAMB * 2, STRIP_H];
  const pathLen = segLen[0] + segLen[1] + segLen[2];
  const pathPoint = (pv: number, out = new THREE.Vector3()) => {
    let d = pv * pathLen;
    for (let i = 0; i < 3; i++) {
      if (d <= segLen[i] || i === 2) return out.lerpVectors(stripPath[i], stripPath[i + 1], Math.min(1, Math.max(0, d / segLen[i])));
      d -= segLen[i];
    }
    return out;
  };
  const mkStrip = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const m = mesh(geo, rubberMat, { cast: false });
    m.position.set(x, y, z);
    m.visible = false;
    placed.add(m);
    return m;
  };
  // Bandas de hule al filo de los laterales (se ven desde afuera) y en el piso de la entrada.
  const stripL = mkStrip(new THREE.BoxGeometry(0.034, STRIP_H, 0.026).translate(0, -STRIP_H / 2, 0), doorX - JAMB, FLOOR + STRIP_H, F - 0.014);
  const stripF = mkStrip(new THREE.BoxGeometry(JAMB * 2, 0.014, 0.09).translate(JAMB, 0, 0), doorX - JAMB, FLOOR + 0.007, F - 0.055);
  const stripR = mkStrip(new THREE.BoxGeometry(0.034, STRIP_H, 0.026).translate(0, STRIP_H / 2, 0), doorX + JAMB, FLOOR, F - 0.014);
  const setStrip = (pv: number) => {
    let d = pv * pathLen;
    const a = Math.min(1, d / segLen[0]);
    d -= segLen[0];
    const b = Math.max(0, Math.min(1, d / segLen[1]));
    d -= segLen[1];
    const c = Math.max(0, Math.min(1, d / segLen[2]));
    stripL.visible = a > 0;
    stripL.scale.y = Math.max(0.001, a);
    stripF.visible = b > 0;
    stripF.scale.x = Math.max(0.001, b);
    stripR.visible = c > 0;
    stripR.scale.y = Math.max(0.001, c);
  };
  const doorTarget = new THREE.Vector3(doorX, FLOOR, F);
  const doorwayCenter = new THREE.Vector3(doorX, FLOOR + 0.32, F - 0.06);
  const cornerPos = (i: number) => new THREE.Vector3(doorX + (i ? 1 : -1) * (DOOR_HALF - 0.04), FLOOR + 0.04, F - 0.025);

  // Guías al arrastrar: dónde va la compuerta, el camino de la tira y aros en las esquinas y tornillos.
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const gateGhost = new THREE.Mesh(new THREE.PlaneGeometry(0.93, 0.6), ghostMat);
  gateGhost.position.set(doorX, FLOOR + 0.32, F - 0.11);
  gateGhost.rotation.y = Math.PI;
  placed.add(gateGhost);
  const GUIDE = 0xfe9f29;
  // Rayitas naranjas por el marco (una línea de WebGL siempre mide 1 px).
  const lineMat = new THREE.MeshBasicMaterial({ color: GUIDE, transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false });
  for (let i = 0; i < 3; i++) {
    const a = stripPath[i];
    const b = stripPath[i + 1];
    const n = Math.max(2, Math.round(a.distanceTo(b) / 0.075));
    const geo = i === 1 ? new THREE.BoxGeometry(0.045, 0.022, 0.02) : new THREE.BoxGeometry(0.022, 0.045, 0.02);
    for (let k = 0; k < n; k++) {
      const dash = new THREE.Mesh(geo, lineMat);
      dash.position.lerpVectors(a, b, (k + 0.5) / n).add(new THREE.Vector3(0, i === 1 ? 0.012 : 0, 0.03));
      dash.renderOrder = 5;
      placed.add(dash);
    }
  }
  const ringMat = new THREE.MeshBasicMaterial({ color: GUIDE, transparent: true, opacity: 0, depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false });
  const cornerRings = [0, 1].map((i) => {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.055, 0.08, 32), ringMat);
    r.position.copy(cornerPos(i)).add(new THREE.Vector3(0, 0.02, 0.03));
    r.renderOrder = 5;
    placed.add(r);
    return r;
  });
  const headRings = [0, 1, 2, 3].map(() => {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.032, 0.048, 32), ringMat);
    r.rotation.y = Math.PI;
    r.renderOrder = 5;
    r.visible = false;
    placed.add(r);
    return r;
  });
  let ghostKind: "ball" | "roll" | "gate" | "heads" | null = null;

  const setGlow = (it: Item | null, on: boolean) =>
    it?.obj.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial && !o.material.vertexColors) o.material.emissive.setHex(on ? 0x303030 : 0x000000);
    });
  const tweenTo = (o: THREE.Object3D, pos: THREE.Vector3, rot: THREE.Euler | null, dur: number, opts: Parameters<Timeline["tween"]>[2] = {}) => {
    const p0 = o.position.clone();
    const r0 = o.rotation.clone();
    return tl.tween(dur, (k) => {
      o.position.lerpVectors(p0, pos, k);
      if (rot) o.rotation.set(lerp(r0.x, rot.x, k), lerp(r0.y, rot.y, k), lerp(r0.z, rot.z, k));
    }, opts);
  };
  const returnItem = (it: Item) => tweenTo(it.obj, it.rest.p.clone(), it.rest.r, 0.45, { ease: E.out });
  const wiggle = (it: Item, then: () => void) => {
    const x0 = it.obj.position.x;
    tl.tween(0.4, (_, k) => (it.obj.position.x = x0 + Math.sin(k * Math.PI * 6) * 0.04 * (1 - k)), { ease: E.lin, done: then });
  };
  const reject = (it: Item) => {
    G.mistakes++;
    wiggle(it, () => returnItem(it));
  };

  /* ── Plastiloka: juntar las barritas, amasar, una bolita por esquina y 3 clics ── */
  let lump: THREE.Mesh | null = null;
  const blobs: (THREE.Mesh | null)[] = [null, null];
  let tipShown = false;
  const mergeBars = (a: Item, b: Item) => {
    a.locked = b.locked = true;
    const at = b.obj.position.clone();
    tl.tween(0.18, (k) => {
      a.obj.position.lerp(at, k);
      a.obj.scale.setScalar(1.6 * (1 - k * 0.8));
      b.obj.scale.setScalar(1.6 * (1 - k * 0.8));
    }, { done: () => (a.obj.visible = b.obj.visible = false) });
    const l = buildLump();
    l.position.set(at.x, 0.07, at.z);
    l.scale.setScalar(0.01);
    itemsGroup.add(l);
    tag(l, "lump", "out");
    lump = l;
    tl.tween(0.3, (k) => l.scale.set(2 * Math.max(0.01, k), 1.15 * Math.max(0.01, k), 1.7 * Math.max(0.01, k)), { delay: 0.15, ease: E.back });
    // Indicación breve (pedido del dueño): solo la primera vez.
    if (!tipShown) {
      tipShown = true;
      tl.after(0.4, () => hud.showTip(true));
      tl.after(3.0, () => hud.showTip(false));
    }
  };
  let knead: { lastX: number; dir: number; travel: number } | null = null;
  const doKnead = () => {
    const l = lump;
    if (!l) return;
    G.kneads++;
    mixLump(l, G.kneads >= RULES.kneads ? 1 : 0.32);
    const s0 = l.scale.clone();
    tl.tween(0.16, (_, k) => l.scale.set(s0.x * (1 + Math.sin(k * Math.PI) * 0.18), s0.y * (1 - Math.sin(k * Math.PI) * 0.15), s0.z), { ease: E.lin });
    if (G.kneads >= RULES.kneads) {
      knead = null;
      tl.after(0.25, splitLump);
    }
  };
  const splitLump = () => {
    const l = lump;
    if (!l) return;
    hud.showTip(false);
    const li = rootOf.get(l);
    if (li) li.locked = true;
    const at = l.position.clone();
    l.visible = false;
    [-1, 1].forEach((sx) => {
      const b = mesh(new THREE.SphereGeometry(0.05, 22, 16), std(PLASTI_MIXED.getHex(), { roughness: 0.9 }));
      b.position.copy(at).add(new THREE.Vector3(sx * 0.03, 0, 0));
      itemsGroup.add(b);
      const dest = at.clone().add(new THREE.Vector3(sx * 0.16, -0.02, 0.03));
      tl.tween(0.3, (k) => b.position.lerpVectors(at, dest, k), { ease: E.back, done: () => void tag(b, "ball", "out") });
    });
  };
  const placeBall = (it: Item, i: number) => {
    it.locked = true;
    if (it.obj instanceof THREE.Mesh) blobs[i] = it.obj;
    tweenTo(it.obj, cornerPos(i), null, 0.25, { ease: E.out });
  };
  const squash = (i: number) => {
    const m = blobs[i];
    if (!m) return;
    G.putty[i]++;
    const n = G.putty[i];
    const sy0 = m.scale.y;
    const sx0 = m.scale.x;
    const sy1 = Math.max(0.3, 1 - 0.24 * n);
    const sx1 = 1 + 0.22 * n;
    tl.tween(0.14, (k) => {
      m.scale.y = lerp(sy0, sy1 * 0.85, k);
      m.scale.x = m.scale.z = lerp(sx0, sx1 * 1.05, k);
    }, {
      ease: E.out,
      done: () => tl.tween(0.12, (k) => {
        m.scale.y = lerp(sy1 * 0.85, sy1, k);
        m.scale.x = m.scale.z = lerp(sx1 * 1.05, sx1, k);
      }),
    });
    m.position.y = FLOOR + 0.04 - 0.01 * n;
  };

  /* ── Tira: el rollo al marco y se desenrolla con el mouse ── */
  const snapRoll = (it: Item) => {
    it.locked = true;
    const start = pathPoint(0).clone().add(new THREE.Vector3(0, -0.11 * it.obj.scale.y, 0.08));
    tweenTo(it.obj, start, new THREE.Euler(0, 0, 0), 0.5, {
      ease: E.out,
      done: () => {
        G.strip = 1;
        G.stripP = 0;
      },
    });
  };
  const placeRollOnPath = () => {
    const r = itemOf("roll")?.obj;
    if (!r) return;
    const s = Math.max(0.45, 1.25 * (1 - 0.6 * G.stripP));
    r.scale.setScalar(s);
    const pp = pathPoint(G.stripP);
    r.position.set(pp.x, pp.y - 0.11 * s, pp.z + 0.08);
    const rollo = r.getObjectByName("rollo");
    if (rollo) rollo.rotation.y = -G.stripP * 30;
    const cola = r.getObjectByName("cola");
    if (cola) cola.visible = false;
  };
  let unrolling = false;
  const advanceStrip = (cx: number, cy: number) => {
    let best = G.stripP;
    let bestD = 1e9;
    for (let k = 0; k <= 60; k++) {
      const t = G.stripP - 0.02 + k * (0.2 / 60);
      if (t < 0 || t > 1) continue;
      const sp = toScreen(pathPoint(t));
      const d = Math.hypot(sp.x - cx, sp.y - cy);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (bestD < 95 && best > G.stripP) G.stripP = Math.min(1, best);
    setStrip(G.stripP);
    placeRollOnPath();
    if (G.stripP >= 0.985) {
      G.strip = 2;
      G.stripP = 1;
      setStrip(1);
      unrolling = false;
      const r = itemOf("roll")?.obj;
      if (r) tl.tween(0.3, (k) => r.scale.setScalar(Math.max(0.001, 0.5 * (1 - k))), { done: () => (r.visible = false) });
      tl.after(0.5, openDoor);
    }
  };

  /* ── Se abre la puerta y la cámara entra ── */
  const openDoor = () => {
    const h = house;
    if (state !== "play" || !h) return;
    G.phase = "opening";
    ghostKind = null;
    hud.setBubble("");
    tl.tween(1.1, (k) => (h.doorPivot.rotation.y = 1.75 * k), { ease: E.inOut });
    tl.after(0.9, () => stage.moveCam(shots.door(), 0.75, { ease: E.in }));
    tl.after(1.55, () =>
      fadeCut(() => {
        if (state !== "play") return;
        stage.cutCam(shots.inside());
        weather.raiseClouds(true, 0.01);
        dim.style.opacity = "0";
        G.inside = true;
        G.phase = "in";
        // Adentro la persona no sale en cuadro: su voz va en un globo fijo.
        if (person) person.group.visible = false;
        hud.showPress(true);
        hud.setBubble("¡Ya se está metiendo el agua!");
        tl.after(2.4, () => state === "play" && hud.setBubble(""));
      }),
    );
  };

  /* ── Adentro: compuerta, dado a la matraca, matraca al tornillo y girar en círculos ── */
  const GATE_LOOSE = 0.93;
  const GATE_TIGHT = 0.955;
  const GATE_Y = FLOOR + 0.314;
  const GATE_Z = F - 0.055;
  const snapGate = (it: Item) => {
    it.locked = true;
    const g = it.obj;
    const sx0 = g.scale.x;
    tweenTo(g, new THREE.Vector3(doorX, GATE_Y + 0.04, GATE_Z), new THREE.Euler(0, 0, 0), 0.6, { ease: E.inOut });
    tl.tween(0.6, (k) => (g.scale.x = lerp(sx0, GATE_LOOSE, k)));
    tl.after(0.6, () =>
      tweenTo(g, new THREE.Vector3(doorX, GATE_Y, GATE_Z), null, 0.15, {
        ease: E.in,
        done: () => {
          G.gate = true;
          tl.tween(0.25, (_, k) => (g.position.y = GATE_Y + Math.sin(k * Math.PI) * 0.008), { ease: E.lin });
          stage.moveCam(shots.work(), 0.9);
          bringTools();
        },
      }),
    );
  };
  const headsNow = (): Head[] => {
    if (!gate || !G.gate) return [];
    const out: Head[] = [{ type: "jack", i: 0, pos: gate.jackHead.getWorldPosition(new THREE.Vector3()) }];
    gate.boltHeads.forEach((h, i) => out.push({ type: "bolt", i, pos: h.getWorldPosition(new THREE.Vector3()) }));
    return out;
  };
  const ratchetHeadScreen = (): Point => {
    const r = itemOf("ratchet")?.obj;
    return r ? toScreen(r.getWorldPosition(new THREE.Vector3())) : { x: -1e4, y: -1e4 };
  };
  // La matraca puesta en un tornillo.
  let att: { head: Head; count: number; acc: number; prev: number | null } | null = null;
  let mounted: Item | null = null;
  const mountSocket = (sk: Item) => {
    const r = itemOf("ratchet");
    if (!r) return;
    const old = mounted;
    if (old && old !== sk) {
      itemsGroup.attach(old.obj);
      old.mounted = false;
      old.obj.scale.setScalar(old.rest.s);
      tweenTo(old.obj, old.rest.p.clone(), old.rest.r, 0.4, { ease: E.out });
    }
    r.obj.add(sk.obj);
    sk.mounted = true;
    sk.obj.position.set(0, 0, 0.032);
    sk.obj.rotation.set(0, 0, 0);
    sk.obj.scale.setScalar(1);
    mounted = sk;
    tl.tween(0.14, (_, k) => r.obj.scale.setScalar(1.3 * (1 + Math.sin(k * Math.PI) * 0.08)), { ease: E.lin });
  };
  const flashRed = (sk: Item) => {
    const body = sk.body;
    if (!body) return;
    body.material.emissive.setHex(0x661111);
    tl.after(0.35, () => body.material.emissive.setHex(0x000000));
  };
  const tryAttach = (r: Item, head: Head) => {
    const sk = mounted;
    if (!sk || !canTurn(G, head)) {
      reject(r);
      return;
    }
    if (sk.fits !== head.type) {
      // Dado equivocado: destello rojo y 2 s de castigo.
      G.mistakes++;
      G.penalty += 2;
      flashRed(sk);
      wiggle(r, () => returnItem(r));
      return;
    }
    r.obj.position.set(head.pos.x, head.pos.y, head.pos.z - 0.075);
    r.obj.rotation.set(0, 0, 0.6);
    att = { head, count: head.type === "jack" ? G.jack : G.bolts[head.i], acc: 0, prev: null };
  };
  const updatePress = () => {
    const jack = Math.min(G.jack, RULES.jackClicks) / RULES.jackClicks;
    const bolts = G.bolts.reduce((a, b) => a + Math.min(b, RULES.boltClicks), 0) / (RULES.boltClicks * 3);
    hud.setPress(jack * 0.5 + bolts * 0.5);
  };
  let turning = false;
  const finishTurn = () => {
    att = null;
    turning = false;
    tl.after(0.25, () => {
      const r = itemOf("ratchet");
      if (r) returnItem(r);
    });
  };
  const turnClick = () => {
    const a = att;
    const r = itemOf("ratchet")?.obj;
    if (!a || !gate || !r) return;
    const g = gate;
    a.count++;
    tl.tween(0.12, (_, k) => r.scale.setScalar(1.3 * (1 + Math.sin(k * Math.PI) * 0.05)), { ease: E.lin });
    if (a.head.type === "jack") {
      G.jack = a.count;
      const sv = Math.min(1, G.jack / RULES.jackClicks);
      g.setJack(sv);
      const target = lerp(GATE_LOOSE, GATE_TIGHT, sv);
      tl.tween(0.18, (_, k) => (g.group.scale.x = target + Math.sin(k * Math.PI) * 0.006), { ease: E.lin });
      if (jackDone(G)) finishTurn();
    } else {
      G.bolts[a.head.i] = a.count;
      g.setBolt(a.head.i, Math.min(1, a.count / RULES.boltClicks));
      const done = G.bolts.reduce((s, b) => s + Math.min(b, RULES.boltClicks), 0) / (RULES.boltClicks * 3);
      g.group.position.y = GATE_Y - 0.005 * done;
      stripF.scale.y = 1 - 0.45 * done;
      if (a.count >= RULES.boltClicks) finishTurn();
    }
    updatePress();
  };
  const turnPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const turnTo = (cx: number, cy: number) => {
    const a = att;
    const r = itemOf("ratchet")?.obj;
    if (!a || !r) return;
    turnPlane.constant = -a.head.pos.z;
    aim(cx, cy);
    if (!raycaster.ray.intersectPlane(turnPlane, hitPoint)) return;
    const ang = Math.atan2(hitPoint.y - a.head.pos.y, hitPoint.x - a.head.pos.x);
    r.rotation.z = ang;
    if (a.prev == null) {
      a.prev = ang;
      return;
    }
    let d = ang - a.prev;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    a.prev = ang;
    // Visto desde adentro (la cámara mira hacia +z), el ángulo que crece se ve en el sentido del reloj.
    if (d > 0) {
      a.acc += d;
      while (att === a && a.acc >= Math.PI / 3) {
        a.acc -= Math.PI / 3;
        turnClick();
      }
    }
  };

  /* ── Agua que se mete (chorritos que se ven desde adentro) ── */
  const LEAKS = 260;
  const leakPos = new Float32Array(LEAKS * 3);
  const leakGeo = new THREE.BufferGeometry();
  leakGeo.setAttribute("position", new THREE.BufferAttribute(leakPos, 3));
  const leakPts = new THREE.Points(leakGeo, new THREE.PointsMaterial({ color: 0xbfe0ff, size: 0.04, transparent: true, opacity: 0.9, depthWrite: false }));
  leakPts.frustumCulled = false;
  scene.add(leakPts);
  type Leak = { life: number; x: number; y: number; z: number; vx: number; vy: number; vz: number };
  type Source = { x: () => number; y: () => number; z: number; vx: () => number; vz: () => number; w: number };
  const leakDrops: Leak[] = Array.from({ length: LEAKS }, () => ({ life: 0, x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0 }));
  const leakSources = (): Source[] => {
    const level = weather.level;
    if (state !== "play" || !G.inside || level <= FLOOR + 0.004) return [];
    const top = Math.min(0.5, level - FLOOR);
    if (!G.gate) {
      return [{ x: () => doorX + rand(-0.44, 0.44), y: () => FLOOR + rand(0.005, Math.max(0.01, top * 0.8)), z: F - HOUSE.t, vx: () => rand(-0.05, 0.05), vz: () => -rand(0.7, 1.3), w: 3 }];
    }
    const out: Source[] = [];
    if (!jackDone(G)) {
      for (const sx of [-1, 1]) {
        out.push({ x: () => doorX + sx * 0.455, y: () => FLOOR + rand(0.02, Math.max(0.03, top * 0.85)), z: GATE_Z - 0.05, vx: () => -sx * rand(0.1, 0.25), vz: () => -rand(0.5, 0.9), w: 1 });
      }
    }
    if (!boltsDone(G)) out.push({ x: () => doorX + rand(-0.4, 0.4), y: () => FLOOR + 0.012, z: GATE_Z - 0.05, vx: () => rand(-0.05, 0.05), vz: () => -rand(0.4, 0.7), w: 1 });
    return out;
  };
  const updateLeaks = (dt: number) => {
    const src = leakSources();
    const weights = src.reduce((a, s) => a + s.w, 0);
    for (let i = 0; i < LEAKS; i++) {
      const d = leakDrops[i];
      d.life -= dt;
      if (d.life <= 0 || d.y < FLOOR + weather.inLevel - 0.005) {
        if (src.length && Math.random() < 0.5) {
          let pick = Math.random() * weights;
          let s = src[0];
          for (const it of src) {
            pick -= it.w;
            if (pick <= 0) {
              s = it;
              break;
            }
          }
          d.x = s.x();
          d.y = s.y();
          d.z = s.z;
          d.vx = s.vx();
          d.vy = rand(0.05, 0.3);
          d.vz = s.vz();
          d.life = rand(0.4, 0.9);
        } else {
          d.y = -10;
          d.life = rand(0.05, 0.2);
        }
      } else {
        d.vy -= 9.8 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.z += d.vz * dt;
      }
      leakPos[i * 3] = d.x;
      leakPos[i * 3 + 1] = d.y;
      leakPos[i * 3 + 2] = d.z;
    }
    leakGeo.getAttribute("position").needsUpdate = true;
  };

  /* ── Mouse ── */
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line = { threshold: 0.002 };
  raycaster.params.Points = { threshold: 0.002 };
  const ndc = new THREE.Vector2();
  const hitPoint = new THREE.Vector3();
  // Afuera se arrastra a ras del piso; adentro, en un plano de pie frente a la puerta.
  const planeOut = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.16);
  const planeIn = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(F - 0.42));
  const aim = (cx: number, cy: number) => {
    ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, stage.camera);
  };
  const pickItem = (cx: number, cy: number): Item | null => {
    aim(cx, cy);
    const side = G.inside ? "in" : "out";
    const list = items.filter((it) => it.obj.visible && !it.locked && it.side === side && it.kind !== "kit").map((it) => it.obj);
    const hit = raycaster.intersectObjects(list, true).find((h) => h.object instanceof THREE.Mesh);
    if (!hit) return null;
    const it = rootOf.get(hit.object) ?? null;
    return it?.mounted ? itemOf("ratchet") : it;
  };
  const pickBlob = (cx: number, cy: number): number => {
    const live = blobs.filter((b, i): b is THREE.Mesh => !!b && G.putty[i] < RULES.puttyClicks);
    if (!live.length) return -1;
    aim(cx, cy);
    const h = raycaster.intersectObjects(live, false);
    return h.length && h[0].object instanceof THREE.Mesh ? blobs.indexOf(h[0].object) : -1;
  };
  const onRatchet = (cx: number, cy: number) => {
    const r = itemOf("ratchet")?.obj;
    if (!r) return false;
    aim(cx, cy);
    return raycaster.intersectObject(r, true).length > 0;
  };
  const nearStripEnd = (cx: number, cy: number) => {
    const end = toScreen(pathPoint(G.stripP));
    return Math.hypot(end.x - cx, end.y - cy) < 95;
  };
  const capture = (e: PointerEvent) => {
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      // Sin captura el arrastre sigue funcionando mientras el puntero esté sobre la tormenta.
    }
  };
  let drag: { it: Item; off: THREE.Vector3 } | null = null;
  let hover: Item | null = null;
  let lastPtr: Point = { x: 0, y: 0 };

  const onDown = (e: PointerEvent) => {
    if (state !== "play" || e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest("button")) return;
    if (G.phase === "opening") return;
    lastPtr = { x: e.clientX, y: e.clientY };
    if (att) {
      if (onRatchet(e.clientX, e.clientY)) {
        turning = true;
        att.prev = null;
        capture(e);
        root.style.cursor = "grabbing";
      }
      return;
    }
    if (!G.inside && G.strip === 1 && nearStripEnd(e.clientX, e.clientY)) {
      unrolling = true;
      capture(e);
      root.style.cursor = "grabbing";
      return;
    }
    if (!G.inside) {
      const b = pickBlob(e.clientX, e.clientY);
      if (b >= 0) {
        squash(b);
        return;
      }
    }
    const it = pickItem(e.clientX, e.clientY);
    if (!it) return;
    if (it.kind === "lump") {
      knead = { lastX: e.clientX, dir: 0, travel: 0 };
      capture(e);
      root.style.cursor = "ew-resize";
      return;
    }
    aim(e.clientX, e.clientY);
    if (!raycaster.ray.intersectPlane(G.inside ? planeIn : planeOut, hitPoint)) return;
    const off = it.obj.getWorldPosition(new THREE.Vector3()).sub(hitPoint);
    if (G.inside) {
      off.set(0, 0, 0);
      it.obj.rotation.set(0, 0, 0);
    }
    drag = { it, off };
    ghostKind =
      it.kind === "ball" ? (canPlace(G, "putty") ? "ball" : null)
      : it.kind === "roll" ? (canPlace(G, "roll") ? "roll" : null)
      : it.kind === "gate" ? (canPlace(G, "gate") ? "gate" : null)
      : it.kind === "ratchet" && mounted ? "heads"
      : null;
    setGlow(it, false);
    capture(e);
    root.style.cursor = "grabbing";
  };
  const onMove = (e: PointerEvent) => {
    if (state !== "play") return;
    lastPtr = { x: e.clientX, y: e.clientY };
    if (turning && att) {
      turnTo(e.clientX, e.clientY);
      return;
    }
    if (knead) {
      const dx = e.clientX - knead.lastX;
      knead.lastX = e.clientX;
      if (!dx) return;
      const sgn = Math.sign(dx);
      if (sgn !== knead.dir) {
        if (knead.travel >= 26) doKnead();
        if (knead) {
          knead.dir = sgn;
          knead.travel = 0;
        }
      }
      if (knead) knead.travel += Math.abs(dx);
      return;
    }
    if (unrolling) {
      advanceStrip(e.clientX, e.clientY);
      return;
    }
    if (drag) {
      aim(e.clientX, e.clientY);
      const o = drag.it.obj;
      if (G.inside) {
        if (!raycaster.ray.intersectPlane(planeIn, hitPoint)) return;
        o.position.set(hitPoint.x, Math.max(FLOOR + 0.06, hitPoint.y), F - 0.42);
      } else {
        if (!raycaster.ray.intersectPlane(planeOut, hitPoint)) return;
        o.position.set(hitPoint.x + drag.off.x, drag.it.rest.p.y + 0.14, hitPoint.z + drag.off.z);
      }
      return;
    }
    const it = pickItem(e.clientX, e.clientY);
    if (it !== hover) {
      setGlow(hover, false);
      hover = it;
      setGlow(it, true);
    }
    let cursor = it ? (it.kind === "lump" ? "ew-resize" : "grab") : "default";
    if (!it && !G.inside) {
      if (G.strip === 1 && nearStripEnd(e.clientX, e.clientY)) cursor = "grab";
      if (pickBlob(e.clientX, e.clientY) >= 0) cursor = "pointer";
    }
    if (att && onRatchet(e.clientX, e.clientY)) cursor = "grab";
    root.style.cursor = cursor;
  };
  const screenDist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const onUp = () => {
    root.style.cursor = "default";
    if (turning) {
      turning = false;
      return;
    }
    if (knead) {
      if (knead.travel >= 26) doKnead();
      knead = null;
      return;
    }
    if (unrolling) {
      unrolling = false;
      return;
    }
    if (!drag) return;
    const it = drag.it;
    drag = null;
    ghostKind = null;
    const o = it.obj;
    const dxz = (v: THREE.Vector3) => Math.hypot(o.position.x - v.x, o.position.z - v.z);
    if (it.kind === "barG" || it.kind === "barW") {
      const other = itemOf(it.kind === "barG" ? "barW" : "barG");
      if (other && other.obj.visible && dxz(other.obj.position) < 0.28) mergeBars(it, other);
      else returnItem(it);
    } else if (it.kind === "ball") {
      let best = -1;
      let bd = 0.38;
      [0, 1].forEach((i) => {
        if (blobs[i]) return;
        const d = dxz(cornerPos(i));
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (best >= 0 && canPlace(G, "putty")) placeBall(it, best);
      else returnItem(it);
    } else if (it.kind === "roll") {
      if (dxz(doorTarget) >= 0.75) returnItem(it);
      else if (canPlace(G, "roll")) snapRoll(it);
      else reject(it);
    } else if (it.kind === "gate") {
      if (screenDist(lastPtr, toScreen(doorwayCenter)) >= 170) returnItem(it);
      else if (canPlace(G, "gate")) snapGate(it);
      else reject(it);
    } else if (it.kind === "socket") {
      if (!att && screenDist(lastPtr, ratchetHeadScreen()) < 60) mountSocket(it);
      else returnItem(it);
    } else if (it.kind === "ratchet") {
      let best: Head | null = null;
      let bd = 60;
      for (const h of headsNow()) {
        const d = screenDist(lastPtr, toScreen(h.pos));
        if (d < bd) {
          bd = d;
          best = h;
        }
      }
      if (best) tryAttach(it, best);
      else returnItem(it);
    }
  };
  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);

  const updateGhosts = (t: number) => {
    const pulse = 0.22 + 0.12 * Math.sin(t * 6);
    ghostMat.opacity = ghostKind === "gate" ? pulse : 0;
    lineMat.opacity = ghostKind === "roll" ? pulse + 0.5 : 0;
    cornerRings.forEach((r, i) => (r.visible = ghostKind === "ball" && !blobs[i]));
    const hs = ghostKind === "heads" ? headsNow().filter((h) => canTurn(G, h)) : [];
    headRings.forEach((r, i) => {
      const h = hs[i];
      r.visible = !!h;
      if (h) r.position.set(h.pos.x, h.pos.y, h.pos.z - 0.02);
    });
    ringMat.opacity = ghostKind === "ball" || ghostKind === "heads" ? pulse + 0.3 : 0;
  };

  /* ── Ganar / perder ── */
  const stopHands = () => {
    drag = null;
    turning = false;
    knead = null;
    unrolling = false;
    ghostKind = null;
  };
  const win = () => {
    state = "won";
    stopHands();
    const total = playT + G.penalty;
    const stars = total <= 75 && G.mistakes <= 1 && meter < 0.35 ? 3 : total <= 120 && meter < 0.7 ? 2 : 1;
    let best: number | null = null;
    try {
      best = Number(window.localStorage.getItem(RECORD_KEY)) || null;
      if (!best || total < best) window.localStorage.setItem(RECORD_KEY, String(total));
    } catch {
      // Sin almacenamiento no hay mejor tiempo.
    }
    tl.after(0.7, () =>
      fadeCut(() => {
        G.inside = false;
        stage.cutCam(shots.win());
        weather.raiseClouds(false, 0.01);
        dim.style.opacity = "1";
        hud.showPress(false);
        if (person) {
          person.group.position.copy(windowSpot());
          person.group.rotation.y = 0;
          person.group.visible = true;
          person.mode = "cheer";
        }
        hud.setBubble("¡Gracias! Aquí no pasa el agua 💧");
        weather.setLevel(FLOOR + 0.42, 2.2, { ease: E.inOut });
      }),
    );
    tl.after(3.9, () => {
      state = "result";
      hud.showBoard(false);
      const lines = [`Tiempo ${clock(total)} · ${"⭐".repeat(stars)}${"☆".repeat(3 - stars)}`];
      if (best) lines.push(`Tu mejor tiempo: ${clock(Math.min(best, total))}`);
      hud.showCard("¡Aquí no pasó el agua!", lines, "Otra vez", retry, () => calm(false));
    });
  };
  const lose = () => {
    const h = house;
    if (!G.inside || !h) {
      floodAndDestroy(true);
      return;
    }
    state = "destroy";
    stopHands();
    hud.setBubble("¡Se metió el agua!");
    if (person) person.mode = "frantic";
    stage.moveCam(shots.inside(), 0.7);
    const l0 = weather.inLevel;
    tl.tween(1.8, (k) => (weather.inLevel = lerp(l0, 1.2, k)), { ease: E.inOut, delay: 0.3 });
    for (const p of h.props) {
      if (p.y0 > 0.5) continue; // el cuadro se queda en la pared
      const y0 = p.obj.position.y;
      tl.tween(1.8, (k) => (p.obj.position.y = y0 + 1.05 * k + Math.sin(k * 9) * 0.03), { ease: E.inOut, delay: 0.3 });
    }
    tl.after(2.2, () =>
      fadeCut(() => {
        G.inside = false;
        stage.cutCam(shots.wide());
        weather.raiseClouds(false, 0.01);
        dim.style.opacity = "1";
        hud.showPress(false);
        if (person) {
          person.group.position.copy(windowSpot());
          person.group.rotation.y = 0;
          person.group.visible = true;
        }
        floodAndDestroy(true, true);
      }),
    );
  };

  /* ── Inundación y destrucción (sin clic, o al perder) ── */
  const floodAndDestroy = (lost: boolean, fromInside = false) => {
    const h = house;
    const p = person;
    if (!h || !p) return;
    state = "destroy";
    stopHands();
    hud.hit.style.display = "none";
    hud.showBoard(false);
    hud.showTip(false);
    const o0 = weather.waterMat.opacity;
    tl.tween(1.0, (k) => (weather.waterMat.opacity = lerp(o0, 0.86, k)));
    hud.setBubble("¡Noooo, se mete el agua!");
    // Se va la luz de la sala.
    const i0 = h.lamp.intensity;
    tl.tween(0.8, (k) => (h.lamp.intensity = i0 * (1 - k)), { delay: 0.6 });
    let t0 = 0;
    if (lost && !fromInside) {
      stage.moveCam(shots.wide(), 1.2);
      t0 = 1.0;
    }
    tl.after(t0, () => weather.setLevel(2.65, 2.8, { ease: E.inOut }));
    // La persona se sube al techo.
    tl.after(t0 + 0.9, () => {
      hud.setBubble("¡Al techo!");
      p.mode = "climb";
      const p0 = p.group.position.clone();
      const p1 = new THREE.Vector3(1.2, HOUSE.base + HOUSE.wallH + 1.6 * (1 - 1.2 / 2.95) + 0.1, 0.45);
      tl.tween(1.15, (k) => {
        p.group.position.set(lerp(p0.x, p1.x, k), lerp(p0.y, p1.y, E.out(k)) + Math.sin(Math.PI * k) * 0.6, lerp(p0.z, p1.z, k) + Math.sin(Math.PI * k) * 0.7);
      }, { ease: E.inOut, done: () => (p.mode = "frantic") });
    });
    tl.tween(0.9, (k) => (shake = 0.05 * Math.sin(k * Math.PI)), { delay: t0 + 2.2, ease: E.lin });
    tl.after(t0 + 3.1, () => collapse(h, p, lost));
  };
  const collapse = (h: House, p: Person, lost: boolean) => {
    shake = 0;
    houseDown = true;
    weather.waterIntoHouse(true);
    const falling: { obj: THREE.Object3D; fall: Fall | null }[] = [
      ...h.pieces.filter((pc) => pc.fall),
      ...h.props.map((pr) => ({ obj: pr.obj, fall: { dx: rand(-0.5, 1.5), dy: -3.5, rz: rand(-1, 1) } })),
    ];
    for (const { obj, fall } of falling) {
      const f = fall ?? {};
      const p0 = obj.position.clone();
      const r0 = obj.rotation.clone();
      const drift = rand(2.2, 3.4);
      tl.tween(2.6, (k) => {
        obj.position.set(p0.x + (f.dx ?? 0) * k + drift * k, p0.y + (f.dy ?? 0) * k, p0.z + (f.dz ?? 0) * k);
        obj.rotation.set(r0.x + (f.rx ?? 0) * k, r0.y + 0.3 * k, r0.z + (f.rz ?? 0) * k);
      }, { ease: E.in });
    }
    // La persona cae a una llanta y se va flotando, saludando.
    scene.attach(p.group);
    const t = new THREE.Group();
    const torus = mesh(new THREE.TorusGeometry(0.46, 0.17, 18, 40), std(0x1b1b1d, { roughness: 0.75 }));
    torus.rotation.x = Math.PI / 2;
    t.add(torus);
    const rim = mesh(new THREE.TorusGeometry(0.3, 0.025, 8, 32), std(0x9aa0a6, { metalness: 0.8, roughness: 0.35 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.06;
    t.add(rim);
    t.position.set(p.group.position.x + 0.3, 2.65, 2.2);
    t.scale.setScalar(0.01);
    scene.add(t);
    tire = t;
    tl.tween(0.45, (k) => t.scale.setScalar(Math.max(0.01, k)), { ease: E.back });
    const pp = p.group.position.clone();
    tl.tween(0.75, (k) => {
      p.group.position.set(lerp(pp.x, t.position.x, k), lerp(pp.y, t.position.y - 0.66, E.in(k)) + Math.sin(Math.PI * k) * 0.5, lerp(pp.z, t.position.z, k));
    }, {
      delay: 0.15,
      done: () => {
        p.mode = "float";
        hud.setBubble("¡Uf, me salvé! 👋");
        floatT = 0;
        floating = true;
      },
    });
    tl.after(lost ? 3.4 : 3.2, () => (lost ? showLost() : calm(false)));
  };
  const showLost = () => {
    state = "result";
    hud.showCard("¡Se metió el agua!", ["La casa no aguantó. ¿Lo intentas otra vez?"], "Reintentar", retry, () => calm(false));
  };
  const clearHouse = () => {
    for (const obj of [house?.group, tire, person?.group]) {
      if (!obj) continue;
      obj.removeFromParent();
      disposeTree(obj);
    }
    house = null;
    tire = null;
    person = null;
    floating = false;
  };
  const resetPieces = () => {
    G = freshState();
    att = null;
    mounted = null;
    stopHands();
    lump = null;
    blobs[0] = blobs[1] = null;
    tipShown = false;
    setStrip(0);
    stripF.scale.y = 1;
    weather.inLevel = 0;
    hud.showPress(false);
    hud.setPress(0);
    buildItems();
  };
  const retry = () => {
    clearHouse();
    hud.setBubble("");
    weather.setLevel(0.09, 1.2, { ease: E.inOut });
    spawnHouse(true);
    const h = house;
    if (person) person.group.visible = true;
    if (h) tl.tween(1.2, (k) => (h.group.position.x = lerp(houseX - 10, houseX, k)), { ease: E.back });
    resetPieces();
    state = "intro";
    tl.after(1.3, () => startPlay());
  };

  /* ── La tormenta pasa y todo vuelve a la normalidad ── */
  const calm = (fast: boolean) => {
    if (state === "leaving") return;
    if (G.inside) {
      G.inside = false;
      stage.cutCam(shots.wide());
      weather.raiseClouds(false, 0.01);
      hud.showPress(false);
      if (person) person.group.visible = true;
    }
    state = "leaving";
    hud.setBubble(floating ? "¡Uf, me salvé! 👋" : "");
    hud.hit.style.display = "none";
    hud.showTip(false);
    hud.showBoard(false);
    root.classList.remove("playing");
    const d = fast ? 0.5 : 1;
    const r0 = weather.rainMat.opacity;
    tl.tween(1.4 * d, (k) => (weather.rainMat.opacity = lerp(r0, 0, k)));
    for (const c of weather.clouds) {
      const from = c.obj.position.x;
      tl.tween(1.5 * d, (k) => (c.obj.position.x = from + k * (weather.cloudsHalfW * 2 + 3)), { delay: 0.3 * d + c.i * 0.04, ease: E.in });
    }
    tl.after(0.5 * d, () => weather.setLevel(-0.45, 2.4 * d, { ease: E.inOut }));
    const h = house;
    if (h && !houseDown) {
      const hx = h.group.position.x;
      tl.tween(1.2 * d, (k) => (h.group.position.x = lerp(hx, houseX - 11, k)), { delay: 0.6 * d, ease: E.in });
    }
    if (itemsGroup.position.y === 0) tl.tween(0.8 * d, (k) => (itemsGroup.position.y = lerp(0, -1.5, k)), { delay: 0.4 * d, ease: E.in });
    stage.moveCam(shots.wide(), 1.2 * d);
    tl.after(1.6 * d, () => (dim.style.opacity = "0"));
    tl.after(3.4 * d, () => {
      hud.setBubble("");
      destroy();
    });
  };
  const leave = () => {
    if (state === "leaving") return;
    hud.closeCard();
    if (state === "boot") {
      destroy();
      return;
    }
    calm(true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") leave();
  };
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", stage.resize);

  /* ── Bucle ── */
  let raf = 0;
  let last = performance.now();
  let alive = true;
  const frame = (now: number) => {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tl.update(dt);
    weather.update(dt, now);
    if (state !== "leaving" && (nextBolt -= dt) <= 0) {
      weather.lightning(!G.inside);
      nextBolt = rand(3.5, 7);
    }
    const h = house;
    const p = person;
    if (h) {
      h.group.position.y = 0;
      if (shake) h.group.position.x = houseX + rand(-1, 1) * shake;
    }
    if (p) animatePerson(p, dt);
    if (floating && tire && p) {
      floatT += dt;
      tire.position.x += dt * 1.6;
      tire.position.y = weather.level + 0.06 + 0.06 * Math.sin(floatT * 3);
      tire.rotation.z = 0.08 * Math.sin(floatT * 2.2);
      p.group.position.set(tire.position.x, tire.position.y - 0.66, tire.position.z - 0.05);
      p.group.rotation.z = tire.rotation.z;
    }
    if (state === "play" && G.phase !== "opening") {
      playT += dt;
      hud.setTime(playT);
      meter += dt * leakRate(G, weather.level - FLOOR);
      hud.setMeter(meter);
      weather.inLevel = Math.min(0.1, meter * 0.1);
      if (sealed(G)) win();
      else if (meter >= 1) lose();
    }
    if (state === "destroy" && h && !houseDown) weather.inLevel = Math.max(weather.inLevel, weather.level - FLOOR);
    const flood = weather.inFlood;
    flood.visible = !!h && !houseDown && weather.inLevel > 0.004;
    if (h) flood.position.x = h.group.position.x;
    flood.position.y = FLOOR + weather.inLevel - 0.008;
    updateLeaks(dt);
    updateGhosts(now / 1000);
    placeLabels(p, h);
    stage.render(weather.cloudsUp < 0.999);
    raf = requestAnimationFrame(frame);
  };
  // Globo de la persona, indicación de amasar y zona de clic de la casa (siguen a la escena).
  const headAt = new THREE.Vector3();
  const placeLabels = (p: Person | null, h: House | null) => {
    const { bubble, tip, hit } = hud;
    bubble.classList.toggle("free", !!p && !p.group.visible);
    if (p && bubble.classList.contains("show")) {
      if (!p.group.visible) {
        bubble.style.left = "24px";
        bubble.style.top = "112px";
      } else {
        p.head.getWorldPosition(headAt);
        headAt.y += 0.32;
        const sp = toScreen(headAt);
        bubble.style.left = `${Math.min(window.innerWidth - bubble.offsetWidth / 2 - 12, Math.max(bubble.offsetWidth / 2 + 12, sp.x))}px`;
        bubble.style.top = `${Math.max(bubble.offsetHeight + 16, sp.y)}px`;
      }
    }
    if (lump && tip.classList.contains("show")) {
      const sp = toScreen(lump.position);
      tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth / 2 - 12, sp.x)}px`;
      tip.style.top = `${sp.y}px`;
    }
    if (h && state === "intro") {
      const b = new THREE.Box3().setFromObject(h.group);
      const corners = [
        new THREE.Vector3(b.min.x, b.min.y, b.max.z),
        new THREE.Vector3(b.max.x, b.max.y, b.max.z),
        new THREE.Vector3(b.min.x, b.max.y, b.max.z),
        new THREE.Vector3(b.max.x, b.min.y, b.max.z),
      ].map(toScreen);
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      Object.assign(hit.style, {
        left: `${Math.min(...xs)}px`,
        top: `${Math.min(...ys)}px`,
        width: `${Math.max(...xs) - Math.min(...xs)}px`,
        height: `${Math.max(...ys) - Math.min(...ys)}px`,
      });
    }
  };

  const destroy = () => {
    if (!alive) return;
    alive = false;
    cancelAnimationFrame(raf);
    tl.clear();
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", stage.resize);
    disposeTree(stage.scene);
    disposeTree(stage.skyScene);
    stage.dispose();
    root.remove();
    onClose();
  };

  // Antes de la tormenta: logo, casa y piezas listas y sombreadores compilados (sin tirones al empezar).
  void (async () => {
    try {
      const tex = await new THREE.TextureLoader().loadAsync(LOGO_URL);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      logoTex = tex;
    } catch {
      // Sin logo, la compuerta sale lisa.
    }
    if (!alive) return;
    spawnHouse(true);
    buildItems();
    await Promise.race([stage.renderer.compileAsync(stage.scene, stage.camera).catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
    if (!alive) return;
    last = performance.now();
    intro();
    raf = requestAnimationFrame(frame);
  })().catch(() => destroy());

  return { leave };
}
