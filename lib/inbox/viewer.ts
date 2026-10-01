// Lógica pura del visor de adjuntos de escritorio (1-oct-2026, opción B elegida por
// el dueño en la página de prueba): qué adjuntos se recorren con ← →, zoom con lupa,
// desplazamiento de la foto ampliada, giro, deslizar para cambiar de archivo (Magic
// Mouse y clic-arrastrar) y nombre/tipo de la foto girada al descargarla. Sin DOM: lo
// usa media-viewer-desktop.tsx y lo cubren las pruebas.
import type { AttachmentView } from "./types";

/** Un clic con la lupa lleva la foto a 200 % (donde se hizo clic). */
export const LUPA_ZOOM = 2;
export const MAX_ZOOM = 5;
/** Paradas de Acercar / Alejar. */
export const ZOOM_STEPS = [1, 1.5, 2, 3, 4, 5] as const;
/** Margen alrededor de la foto ajustada: a los lados deja libre el lugar de las flechas. */
export const FIT_PAD = { x: 90, y: 16 } as const;
/** px de arrastre (clic-arrastrar) para cambiar de archivo. */
export const DRAG_SWIPE_PX = 80;
/** px acumulados de rueda horizontal (un dedo en el Magic Mouse) para cambiar de archivo. */
export const WHEEL_SWIPE_PX = 70;
/** Lo más que cede el primer/último archivo al deslizar hacia donde ya no hay más. */
export const EDGE_GIVE_PX = 40;
const EDGE_RESIST = 0.4;
/** Pausa entre eventos de rueda que separa un gesto del siguiente. */
export const GESTURE_GAP_MS = 200;
/**
 * Tras cambiar de archivo la inercia se ignora. Pasado este tiempo, un empuje que vuelve a crecer (más del
 * doble de lo más bajo que llegó la inercia) cuenta como gesto nuevo.
 */
const RELOCK_MS = 250;
/** Una página de PDF más ancha que esto (ancho/alto) se ve completa; las verticales van a lo ancho. */
const PDF_FIT_PAGE_RATIO = 0.85;

/**
 * ¿Este adjunto abre el visor? El mismo criterio que el chat (Attachment en
 * chat-thread.tsx): listo en el bucket y no es un audio o video que se reproduce
 * en la burbuja. Fotos, stickers, PDF y cualquier documento sí (lo que no se puede
 * ver se ofrece para descargar).
 */
export function isViewerOpenable(attachment: AttachmentView): boolean {
  if (attachment.state !== "ready") return false;
  if (attachment.kind === "audio" && attachment.preview === "audio") return false;
  if (attachment.kind === "video" && attachment.preview === "video") return false;
  return true;
}

export type Size = { w: number; h: number };
export type ImageView = { scale: number; rot: number; tx: number; ty: number };
export const IMAGE_VIEW_START: ImageView = { scale: 1, rot: 0, tx: 0, ty: 0 };

/** Cuartos de vuelta a la derecha (0–3) de un giro acumulado en grados. */
export function quarterTurns(rotDeg: number): number {
  return (((Math.round(rotDeg / 90) % 4) + 4) % 4);
}

/**
 * Tamaño de la foto ajustada a la pantalla (nunca más grande que su tamaño real).
 * `width/height` = el <img> sin girar; `base` = lo que ocupa ya girada, al 100 %.
 */
export function fitImage(natural: Size, stage: Size, rotDeg: number, pad: { x: number; y: number } = FIT_PAD): { width: number; height: number; base: Size } {
  const sideways = quarterTurns(rotDeg) % 2 === 1;
  const ew = sideways ? natural.h : natural.w;
  const eh = sideways ? natural.w : natural.h;
  if (ew <= 0 || eh <= 0) return { width: 0, height: 0, base: { w: 0, h: 0 } };
  const fit = Math.max(0, Math.min((stage.w - 2 * pad.x) / ew, (stage.h - 2 * pad.y) / eh, 1));
  return { width: natural.w * fit, height: natural.h * fit, base: { w: ew * fit, h: eh * fit } };
}

/** Limita el desplazamiento para que las cuatro orillas se alcancen y no se pase de ellas. */
export function clampPan(view: ImageView, base: Size, stage: Size): ImageView {
  const mx = Math.max(0, (base.w * view.scale - stage.w) / 2);
  const my = Math.max(0, (base.h * view.scale - stage.h) / 2);
  return { ...view, tx: Math.max(-mx, Math.min(mx, view.tx)), ty: Math.max(-my, Math.min(my, view.ty)) };
}

/**
 * Zoom hacia un punto (px, py medidos desde el centro de la pantalla): ese punto se
 * queda bajo el cursor. A 100 % la foto vuelve al centro.
 */
export function zoomAt(view: ImageView, nextScale: number, px = 0, py = 0): ImageView {
  const scale = Math.max(1, Math.min(MAX_ZOOM, nextScale));
  if (scale <= 1.001) return { ...view, scale: 1, tx: 0, ty: 0 };
  const k = scale / view.scale;
  return { ...view, scale, tx: px - (px - view.tx) * k, ty: py - (py - view.ty) * k };
}

