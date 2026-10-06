import { describe, expect, it } from "vitest";
import { findInternalText, internalTextReason, unfinishedReply } from "./internal-text";

// Las formas reales que se colaron del 30-sep al 4-oct (datos del cliente cambiados) y textos
// normales del Agente IA que NUNCA deben marcarse.
const LEAKS = [
  "[tool call] wf_video_instalacion_estandar",
  '[tool call] actualizar_detalle {"tiene_inundaciones":"si","nivel_agua_cm":10}',
  "[We need tool after response]",
  "[tool call?]",
  "[actions]",
  "*(sin acción adicional, la respuesta ya fue enviada por el sistema)*",
  "(nota interna: ya se mandó la tabla)",
  'mover_etapa {"etapa":"interesado"}',
  "fijar_cotizacion 5500",
  "function call: aviso_vendedor",
  // 6-oct: basura del modelo en otro alfabeto, sola o pegada a una respuesta buena.
  "娱乐平台招商",
  "¿Aproximadamente hasta qué nivel le sube el agua? 娱乐",
  "Спасибо",
  "ありがとうございます",
  "شكرا",
  "감사합니다",
];

const OK = [
  "La compuerta estándar cuesta $5,500 MXN con envío incluido.",
  "¿Usted tiene problemas de inundaciones?",
  "Para 95 cm le corresponde el tamaño M (estándar).",
  "Puede pagar con tarjeta hasta en 6 meses sin intereses (con un cargo de 13 %).",
  "¿Habrá manera de medir la anchura de la entrada? De izquierda a derecha, para saber qué tamaño le serviría.",
  "Claro, aquí quedo al pendiente 👍",
  "Estamos en Los Mochis, Sinaloa, y enviamos a todo México.",
  "El video de instalación está en nuestro canal: https://youtube.com/@ejemplo",
  "Señora Peña, ¿cuál es el nivel del agua? Pingüino, 2.º piso, 1.ª entrada, 30 °C, 5 m² ✅🏠💧",
  "Ç Ã Ê Ö ß Œ — «comillas» … ¡Gracias!",
];

describe("internalTextReason", () => {
  it.each(LEAKS)("marca texto interno: %s", (t) => {
    expect(internalTextReason(t)).not.toBeNull();
  });
  it.each(OK)("deja pasar texto para el cliente: %s", (t) => {
    expect(internalTextReason(t)).toBeNull();
  });
});

describe("findInternalText", () => {
  it("encuentra la nota en el último renglón de una respuesta buena (caso 1-oct)", () => {
    const found = findInternalText(["¿Me comparte una fotografía de cada entrada?\n\n[actions]"]);
    expect(found?.text).toBe("[actions]");
  });
  it("la burbuja en chino detrás de una pregunta buena (caso 6-oct) detiene toda la respuesta", () => {
    const found = findInternalText(["¿Aproximadamente hasta qué nivel le sube el agua?\n\n娱乐平台招商"]);
    expect(found).toEqual({ text: "娱乐平台招商", reason: "letras de otro idioma" });
  });
  it("una respuesta normal de dos mensajes no tiene nada interno", () => {
    expect(findInternalText(OK.slice(0, 2))).toBeNull();
  });
});

describe("unfinishedReply", () => {
  it("texto interno → tarjeta que dice que no salió nada y que queda en pausa", () => {
    const r = unfinishedReply(["Sí, es removible.\n[tool call] wf_video_instalacion_estandar"], "tool-calls", []);
    expect(r?.card).toContain("nota interna");
    expect(r?.card).toContain("No se le mandó nada al cliente");
    expect(r?.card).toContain("pausa");
  });
  it("respuesta cortada por el tope → tarjeta", () => {
    expect(unfinishedReply(["La compuerta cuesta"], "length", [])?.log).toContain("cortada");
  });
  it("acción con datos inválidos o herramienta que no existe → tarjeta", () => {
    expect(unfinishedReply(["Listo."], "stop", ["fijar_cotizacion: argumentos inválidos"])?.card).toContain("fijar_cotizacion");
    expect(unfinishedReply(["Listo."], "stop", ["wf_inventado: herramienta desconocida o deshabilitada"])).not.toBeNull();
  });
  it("el Detalle sin datos válidos no detiene la respuesta (es de apoyo)", () => {
    expect(unfinishedReply(["La compuerta cuesta $5,500."], "stop", ["actualizar_detalle: sin datos válidos"])).toBeNull();
  });
  it("una respuesta normal sale", () => {
    expect(unfinishedReply(OK.slice(0, 2), "stop", [])).toBeNull();
  });
});
