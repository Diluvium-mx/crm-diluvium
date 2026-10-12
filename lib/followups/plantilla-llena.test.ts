import { describe, expect, it } from "vitest";
import { fillFollowUpTemplate, followUpCanFill } from "./plantilla-llena";

describe("plantillas que puede mandar un seguimiento", () => {
  it("sin datos o con la frase de tiempo, sí; con el nombre u otro dato, no", () => {
    expect(followUpCanFill("hola_buenas_tardes", "Hola, buenas tardes.")).toBe(true);
    expect(followUpCanFill("seg_medidas", "Referente a lo que nos comentó {{1}}.")).toBe(true);
    expect(followUpCanFill("daniel_medidas", "Hola. Referente a lo que nos comentó {{1}}.")).toBe(true);
    expect(followUpCanFill("promo_nombre", "Hola {{1}}.")).toBe(false);
    expect(followUpCanFill("seg_medidas", "{{1}} y {{2}}")).toBe(false);
  });

  it("llena el {{1}} con cuándo escribió el cliente, visto desde la hora a la que sale", () => {
    const last = new Date("2026-10-05T11:58:00-06:00");
    const sale = new Date("2026-10-07T17:00:00-06:00");
    expect(fillFollowUpTemplate("seg_medidas", "Lo que nos comentó {{1}}.", last, sale, "America/Mexico_City")).toBe("Lo que nos comentó antier.");
    expect(fillFollowUpTemplate("hola_buenas_tardes", "Hola, buenas tardes.", last, sale, "America/Mexico_City")).toBe("Hola, buenas tardes.");
  });
});
