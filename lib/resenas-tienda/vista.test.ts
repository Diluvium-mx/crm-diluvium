import { describe, expect, it } from "vitest";
import type { ResenaFila } from "./queries";
import { pasoDe, resenaVista } from "./vista";

const NOW = new Date("2026-10-27T22:00:00Z");
const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

// De Mercado Libre, con más de 40 días desde que lo dijo (ya pasó Compra Protegida) y la ventana abierta.
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
    channelId: "ch1",
    windowExpiresAt: new Date(NOW.getTime() + 5 * HORA),
    plantillaAt: null,
    ...over,
  };
}

describe("Amazon: se pide en Seller Central, sin marcar nada a mano", () => {
  it("sale para pedir con el botón a Seller Central y la fecha límite, aunque alguien la haya marcado como pedida", () => {
    for (const estado of ["por_pedir", "pedida"] as const) {
      const v = resenaVista(fila({ tienda: "amazon", estado, createdAt: new Date("2026-10-13T21:00:00Z"), frase: "Disculpe lo pedí por Amazon" }), NOW);
      expect(v).toMatchObject({ tienda: "Amazon", seccion: "pedir", accion: "amazon", mensaje: null });
      expect(v?.aviso).toBe("En su pedido de Seller Central, toque «Solicitar una reseña». Amazon deja hasta el 17-nov-2026.");
    }
  });

  it("pasado su plazo (35 días desde que lo dijo) ya no sale", () => {
    expect(resenaVista(fila({ tienda: "amazon", createdAt: new Date(NOW.getTime() - 35 * DIA) }), NOW)).toBeNull();
  });
});

describe("Mercado Libre: cuando su tienda lo permite, texto o plantilla", () => {
  it("antes de 40 días: en espera, con la fecha desde la que se puede", () => {
    const v = resenaVista(fila({ createdAt: new Date("2026-10-03T15:37:00Z") }), NOW);
    expect(v).toMatchObject({ seccion: "espera", accion: null, mensaje: null });
    expect(v?.aviso).toBe("Se le puede escribir desde el 12-nov-2026: antes, Mercado Libre no lo permite (Compra Protegida).");
  });

  it("ventana abierta: «Pedir reseña» con el texto que saldría", () => {
    const v = resenaVista(fila(), NOW);
    expect(v).toMatchObject({ titulo: "Pedro", tienda: "Mercado Libre", seccion: "pedir", accion: "texto", dicho: "Lo dijo el 10-sep-2026", chatHref: "/dashboard?contacto=c1" });
    expect(v?.mensaje).toContain("nuestra compuerta en Mercado Libre");
  });

  it("WhatsApp de más de 24 h: primero la plantilla; ya mandada, espera su respuesta; contestó, ya sale el texto", () => {
    const cerrada = { windowExpiresAt: new Date(NOW.getTime() - HORA) };
    expect(resenaVista(fila(cerrada), NOW)).toMatchObject({ seccion: "pedir", accion: "plantilla" });
    expect(resenaVista(fila(cerrada), NOW)?.mensaje).toContain("por la compuerta que pidió en Mercado Libre");

    const mandada = resenaVista(fila({ ...cerrada, plantillaAt: new Date("2026-10-26T17:30:00Z") }), NOW);
    expect(mandada).toMatchObject({ seccion: "espera", accion: null, aviso: "Le mandamos la plantilla el 26-oct-2026 10:30: cuando conteste, sale «Pedir reseña»." });

    expect(pasoDe(fila({ plantillaAt: new Date("2026-10-26T17:30:00Z") }), NOW)?.accion).toBe("texto");
  });

  it("Instagram (sin plantillas): un vendedor puede hasta 7 días; después, a esperar que escriba", () => {
    expect(pasoDe(fila({ canal: "instagram", windowExpiresAt: new Date(NOW.getTime() - 2 * DIA) }), NOW)?.accion).toBe("texto");
    expect(pasoDe(fila({ canal: "instagram", windowExpiresAt: new Date(NOW.getTime() - 7 * DIA) }), NOW)).toMatchObject({ seccion: "espera", accion: null });
  });

  it("ya pedida: dice cuándo; sin chat, no hay acción", () => {
    const pedida = resenaVista(fila({ estado: "pedida", pedidaAt: new Date("2026-10-27T17:30:00Z") }), NOW);
    expect(pedida).toMatchObject({ seccion: "pedida", accion: null, aviso: "Se le pidió el 27-oct-2026 10:30." });
    expect(pasoDe(fila({ conversationId: null, canal: null }), NOW)).toMatchObject({ accion: null, aviso: "Ya no está el chat donde lo dijo." });
  });
});
