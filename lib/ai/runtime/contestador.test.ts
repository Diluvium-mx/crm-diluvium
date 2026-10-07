import { describe, expect, it } from "vitest";
import { INSTAGRAM_WITHHELD } from "@/lib/messaging/instagram-unviewable";
import { AUTO_RESPONDER_NOTICE, LOOP_ROUNDS, looksLikeAutoResponder, type LoopMessage } from "./contestador";

// Lo que mandó el contestador de Estafeta el 7-oct-2026 (chat real del freno).
const NO_ENTENDI = "Perdón, no estoy seguro de haber entendido bien. ¿Podrías preguntar dando más detalle por favor?";

const cliente = (body: string | null, extra: Partial<LoopMessage> = {}): LoopMessage => ({ direction: "in", human: false, body, unreadable: false, afterCut: true, ...extra });
const noCompatible = (extra: Partial<LoopMessage> = {}): LoopMessage => cliente("[Unsupported message]", { unreadable: true, ...extra });
const agente = (body = "¿En qué le podemos ayudar?"): LoopMessage => ({ direction: "out", human: false, body, unreadable: false, afterCut: true });
const vendedor = (body = "Le atiendo yo."): LoopMessage => ({ direction: "out", human: true, body, unreadable: false, afterCut: true });

/** Una vuelta del contestador de Estafeta: su «no entendí» y su menú (no compatible). */
const vueltaEstafeta = (): LoopMessage[] => [cliente(NO_ENTENDI), noCompatible()];

describe("freno ante contestadores automáticos", () => {
  it("caso Estafeta: a la 3.ª vuelta seguida con el mismo «no entendí» y su menú, frena", () => {
    const inicio = [noCompatible(), agente(), noCompatible(), agente("No pude visualizar el mensaje."), ...vueltaEstafeta(), agente()];
    // La 1.ª vez que llega el «no entendí» es algo nuevo: no frena.
    expect(looksLikeAutoResponder([noCompatible(), agente(), noCompatible(), agente(), ...vueltaEstafeta()])).toBe(false);
    // 1.ª y 2.ª repetición: todavía no.
    expect(looksLikeAutoResponder([...inicio, ...vueltaEstafeta()])).toBe(false);
    expect(looksLikeAutoResponder([...inicio, ...vueltaEstafeta(), agente(), ...vueltaEstafeta()])).toBe(false);
    // 3.ª vuelta seguida sin nada nuevo: frena.
    expect(looksLikeAutoResponder([...inicio, ...vueltaEstafeta(), agente(), ...vueltaEstafeta(), agente(), ...vueltaEstafeta()])).toBe(true);
  });

  it("solo mensajes que WhatsApp no deja ver, vuelta tras vuelta: frena a la 3.ª", () => {
    expect(looksLikeAutoResponder([noCompatible(), agente(), noCompatible()])).toBe(false);
    expect(looksLikeAutoResponder([noCompatible(), agente(), noCompatible(), agente(), noCompatible()])).toBe(true);
  });

  it("el mismo texto con otras mayúsculas o espacios cuenta como repetido", () => {
    const rows = [cliente(NO_ENTENDI), agente(), cliente(NO_ENTENDI.toUpperCase()), agente(), cliente(`  ${NO_ENTENDI}  `), agente(), cliente(NO_ENTENDI.replace(" ", "   "))];
    expect(looksLikeAutoResponder(rows)).toBe(true);
  });

  it("una persona que repite algo corto («sí», «ok», «gracias») no es un contestador", () => {
    const rows = [cliente("sí"), agente(), cliente("sí"), agente(), cliente("Sí"), agente(), cliente("sí")];
    expect(looksLikeAutoResponder(rows)).toBe(false);
    expect(looksLikeAutoResponder([cliente("Muchas gracias"), agente(), cliente("Muchas gracias"), agente(), cliente("Muchas gracias"), agente(), cliente("Muchas gracias")])).toBe(false);
  });

  it("si en la vuelta llega algo nuevo (texto, foto o audio), no frena", () => {
    const base = [cliente(NO_ENTENDI), agente(), cliente(NO_ENTENDI), agente(), cliente(NO_ENTENDI), agente()];
    expect(looksLikeAutoResponder([...base, cliente(NO_ENTENDI), cliente("¿Cuánto cuesta la de 90 cm?")])).toBe(false);
    // Foto o audio sin texto: es contenido.
    expect(looksLikeAutoResponder([...base, cliente(NO_ENTENDI), cliente(null)])).toBe(false);
  });

  it("varios reels de Instagram seguidos (no se pueden ver) no frenan: es un cliente", () => {
    const rows = [cliente(INSTAGRAM_WITHHELD), agente(), cliente(INSTAGRAM_WITHHELD), agente(), cliente(INSTAGRAM_WITHHELD), agente(), cliente(INSTAGRAM_WITHHELD)];
    expect(looksLikeAutoResponder(rows)).toBe(false);
  });

  it("un vendedor que contestó entre esas vueltas corta la cuenta", () => {
    const rows = [cliente(NO_ENTENDI), agente(), cliente(NO_ENTENDI), vendedor(), cliente(NO_ENTENDI), agente(), cliente(NO_ENTENDI)];
    expect(looksLikeAutoResponder(rows)).toBe(false);
    // Ya con tres vueltas seguidas después del vendedor, sí.
    expect(looksLikeAutoResponder([...rows, agente(), cliente(NO_ENTENDI)])).toBe(true);
  });

  it("tras «Activar» solo cuentan las vueltas nuevas: el siguiente mensaje se contesta", () => {
    const antes = [cliente(NO_ENTENDI), agente(), cliente(NO_ENTENDI), agente(), cliente(NO_ENTENDI), agente(), cliente(NO_ENTENDI)].map((m) => ({ ...m, afterCut: false }));
    expect(looksLikeAutoResponder([...antes, agente(), cliente(NO_ENTENDI)])).toBe(false);
    expect(looksLikeAutoResponder([...antes, agente(), cliente(NO_ENTENDI), agente(), cliente(NO_ENTENDI)])).toBe(false);
    // Lo repetido se reconoce aunque la 1.ª vez fuera antes del corte.
    expect(looksLikeAutoResponder([...antes, agente(), cliente(NO_ENTENDI), agente(), cliente(NO_ENTENDI), agente(), cliente(NO_ENTENDI)])).toBe(true);
  });

  it("la media de un workflow después del último mensaje no cierra la vuelta pendiente", () => {
    const rows = [noCompatible(), agente(), noCompatible(), agente(), noCompatible(), agente("[tabla de tamaños]")];
    expect(looksLikeAutoResponder(rows)).toBe(true);
  });

  it("con menos vueltas que las necesarias, o sin mensajes, no frena", () => {
    expect(looksLikeAutoResponder([])).toBe(false);
    expect(looksLikeAutoResponder([noCompatible()])).toBe(false);
    expect(LOOP_ROUNDS).toBe(3);
  });

  it("la tarjeta dice qué pasó y cómo volver a encenderlo", () => {
    expect(AUTO_RESPONDER_NOTICE).toContain("contestador automático");
    expect(AUTO_RESPONDER_NOTICE).toContain("«Activar»");
    expect(AUTO_RESPONDER_NOTICE).not.toMatch(/\bbot\b/i);
  });
});
