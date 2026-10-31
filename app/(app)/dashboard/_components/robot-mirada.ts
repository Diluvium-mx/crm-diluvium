// Mirada y brinco del robot del seguimiento (30-oct-2026, el dueño eligió entre maquetas: mirada «ojos y cabeza» y clic
// «brinco»). El robot despierto sigue el cursor por toda la ventana con los ojos y la cabeza: la píldora y el encabezado
// de su ventana. Un solo escucha del cursor para todos los robots a la vista; cada uno recibe hacia dónde mira en
// --re-mx y --re-my (de -1 a 1) y app/globals.css › «Mirada del robot» mueve los ojos y la cabeza. No miran el robot
// dormido ni el de ojos en X, ni durante una escena (la escena manda), ni en el celular (sin cursor), ni con «reducir
// movimiento». Al tocar la píldora, se aplasta y el robot brinca y cae.
import { useEffect, type RefObject } from "react";

/** A esta distancia (px) del centro del robot ya mira con todo; más cerca, menos (con el cursor encima no bizquea). */
const ALCANCE_PX = 120;

/** Hacia dónde mira un robot con el cursor a (dx, dy) px de su centro: cada eje de -1 a 1, en la dirección del cursor. */
export function direccionMirada(dx: number, dy: number): { x: number; y: number } {
  const d = Math.hypot(dx, dy);
  if (d === 0) return { x: 0, y: 0 };
  const k = Math.min(1, d / ALCANCE_PX) / d;
  return { x: dx * k, y: dy * k };
}

const sinMovimiento = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const robots = new Set<HTMLElement>();
let cursor: { x: number; y: number } | null = null;
let cuadro = 0;

function soltar(robot: HTMLElement) {
  robot.style.removeProperty("--re-mx");
  robot.style.removeProperty("--re-my");
}

function mirar() {
  cuadro = 0;
  // Primero se miden todos y luego se escriben (sin medir entre escrituras).
  const cajas = [...robots].map((robot) => ({ robot, caja: robot.getBoundingClientRect() }));
  for (const { robot, caja } of cajas) {
    if (!cursor || caja.width === 0) {
      soltar(robot);
      continue;
    }
    const { x, y } = direccionMirada(cursor.x - (caja.left + caja.width / 2), cursor.y - (caja.top + caja.height / 2));
    robot.style.setProperty("--re-mx", x.toFixed(3));
    robot.style.setProperty("--re-my", y.toFixed(3));
  }
}

const pedirCuadro = () => {
  if (!cuadro) cuadro = window.requestAnimationFrame(mirar);
};

function alMover(event: PointerEvent) {
  if (event.pointerType === "touch") return;
  cursor = { x: event.clientX, y: event.clientY };
  pedirCuadro();
}

/** El cursor salió de la ventana: el robot vuelve a mirar al frente. */
function alSalir(event: MouseEvent) {
  if (event.relatedTarget) return;
  cursor = null;
  pedirCuadro();
}

/** El robot de `robot` sigue el cursor mientras `activa`. */
export function useMirada(robot: RefObject<HTMLElement | null>, activa: boolean) {
  useEffect(() => {
    const el = robot.current;
    if (!activa || !el || sinMovimiento()) return;
    robots.add(el);
    if (robots.size === 1) {
      window.addEventListener("pointermove", alMover, { passive: true });
      document.addEventListener("mouseout", alSalir);
    }
    pedirCuadro();
    return () => {
      robots.delete(el);
      soltar(el);
      if (robots.size > 0) return;
      window.removeEventListener("pointermove", alMover);
      document.removeEventListener("mouseout", alSalir);
      if (cuadro) window.cancelAnimationFrame(cuadro);
      cuadro = 0;
    };
  }, [robot, activa]);
}

// 490 ms y 8 px (30-oct-2026, el dueño los midió en notas/robot-mirada/velocidad.html: con 620 ms el robot seguía
// brincando con la ventana ya abierta).
export const BRINCO_MS = 490;

/** Al tocar la píldora: se aplasta contra el piso y el robot brinca y cae aplastándose un poco. */
export function brincar(pildora: HTMLElement, robot: Element | null) {
  if (sinMovimiento()) return;
  const piso = "50% 100%";
  pildora.animate(
    [
      { transform: "none", transformOrigin: piso },
      { transform: "scale(1.06, 0.9)", transformOrigin: piso, offset: 0.15 },
      { transform: "none", transformOrigin: piso, offset: 0.35 },
      { transform: "scale(1.08, 0.88)", transformOrigin: piso, offset: 0.8 },
      { transform: "none", transformOrigin: piso },
    ],
    { duration: BRINCO_MS, easing: "ease-in-out" },
  );
  robot?.animate(
    [
      { transform: "none", transformOrigin: piso },
      { transform: "translateY(1px) scale(1.12, 0.84)", transformOrigin: piso, offset: 0.15 },
      { transform: "translateY(-8px) scale(0.9, 1.12)", transformOrigin: piso, offset: 0.45 },
      { transform: "scale(1.16, 0.84)", transformOrigin: piso, offset: 0.8 },
      { transform: "none", transformOrigin: piso },
    ],
    { duration: BRINCO_MS, easing: "ease-in-out" },
  );
}
