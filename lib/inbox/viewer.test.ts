import { describe, expect, it } from "vitest";
import type { AttachmentView } from "./types";
import {
  clampPan,
  dragDecision,
  dragOffset,
  EDGE_GIVE_PX,
  edgeGive,
  fitImage,
  IMAGE_VIEW_START,
  isViewerOpenable,
  pdfPageFitsScreen,
  quarterTurns,
  rotatedImageFile,
  stepZoom,
  WHEEL_SWIPE_START,
  wheelSwipe,
  zoomAt,
  type WheelSwipeAction,
  type WheelSwipeState,
} from "./viewer";

function att(over: Partial<AttachmentView> = {}): AttachmentView {
  return { index: 0, kind: "image", fileName: null, mimeType: null, state: "ready", url: "/api/media/m/0", downloadUrl: "/api/media/m/0?download=1", thumbnailUrl: null, sizeBytes: null, pageCount: null, preview: "image", ...over };
}

const all = () => true;
const none = () => false;

describe("isViewerOpenable (qué se recorre con ← →)", () => {
  it("fotos, stickers, PDF y documentos sí", () => {
    expect(isViewerOpenable(att())).toBe(true);
    expect(isViewerOpenable(att({ kind: "sticker" }))).toBe(true);
    expect(isViewerOpenable(att({ kind: "document", preview: "pdf" }))).toBe(true);
    expect(isViewerOpenable(att({ kind: "document", preview: null, fileName: "factura.xml" }))).toBe(true);
  });
  it("audio y video que se reproducen en la burbuja, no", () => {
    expect(isViewerOpenable(att({ kind: "audio", preview: "audio" }))).toBe(false);
    expect(isViewerOpenable(att({ kind: "video", preview: "video" }))).toBe(false);
  });
  it("S2: un audio/video que sus bytes no confirman es tarjeta de descarga → sí abre", () => {
    expect(isViewerOpenable(att({ kind: "video", preview: null }))).toBe(true);
    expect(isViewerOpenable(att({ kind: "audio", preview: null }))).toBe(true);
  });
  it("procesando o fallido, no", () => {
    expect(isViewerOpenable(att({ state: "processing" }))).toBe(false);
    expect(isViewerOpenable(att({ state: "failed" }))).toBe(false);
  });
});

describe("fitImage (foto ajustada, con giro)", () => {
  it("cabe completa sin agrandarse más que su tamaño real", () => {
    const r = fitImage({ w: 1500, h: 1500 }, { w: 1440, h: 737 }, 0);
    expect(r.width).toBeCloseTo(705);
    expect(r.base).toEqual({ w: r.width, h: r.height });
    expect(fitImage({ w: 200, h: 100 }, { w: 1440, h: 737 }, 0).width).toBe(200);
  });
  it("girada de lado intercambia ancho y alto", () => {
    const r = fitImage({ w: 2000, h: 1000 }, { w: 1440, h: 737 }, 90);
    expect(r.base.w).toBeCloseTo(r.height);
    expect(r.base.h).toBeCloseTo(r.width);
    expect(r.base.h).toBeLessThanOrEqual(737 - 32);
  });
  it("sin tamaño todavía (no cargó) no truena", () => {
    expect(fitImage({ w: 0, h: 0 }, { w: 1440, h: 737 }, 0).width).toBe(0);
  });
});

describe("zoomAt / clampPan (lupa y desplazamiento)", () => {
  const stage = { w: 1440, h: 737 };
  const base = { w: 705, h: 705 };
  it("la lupa acerca hacia el punto del clic y se puede llegar a cada orilla", () => {
    const v = clampPan(zoomAt(IMAGE_VIEW_START, 2, -200, -200), base, stage);
    expect(v.scale).toBe(2);
    // A 200 % la foto (1410 px) cabe a lo ancho: se queda centrada a los lados.
    expect(v.tx).toBe(0);
    // A lo alto sí sobra: el punto del clic se queda bajo el cursor.
    expect(v.ty).toBeCloseTo(200);
    const lejos = clampPan({ ...v, tx: 9999, ty: -9999 }, base, stage);
    expect(lejos.ty).toBeCloseTo(-(1410 - 737) / 2);
  });
  it("volver a 100 % la centra", () => {
    expect(zoomAt({ scale: 3, rot: 90, tx: 50, ty: -40 }, 1)).toEqual({ scale: 1, rot: 90, tx: 0, ty: 0 });
  });
  it("nunca menos de 100 % ni más de 500 %", () => {
    expect(zoomAt(IMAGE_VIEW_START, 0.2).scale).toBe(1);
    expect(zoomAt(IMAGE_VIEW_START, 50).scale).toBe(5);
  });
  it("Acercar/Alejar recorren las paradas", () => {
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(2, 1)).toBe(3);
    expect(stepZoom(5, 1)).toBe(5);
    expect(stepZoom(3, -1)).toBe(2);
    expect(stepZoom(1.5, -1)).toBe(1);
    expect(stepZoom(1, -1)).toBe(1);
    expect(stepZoom(2.4, -1)).toBe(2);
  });
  it("cuartos de vuelta de un giro acumulado", () => {
    expect([0, 90, 180, 270, 360, 450, -90].map(quarterTurns)).toEqual([0, 1, 2, 3, 0, 1, 3]);
  });
});

