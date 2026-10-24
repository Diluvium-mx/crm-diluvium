// Efectos del cielo de la píldora del tema (actualización del interruptor de tema, 1-oct-2026). Con clic
// derecho en la píldora (en Android, dejarla presionada) se alternan dos:
// - Estrella fugaz / avioncito: en oscuro, dos estrellas fugaces cruzan la barra de arriba; en
//   claro, un avioncito sale de detrás del sol y pasa entre las nubes de la píldora.
// - Eclipse: la bolita va al centro, una sombra la tapa y queda su halo (solo dentro de la píldora);
//   la píldora y TODA la pantalla se oscurecen un poco y luego todo regresa. A pedido del dueño
//   (24-oct-2026): la entrada y la salida en la píldora son rápidas (1 s y 0.9 s), la pantalla se queda
//   oscura 14.1 s completos (antes eran 14.5 s en total, con solo ~3 s de oscuridad completa) y ya no
//   hay luz alrededor de la píldora (antes un degradado de 80 px dejaba un círculo claro sobre la página).
// Solo visual: no cambia el tema ni toca datos, sin sonido; con «reducir movimiento» no hace nada.
// Las medidas dentro de la píldora van en su escala de 62×32 (la píldora lleva zoom 0.8). Estilos
// en app/globals.css › "Interruptor de tema".

