// Efectos del cielo de la píldora del tema (actualización del interruptor de tema, 1-oct-2026). Con clic
// derecho en la píldora (en Android, dejarla presionada) salen por turnos, uno en cada clic derecho:
// - Estrella fugaz / avioncito: en oscuro, dos estrellas fugaces cruzan la barra de arriba; en
//   claro, un avioncito sale de detrás del sol y pasa entre las nubes de la píldora.
// - Eclipse: la bolita va al centro, una sombra la tapa y queda su halo (solo dentro de la píldora);
//   la píldora y TODA la pantalla se oscurecen un poco y al final la luz regresa en círculo desde la
//   píldora, como el cambio de tema. A pedido del dueño (24-oct-2026): la entrada es rápida (1 s), la
//   pantalla se queda oscura 14.1 s completos y la salida dura 1 s; sin luz alrededor de la píldora.
// - Tormenta (24-oct-2026): theme-sky-storm/storm.ts, que se carga (con three.js) solo cuando le toca.
//   Necesita mouse y pantalla grande; en celular o tableta se salta y siguen los otros dos.
// El turno empieza de nuevo al recargar la página. Ninguno sale si otro sigue en pantalla.
// Solo visual: no cambia el tema ni toca datos, sin sonido; con «reducir movimiento» no hace nada.
// Las medidas dentro de la píldora van en su escala de 62×32 (la píldora lleva zoom 0.8). Estilos
// en app/globals.css › "Interruptor de tema".

type Scene = {
  pill: HTMLElement;
  knob: HTMLElement;
  add: (className: string, parent: Element, before?: Element | null) => HTMLElement;
  animate: (el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => void;
  endAfter: (ms: number) => void;
  after: (ms: number, run: () => void) => void;
  listen: (target: EventTarget, type: string, handler: () => void) => void;
  stop: () => void;
};

const TURNS = ["fly", "eclipse", "storm"] as const;
let running: Scene | null = null;
let storm: { leave: () => void } | null = null;
let stormLoading = false;
let turn = 0;

export function stopSkyEffect(): void {
  running?.stop();
  storm?.leave();
}

export function playSkyEffect(pill: HTMLElement): void {
  if (running || storm || stormLoading || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const knob = pill.querySelector<HTMLElement>(".theme-pill-knob");
  if (!knob) return;
  let next = TURNS[turn % TURNS.length];
  turn += 1;
  if (next === "storm" && !canStorm()) {
    next = TURNS[turn % TURNS.length];
    turn += 1;
  }
  if (next === "storm") {
    stormEffect(pill);
    return;
  }
  const scene = createScene(pill, knob);
  running = scene;
  const dark = document.documentElement.classList.contains("dark");
  if (next === "fly") flyEffect(scene, dark);
  else eclipseEffect(scene, dark);
}

// La tormenta se juega con mouse en pantalla grande (la versión para celular queda para después).
function canStorm(): boolean {
  return window.matchMedia("(pointer: fine)").matches && window.innerWidth >= 1000 && window.innerHeight >= 600;
}

function stormEffect(pill: HTMLElement): void {
  stormLoading = true;
  import("./theme-sky-storm/storm")
    .then(({ startStorm }) => {
      storm = startStorm(() => {
        storm = null;
      });
      // Sin WebGL no hay tormenta: sale el efecto que sigue.
      stormLoading = false;
      if (!storm) playSkyEffect(pill);
    })
    .catch(() => {
      stormLoading = false;
    });
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
    after(ms, run) {
      timers.push(window.setTimeout(run, ms));
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
  // Tiempos en ms: la entrada termina en IN (pantalla ya oscura), la oscuridad completa dura DARK y en
  // OUT la luz empieza a regresar en círculo desde la píldora (LIGHT ms, como el cambio de tema).
  const IN = 1000;
  const DARK = 14100;
  const OUT = IN + DARK;
  const LIGHT = 1000;
  const total = OUT + LIGHT;
  const at = (ms: number) => ms / total;
  // La suavidad va en cada tramo: puesta en la animación entera, deformaría los tiempos de arriba.
  const smooth = (frames: Keyframe[]): Keyframe[] => frames.map((frame) => ({ easing: "ease-in-out", ...frame }));
  const { pill, knob } = scene;

  // La oscuridad es la sombra enorme de un recorte con la forma exacta de la píldora: oscurece TODO menos
  // la píldora (el halo de adentro sigue brillando), va pegada a la página (al bajar se va con la
  // píldora) y no tiene orillas dentro de la pantalla. El recorte se centra en un punto (`shade`) puesto
  // sobre el centro de la píldora.
  const shade = scene.add("theme-sky-shade", document.body);
  const hole = scene.add("theme-sky-hole", shade);
  const place = () => {
    const box = pill.getBoundingClientRect();
    shade.style.left = "0px";
    shade.style.top = "0px";
    const origin = shade.getBoundingClientRect();
    shade.style.left = `${box.left + box.width / 2 - origin.left}px`;
    shade.style.top = `${box.top + box.height / 2 - origin.top}px`;
    hole.style.width = `${box.width}px`;
    hole.style.height = `${box.height}px`;
  };
  place();
  scene.listen(window, "resize", place);
  scene.animate(
    shade,
    smooth([{ opacity: 0 }, { opacity: 0, offset: at(400) }, { opacity: 1, offset: at(IN) }, { opacity: 1 }]),
    { duration: total, fill: "forwards" },
  );
  // Salida: el recorte crece en círculo hasta la esquina más lejana de la pantalla y la luz regresa.
  scene.after(OUT, () => {
    const box = pill.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const size = 2 * Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    scene.animate(
      hole,
      [
        { width: `${box.width}px`, height: `${box.height}px` },
        { width: `${size}px`, height: `${size}px` },
      ],
      { duration: LIGHT, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
    );
  });

  const home = dark ? "translateX(30px)" : "translateX(0px)";
  scene.animate(
    knob,
    smooth([
      { transform: home },
      { transform: "translateX(15px)", offset: at(450) },
      { transform: "translateX(15px)", offset: at(OUT + 500) },
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
      { transform: "translateX(15px)", offset: at(OUT - 300) },
      { transform: "translateX(-28px)", offset: at(OUT + 350) },
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
      { boxShadow: corona, offset: at(OUT - 200) },
      { boxShadow: shadow, offset: at(OUT + 100) },
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
      { backgroundColor: "#050d18", offset: at(OUT) },
      { backgroundColor: sky, offset: at(OUT + 450) },
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
        { opacity: 1, transform: "scale(1)", offset: at(OUT + 100) },
        { opacity, transform, offset: at(OUT + 450) },
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
        { opacity: 0.15, offset: at(OUT + 150) },
        { opacity, offset: at(OUT + 550) },
        { opacity },
      ]),
      { duration: total },
    );
  });
  scene.endAfter(total + 50);
}
