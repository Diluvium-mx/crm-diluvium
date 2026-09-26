import { describe, expect, it } from "vitest";
import { funnelTone, unreadBadge } from "./funnel-tone";

describe("funnelTone", () => {
  it("no asigna tono sin señal pendiente ni urgente", () => {
    expect(funnelTone(undefined)).toBeUndefined();
    expect(funnelTone({ unread: 8, pending: false, urgent: false })).toBeUndefined();
  });

  it("usa pending cuando hay un mensaje por contestar", () => {
    expect(funnelTone({ unread: 0, pending: true, urgent: false })).toBe("pending");
  });

  it("da prioridad a urgent cuando urgent y pending coinciden", () => {
    expect(funnelTone({ unread: 0, pending: true, urgent: true })).toBe("urgent");
  });
});

describe("unreadBadge", () => {
  it("oculta el badge para undefined, cero y valores negativos", () => {
    expect(unreadBadge(undefined)).toBe("");
    expect(unreadBadge(0)).toBe("");
    expect(unreadBadge(-2)).toBe("");
  });

  it("muestra enteros positivos hasta 99", () => {
    expect(unreadBadge(1)).toBe("1");
    expect(unreadBadge(42.9)).toBe("42");
    expect(unreadBadge(99)).toBe("99");
  });

  it("limita cualquier valor superior a 99 a 99+", () => {
    expect(unreadBadge(99.1)).toBe("99+");
    expect(unreadBadge(100)).toBe("99+");
    expect(unreadBadge(10_000)).toBe("99+");
  });
});
