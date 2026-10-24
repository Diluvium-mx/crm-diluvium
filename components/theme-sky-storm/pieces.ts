// Las piezas de la tormenta: el rollo de la tira de hule, las 2 barritas de Plasti Loka y la bola que
// se amasa, el estuche, la matraca, los 3 dados y las nubes.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { box, mesh, rand, std } from "./kit";

export function buildRubberRoll(): THREE.Group {
  const g = new THREE.Group();
  g.name = "tira-de-hule";
  const rubber = std(0x1a1b1d, { roughness: 0.58 });
  const prof = [new THREE.Vector2(0.035, -0.02), new THREE.Vector2(0.11, -0.02), new THREE.Vector2(0.11, 0.02), new THREE.Vector2(0.035, 0.02), new THREE.Vector2(0.035, -0.02)];
  const roll = mesh(new THREE.LatheGeometry(prof, 40), rubber);
  roll.name = "rollo";
  roll.rotation.x = Math.PI / 2;
  roll.position.y = 0.11;
  g.add(roll);
  // Centro de cartón del rollo (también deja agarrarlo por en medio).
  const core = mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.044, 24), std(0xb38b5d, { roughness: 0.9 }));
  roll.add(core);
  for (let i = 1; i < 6; i++) {
    const ring = mesh(new THREE.TorusGeometry(0.035 + i * 0.0125, 0.0012, 4, 48), std(0x2c2e31, { roughness: 0.7 }), { cast: false });
    ring.position.set(0, 0.11, 0.0205);
    g.add(ring);
  }
  const tail = box(0.2, 0.012, 0.04, rubber);
  tail.name = "cola";
  tail.position.set(0.09, 0.006, 0);
  g.add(tail);
  return g;
}

// Una barrita de Plasti Loka (la verde o la blanca), como en el paquete.
export function buildPlastiBar(color: THREE.ColorRepresentation): THREE.Group {
  const g = new THREE.Group();
  const bar = mesh(new RoundedBoxGeometry(0.17, 0.032, 0.045, 3, 0.012), std(color, { roughness: 0.85 }));
  bar.position.y = 0.016;
  g.add(bar);
  return g;
}

// La bola de las dos barritas juntas: a rayas verde y blanca; al amasarla queda de un solo color.
export const PLASTI_GREEN = new THREE.Color(0x1f9a4a);
export const PLASTI_WHITE = new THREE.Color(0xf3f3ef);
export const PLASTI_MIXED = PLASTI_GREEN.clone().lerp(PLASTI_WHITE, 0.55);

export function buildLump(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(0.06, 32, 22);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const c = Math.sin(Math.atan2(z, x) * 3 + y * 55) > 0 ? PLASTI_GREEN : PLASTI_WHITE;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const m = mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  m.scale.set(1.25, 0.72, 1.05);
  return m;
}

// Acerca los colores de la bola al color ya mezclado (`amount` 0 → 1).
export function mixLump(m: THREE.Mesh, amount: number): void {
  const col = m.geometry.getAttribute("color");
  const c = new THREE.Color();
  for (let i = 0; i < col.count; i++) {
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(PLASTI_MIXED, amount);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}

// Estuche abierto; la matraca y los dados son piezas aparte.
export function buildToolCase(): THREE.Group {
  const g = new THREE.Group();
  g.name = "estuche";
  const plastic = std(0x2b2e34, { roughness: 0.55 });
  const base = mesh(new RoundedBoxGeometry(0.5, 0.07, 0.3, 3, 0.012), plastic);
  base.position.y = 0.035;
  g.add(base);
  const foam = box(0.47, 0.004, 0.27, std(0x111215, { roughness: 1 }), { cast: false });
  foam.position.y = 0.072;
  g.add(foam);
  const lid = new THREE.Group();
  lid.position.set(0, 0.07, -0.15);
  lid.rotation.x = -1.2;
  const lidMesh = mesh(new RoundedBoxGeometry(0.5, 0.024, 0.3, 3, 0.01), plastic);
  lidMesh.position.z = 0.15;
  lid.add(lidMesh);
  g.add(lid);
  return g;
}

// El banquito donde llega el estuche (adentro de la casa).
export function buildStool(): THREE.Group {
  const stool = new THREE.Group();
  const wood = std(0x8a6038, { roughness: 0.75 });
  const seat = box(0.62, 0.04, 0.42, wood);
  seat.position.y = 0.4;
  stool.add(seat);
  for (const [lx, lz] of [[-0.27, -0.17], [0.27, -0.17], [-0.27, 0.17], [0.27, 0.17]]) {
    const leg = box(0.04, 0.38, 0.04, wood);
    leg.position.set(lx, 0.19, lz);
    stool.add(leg);
  }
  return stool;
}

// Matraca: la cabeza en el origen (su eje = z, donde entra el dado) y el mango hacia +x.
export function buildRatchet(): THREE.Group {
  const g = new THREE.Group();
  g.name = "matraca";
  const chrome = std(0xd5d9de, { metalness: 1, roughness: 0.25 });
  const head = mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 28), chrome);
  head.rotation.x = Math.PI / 2;
  g.add(head);
  const shaft = box(0.1, 0.016, 0.014, chrome);
  shaft.position.x = 0.07;
  g.add(shaft);
  const grip = mesh(new RoundedBoxGeometry(0.18, 0.03, 0.026, 3, 0.011), std(0x1b1c1f, { roughness: 0.7 }));
  grip.position.x = 0.2;
  g.add(grip);
  const lever = box(0.014, 0.008, 0.02, std(0xb22222, { roughness: 0.5 }));
  lever.position.set(0, 0.02, -0.012);
  g.add(lever);
  return g;
}

// Los 3 dados: el chico es el de los tornillos, el mediano el del gato y el grande no entra en nada.
export type SocketFit = "bolt" | "jack" | null;
export const SOCKETS: { out: number; hex: number; fits: SocketFit }[] = [
  { out: 0.017, hex: 0.011, fits: "bolt" },
  { out: 0.022, hex: 0.016, fits: "jack" },
  { out: 0.028, hex: 0.022, fits: null },
];

export function buildSocket(sz: { out: number; hex: number }): { group: THREE.Group; body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> } {
  const g = new THREE.Group();
  g.name = "dado";
  const chrome = std(0xd5d9de, { metalness: 1, roughness: 0.25 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(sz.out, sz.out, 0.04, 28), chrome);
  body.castShadow = body.receiveShadow = true;
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const hex = mesh(new THREE.CylinderGeometry(sz.hex, sz.hex, 0.002, 6), std(0x0c0d0f, { roughness: 1 }), { cast: false });
  hex.rotation.x = Math.PI / 2;
  hex.position.z = 0.021;
  g.add(hex);
  return { group: g, body };
}

// Una nube de la tormenta (esferas juntas).
export function buildCloud(material: THREE.Material, scale: number): THREE.Group {
  const g = new THREE.Group();
  const blobs = [[-0.75, -0.05, 0.42], [-0.35, 0.12, 0.52], [0.1, 0.18, 0.58], [0.55, 0.08, 0.48], [0.9, -0.06, 0.38], [0.2, -0.12, 0.46], [-0.2, -0.14, 0.42]];
  for (const [x, y, r] of blobs) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), material);
    s.position.set(x, y, rand(-0.12, 0.12));
    g.add(s);
  }
  g.scale.setScalar(scale);
  return g;
}
