import { describe, expect, it } from "vitest";
import { canMarkRead, funnelTone, unreadBadge, type FunnelSignal } from "./funnel-tone";

const signal = (s: Partial<FunnelSignal>): FunnelSignal => ({ unread: 0, pending: false, urgent: false, lastInboundAt: null, starred: false, ...s });

describe("funnelTone", () => {
  it("no asigna tono sin señal pendiente ni urgente", () => {
    expect(funnelTone(undefined)).toBeUndefined();
    expect(funnelTone(signal({ unread: 8 }))).toBeUndefined();
  });

  it("usa pending cuando hay un mensaje por contestar", () => {
    expect(funnelTone(signal({ pending: true }))).toBe("pending");
  });

  it("da prioridad a urgent cuando urgent y pending coinciden", () => {
    expect(funnelTone(signal({ pending: true, urgent: true }))).toBe("urgent");
  });
});

describe("canMarkRead", () => {
  it("hay qué marcar con el círculo naranja o con el azul", () => {
    expect(canMarkRead(signal({ unread: 2 }))).toBe(true);
    expect(canMarkRead(signal({ pending: true }))).toBe(true);
  });

  it("sin señal, en blanco o solo en amarillo no hay nada que marcar", () => {
    expect(canMarkRead(undefined)).toBe(false);
    expect(canMarkRead(signal({}))).toBe(false);
    expect(canMarkRead(signal({ urgent: true }))).toBe(false);
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
