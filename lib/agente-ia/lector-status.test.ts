import { describe, expect, it } from "vitest";
import { etaSeconds, isPending, resolveLectorStatus, type LectorConversationInfo } from "./lector-status";

const now = new Date("2026-09-29T18:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);
const conv = (over: Partial<LectorConversationInfo> = {}): LectorConversationInfo => ({
  conversationId: "c1",
  lastMessageAt: ago(60),
  leidoHasta: ago(60),
  firstUnreadAt: null,
  reading: false,
  lastRead: { at: ago(55), ok: true },
  ...over,
});

describe("indicador del Agente IA en segundo plano (Detalle)", () => {
  it("sin chats o nunca leído y sin nada pendiente: no se muestra nada", () => {
    expect(resolveLectorStatus([], now)).toBeNull();
    expect(resolveLectorStatus([conv({ lastRead: null })], now)).toBeNull();
  });

  it("al día con la hora de la última lectura; si falló, error", () => {
    expect(resolveLectorStatus([conv()], now)).toEqual({ kind: "al_dia", at: ago(55).toISOString() });
    expect(resolveLectorStatus([conv({ lastRead: { at: ago(5), ok: false } })], now)).toEqual({ kind: "error", at: ago(5).toISOString() });
  });

  it("mensaje sin leer: en espera hasta que el chat lleve 3 min quieto (+ el paso del barrido)", () => {
    const c = conv({ lastMessageAt: ago(1), firstUnreadAt: ago(1) });
    expect(isPending(c, now)).toBe(true);
    expect(etaSeconds(c, now)).toBe(2 * 60 + 30);
    expect(resolveLectorStatus([c], now)).toEqual({ kind: "espera", etaSeconds: 150 });
  });

  it("chat que no para: manda el tope de 15 min desde el primer mensaje sin leer", () => {
    const c = conv({ lastMessageAt: ago(0), firstUnreadAt: ago(14) });
    expect(etaSeconds(c, now)).toBe(60 + 30);
  });

  it("leyendo gana sobre todo (dos chats del mismo contacto); el pendiente más próximo gana sobre al día", () => {
    const leyendo = conv({ conversationId: "c2", reading: true });
    const pendiente = conv({ conversationId: "c3", lastMessageAt: ago(2), firstUnreadAt: ago(2) });
    expect(resolveLectorStatus([conv(), pendiente, leyendo], now)).toEqual({ kind: "leyendo" });
    expect(resolveLectorStatus([conv(), pendiente], now)?.kind).toBe("espera");
  });

  it("lo más viejo que 3 días no lo toma el barrido: no se promete lectura", () => {
    const viejo = conv({ lastMessageAt: ago(4 * 24 * 60), leidoHasta: null, lastRead: null });
    expect(isPending(viejo, now)).toBe(false);
    expect(resolveLectorStatus([viejo], now)).toBeNull();
  });
});
