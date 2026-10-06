import { describe, expect, it } from "vitest";
import { findInternalText, hasForeignScript, internalTextReason, stripForeignScript, unfinishedReply } from "./internal-text";

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

// 6-oct-2026 (dueño): las letras de otro alfabeto se BORRAN y sale lo demás; no detienen la respuesta.
describe("stripForeignScript", () => {
  it("caso 6-oct: la burbuja en chino detrás de una pregunta buena desaparece y queda la pregunta", () => {
    expect(stripForeignScript("¿Aproximadamente hasta qué nivel le sube el agua?\n\n娱乐平台招商")).toBe("¿Aproximadamente hasta qué nivel le sube el agua?");
  });
  it("caso 2-oct: un mensaje que solo era basura queda vacío", () => {
    expect(stripForeignScript("屹")).toBe("");
    expect(stripForeignScript("娱乐平台招商。")).toBe("");
  });
  it("basura en medio de un renglón: se quita sin dejar espacios dobles ni antes del signo", () => {
    expect(stripForeignScript("La compuerta 娱乐平台 es de acero.")).toBe("La compuerta es de acero.");
    expect(stripForeignScript("¿Hasta qué nivel 招商?")).toBe("¿Hasta qué nivel?");
    expect(stripForeignScript("Hola Спасибо señora, ありがとう ¿cómo está? شكرا 감사합니다")).toBe("Hola señora, ¿cómo está?");
  });
  it("un texto en español queda IDÉNTICO (acentos, ñ, ü, º/ª, °, m², emojis, saltos de renglón)", () => {
    for (const t of [...OK, "Señora Peña, ¿cuál es el nivel del agua? Pingüino, 2.º piso, 1.ª entrada, 30 °C, 5 m² ✅🏠💧", "Ç Ã Ê Ö ß Œ — «comillas» … ¡Gracias!", "Primero.\n\nSegundo.\n"]) {
      expect(hasForeignScript(t)).toBe(false);
      expect(stripForeignScript(t)).toBe(t);
    }
  });
  it("ya no es «texto interno»: no detiene la respuesta ni pausa", () => {
    expect(findInternalText(["¿Hasta qué nivel le sube el agua?\n\n娱乐平台招商"])).toBeNull();
    expect(unfinishedReply(["娱乐平台招商"], "stop", [])).toBeNull();
  });
});