/** Siguiente parada de Acercar (+1) o Alejar (−1). */
export function stepZoom(scale: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > scale + 0.01) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((s) => s < scale - 0.01) ?? 1;
}

/** Cuánto se corre el primer/último archivo al jalarlo hacia donde no hay más: cede y se detiene en 40 px. */
export function edgeGive(distance: number): number {
  return Math.sign(distance) * Math.min(EDGE_GIVE_PX, Math.abs(distance) * EDGE_RESIST);
}

/** Desplazamiento visible mientras se arrastra con clic: sigue al mouse, salvo en los extremos. */
export function dragOffset(dx: number, canGo: (dir: 1 | -1) => boolean): number {
  if (dx === 0) return 0;
  // Arrastrar a la izquierda (dx < 0) lleva al siguiente.
  return canGo(dx < 0 ? 1 : -1) ? dx : edgeGive(dx);
}

/** Al soltar el arrastre: siguiente (+1), anterior (−1) o se queda (0). */
export function dragDecision(dx: number, canGo: (dir: 1 | -1) => boolean): 1 | -1 | 0 {
  if (dx <= -DRAG_SWIPE_PX && canGo(1)) return 1;
  if (dx >= DRAG_SWIPE_PX && canGo(-1)) return -1;
  return 0;
}

export type WheelSwipeState = { acc: number; last: number; trough: number; locked: boolean; lockedAt: number };
export const WHEEL_SWIPE_START: WheelSwipeState = { acc: 0, last: Number.NEGATIVE_INFINITY, trough: 0, locked: false, lockedAt: 0 };
export type WheelSwipeAction =
  | { type: "none" }
  /** El archivo sigue al dedo (px de corrimiento visible). */
  | { type: "follow"; px: number }
  /** Primer/último archivo: llegó a los 40 px; se muestra y regresa. */
  | { type: "bounce"; px: number }
  | { type: "go"; dir: 1 | -1 };

/**
 * Un evento de rueda HORIZONTAL (el dedo del Magic Mouse; trae inercia). Un gesto =
 * un archivo: después de cambiar, la inercia se ignora hasta una pausa o un empuje
 * nuevo. dx > 0 = el dedo va a la izquierda = siguiente.
 */
export function wheelSwipe(
  state: WheelSwipeState,
  dx: number,
  now: number,
  canGo: (dir: 1 | -1) => boolean,
): { state: WheelSwipeState; action: WheelSwipeAction } {
  const abs = Math.abs(dx);
  const s: WheelSwipeState = { ...state, last: now };
  if (now - state.last > GESTURE_GAP_MS) {
    s.acc = 0;
    s.locked = false;
  } else if (state.locked && now - state.lockedAt > RELOCK_MS && abs > 10 && abs > state.trough * 2) {
    s.acc = 0;
    s.locked = false;
  }
  if (s.locked) {
    s.trough = Math.min(s.trough, abs);
    return { state: s, action: { type: "none" } };
  }
  s.acc += dx;
  if (s.acc === 0) return { state: s, action: { type: "follow", px: 0 } };
  const dir: 1 | -1 = s.acc > 0 ? 1 : -1;
  if (!canGo(dir)) {
    const give = Math.min(EDGE_GIVE_PX, Math.abs(s.acc) * EDGE_RESIST);
    if (give >= EDGE_GIVE_PX) {
      s.locked = true;
      s.lockedAt = now;
      s.trough = abs;
      return { state: s, action: { type: "bounce", px: -dir * EDGE_GIVE_PX } };
    }
    return { state: s, action: { type: "follow", px: -dir * give } };
  }
  if (Math.abs(s.acc) >= WHEEL_SWIPE_PX) {
    s.locked = true;
    s.lockedAt = now;
    s.trough = abs;
    return { state: s, action: { type: "go", dir } };
  }
  return { state: s, action: { type: "follow", px: -s.acc } };
}

/** Página cuadrada o acostada: se ve completa sin bajar (las verticales van a lo ancho). */
export function pdfPageFitsScreen(width: number, height: number): boolean {
  return height > 0 && width / height > PDF_FIT_PAGE_RATIO;
}

/**
 * Tipo y nombre de la foto girada al descargarla: el mismo formato y nombre que el
 * original; un GIF se guarda como PNG (el canvas no guarda GIF).
 */
export function rotatedImageFile(fileName: string | null, mime: string | null): { type: string; name: string } {
  const clean = (mime ?? "").toLowerCase();
  const type = clean === "image/png" || clean === "image/gif" ? "image/png" : clean === "image/webp" ? "image/webp" : "image/jpeg";
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  if (!fileName) return { type, name: `imagen.${ext}` };
  if (clean === "image/gif") return { type, name: fileName.replace(/\.gif$/i, "") + ".png" };
  return { type, name: fileName };
}
