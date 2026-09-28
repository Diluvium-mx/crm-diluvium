import { describe, expect, it } from "vitest";
import { firstResponseSeconds, isAmbiguousSendError, isWindowOpen, nextStatus, SEND_ACCEPTED, SEND_RATE_LIMITED, windowExpiresAt } from "./rules";

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
