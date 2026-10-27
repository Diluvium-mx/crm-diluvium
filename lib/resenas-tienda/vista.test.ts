import { describe, expect, it } from "vitest";
import type { ResenaFila } from "./queries";
import { bloqueoDe, resenaVista } from "./vista";

const NOW = new Date("2026-10-27T22:00:00Z");
const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const SIN_ENLACES = { amazon: null, mercado_libre: null };

// De Mercado Libre y con más de 40 días desde que lo dijo: ya pasó Compra Protegida.
function fila(over: Partial<ResenaFila> = {}): ResenaFila {
  return {
    id: "r1",
    contactId: "c1",
    conversationId: "conv1",
    tienda: "mercado_libre",
    frase: "Ya la encargué en Mercado Libre, gracias",
    estado: "por_pedir",
    createdAt: new Date("2026-09-10T15:45:00Z"),
    pedidaAt: null,
    contacto: "Pedro",
    telefono: "+526681110000",
    canal: "whatsapp",
    windowExpiresAt: new Date(NOW.getTime() + 5 * HORA),
    ...over,
  };
}

describe("cómo se ve cada cliente en Amazon y Mercado Libre", () => {
  it("Mercado Libre por pedir, con la ventana abierta: se puede pedir y trae el texto que saldría", () => {
    const v = resenaVista(fila(), SIN_ENLACES, NOW);
    expect(v).toMatchObject({ titulo: "Pedro", tienda: "Mercado Libre", estadoTexto: "Por pedir", tono: "alerta", bloqueo: null, enAmazon: false, fecha: "Lo dijo el 10-sep-2026", chatHref: "/dashboard?contacto=c1" });
    expect(v.mensaje).toContain("nuestra compuerta en Mercado Libre");
  });

  it("Mercado Libre antes de 40 días: no se le escribe por fuera mientras dura Compra Protegida", () => {
    const reciente = fila({ createdAt: new Date("2026-10-03T15:37:00Z") });
    expect(resenaVista(reciente, SIN_ENLACES, NOW).bloqueo).toBe(
      "Mercado Libre no deja escribirle por fuera mientras dura Compra Protegida: se puede desde el 12-nov-2026.",
    );
    const despues = new Date("2026-11-12T16:00:00Z");
    expect(bloqueoDe({ ...reciente, windowExpiresAt: new Date(despues.getTime() + HORA) }, despues)).toBeNull();
  });

  it("WhatsApp fuera de 24 h: se manda la plantilla desde el chat y su respuesta abre «Pedir reseña»", () => {
    const v = resenaVista(fila({ windowExpiresAt: new Date(NOW.getTime() - HORA) }), SIN_ENLACES, NOW);
    expect(v.bloqueo).toMatch(/más de 24 h.*plantilla «Reseña en tienda»/);
  });

  it("Instagram: un vendedor puede hasta 7 días desde su último mensaje", () => {
    const tresDias = fila({ canal: "instagram", windowExpiresAt: new Date(NOW.getTime() - 2 * DIA) });
    expect(resenaVista(tresDias, SIN_ENLACES, NOW).bloqueo).toBeNull();
    const ochoDias = fila({ canal: "instagram", windowExpiresAt: new Date(NOW.getTime() - 7 * DIA) });
    expect(resenaVista(ochoDias, SIN_ENLACES, NOW).bloqueo).toMatch(/más de 7 días/);
  });

  it("Amazon: nunca por WhatsApp, aunque la ventana esté abierta; se pide en Seller Central", () => {
    const v = resenaVista(fila({ tienda: "amazon", frase: "Ya la pedí por Amazon" }), SIN_ENLACES, NOW);
    expect(v).toMatchObject({ tienda: "Amazon", enAmazon: true });
    expect(v.bloqueo).toMatch(/^Amazon no deja pedirla por WhatsApp: pídala en Seller Central/);
  });

  it("sin chat no se puede; ya pedida, dice cuándo y no muestra bloqueo", () => {
    expect(resenaVista(fila({ conversationId: null, canal: null }), SIN_ENLACES, NOW).bloqueo).toMatch(/Ya no está el chat/);
    const pedida = resenaVista(fila({ estado: "pedida", pedidaAt: new Date("2026-10-27T17:30:00Z"), windowExpiresAt: null }), SIN_ENLACES, NOW);
    expect(pedida).toMatchObject({ estadoTexto: "Pedida", bloqueo: null, fecha: "Se le pidió el 27-oct-2026 10:30" });
  });

  it("el enlace configurado de la tienda va en el mensaje", () => {
    const v = resenaVista(fila(), { amazon: null, mercado_libre: "https://ejemplo.mx/opinar" }, NOW);
    expect(v.mensaje).toContain("Aquí la puede dejar: https://ejemplo.mx/opinar");
  });
});
