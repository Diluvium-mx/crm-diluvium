import { describe, expect, it } from "vitest";
import type { OpinionFila } from "./queries";
import { opinionVista } from "./vista";

const fila: OpinionFila = {
  id: "op1",
  token: "AbCdEfGhIjKlMnOpQrStUv",
  codigo: "DILU-4K7P",
  prueba: false,
  estado: "contestada",
  // 20:05 UTC = 13:05 en Mazatlán (UTC-7).
  createdAt: new Date("2026-10-01T18:00:00Z"),
  answeredAt: new Date("2026-10-03T20:05:00Z"),
  expiresAt: new Date("2026-11-30T18:00:00Z"),
  contacto: "Rosa Mendoza",
  estrellas: 5,
  texto: "No entró nada.",
  lluvia: "resistio",
  permiso: "con_nombre",
  nombre: "R. Mendoza",
  ciudad: "Culiacán",
};

describe("opinionVista", () => {
  it("contestada con su nombre: nombre y ciudad que dio, hora de Mazatlán y etiquetas", () => {
    const v = opinionVista(fila, "https://crm.example.com");
    expect(v.titulo).toBe("R. Mendoza · Culiacán");
    expect(v.fecha).toBe("Contestó el 3-oct-2026 13:05");
    expect(v.etiquetas).toEqual([
      { texto: "Resistió", tono: "bien" },
      { texto: "Con su nombre", tono: "marca" },
      { texto: "Código DILU-4K7P", tono: "neutro" },
    ]);
    expect(v.enlace).toBeNull();
  });

  it("sin permiso de nombre usa el contacto del CRM y no muestra la ciudad", () => {
    const v = opinionVista({ ...fila, permiso: "no", lluvia: "se_metio" }, "");
    expect(v.titulo).toBe("Rosa Mendoza");
    expect(v.etiquetas.slice(0, 2)).toEqual([
      { texto: "Se metió agua", tono: "alerta" },
      { texto: "No publicar", tono: "neutro" },
    ]);
  });

  it("prueba sin contestar: «Prueba», cuándo vence y su enlace para copiar", () => {
    const v = opinionVista(
      { ...fila, prueba: true, estado: "pendiente", contacto: null, answeredAt: null, estrellas: null, texto: null, lluvia: null, permiso: null, nombre: null, ciudad: null },
      "https://crm.example.com",
    );
    expect(v.titulo).toBe("Prueba");
    expect(v.fecha).toBe("Esperando respuesta · vence el 30-nov-2026");
    expect(v.etiquetas).toEqual([{ texto: "Código DILU-4K7P", tono: "neutro" }]);
    expect(v.enlace).toBe("https://crm.example.com/opinion/AbCdEfGhIjKlMnOpQrStUv");
  });

  it("vencida: sin enlace", () => {
    const v = opinionVista({ ...fila, estado: "vencida", answeredAt: null }, "https://crm.example.com");
    expect(v.fecha).toBe("Venció sin respuesta el 30-nov-2026");
    expect(v.enlace).toBeNull();
  });
});
