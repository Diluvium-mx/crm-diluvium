// La compuerta de la tormenta, igual a la foto del producto. Frente: tela negra, costura y el logo real.
// Atrás: marco acolchado, base blanca de PVC, refuerzos, el GATO al centro (abre el rombo y empuja dos
// topes contra los lados del marco), los 3 TORNILLOS de abajo (bajan contra el piso) y dos etiquetas.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { box, mesh, std } from "./kit";
import { fabricBump, qrLabel, warnLabel } from "./textures";

export type Gate = {
  group: THREE.Group;
  // 0 = suelto, 1 = apretado.
  setJack: (sv: number) => void;
  setBolt: (i: number, sv: number) => void;
  jackHead: THREE.Object3D;
  boltHeads: THREE.Object3D[];
};

export function buildGate(logoTex: THREE.Texture): Gate {
  const W = 1.0;
  const H = 0.6;
  const T = 0.09;
  const g = new THREE.Group();
  g.name = "compuerta";
  const fabric = std(0x17191d, { roughness: 0.94, bumpMap: fabricBump(), bumpScale: 1.5 });
  g.add(mesh(new RoundedBoxGeometry(W, H, T, 6, 0.042), fabric));

  // Logo real al frente, centrado arriba (como en la foto).
  const lw = 0.4;
  const lh = lw * (561 / 2000);
  const logo = mesh(
    new THREE.PlaneGeometry(lw, lh),
    std(0xffffff, { map: logoTex, transparent: true, alphaTest: 0.04, roughness: 0.7 }),
    { cast: false },
  );
  logo.position.set(0.01, H / 2 - 0.075 - lh / 2, T / 2 + 0.0015);
  g.add(logo);

  // Costura de la orilla (frente y atrás).
  const seam = new THREE.Shape();
  const sw = W - 0.05;
  const sh = H - 0.05;
  const r = 0.03;
  seam.moveTo(-sw / 2 + r, -sh / 2);
  seam.lineTo(sw / 2 - r, -sh / 2);
  seam.quadraticCurveTo(sw / 2, -sh / 2, sw / 2, -sh / 2 + r);
  seam.lineTo(sw / 2, sh / 2 - r);
  seam.quadraticCurveTo(sw / 2, sh / 2, sw / 2 - r, sh / 2);
  seam.lineTo(-sw / 2 + r, sh / 2);
  seam.quadraticCurveTo(-sw / 2, sh / 2, -sw / 2, sh / 2 - r);
  seam.lineTo(-sw / 2, -sh / 2 + r);
  seam.quadraticCurveTo(-sw / 2, -sh / 2, -sw / 2 + r, -sh / 2);
  const seamPts = seam.getPoints(64).map((p) => new THREE.Vector3(p.x, p.y, 0));
  const seamMat = new THREE.LineDashedMaterial({ color: 0x3b3f46, dashSize: 0.009, gapSize: 0.006 });
  for (const z of [T / 2 + 0.001, -T / 2 - 0.016]) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(seamPts), seamMat);
    line.computeLineDistances();
    line.position.z = z;
    g.add(line);
  }

  // ── Atrás ──
  const back = new THREE.Group();
  back.rotation.y = Math.PI; // todo lo de atrás mira hacia -z
  back.position.z = -T / 2;
  g.add(back);
  const iw = W - 0.17;
  const ih = H - 0.15;
  const rr = (s: THREE.Shape | THREE.Path, w: number, h: number, rad: number) => {
    s.moveTo(-w / 2 + rad, -h / 2);
    s.lineTo(w / 2 - rad, -h / 2);
    s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + rad);
    s.lineTo(w / 2, h / 2 - rad);
    s.quadraticCurveTo(w / 2, h / 2, w / 2 - rad, h / 2);
    s.lineTo(-w / 2 + rad, h / 2);
    s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - rad);
    s.lineTo(-w / 2, -h / 2 + rad);
    s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + rad, -h / 2);
  };
  const outer = new THREE.Shape();
  rr(outer, W - 0.012, H - 0.012, 0.04);
  const hole = new THREE.Path();
  rr(hole, iw, ih, 0.035);
  outer.holes.push(hole);
  const pad = mesh(
    new THREE.ExtrudeGeometry(outer, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.007, bevelSize: 0.007, bevelSegments: 3, curveSegments: 10 }),
    std(0x141619, { roughness: 0.88, bumpMap: fabric.bumpMap, bumpScale: 1.2 }),
  );
  back.add(pad);
  const pvc = mesh(new THREE.PlaneGeometry(iw, ih), std(0xf2f2ee, { roughness: 0.65 }), { cast: false });
  pvc.position.z = 0.002;
  back.add(pvc);

  const steel = std(0x1b1d21, { roughness: 0.45, metalness: 0.65 });
  const bar = (x1: number, y1: number, x2: number, y2: number, t = 0.014, z = 0.012) => {
    const b = box(Math.hypot(x2 - x1, y2 - y1), t, t, steel);
    b.position.set((x1 + x2) / 2, (y1 + y2) / 2, z);
    b.rotation.z = Math.atan2(y2 - y1, x2 - x1);
    back.add(b);
    return b;
  };
  const ix = iw / 2;
  const iy = ih / 2;
  bar(-ix, 0, ix, 0);
  bar(-0.075, -iy, -0.075, iy);
  bar(0.075, -iy, 0.075, iy);
  for (const sx of [-1, 1]) {
    bar(sx * ix, iy, sx * 0.24, 0);
    bar(sx * ix, -iy, sx * 0.24, 0);
  }
  // Topes laterales: el gato los empuja contra los lados del marco de la puerta.
  const padX0 = W / 2 - 0.035;
  const pads = [-1, 1].map((sx) => {
    const p = box(0.03, 0.13, 0.05, std(0x8d939a, { roughness: 0.5, metalness: 0.4 }));
    p.position.set(sx * padX0, 0, 0.03);
    back.add(p);
    return { mesh: p, side: sx };
  });

  // El GATO: rombo central con sus pernos y la cabeza hexagonal donde entra el dado.
  const jack = new THREE.Group();
  jack.name = "gato";
  back.add(jack);
  const jz = 0.03;
  const pts: [number, number][] = [[0, 0.17], [0.055, 0], [0, -0.17], [-0.055, 0]];
  const jackBars: { mesh: THREE.Mesh; len: number }[] = [];
  const jackPins: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % 4];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const b = box(len, 0.018, 0.012, steel);
    b.position.set((x1 + x2) / 2, (y1 + y2) / 2, jz);
    b.rotation.z = Math.atan2(y2 - y1, x2 - x1);
    jack.add(b);
    jackBars.push({ mesh: b, len });
  }
  const chrome = std(0xd5d9de, { metalness: 1, roughness: 0.28 });
  for (const [x, y] of pts) {
    const pin = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 16), chrome);
    pin.rotation.x = Math.PI / 2;
    pin.position.set(x, y, jz);
    jack.add(pin);
    jackPins.push(pin);
  }
  const rod = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.11, 10), chrome);
  rod.rotation.z = Math.PI / 2;
  rod.position.set(0, 0, jz);
  jack.add(rod);
  const jackHead = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.022, 6), chrome);
  jackHead.rotation.x = Math.PI / 2;
  jackHead.position.set(0, 0.2, jz + 0.006);
  jackHead.name = "cabeza-gato";
  jack.add(jackHead);
  const crank = box(0.07, 0.008, 0.008, chrome);
  crank.position.set(0.035, 0.2, jz + 0.02);
  jack.add(crank);

  // Los 3 TORNILLOS de abajo: cabeza hexagonal y perno que baja hacia el piso.
  const bolts = new THREE.Group();
  bolts.name = "tornillos";
  back.add(bolts);
  const boltHeads: THREE.Mesh[] = [];
  const boltRods: { mesh: THREE.Mesh; y0: number }[] = [];
  for (const x of [-0.07, 0.015, 0.1]) {
    const head = mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.016, 6), chrome);
    head.rotation.x = Math.PI / 2;
    head.position.set(x, -iy + 0.035, 0.024);
    bolts.add(head);
    boltHeads.push(head);
    const pinRod = mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.1, 10), chrome);
    pinRod.position.set(x, -iy - 0.012, 0.024);
    bolts.add(pinRod);
    boltRods.push({ mesh: pinRod, y0: pinRod.position.y });
  }

  const setJack = (sv: number) => {
    const top = 0.17 - 0.03 * sv;
    const side = 0.055 + 0.035 * sv;
    const v: [number, number][] = [[0, top], [side, 0], [0, -top], [-side, 0]];
    jackBars.forEach((b, i) => {
      const [x1, y1] = v[i];
      const [x2, y2] = v[(i + 1) % 4];
      b.mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, jz);
      b.mesh.rotation.z = Math.atan2(y2 - y1, x2 - x1);
      b.mesh.scale.x = Math.hypot(x2 - x1, y2 - y1) / b.len;
    });
    jackPins.forEach((pin, i) => pin.position.set(v[i][0], v[i][1], jz));
    rod.scale.y = (side * 2) / 0.11;
    jackHead.position.y = top + 0.03;
    crank.position.y = top + 0.03;
    jackHead.rotation.y = sv * Math.PI * 4;
    pads.forEach((p) => (p.mesh.position.x = p.side * (padX0 + 0.025 * sv)));
  };
  const setBolt = (i: number, sv: number) => {
    boltRods[i].mesh.position.y = boltRods[i].y0 - 0.014 * sv;
    boltHeads[i].rotation.y = sv * Math.PI * 3;
  };

  // Etiquetas.
  const lab1 = mesh(new THREE.PlaneGeometry(0.13, 0.081), std(0xffffff, { map: warnLabel(), roughness: 0.6 }), { cast: false });
  lab1.position.set(-0.26, -0.13, 0.004);
  back.add(lab1);
  const lab2 = mesh(new THREE.PlaneGeometry(0.085, 0.119), std(0xffffff, { map: qrLabel(), roughness: 0.6 }), { cast: false });
  lab2.position.set(0.27, 0.11, 0.004);
  back.add(lab2);

  return { group: g, setJack, setBolt, jackHead, boltHeads };
}
