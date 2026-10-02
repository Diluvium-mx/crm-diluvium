import { describe, expect, it } from "vitest";
import {
  canSendFreeForm,
  firstResponseSeconds,
  humanAgentExpiresAt,
  isAmbiguousSendError,
  isWindowOpen,
  needsHumanAgentTag,
  nextStatus,
  SEND_ACCEPTED,
  SEND_RATE_LIMITED,
  SERVICE_WINDOW_MS,
  windowExpiresAt,
} from "./rules";

const at = (iso: string) => new Date(iso);

describe("ventana de 24 h", () => {
  it("se abre 24 h después del mensaje entrante", () => {
    expect(windowExpiresAt(at("2026-09-18T10:00:00Z"), null)).toEqual(at("2026-09-19T10:00:00Z"));
  });

  it("un entrante más nuevo la extiende; uno viejo (reintento tardío) no la acorta", () => {
    const current = at("2026-09-19T10:00:00Z");
    expect(windowExpiresAt(at("2026-09-18T15:00:00Z"), current)).toEqual(at("2026-09-19T15:00:00Z"));
    expect(windowExpiresAt(at("2026-09-18T08:00:00Z"), current)).toEqual(current);
  });

  it("abierta solo antes de vencer", () => {
    const now = at("2026-09-19T09:59:59Z");
    expect(isWindowOpen(at("2026-09-19T10:00:00Z"), now)).toBe(true);
    expect(isWindowOpen(at("2026-09-19T09:59:59Z"), now)).toBe(false);
    expect(isWindowOpen(null, now)).toBe(false);
  });
});

describe("tiempo de primera respuesta", () => {
  it("segundos entre el primer entrante y la respuesta", () => {
    expect(firstResponseSeconds(at("2026-09-18T10:00:00Z"), at("2026-09-18T10:07:30Z"))).toBe(450);
  });

  it("sin entrante previo (el negocio escribió primero) no hay métrica", () => {
    expect(firstResponseSeconds(null, at("2026-09-18T10:00:00Z"))).toBeNull();
    expect(firstResponseSeconds(at("2026-09-18T10:00:00Z"), at("2026-09-18T09:00:00Z"))).toBeNull();
  });
});

describe("nextStatus", () => {
  it("avanza, nunca retrocede con estados que llegan desordenados", () => {
    expect(nextStatus("queued", "sent")).toBe("sent");
    expect(nextStatus("sent", "read")).toBe("read");
    expect(nextStatus("read", "delivered")).toBe("read");
    expect(nextStatus("delivered", "sent")).toBe("delivered");
  });

  it("failed gana sobre en cola/enviado; un fallido real se queda fallido", () => {
    expect(nextStatus("queued", "failed")).toBe("failed");
    expect(nextStatus("sent", "failed")).toBe("failed");
    expect(nextStatus("failed", "sent")).toBe("failed");
    expect(nextStatus("failed", "queued")).toBe("failed");
  });

  it("entregado o leído gana SIEMPRE sobre failed, en cualquier orden (Bloque B)", () => {
    // failed primero y luego la prueba de entrega
    expect(nextStatus("failed", "delivered")).toBe("delivered");
    expect(nextStatus("failed", "read")).toBe("read");
    // la prueba de entrega primero y luego un failed tardío
    expect(nextStatus("delivered", "failed")).toBe("delivered");
    expect(nextStatus("read", "failed")).toBe("read");
  });
});

describe("isAmbiguousSendError", () => {
  it("aceptado por Zernio sin confirmar en la base: nunca se reenvía; 429 agotado sí", () => {
    expect(isAmbiguousSendError(SEND_ACCEPTED)).toBe(true);
    expect(isAmbiguousSendError(SEND_RATE_LIMITED)).toBe(false);
  });
});

describe("Instagram: 24 h para todos, 7 días solo para un vendedor (docs/instagram.md)", () => {
  const lastInbound = new Date("2026-10-02T12:00:00Z");
  const windowEnd = new Date(lastInbound.getTime() + SERVICE_WINDOW_MS);
  const at = (hours: number) => new Date(lastInbound.getTime() + hours * 3_600_000);

  it("dentro de 24 h: cualquiera, sin etiqueta", () => {
    expect(canSendFreeForm("instagram", windowEnd, at(23), false)).toBe(true);
    expect(needsHumanAgentTag("instagram", windowEnd, at(23))).toBe(false);
  });

  it("de 24 h a 7 días: solo una persona, con HUMAN_AGENT", () => {
    expect(canSendFreeForm("instagram", windowEnd, at(25), false)).toBe(false);
    expect(canSendFreeForm("instagram", windowEnd, at(25), true)).toBe(true);
    expect(canSendFreeForm("instagram", windowEnd, at(167), true)).toBe(true);
    expect(needsHumanAgentTag("instagram", windowEnd, at(25))).toBe(true);
    expect(humanAgentExpiresAt(windowEnd)?.toISOString()).toBe(at(168).toISOString());
  });

  it("después de 7 días: nadie", () => {
    expect(canSendFreeForm("instagram", windowEnd, at(169), true)).toBe(false);
  });

  it("WhatsApp no cambia: fuera de 24 h nadie escribe texto (solo plantilla) y nunca hay etiqueta", () => {
    expect(canSendFreeForm("whatsapp", windowEnd, at(25), true)).toBe(false);
    expect(needsHumanAgentTag("whatsapp", windowEnd, at(25))).toBe(false);
  });

  it("sin mensaje del cliente (ventana null) no se puede", () => {
    expect(canSendFreeForm("instagram", null, at(1), true)).toBe(false);
    expect(humanAgentExpiresAt(null)).toBeNull();
  });
});
