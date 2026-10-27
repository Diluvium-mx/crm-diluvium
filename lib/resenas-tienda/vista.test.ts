import { describe, expect, it } from "vitest";
import type { ResenaFila } from "./queries";
import { resenaVista } from "./vista";

const NOW = new Date("2026-10-27T22:00:00Z");
const HORA = 60 * 60 * 1000;
const SIN_ENLACES = { amazon: null, mercado_libre: null };

function fila(over: Partial<ResenaFila> = {}): ResenaFila {
  return {
    id: "r1",
    contactId: "c1",
    conversationId: "conv1",
    tienda: "amazon",
    frase: "Ya la encargué en Amazon, gracias",
    estado: "por_pedir",
    createdAt: new Date("2026-10-16T15:45:00Z"),
    pedidaAt: null,
    contacto: "Pedro",
    telefono: "+526681110000",
    canal: "whatsapp",
    windowExpiresAt: new Date(NOW.getTime() + 5 * HORA),
    ...over,
  };
}

describe("cómo se ve cada cliente en Amazon y Mercado Libre", () => {
  it("por pedir, con la ventana abierta: se puede pedir y trae el texto que saldría", () => {
    const v = resenaVista(fila(), SIN_ENLACES, NOW);
    expect(v).toMatchObject({ titulo: "Pedro", tienda: "Amazon", estadoTexto: "Por pedir", tono: "alerta", bloqueo: null, fecha: "Lo dijo el 16-oct-2026", chatHref: "/dashboard?contacto=c1" });
    expect(v.mensaje).toContain("nuestra compuerta en Amazon");
  });

  it("WhatsApp fuera de 24 h: todavía no se puede (hace falta que vuelva a escribir)", () => {
    const v = resenaVista(fila({ windowExpiresAt: new Date(NOW.getTime() - HORA) }), SIN_ENLACES, NOW);
    expect(v.bloqueo).toMatch(/más de 24 h/);
  });

  it("Instagram: un vendedor puede hasta 7 días desde su último mensaje", () => {
    const tresDias = fila({ canal: "instagram", windowExpiresAt: new Date(NOW.getTime() - 2 * 24 * HORA) });
    expect(resenaVista(tresDias, SIN_ENLACES, NOW).bloqueo).toBeNull();
    const ochoDias = fila({ canal: "instagram", windowExpiresAt: new Date(NOW.getTime() - 7 * 24 * HORA) });
    expect(resenaVista(ochoDias, SIN_ENLACES, NOW).bloqueo).toMatch(/más de 7 días/);
  });

  it("sin chat no se puede; ya pedida, dice cuándo y no muestra bloqueo", () => {
    expect(resenaVista(fila({ conversationId: null, canal: null }), SIN_ENLACES, NOW).bloqueo).toMatch(/Ya no está el chat/);
    const pedida = resenaVista(fila({ estado: "pedida", pedidaAt: new Date("2026-10-27T17:30:00Z"), windowExpiresAt: null }), SIN_ENLACES, NOW);
    expect(pedida).toMatchObject({ estadoTexto: "Pedida", bloqueo: null, fecha: "Se le pidió el 27-oct-2026 10:30" });
  });

  it("el enlace configurado de la tienda va en el mensaje", () => {
    const v = resenaVista(fila({ tienda: "mercado_libre" }), { amazon: null, mercado_libre: "https://ejemplo.mx/opinar" }, NOW);
    expect(v.mensaje).toContain("Aquí la puede dejar: https://ejemplo.mx/opinar");
  });
});
