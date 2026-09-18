import { describe, expect, it } from "vitest";
import { firstResponseSeconds, isWindowOpen, nextStatus, windowExpiresAt } from "./rules";

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

  it("failed gana, salvo que ya se haya leído; y no se sale de failed", () => {
    expect(nextStatus("sent", "failed")).toBe("failed");
    expect(nextStatus("read", "failed")).toBe("read");
    expect(nextStatus("failed", "delivered")).toBe("failed");
  });
});
