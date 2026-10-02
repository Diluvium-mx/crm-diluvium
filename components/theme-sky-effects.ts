// Efectos del cielo de la píldora del tema (actualización del interruptor de tema, 1-oct-2026). Con clic
// derecho en la píldora (en Android, dejarla presionada) se alternan dos:
// - Estrella fugaz / avioncito: en oscuro, dos estrellas fugaces cruzan la barra de arriba; en
//   claro, un avioncito sale de detrás del sol y pasa entre las nubes de la píldora.
// - Eclipse (14.5 s, a pedido del dueño): la bolita va al centro, una sombra la tapa y queda su halo; la píldora y TODA
//   la pantalla se oscurecen un poco (con un hueco claro alrededor del halo) y luego todo regresa.
// Solo visual: no cambia el tema ni toca datos, sin sonido; con «reducir movimiento» no hace nada.
// Las medidas dentro de la píldora van en su escala de 62×32 (la píldora lleva zoom 0.8). Estilos
// en app/globals.css › "Interruptor de tema".

type Scene = {
  pill: HTMLElement;
  knob: HTMLElement;
  add: (className: string, parent: Element, before?: Element | null) => HTMLElement;
  animate: (el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => void;
  endAfter: (ms: number) => void;
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
    stop() {
      timers.forEach((id) => window.clearTimeout(id));
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
  const total = 14500;
  const { pill, knob } = scene;

  // Toda la pantalla se oscurece poco (0.4 en las orillas) mientras dura; alrededor de la
  // píldora queda un hueco claro para que el halo siga brillando.
  const box = pill.getBoundingClientRect();
  const shade = scene.add("theme-sky-shade", document.body);
  shade.style.background = `radial-gradient(circle at ${box.left + box.width / 2}px ${box.top + box.height / 2}px, rgb(2 6 14 / 0) 0 22px, rgb(2 6 14 / 0.4) 80px)`;
  scene.animate(
    shade,
    [
      { opacity: 0 },
      { opacity: 0, offset: 0.22 },
      { opacity: 1, offset: 0.42 },
      { opacity: 1, offset: 0.62 },
      { opacity: 0, offset: 0.8 },
      { opacity: 0 },
    ],
    { duration: total, easing: "ease-in-out", fill: "forwards" },
  );

  const home = dark ? "translateX(30px)" : "translateX(0px)";
  scene.animate(
    knob,
    [
      { transform: home },
      { transform: "translateX(15px)", offset: 0.18 },
      { transform: "translateX(15px)", offset: 0.8 },
      { transform: home },
    ],
    { duration: total, easing: "ease-in-out" },
  );
  const disc = scene.add("theme-sky-disc", pill);
  scene.animate(
    disc,
    [
      { transform: "translateX(56px)" },
      { transform: "translateX(56px)", offset: 0.2 },
      { transform: "translateX(15px)", offset: 0.42 },
      { transform: "translateX(15px)", offset: 0.62 },
      { transform: "translateX(-28px)", offset: 0.84 },
      { transform: "translateX(-28px)" },
    ],
    { duration: total, easing: "ease-in-out", fill: "forwards" },
  );

  const shadow = getComputedStyle(knob).boxShadow;
  const corona = "0 0 0 1.5px rgb(255 255 255 / 0.95), 0 0 10px 3px rgb(255 225 150 / 0.85)";
  scene.animate(
    knob,
    [
      { boxShadow: shadow },
      { boxShadow: shadow, offset: 0.36 },
      { boxShadow: corona, offset: 0.43 },
      { boxShadow: corona, offset: 0.6 },
      { boxShadow: shadow, offset: 0.7 },
      { boxShadow: shadow },
    ],
    { duration: total },
  );
  const sky = getComputedStyle(pill).backgroundColor;
  scene.animate(
    pill,
    [
      { backgroundColor: sky },
      { backgroundColor: sky, offset: 0.3 },
      { backgroundColor: "#050d18", offset: 0.42 },
      { backgroundColor: "#050d18", offset: 0.62 },
      { backgroundColor: sky, offset: 0.76 },
      { backgroundColor: sky },
    ],
    { duration: total },
  );
  pill.querySelectorAll(".theme-pill-star").forEach((star) => {
    const { opacity, transform } = getComputedStyle(star);
    scene.animate(
      star,
      [
        { opacity, transform },
        { opacity, transform, offset: 0.38 },
        { opacity: 1, transform: "scale(1)", offset: 0.46 },
        { opacity: 1, transform: "scale(1)", offset: 0.62 },
        { opacity, transform, offset: 0.72 },
        { opacity, transform },
      ],
      { duration: total },
    );
  });
  pill.querySelectorAll(".theme-pill-cloud").forEach((cloud) => {
    const { opacity } = getComputedStyle(cloud);
    scene.animate(
      cloud,
      [
        { opacity },
        { opacity, offset: 0.34 },
        { opacity: 0.15, offset: 0.42 },
        { opacity: 0.15, offset: 0.62 },
        { opacity, offset: 0.74 },
        { opacity },
      ],
      { duration: total },
    );
  });
  scene.endAfter(total + 50);
}
