// Herramientas de la tormenta (efecto del cielo de la píldora del tema; ver storm.ts): curvas de
// suavidad, una línea de tiempo propia (todo se anima con ella y se cancela de golpe al salir),
// atajos para materiales y mallas, texturas dibujadas en un lienzo y la limpieza de memoria.
import * as THREE from "three";

export const E = {
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  in: (t: number) => t * t * t,
  lin: (t: number) => t,
  back: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};
export type Ease = (t: number) => number;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const rand = (a: number, b: number) => a + Math.random() * (b - a);

// Un paso de la línea de tiempo: `fn` recibe el avance ya suavizado y el avance lineal (0 → 1).
export type Tween = {
  t: number;
  dur: number;
  fn: (k: number, raw: number) => void;
  ease: Ease;
  done?: () => void;
  dead?: boolean;
};
type TweenOptions = { delay?: number; ease?: Ease; done?: () => void };

export class Timeline {
  private items: Tween[] = [];

  tween(dur: number, fn: (k: number, raw: number) => void, { delay = 0, ease = E.inOut, done }: TweenOptions = {}): Tween {
    const it: Tween = { t: -delay, dur: Math.max(dur, 1e-4), fn, ease, done };
    this.items.push(it);
    return it;
  }

  after(sec: number, fn: () => void): Tween {
    return this.tween(1e-4, () => {}, { delay: sec, done: fn });
  }

  update(dt: number): void {
    for (const it of this.items.slice()) {
      if (it.dead) continue;
      it.t += dt;
      if (it.t < 0) continue;
      const k = Math.min(1, it.t / it.dur);
      it.fn(it.ease(k), k);
      if (k >= 1) {
        it.dead = true;
        const i = this.items.indexOf(it);
        if (i >= 0) this.items.splice(i, 1);
        it.done?.();
      }
    }
  }

  clear(): void {
    this.items.forEach((it) => (it.dead = true));
    this.items.length = 0;
  }
}

export const std = (color: THREE.ColorRepresentation, o: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });

export function mesh(
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  { cast = true, receive = true }: { cast?: boolean; receive?: boolean } = {},
): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

export const box = (w: number, h: number, d: number, material: THREE.Material, o?: { cast?: boolean; receive?: boolean }) =>
  mesh(new THREE.BoxGeometry(w, h, d), material, o);

export function canvasTex(
  w: number,
  h: number,
  draw: (x: CanvasRenderingContext2D, w: number, h: number) => void,
  { color = true, repeat }: { color?: boolean; repeat?: [number, number] } = {},
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (ctx) draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = 4;
  return t;
}

// Libera geometrías, materiales y texturas de todo lo que cuelga de `obj`.
export function disposeTree(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points)) return;
    o.geometry.dispose();
    const materials: THREE.Material[] = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of materials) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
}
