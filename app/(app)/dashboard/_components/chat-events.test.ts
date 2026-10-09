import { describe, expect, it } from "vitest";
import { createReadMarks, newestChanged } from "./chat-events";

describe("createReadMarks", () => {
  it("marca leído la primera vez y no en los cambios de estado del mismo mensaje", () => {
    const marks = createReadMarks();
    expect(marks.first("m1")).toBe(true); // guardado
    expect(marks.first("m1")).toBe(false); // enviado
    expect(marks.first("m1")).toBe(false); // entregado
    expect(marks.first("m2")).toBe(true); // llegó otro
  });

  it("olvida los más viejos pasado el límite", () => {
    const marks = createReadMarks(2);
    marks.first("a");
    marks.first("b");
    marks.first("c"); // saca a «a»
    expect(marks.first("b")).toBe(false);
    expect(marks.first("a")).toBe(true);
  });
});

describe("newestChanged", () => {
  const ids = (...list: string[]) => list.map((id) => ({ id }));

  it("primera carga de la conversación: no cuenta", () => {
    expect(newestChanged(undefined, ids("a", "b"))).toBe(false);
  });

  it("solo cambió el estado (mismos mensajes): no cuenta", () => {
    expect(newestChanged(ids("a", "b"), ids("a", "b"))).toBe(false);
  });

  it("llegó un mensaje o se reemplazó el último: cuenta", () => {
    expect(newestChanged(ids("a", "b"), ids("a", "b", "c"))).toBe(true);
    expect(newestChanged(ids("a", "cola"), ids("a", "real"))).toBe(true);
    expect(newestChanged([], ids("a"))).toBe(true);
  });
});
