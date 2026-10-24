// La casa de la tormenta, con sala adentro: muro de enfrente con puerta (bisagra, se abre hacia adentro)
// y ventana de verdad, laterales, fondo, techo de dos aguas y unos muebles. Coordenadas locales de la
// casa (metros). Cada pieza del muro trae cómo se cae (`fall`) cuando la casa se destruye.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { box, mesh, rand, std } from "./kit";
import { paintingTex } from "./textures";

export const HOUSE = {
  base: 0.12,
  wallH: 3.0,
  front: 1.5,
  back: -1.5,
  half: 2.75,
  t: 0.15,
  doorL: -1.575,
  doorR: -0.625,
  doorH: 2.05,
  win: { x: 1.15, y: 1.55, w: 1.3, h: 1.05 },
};

export type Fall = { dx?: number; dy?: number; dz?: number; rx?: number; rz?: number };
export type House = {
  group: THREE.Group;
  pieces: { obj: THREE.Object3D; fall: Fall | null }[];
  // Muebles: flotan si se inunda; y0 = su altura original.
  props: { obj: THREE.Object3D; y0: number }[];
  doorPivot: THREE.Group;
  lamp: THREE.PointLight;
};

export function buildHouse(dark: boolean): House {
  const g = new THREE.Group();
  g.name = "casa";
  const { base, wallH, front: F, back: B, half: HX, t, doorL, doorR, doorH, win } = HOUSE;
  const top = base + wallH;
  const doorTop = base + doorH;
  const wallMat = std(dark ? 0xe6dac6 : 0xf3e8d6, { roughness: 0.92 });
  const trim = std(0xffffff, { roughness: 0.55 });
  const roofMat = std(0xc9652a, { roughness: 0.72 });
  const pieces: House["pieces"] = [];
  const add = <T extends THREE.Object3D>(obj: T, x: number, y: number, z: number, fall: Fall | null): T => {
    obj.position.set(x, y, z);
    g.add(obj);
    pieces.push({ obj, fall });
    return obj;
  };
  // Piso (el escalón de la casa) y duela adentro.
  add(box(2 * HX + 0.4, base, F - B + 0.2, std(0x9ba2aa, { roughness: 0.95 })), 0, base / 2, 0, null);
  add(box(2 * HX - 2 * t, 0.012, F - B - 2 * t, std(0xb48a5c, { roughness: 0.8 }), { cast: false }), 0, base + 0.006, 0, null);

  // Muro de enfrente: izquierda, dintel y el lado derecho con la ventana (se cae junto).
  const zf = F - t / 2;
  const wallL = add(box(doorL + HX, wallH, t, wallMat), (-HX + doorL) / 2, base + wallH / 2, zf, { dx: -0.9, dy: -3.6, rz: 0.55 });
  add(box(doorR - doorL, top - doorTop, t, wallMat), (doorL + doorR) / 2, (doorTop + top) / 2, zf, { dx: 0.3, dy: -3.9, rz: 0.9 });
  const rg = new THREE.Group();
  const rcx = (doorR + HX) / 2;
  const rcy = base + wallH / 2;
  const winL = win.x - win.w / 2;
  const winR = win.x + win.w / 2;
  const winB = win.y - win.h / 2;
  const winT = win.y + win.h / 2;
  const part = (x0: number, x1: number, y0: number, y1: number) => {
    const b = box(x1 - x0, y1 - y0, t, wallMat);
    b.position.set((x0 + x1) / 2 - rcx, (y0 + y1) / 2 - rcy, 0);
    rg.add(b);
  };
  part(doorR, winL, base, top);
  part(winR, HX, base, top);
  part(winL, winR, base, winB);
  part(winL, winR, winT, top);
  add(rg, rcx, rcy, zf, { dx: 1.3, dy: -3.7, rz: -0.45 });
  // Zoclo de la fachada.
  const skirtMat = std(0xb9a98f, { roughness: 0.9 });
  const skL = box(doorL + HX, 0.18, 0.04, skirtMat, { cast: false });
  skL.position.set(0, -wallH / 2 + 0.09, t / 2 + 0.02);
  wallL.add(skL);
  const skR = box(HX - doorR, 0.18, 0.04, skirtMat, { cast: false });
  skR.position.set(0, -wallH / 2 + 0.09, t / 2 + 0.02);
  rg.add(skR);

  // Ventana: marco por fuera, vidrio en medio del muro, cortinas por dentro.
  const wnd = new THREE.Group();
  wnd.position.set(win.x - rcx, win.y - rcy, 0);
  rg.add(wnd);
  const glass = mesh(
    new THREE.PlaneGeometry(win.w, win.h),
    new THREE.MeshStandardMaterial({ color: 0xd2e6f7, transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }),
    { cast: false, receive: false },
  );
  wnd.add(glass);
  const ft = 0.07;
  const frames: [number, number, number, number][] = [
    [win.w + ft * 2, ft, 0, win.h / 2 + ft / 2],
    [win.w + ft * 2, ft, 0, -win.h / 2 - ft / 2],
    [ft, win.h, -win.w / 2 - ft / 2, 0],
    [ft, win.h, win.w / 2 + ft / 2, 0],
    [0.035, win.h, 0, 0],
  ];
  for (const [w, h, x, y] of frames) {
    const f = box(w, h, 0.07, trim);
    f.position.set(x, y, t / 2 + 0.03);
    wnd.add(f);
  }
  const sill = box(win.w + 0.26, 0.06, 0.18, trim);
  sill.position.set(0, -win.h / 2 - ft - 0.02, t / 2 + 0.07);
  wnd.add(sill);
  const curtainMat = std(0xd7c39a, { roughness: 1, side: THREE.DoubleSide });
  for (const sx of [-1, 1]) {
    const curtain = mesh(new THREE.PlaneGeometry(0.24, win.h + 0.2), curtainMat, { cast: false });
    curtain.position.set(sx * (win.w / 2 + 0.02), 0, -t / 2 - 0.015);
    wnd.add(curtain);
  }

  // Laterales, fondo y techo de adentro.
  add(box(t, wallH, F - B, wallMat), -HX + t / 2, base + wallH / 2, (F + B) / 2, { dx: -1.4, dy: -3.6, rz: 0.6 });
  add(box(t, wallH, F - B, wallMat), HX - t / 2, base + wallH / 2, (F + B) / 2, { dx: 1.6, dy: -3.6, rz: -0.6 });
  add(box(2 * HX, wallH, t, wallMat), 0, base + wallH / 2, B + t / 2, { dx: 0.8, dy: -3.8, dz: -0.6, rx: -0.5 });
  add(box(2 * HX, 0.08, F - B, std(0xf4efe6, { roughness: 0.95 })), 0, top - 0.04, (F + B) / 2, { dx: 1.0, dy: -4.0, rz: 0.2 });

  // Puerta con bisagra en el lado izquierdo, por dentro: se abre hacia la sala.
  const doorPivot = new THREE.Group();
  const panel = new THREE.Group();
  panel.add(box(doorR - doorL - 0.012, doorH - 0.012, 0.045, std(0x1f4f86, { roughness: 0.5 })));
  const insetMat = std(0x2a5d97, { roughness: 0.5 });
  for (const pz of [0.024, -0.024]) {
    for (const py of [0.42, -0.42]) {
      const inset = box(0.66, 0.76, 0.008, insetMat, { cast: false });
      inset.position.set(0, py, pz);
      panel.add(inset);
    }
  }
  const gold = std(0xd4a640, { metalness: 1, roughness: 0.3 });
  for (const pz of [0.036, -0.036]) {
    const knob = mesh(new THREE.SphereGeometry(0.035, 16, 12), gold);
    knob.position.set(0.36, -0.05, pz);
    panel.add(knob);
  }
  panel.position.set((doorR - doorL) / 2, doorH / 2, 0);
  doorPivot.add(panel);
  add(doorPivot, doorL, base, F - t + 0.0225, { dx: 0.6, dy: -2.8, rx: 1.3, dz: 0.8 });
  const jambs: [number, number, number, number][] = [
    [0.07, doorH + 0.07, doorL - 0.035, base + doorH / 2],
    [0.07, doorH + 0.07, doorR + 0.035, base + doorH / 2],
    [doorR - doorL + 0.14, 0.07, (doorL + doorR) / 2, doorTop + 0.035],
  ];
  for (const [w, h, x, y] of jambs) add(box(w, h, 0.06, trim), x, y, F + 0.02, { dx: rand(-0.6, 0.9), dy: -3.2, rz: rand(-1, 1) });
  add(box(1.3, 0.04, 0.35, std(0x8d949c, { roughness: 0.95 })), (doorL + doorR) / 2, base - 0.02, F + 0.17, null);

  // Techo de dos aguas.
  const half = 2.95;
  const rise = 1.6;
  for (const sx of [-1, 1]) {
    const tri = new THREE.Shape();
    tri.moveTo(0, 0);
    tri.lineTo(sx * half, 0);
    tri.lineTo(0, rise);
    tri.closePath();
    const gable = mesh(new THREE.ExtrudeGeometry(tri, { depth: 3, bevelEnabled: false }), wallMat);
    gable.geometry.translate(0, 0, -1.5);
    add(gable, 0, top, 0, { dx: sx * 1.3, dy: -4.2, rz: sx * -0.7 });
  }
  const ang = Math.atan2(rise, half);
  const slabLen = Math.hypot(half, rise) + 0.5;
  for (const sx of [-1, 1]) {
    const slab = box(slabLen, 0.16, 3.5, roofMat);
    slab.rotation.z = -sx * ang;
    add(slab, sx * (half / 2 + 0.1 * Math.sin(ang)), top + rise / 2 + 0.1 * Math.cos(ang), 0, { dx: sx * 1.4 + 0.6, dy: -4.4, rz: sx * 0.35 });
  }
  add(box(0.24, 0.12, 3.55, std(0x9e4d1f, { roughness: 0.7 })), 0, top + rise + 0.12, 0, { dx: 0.8, dy: -4.6, rz: 1.2 });
  const chimney = new THREE.Group();
  chimney.add(box(0.42, 1.0, 0.42, std(0x8a5b44, { roughness: 0.9 })));
  const cap = box(0.54, 0.08, 0.54, std(0x6d4635, { roughness: 0.9 }));
  cap.position.y = 0.54;
  chimney.add(cap);
  add(chimney, 1.6, top + 1.05, -0.45, { dx: 2.0, dy: -4.8, rz: -1.4 });

  // Sala: tapete, mesita con lámpara, maceta, sillón y un cuadro. Flotan si se inunda.
  const props: House["props"] = [];
  const prop = (obj: THREE.Object3D, x: number, y: number, z: number) => {
    obj.position.set(x, y, z);
    g.add(obj);
    props.push({ obj, y0: y });
  };
  prop(box(1.8, 0.01, 1.15, std(0x8a4a3c, { roughness: 1 }), { cast: false }), -0.55, base + 0.018, 0.2);
  const table = new THREE.Group();
  const wood = std(0x7a5232, { roughness: 0.7 });
  const tableTop = box(0.55, 0.04, 0.5, wood);
  tableTop.position.y = 0.6;
  table.add(tableTop);
  for (const [lx, lz] of [[-0.23, -0.2], [0.23, -0.2], [-0.23, 0.2], [0.23, 0.2]]) {
    const leg = box(0.04, 0.6, 0.04, wood);
    leg.position.set(lx, 0.3, lz);
    table.add(leg);
  }
  const lampBase = mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 16), std(0xe9e2d0, { roughness: 0.6 }));
  lampBase.position.y = 0.77;
  table.add(lampBase);
  const shade = mesh(
    new THREE.CylinderGeometry(0.12, 0.18, 0.2, 20, 1, true),
    std(0xf7e7b6, { roughness: 0.8, side: THREE.DoubleSide, emissive: 0x6b5520, emissiveIntensity: 0.5 }),
  );
  shade.position.y = 1.0;
  table.add(shade);
  prop(table, 2.15, base, 1.0);
  const plant = new THREE.Group();
  const pot = mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.3, 18), std(0xb5652f, { roughness: 0.8 }));
  pot.position.y = 0.15;
  plant.add(pot);
  const leaves = mesh(new THREE.IcosahedronGeometry(0.28, 1), std(0x3b7d4f, { roughness: 0.9, flatShading: true }));
  leaves.position.y = 0.5;
  plant.add(leaves);
  prop(plant, -2.25, base, 1.05);
  const sofa = new THREE.Group();
  const cloth = std(0x5a6f8f, { roughness: 0.95 });
  const seat = mesh(new RoundedBoxGeometry(1.6, 0.42, 0.75, 3, 0.06), cloth);
  seat.position.y = 0.21;
  sofa.add(seat);
  const backrest = mesh(new RoundedBoxGeometry(1.6, 0.5, 0.2, 3, 0.06), cloth);
  backrest.position.set(0, 0.62, -0.28);
  sofa.add(backrest);
  sofa.rotation.y = Math.PI / 2;
  prop(sofa, -2.2, base, -0.3);
  const frame = new THREE.Group();
  frame.add(box(0.5, 0.37, 0.03, std(0x3c2a1c, { roughness: 0.6 })));
  const pic = mesh(new THREE.PlaneGeometry(0.42, 0.29), std(0xffffff, { map: paintingTex(), roughness: 0.8 }), { cast: false });
  pic.position.z = -0.017;
  pic.rotation.y = Math.PI;
  frame.add(pic);
  prop(frame, -0.07, 1.78, F - t - 0.02);
  // Luz de la sala.
  const lamp = new THREE.PointLight(0xfff1d6, 1.6, 8, 1.4);
  lamp.position.set(0, top - 0.4, 0);
  g.add(lamp);

  return { group: g, pieces, props, doorPivot, lamp };
}
