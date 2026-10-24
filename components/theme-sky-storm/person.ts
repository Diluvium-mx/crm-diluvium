// La persona animada de la tormenta: pide ayuda en la ventana, se sube al techo, se va flotando en una
// llanta o festeja. `mode` dice qué hace y animatePerson la mueve en cada cuadro.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { box, mesh, std } from "./kit";

export type PersonMode = "wave" | "frantic" | "float" | "cheer" | "climb";
export type Person = {
  group: THREE.Group;
  head: THREE.Group;
  arms: THREE.Group[];
  legs: THREE.Group[];
  mouth: THREE.Mesh;
  mode: PersonMode;
  t: number;
};

export function buildPerson(): Person {
  const g = new THREE.Group();
  g.name = "persona";
  const skin = std(0xe2b38a, { roughness: 0.7 });
  const shirt = std(0x245595, { roughness: 0.75 });
  const pants = std(0x2b2f36, { roughness: 0.85 });
  const hairM = std(0x3a281d, { roughness: 0.9 });
  const dark = std(0x111111, { roughness: 0.4 });
  const white = std(0xffffff, { roughness: 0.4 });
  const legs: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.085, 0.82, 0);
    const leg = mesh(new THREE.CapsuleGeometry(0.075, 0.62, 6, 12), pants);
    leg.position.y = -0.38;
    hip.add(leg);
    const shoe = mesh(new RoundedBoxGeometry(0.12, 0.07, 0.2, 2, 0.03), dark);
    shoe.position.set(0, -0.78, 0.04);
    hip.add(shoe);
    g.add(hip);
    legs.push(hip);
  }
  const torso = mesh(new THREE.CapsuleGeometry(0.17, 0.32, 8, 16), shirt);
  torso.position.y = 1.07;
  g.add(torso);
  const neck = mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.08, 12), skin);
  neck.position.y = 1.34;
  g.add(neck);
  const head = new THREE.Group();
  head.position.y = 1.48;
  g.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.15, 28, 20), skin));
  const hair = mesh(new THREE.SphereGeometry(0.157, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.52), hairM);
  hair.rotation.x = -0.35;
  head.add(hair);
  for (const sx of [-1, 1]) {
    const eyeW = mesh(new THREE.SphereGeometry(0.03, 14, 10), white, { cast: false });
    eyeW.position.set(sx * 0.055, 0.02, 0.128);
    eyeW.scale.z = 0.5;
    head.add(eyeW);
    const eye = mesh(new THREE.SphereGeometry(0.017, 12, 10), dark, { cast: false });
    eye.position.set(sx * 0.055, 0.02, 0.143);
    head.add(eye);
    const brow = box(0.05, 0.01, 0.01, hairM, { cast: false });
    brow.position.set(sx * 0.055, 0.065, 0.135);
    brow.rotation.z = sx * 0.35;
    head.add(brow);
  }
  const mouth = mesh(new THREE.SphereGeometry(0.03, 14, 10), std(0x5a1414, { roughness: 0.6 }), { cast: false });
  mouth.position.set(0, -0.06, 0.135);
  mouth.scale.set(1, 1.2, 0.4);
  head.add(mouth);
  const arms: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.215, 1.25, 0);
    const upper = mesh(new THREE.CapsuleGeometry(0.055, 0.24, 6, 10), shirt);
    upper.position.y = -0.16;
    shoulder.add(upper);
    const fore = mesh(new THREE.CapsuleGeometry(0.048, 0.2, 6, 10), skin);
    fore.position.y = -0.4;
    shoulder.add(fore);
    const hand = mesh(new THREE.SphereGeometry(0.058, 14, 10), skin);
    hand.position.y = -0.55;
    shoulder.add(hand);
    g.add(shoulder);
    arms.push(shoulder);
  }
  return { group: g, head, arms, legs, mouth, mode: "wave", t: 0 };
}

// Brazos en ángulo (radianes) desde "colgando hacia abajo"; positivo = hacia arriba por su lado.
export function animatePerson(p: Person, dt: number): void {
  p.t += dt;
  const t = p.t;
  const [aL, aR] = p.arms;
  if (p.mode === "wave") {
    aL.rotation.z = -(2.45 + 0.35 * Math.sin(t * 9));
    aR.rotation.z = 2.45 + 0.35 * Math.sin(t * 9 + 1.6);
    p.head.rotation.z = 0.12 * Math.sin(t * 4.5);
    p.mouth.scale.y = 1.0 + 0.5 * Math.abs(Math.sin(t * 7));
  } else if (p.mode === "frantic") {
    aL.rotation.z = -(2.6 + 0.45 * Math.sin(t * 14));
    aR.rotation.z = 2.6 + 0.45 * Math.sin(t * 14 + 2);
    p.head.rotation.z = 0.18 * Math.sin(t * 7);
    p.mouth.scale.y = 1.4;
  } else if (p.mode === "float") {
    aL.rotation.z = -0.55;
    aR.rotation.z = 2.5 + 0.5 * Math.sin(t * 6);
    p.head.rotation.z = 0.1 * Math.sin(t * 2);
    p.mouth.scale.y = 0.6;
  } else if (p.mode === "cheer") {
    aL.rotation.z = -(2.8 + 0.2 * Math.sin(t * 10));
    aR.rotation.z = 2.8 + 0.2 * Math.sin(t * 10 + 1);
    p.mouth.scale.y = 0.8;
  }
  const sit = p.mode === "float";
  p.legs.forEach((leg, i) => {
    leg.rotation.x = sit ? -1.35 : p.mode === "climb" ? 0.6 * Math.sin(t * 12 + i * Math.PI) : 0;
  });
}