type Scene = {
  pill: HTMLElement;
  knob: HTMLElement;
  add: (className: string, parent: Element, before?: Element | null) => HTMLElement;
  animate: (el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => void;
  endAfter: (ms: number) => void;
  listen: (target: EventTarget, type: string, handler: () => void) => void;
  stop: () => void;
};

let running: Scene | null = null;
let turn = 0;

export function stopSkyEffect(): void {
  running?.stop();
}

export function playSkyEffect(pill: HTMLElement): void {
  if (running || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const knob = pill.querySelector<HTMLElement>(".theme-pill-knob");
  if (!knob) return;
  const scene = createScene(pill, knob);
  running = scene;
  const dark = document.documentElement.classList.contains("dark");
  if (turn % 2 === 0) flyEffect(scene, dark);
  else eclipseEffect(scene, dark);
  turn += 1;
}

function createScene(pill: HTMLElement, knob: HTMLElement): Scene {
  const parts: Element[] = [];
  const animations: Animation[] = [];
  const timers: number[] = [];
  const unlisten: (() => void)[] = [];
  const scene: Scene = {
    pill,
    knob,
    add(className, parent, before = null) {
      const el = document.createElement("span");
      el.className = className;
      el.setAttribute("aria-hidden", "true");
      parent.insertBefore(el, before);
      parts.push(el);
      return el;
    },
    animate(el, keyframes, options) {
      animations.push(el.animate(keyframes, options));
    },
    endAfter(ms) {
      timers.push(window.setTimeout(() => scene.stop(), ms));
    },
    listen(target, type, handler) {
      target.addEventListener(type, handler);
      unlisten.push(() => target.removeEventListener(type, handler));
    },
    stop() {
      timers.forEach((id) => window.clearTimeout(id));
      unlisten.forEach((off) => off());
      animations.forEach((animation) => animation.cancel());
      parts.forEach((el) => el.remove());
      if (running === scene) running = null;
    },
  };
  return scene;
}

function flyEffect(scene: Scene, dark: boolean): void {
  if (dark) {
    const bar = scene.pill.closest("header");
    if (!bar) {
      scene.endAfter(0);
      return;
    }
    const sky = scene.add("theme-sky-layer", bar);
    const width = sky.clientWidth;
    const height = sky.clientHeight;
    const meteors: [delay: number, fromY: number, toY: number, duration: number, length: number][] = [
      [0, -6, height + 16, 1100, 1],
      [380, -10, height * 0.7, 900, 0.7],
    ];
    for (const [delay, fromY, toY, duration, length] of meteors) {
      const meteor = scene.add("theme-sky-meteor", sky);
      const fromX = width + 30;
      const toX = -110;
      // La cabeza va adelante y la cola queda atrás, alineada con la trayectoria.
      const angle = (Math.atan2(toY - fromY, toX - fromX) * 180) / Math.PI - 180;
      scene.animate(
        meteor,
        [
          { transform: `translate(${fromX}px, ${fromY}px) rotate(${angle}deg) scaleX(${length})`, opacity: 0 },
          { opacity: 1, offset: 0.12 },
          { opacity: 1, offset: 0.75 },
          { transform: `translate(${toX}px, ${toY}px) rotate(${angle}deg) scaleX(${length})`, opacity: 0 },
        ],
        { duration, delay, easing: "cubic-bezier(0.4, 0, 0.8, 0.6)", fill: "both" },
      );
    }
    scene.endAfter(1700);
    return;
  }
  // Entre la primera nube y las demás: sale de detrás del sol y pasa entre las nubes.
  const plane = scene.add("theme-sky-plane", scene.pill, scene.pill.querySelector(".theme-pill-cloud.c2"));
  plane.appendChild(planeIcon());
  scene.animate(
    plane,
    [
      { transform: "translate(-14px, 5px)" },
      { transform: "translate(14px, 1px)", offset: 0.35 },
      { transform: "translate(40px, 3px)", offset: 0.7 },
      { transform: "translate(74px, -1px)" },
    ],
    { duration: 2400, easing: "ease-in-out", fill: "forwards" },
  );
  scene.endAfter(2500);
}

function planeIcon(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("fill", "currentColor");
  // Avión de lucide (plane), relleno.
  path.setAttribute(
    "d",
    "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z",
  );
  svg.appendChild(path);
  return svg;
}

function eclipseEffect(scene: Scene, dark: boolean): void {
  // Tiempos en ms: la entrada termina en IN (pantalla ya oscura), la oscuridad completa dura DARK y
  // después todo regresa rápido.
  const IN = 1000;
  const DARK = 14100;
  const OUT = IN + DARK;
  const total = OUT + 900;
  const at = (ms: number) => ms / total;
  // La suavidad va en cada tramo: puesta en la animación entera, deformaría los tiempos de arriba.
  const smooth = (frames: Keyframe[]): Keyframe[] => frames.map((frame) => ({ easing: "ease-in-out", ...frame }));
  const { pill, knob } = scene;

  // Toda la pantalla se oscurece poco mientras dura, menos la píldora (hueco con su forma exacta, sin
  // degradado): así el halo de adentro sigue brillando y no sale luz alrededor.
  const shade = scene.add("theme-sky-shade", document.body);
  const cutPill = () => {
    shade.style.clipPath = pillHole(pill.getBoundingClientRect());
  };
  cutPill();
  scene.listen(window, "resize", cutPill);
  scene.animate(
    shade,
    smooth([
      { opacity: 0 },
      { opacity: 0, offset: at(400) },
      { opacity: 1, offset: at(IN) },
      { opacity: 1, offset: at(OUT) },
      { opacity: 0, offset: at(OUT + 600) },
      { opacity: 0 },
    ]),
    { duration: total, fill: "forwards" },
  );

  const home = dark ? "translateX(30px)" : "translateX(0px)";
  scene.animate(
    knob,
    smooth([
      { transform: home },
      { transform: "translateX(15px)", offset: at(450) },
      { transform: "translateX(15px)", offset: at(OUT + 400) },
      { transform: home },
    ]),
    { duration: total },
  );
  const disc = scene.add("theme-sky-disc", pill);
  scene.animate(
    disc,
    smooth([
      { transform: "translateX(56px)" },
      { transform: "translateX(56px)", offset: at(250) },
      { transform: "translateX(15px)", offset: at(900) },
      { transform: "translateX(15px)", offset: at(OUT) },
      { transform: "translateX(-28px)", offset: at(OUT + 650) },
      { transform: "translateX(-28px)" },
    ]),
    { duration: total, fill: "forwards" },
  );

  const shadow = getComputedStyle(knob).boxShadow;
  const corona = "0 0 0 1.5px rgb(255 255 255 / 0.95), 0 0 10px 3px rgb(255 225 150 / 0.85)";
  scene.animate(
    knob,
    smooth([
      { boxShadow: shadow },
      { boxShadow: shadow, offset: at(750) },
      { boxShadow: corona, offset: at(IN) },
      { boxShadow: corona, offset: at(OUT) },
      { boxShadow: shadow, offset: at(OUT + 250) },
      { boxShadow: shadow },
    ]),
    { duration: total },
  );
  const sky = getComputedStyle(pill).backgroundColor;
  scene.animate(
    pill,
    smooth([
      { backgroundColor: sky },
      { backgroundColor: sky, offset: at(500) },
      { backgroundColor: "#050d18", offset: at(950) },
      { backgroundColor: "#050d18", offset: at(OUT + 150) },
      { backgroundColor: sky, offset: at(OUT + 550) },
      { backgroundColor: sky },
    ]),
    { duration: total },
  );
  pill.querySelectorAll(".theme-pill-star").forEach((star) => {
    const { opacity, transform } = getComputedStyle(star);
    scene.animate(
      star,
      smooth([
        { opacity, transform },
        { opacity, transform, offset: at(650) },
        { opacity: 1, transform: "scale(1)", offset: at(IN) },
        { opacity: 1, transform: "scale(1)", offset: at(OUT + 150) },
        { opacity, transform, offset: at(OUT + 500) },
        { opacity, transform },
      ]),
      { duration: total },
    );
  });
  pill.querySelectorAll(".theme-pill-cloud").forEach((cloud) => {
    const { opacity } = getComputedStyle(cloud);
    scene.animate(
      cloud,
      smooth([
        { opacity },
        { opacity, offset: at(450) },
        { opacity: 0.15, offset: at(900) },
        { opacity: 0.15, offset: at(OUT + 200) },
        { opacity, offset: at(OUT + 600) },
        { opacity },
      ]),
      { duration: total },
    );
  });
  scene.endAfter(total + 50);
}

// Toda la ventana menos un hueco con la forma de la píldora (rectángulo de puntas redondas).
function pillHole(box: DOMRect): string {
  const r = box.height / 2;
  const { left, top, right, bottom } = box;
  return `path(evenodd, "M0 0H${window.innerWidth}V${window.innerHeight}H0Z M${left + r} ${top}H${right - r}A${r} ${r} 0 0 1 ${right - r} ${bottom}H${left + r}A${r} ${r} 0 0 1 ${left + r} ${top}Z")`;
}