describe("deslizar con clic-arrastrar", () => {
  it("sigue al mouse y cambia al pasar 80 px", () => {
    expect(dragOffset(-60, all)).toBe(-60);
    expect(dragDecision(-79, all)).toBe(0);
    expect(dragDecision(-80, all)).toBe(1);
    expect(dragDecision(120, all)).toBe(-1);
  });
  it("en el primer/último archivo cede como máximo 40 px y no cambia", () => {
    expect(dragOffset(-300, none)).toBe(-EDGE_GIVE_PX);
    expect(dragOffset(50, none)).toBe(20);
    expect(dragDecision(-300, none)).toBe(0);
    expect(edgeGive(-1000)).toBe(-EDGE_GIVE_PX);
  });
});

describe("wheelSwipe (un dedo en el Magic Mouse)", () => {
  // Un gesto con inercia: empuje y luego deltas que se apagan, cada 12 ms.
  function gesture(state: WheelSwipeState, start: number, sign: 1 | -1, t0: number, canGo: (d: 1 | -1) => boolean, n = 40) {
    const actions: WheelSwipeAction[] = [];
    let s = state;
    let d = start;
    let t = t0;
    for (let i = 0; i < n; i++) {
      const r = wheelSwipe(s, sign * d, t, canGo);
      s = r.state;
      actions.push(r.action);
      d = Math.max(0.5, d * 0.9);
      t += 12;
    }
    return { state: s, actions, end: t };
  }

  it("un gesto con inercia cambia UN solo archivo", () => {
    const g = gesture(WHEEL_SWIPE_START, 28, 1, 0, all);
    expect(g.actions.filter((a) => a.type === "go")).toEqual([{ type: "go", dir: 1 }]);
  });
  it("antes del umbral el archivo sigue al dedo", () => {
    const r = wheelSwipe(WHEEL_SWIPE_START, 30, 0, all);
    expect(r.action).toEqual({ type: "follow", px: -30 });
  });
  it("dos gestos seguidos (sin pausa) cambian dos archivos", () => {
    const a = gesture(WHEEL_SWIPE_START, 28, 1, 0, all, 30);
    const b = gesture(a.state, 28, 1, a.end, all, 30);
    expect([...a.actions, ...b.actions].filter((x) => x.type === "go")).toHaveLength(2);
  });
  it("tras una pausa empieza un gesto nuevo hacia el otro lado", () => {
    const a = gesture(WHEEL_SWIPE_START, 28, 1, 0, all);
    const b = gesture(a.state, 28, -1, a.end + 500, all);
    expect(b.actions.find((x) => x.type === "go")).toEqual({ type: "go", dir: -1 });
  });
  it("en el primer/último archivo: nunca más de 40 px, rebota y no cambia (aunque se deslice 3 veces)", () => {
    let s = WHEEL_SWIPE_START;
    let t = 0;
    const acts: WheelSwipeAction[] = [];
    for (let k = 0; k < 3; k++) {
      const g = gesture(s, 30, -1, t, none, 45);
      s = g.state;
      t = g.end;
      acts.push(...g.actions);
    }
    expect(acts.some((a) => a.type === "go")).toBe(false);
    const moves = acts.flatMap((a) => (a.type === "follow" || a.type === "bounce" ? [Math.abs(a.px)] : []));
    expect(Math.max(...moves)).toBe(EDGE_GIVE_PX);
    expect(acts.filter((a) => a.type === "bounce").length).toBeGreaterThanOrEqual(3);
  });
});

describe("pdfPageFitsScreen", () => {
  it("carta vertical va a lo ancho; cuadrada y acostada completas", () => {
    expect(pdfPageFitsScreen(612, 792)).toBe(false);
    expect(pdfPageFitsScreen(1500, 1500)).toBe(true);
    expect(pdfPageFitsScreen(792, 612)).toBe(true);
  });
});

describe("rotatedImageFile (foto girada al descargar)", () => {
  it("mismo nombre y formato", () => {
    expect(rotatedImageFile("foto.jpeg", "image/jpeg")).toEqual({ type: "image/jpeg", name: "foto.jpeg" });
    expect(rotatedImageFile("tabla.png", "image/png")).toEqual({ type: "image/png", name: "tabla.png" });
    expect(rotatedImageFile("x.webp", "image/webp")).toEqual({ type: "image/webp", name: "x.webp" });
  });
  it("sin nombre (fotos de WhatsApp) le pone uno; un GIF sale como PNG", () => {
    expect(rotatedImageFile(null, "image/jpeg")).toEqual({ type: "image/jpeg", name: "imagen.jpg" });
    expect(rotatedImageFile("risa.gif", "image/gif")).toEqual({ type: "image/png", name: "risa.png" });
  });
});
