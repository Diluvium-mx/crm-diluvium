import { describe, expect, it } from "vitest";
import { buildAdCleanerPrompt, needsAdCleaning, parseAdCleaner, stripAdMetadata } from "./filter";
import { buildBrainSystemWithRuntime, HANDOVER_FALLBACK_TEXT, HANDOVER_TOKEN, parseBrainOutput, RUNTIME_SUFFIX } from "./brain";
import { FAQ_SECTION_HEADER } from "./knowledge";
import { isInternalAgentTag } from "./tags";

const AD_BODY = "Hola, quiero información\nbody: Compuertas contra inundaciones desde $5,500\nctwaClid: ARxyz\nsourceType: ad";

describe("filtro: solo limpia el anuncio de Click-to-WhatsApp", () => {
  it("detecta los entrantes con anuncio (referral o metadata pegada al texto)", () => {
    expect(needsAdCleaning({ direction: "in", body: "Hola", adReferral: { headline: "Compuertas" } })).toBe(true);
    expect(needsAdCleaning({ direction: "in", body: AD_BODY, adReferral: null })).toBe(true);
    expect(needsAdCleaning({ direction: "in", body: "¿Cuánto cuesta?", adReferral: null })).toBe(false);
    expect(needsAdCleaning({ direction: "out", body: AD_BODY, adReferral: null })).toBe(false);
  });

  it("el prompt lleva solo campos legibles del anuncio (sin ctwa_clid) y el texto como JSON", () => {
    const p = buildAdCleanerPrompt({ direction: "in", body: "hola", adReferral: { headline: "Compuertas", ctwa_clid: "secreto" } });
    expect(p).toContain('"titulo":"Compuertas"');
    expect(p).not.toContain("secreto");
    expect(p).toContain('Mensaje como llegó: "hola"');
  });

  it("lee el JSON de Luna: mensaje limpio + resumen del anuncio", () => {
    const m = { direction: "in" as const, body: AD_BODY, adReferral: null };
    expect(parseAdCleaner('```json\n{"mensaje":"Hola, quiero información","anuncio":"Compuertas desde $5,500"}\n```', m)).toEqual({
      mensaje: "Hola, quiero información",
      anuncio: "Compuertas desde $5,500",
      parsed: true,
    });
  });

  it("si Luna falla o no se entiende, el respaldo quita la metadata y el cliente igual recibe respuesta", () => {
    const m = { direction: "in" as const, body: AD_BODY, adReferral: { headline: "Compuertas" } };
    expect(parseAdCleaner("???", m)).toEqual({ mensaje: "Hola, quiero información", anuncio: "Compuertas", parsed: false });
    expect(stripAdMetadata(AD_BODY)).toBe("Hola, quiero información");
  });
});

describe("cerebro: se rige solo por el Goal y las FAQs", () => {
  it("el system es Goal completo + FAQs + sufijo fijo del CRM (el prefijo largo no cambia)", () => {
    const sys = buildBrainSystemWithRuntime("GOAL", [{ position: 1, question: "q", answer: "a" }]);
    expect(sys.startsWith("GOAL\n\n" + FAQ_SECTION_HEADER)).toBe(true);
    expect(sys.endsWith(RUNTIME_SUFFIX)).toBe(true);
  });

  it("el runtime NO agrega reglas propias (precios, montos, desglose, formato, límites)", () => {
    for (const banned of ["desglos", "precio unitario", "cifras", "signo $", "inventes", "Máximo", "bloque", "reveles"]) {
      expect(RUNTIME_SUFFIX).not.toContain(banned);
    }
  });

  it("pase a humano: la señal se quita del texto y el cliente recibe la respuesta", () => {
    expect(parseBrainOutput(`Claro, en un momento te atiende un asesor.\n${HANDOVER_TOKEN}`)).toEqual({
      kind: "reply",
      text: "Claro, en un momento te atiende un asesor.",
      handover: true,
    });
  });

  it("pase a humano sin texto: el cliente recibe el texto de respaldo (el agente siempre contesta)", () => {
    expect(parseBrainOutput(` ${HANDOVER_TOKEN} `)).toEqual({ kind: "reply", text: HANDOVER_FALLBACK_TEXT, handover: true });
  });

  it("vacío → empty; texto → reply", () => {
    expect(parseBrainOutput("   ")).toEqual({ kind: "empty" });
    expect(parseBrainOutput(" Hola ")).toEqual({ kind: "reply", text: "Hola", handover: false });
  });
});

describe("etiquetas internas", () => {
  it("'pasar a humano' y 'revisión humana' nunca se muestran", () => {
    expect(isInternalAgentTag("pasar a humano")).toBe(true);
    expect(isInternalAgentTag("Revisión humana")).toBe(true);
    expect(isInternalAgentTag("cliente VIP")).toBe(false);
  });
});
