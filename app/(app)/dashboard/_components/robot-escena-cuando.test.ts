import { describe, expect, it } from "vitest";
import { elegirEscena, ESCENA_MS, ESCENA_TONO_MS, type FotoPildora } from "./robot-escena-cuando";

const programado: FotoPildora = {
  estado: "activo",
  id: "f1",
  dueAt: "2026-10-14T01:00:00.000Z",
  enviados: 0,
  ultimoSalio: false,
  cara: "normal",
  etiqueta: "mar 18:00",
  tono: "azul",
};
const suspendido: FotoPildora = { ...programado, cara: "dormido", tono: "ambar" };
const cancelado: FotoPildora = { estado: "cancelado", id: null, dueAt: null, enviados: 0, ultimoSalio: false, cara: "cancelado", etiqueta: null, tono: "gris" };
const dormido: FotoPildora = { ...cancelado, estado: "dormido", cara: "dormido" };
const baja: FotoPildora = { ...cancelado, estado: "baja", etiqueta: "Se dio de baja", tono: "rojo" };

describe("escena de la píldora del seguimiento", () => {
  it("disparo al pasar a Cancelado, desde programado o desde dormido (Apagar)", () => {
    expect(elegirEscena(programado, cancelado)).toBe("disparo");
    expect(elegirEscena(suspendido, cancelado)).toBe("disparo");
    expect(elegirEscena(dormido, cancelado)).toBe("disparo");
    expect(elegirEscena(cancelado, cancelado)).toBeNull();
  });

  it("reparación al reactivar: despierta o se vuelve a dormir según la carita nueva", () => {
    expect(elegirEscena(cancelado, programado)).toBe("reparacion");
    expect(elegirEscena(cancelado, suspendido)).toBe("reparacion-dormido");
    expect(elegirEscena(cancelado, dormido)).toBe("reparacion-dormido");
    expect(elegirEscena(cancelado, baja)).toBeNull();
  });

  it("avión cuando el mismo seguimiento tiene un mensaje más y sí salió", () => {
    const salio = { ...programado, enviados: 1, ultimoSalio: true, dueAt: "2026-10-16T01:00:00.000Z", etiqueta: "jue 18:00" };
    expect(elegirEscena(programado, salio)).toBe("avion");
    expect(elegirEscena(programado, { ...salio, ultimoSalio: false })).toBeNull();
    expect(elegirEscena(programado, { ...salio, id: "f2" })).toBeNull();
  });

  it("despertador con Que salga solo", () => {
    expect(elegirEscena(suspendido, programado)).toBe("despertador");
    expect(elegirEscena(programado, suspendido)).toBeNull();
  });

  it("reloj al cambiar la hora con el robot despierto", () => {
    expect(elegirEscena(programado, { ...programado, dueAt: "2026-10-15T17:00:00.000Z", etiqueta: "mié 10:00" })).toBe("reloj");
    expect(elegirEscena(suspendido, { ...suspendido, dueAt: "2026-10-15T17:00:00.000Z" })).toBeNull();
    expect(elegirEscena(programado, { ...programado, etiqueta: "hoy 18:00" })).toBeNull();
  });

  it("sin escena en lo demás: otro seguimiento, dormido, se dio de baja", () => {
    expect(elegirEscena(programado, { ...programado, id: "f2", dueAt: "2026-10-20T01:00:00.000Z" })).toBeNull();
    expect(elegirEscena(programado, dormido)).toBeNull();
    expect(elegirEscena(dormido, programado)).toBeNull();
    expect(elegirEscena(programado, baja)).toBeNull();
  });

  it("el cambio de color cae antes de que termine la escena", () => {
    for (const [escena, ms] of Object.entries(ESCENA_TONO_MS)) expect(ms).toBeLessThan(ESCENA_MS[escena as keyof typeof ESCENA_MS]);
  });
});
