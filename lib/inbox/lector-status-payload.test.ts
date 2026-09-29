import { describe, expect, it } from "vitest";
import { parseLectorStatus } from "./lector-status-payload";

describe("aviso lector.status del tiempo real", () => {
  it("válido: leyendo / listo con cambios / error", () => {
    expect(parseLectorStatus({ contactId: "c", conversationId: "v", phase: "leyendo", cambios: 0 })).toEqual({ type: "lector.status", contactId: "c", conversationId: "v", phase: "leyendo", cambios: 0 });
    expect(parseLectorStatus({ contactId: "c", conversationId: "v", phase: "listo", cambios: 3 })?.cambios).toBe(3);
    expect(parseLectorStatus({ contactId: "c", conversationId: "v", phase: "error" })?.phase).toBe("error");
  });

  it("dato raro: se descarta el aviso (o el conteo), nunca rompe", () => {
    expect(parseLectorStatus({ contactId: "c", conversationId: "v", phase: "otra" })).toBeNull();
    expect(parseLectorStatus({ contactId: 1, conversationId: "v", phase: "listo" })).toBeNull();
    expect(parseLectorStatus({ contactId: "c", conversationId: "v", phase: "listo", cambios: -2 })?.cambios).toBe(0);
    expect(parseLectorStatus({ contactId: "c", conversationId: "v", phase: "listo", cambios: 500 })?.cambios).toBe(99);
  });
});
